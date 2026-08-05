use ade_host_core::terminal::{TerminalCommand, TerminalRuntime, TerminalSnapshot, TerminalStatus};
use portable_pty::{native_pty_system, Child, CommandBuilder, ExitStatus, MasterPty, PtySize};
use std::collections::BTreeMap;
#[cfg(unix)]
use std::io;
use std::io::{Read, Write};
use std::path::PathBuf;
#[cfg(windows)]
use std::process::Stdio;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const OUTPUT_CHUNK_BYTES: usize = 8192;
const OUTPUT_CHANNEL_CAPACITY: usize = 64;
pub const MAX_PTY_OUTPUT_BYTES: usize = 1024 * 1024;
const READER_CLOSE_TIMEOUT: Duration = Duration::from_secs(1);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtySpec {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

impl PtySpec {
    fn validate(&self) -> Result<(), PtyError> {
        if self.program.trim().is_empty() {
            return Err(PtyError::EmptyProgram);
        }
        if self.cols == 0 || self.rows == 0 {
            return Err(PtyError::InvalidSize);
        }
        if let Some(path) = &self.current_dir {
            if !path.is_dir() {
                return Err(PtyError::InvalidWorkingDirectory(path.clone()));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyError {
    EmptyProgram,
    InvalidSize,
    InvalidWorkingDirectory(PathBuf),
    Spawn(String),
    Input(String),
    Resize(String),
    Output(String),
    Terminal(String),
    Timeout,
    Termination(String),
}

pub struct PtySession {
    terminal: TerminalRuntime,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    process_id: Option<u32>,
    process_group: Option<i32>,
    output_rx: Receiver<Result<Vec<u8>, String>>,
    reader_thread: Option<JoinHandle<()>>,
    output_bytes: usize,
    output_sequence: u64,
    pending_utf8: Vec<u8>,
    terminated: bool,
    child_reaped: bool,
}

impl PtySession {
    pub fn spawn(terminal_id: impl Into<String>, spec: PtySpec) -> Result<Self, PtyError> {
        spec.validate()?;
        let terminal = TerminalRuntime::new(terminal_id).map_err(terminal_error)?;
        terminal
            .apply(0, TerminalCommand::Start)
            .map_err(terminal_error)?;

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: spec.rows,
                cols: spec.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        let mut command = CommandBuilder::new(spec.program);
        command.args(spec.args);
        if let Some(current_dir) = spec.current_dir {
            command.cwd(current_dir);
        }
        for (key, value) in spec.environment {
            command.env(key, value);
        }
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        let process_id = child.process_id();
        #[cfg(unix)]
        let process_group = pair.master.process_group_leader();
        #[cfg(not(unix))]
        let process_group = None;
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(PtyError::Spawn(error.to_string()));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(PtyError::Spawn(error.to_string()));
            }
        };
        let (output_tx, output_rx) = mpsc::sync_channel(OUTPUT_CHANNEL_CAPACITY);
        let reader_thread = Some(spawn_reader(reader, output_tx));

        Ok(Self {
            terminal,
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            child: Arc::new(Mutex::new(child)),
            process_id,
            process_group,
            output_rx,
            reader_thread,
            output_bytes: 0,
            output_sequence: 0,
            pending_utf8: Vec::new(),
            terminated: false,
            child_reaped: false,
        })
    }

    pub fn write(&self, input: &[u8]) -> Result<(), PtyError> {
        let snapshot = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(snapshot.status, TerminalStatus::Running) {
            return Err(PtyError::Terminal(String::from("pty_not_running")));
        }
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| PtyError::Input(String::from("pty_writer_unavailable")))?;
        let writer = writer
            .as_mut()
            .ok_or_else(|| PtyError::Input(String::from("pty_not_running")))?;
        writer
            .write_all(input)
            .and_then(|_| writer.flush())
            .map_err(|error| PtyError::Input(error.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        if cols == 0 || rows == 0 {
            return Err(PtyError::InvalidSize);
        }
        let snapshot = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(snapshot.status, TerminalStatus::Running) {
            return Err(PtyError::Terminal(String::from("pty_not_running")));
        }
        let mut master = self
            .master
            .lock()
            .map_err(|_| PtyError::Resize(String::from("pty_master_unavailable")))?;
        master
            .as_mut()
            .ok_or_else(|| PtyError::Resize(String::from("pty_not_running")))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Resize(error.to_string()))
    }

    pub fn poll(&mut self) -> Result<TerminalSnapshot, PtyError> {
        if let Err(error) = self.drain_output() {
            self.fail_after_backend_error(&error);
            return Err(error);
        }
        let current = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(current.status, TerminalStatus::Running) {
            return Ok(current);
        }
        let exit = self.observe_child_exit()?;
        if let Some(status) = exit {
            return self.complete_natural_exit(status);
        }
        self.terminal.snapshot().map_err(terminal_error)
    }

    pub fn wait(&mut self, timeout: Duration) -> Result<TerminalSnapshot, PtyError> {
        let started = Instant::now();
        loop {
            let snapshot = self.poll()?;
            if !matches!(snapshot.status, TerminalStatus::Running) {
                return Ok(snapshot);
            }
            if started.elapsed() >= timeout {
                let termination_error = match self.terminate_running_process() {
                    Ok(Some(status)) => return self.complete_natural_exit(status),
                    Ok(None) => None,
                    Err(error) => Some(error),
                };
                let reap = if termination_error.is_none() || self.child_reaped {
                    self.reap_child()
                } else {
                    Err(PtyError::Termination(String::from(
                        "pty child termination was not confirmed",
                    )))
                };
                let drain = self.drain_output_until_reader_closes();
                if drain.is_err() {
                    self.disconnect_output_reader();
                }
                let cleanup_error = termination_error
                    .or_else(|| reap.err())
                    .or_else(|| drain.err());
                let reason = cleanup_error
                    .as_ref()
                    .map(|error| format!("pty timed out: {error:?}"))
                    .unwrap_or_else(|| String::from("pty timed out"));
                let snapshot = self
                    .terminal
                    .fail_process("", reason)
                    .map_err(terminal_error)?;
                return if cleanup_error.is_some() {
                    Err(PtyError::Termination(String::from(
                        "pty timeout cleanup failed",
                    )))
                } else {
                    Ok(snapshot)
                };
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    pub fn terminate(&mut self) -> Result<TerminalSnapshot, PtyError> {
        // Observe an already-exited child before converting termination into failure.
        let current = self.terminal.snapshot().map_err(terminal_error)?;
        let preserve_failed_state = matches!(current.status, TerminalStatus::Failed { .. });
        if matches!(current.status, TerminalStatus::Running) {
            let observed = self.poll()?;
            if !matches!(observed.status, TerminalStatus::Running) {
                return Ok(observed);
            }
        } else if !matches!(current.status, TerminalStatus::Failed { .. })
            || (self.terminated && self.child_reaped)
        {
            return Ok(current);
        }
        let termination_error = match self.terminate_running_process() {
            Ok(Some(status)) => return self.complete_natural_exit(status),
            Ok(None) => None,
            Err(error) => Some(error),
        };
        let reap = if termination_error.is_none() || self.child_reaped {
            self.reap_child()
        } else {
            Err(PtyError::Termination(String::from(
                "pty child termination was not confirmed",
            )))
        };
        let drain = self.drain_output_until_reader_closes();
        if drain.is_err() {
            self.disconnect_output_reader();
        }
        let cleanup_error = termination_error
            .or_else(|| reap.err())
            .or_else(|| drain.err());
        let reason = cleanup_error
            .as_ref()
            .map(|error| format!("pty termination cleanup failed: {error:?}"))
            .unwrap_or_else(|| String::from("pty terminated"));
        let snapshot = if preserve_failed_state {
            self.terminal.snapshot().map_err(terminal_error)?
        } else {
            self.terminal
                .fail_process("", reason)
                .map_err(terminal_error)?
        };
        if cleanup_error.is_some() {
            Err(PtyError::Termination(String::from(
                "pty termination cleanup failed",
            )))
        } else {
            Ok(snapshot)
        }
    }

    pub fn snapshot(&self) -> Result<TerminalSnapshot, PtyError> {
        self.terminal.snapshot().map_err(terminal_error)
    }

    fn observe_child_exit(&mut self) -> Result<Option<ExitStatus>, PtyError> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| PtyError::Terminal(String::from("pty_child_unavailable")))?;
        let exit =
            try_wait_child(&mut child).map_err(|error| PtyError::Terminal(format!("{error:?}")))?;
        if exit.is_some() {
            self.child_reaped = true;
        }
        Ok(exit)
    }

    fn complete_natural_exit(&mut self, status: ExitStatus) -> Result<TerminalSnapshot, PtyError> {
        if status.exit_code() > i32::MAX as u32 {
            let error = PtyError::Termination(String::from("pty returned an invalid exit code"));
            self.fail_after_backend_error(&error);
            return Err(error);
        }
        if let Err(error) = self.close_pty_handles() {
            self.fail_after_backend_error(&error);
            return Err(error);
        }
        if let Err(error) = self.drain_output_until_reader_closes() {
            let _ = self.terminate_descendants();
            if self.drain_output_until_reader_closes().is_err() {
                self.disconnect_output_reader();
            }
            self.fail_after_backend_error(&error);
            return Err(error);
        }
        self.terminated = true;
        if let Err(error) = self.finish_output() {
            self.fail_after_backend_error(&error);
            return Err(error);
        }
        let current = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(current.status, TerminalStatus::Running) {
            return Ok(current);
        }
        self.terminal
            .complete_process("", status.exit_code() as i32)
            .map_err(terminal_error)
    }

    fn drain_output(&mut self) -> Result<(), PtyError> {
        loop {
            match self.output_rx.try_recv() {
                Ok(Ok(bytes)) => self.record_output(bytes)?,
                Ok(Err(reason)) => return Err(PtyError::Output(reason)),
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => return Ok(()),
            }
        }
    }

    fn drain_output_until_reader_closes(&mut self) -> Result<(), PtyError> {
        let deadline = Instant::now() + READER_CLOSE_TIMEOUT;
        loop {
            match self
                .output_rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            {
                Ok(Ok(bytes)) => self.record_output(bytes)?,
                Ok(Err(reason)) => return Err(PtyError::Output(reason)),
                Err(RecvTimeoutError::Disconnected) => return Ok(()),
                Err(RecvTimeoutError::Timeout) => {
                    return Err(PtyError::Termination(String::from(
                        "pty reader did not close",
                    )))
                }
            }
        }
    }

    fn record_output(&mut self, bytes: Vec<u8>) -> Result<(), PtyError> {
        let next_total = self
            .output_bytes
            .checked_add(bytes.len())
            .ok_or_else(|| PtyError::Output(String::from("pty output limit exceeded")))?;
        if next_total > MAX_PTY_OUTPUT_BYTES {
            return Err(PtyError::Output(String::from("pty output limit exceeded")));
        }
        self.output_bytes = next_total;
        let mut combined = std::mem::take(&mut self.pending_utf8);
        combined.extend(bytes);
        let data = match std::str::from_utf8(&combined) {
            Ok(data) => data.to_owned(),
            Err(error) if error.error_len().is_none() => {
                self.pending_utf8 = combined[error.valid_up_to()..].to_vec();
                std::str::from_utf8(&combined[..error.valid_up_to()])
                    .map_err(|error| {
                        PtyError::Output(format!("pty output is not valid UTF-8: {error}"))
                    })?
                    .to_owned()
            }
            Err(error) => {
                return Err(PtyError::Output(format!(
                    "pty output is not valid UTF-8: {error}"
                )))
            }
        };
        if data.is_empty() {
            return Ok(());
        }
        self.output_sequence = self
            .output_sequence
            .checked_add(1)
            .ok_or_else(|| PtyError::Output(String::from("pty output sequence overflow")))?;
        let snapshot = self.terminal.snapshot().map_err(terminal_error)?;
        self.terminal
            .apply(
                snapshot.generation,
                TerminalCommand::Output {
                    sequence: self.output_sequence,
                    data,
                },
            )
            .map_err(terminal_error)?;
        Ok(())
    }

    fn finish_output(&mut self) -> Result<(), PtyError> {
        if self.pending_utf8.is_empty() {
            return Ok(());
        }
        Err(PtyError::Output(String::from(
            "pty output ended with incomplete UTF-8",
        )))
    }

    fn fail_after_backend_error(&mut self, error: &PtyError) {
        let termination = self.terminate_running_process();
        let descendants = self.terminate_descendants();
        if termination.is_ok() || self.child_reaped {
            let _ = self.reap_child();
        }
        let _ = self.close_pty_handles();
        if termination.is_err() || descendants.is_err() {
            self.disconnect_output_reader();
        }
        let _ = self
            .terminal
            .fail_process("", format!("pty backend failure: {error:?}"));
    }

    fn disconnect_output_reader(&mut self) {
        let (_, replacement) = mpsc::sync_channel(1);
        let _ = std::mem::replace(&mut self.output_rx, replacement);
    }

    fn reap_child(&mut self) -> Result<(), PtyError> {
        if self.child_reaped {
            return Ok(());
        }
        let mut child = self
            .child
            .lock()
            .map_err(|_| PtyError::Termination(String::from("pty_child_unavailable")))?;
        child
            .wait()
            .map_err(|error| PtyError::Termination(error.to_string()))?;
        self.child_reaped = true;
        Ok(())
    }

    fn terminate_running_process(&mut self) -> Result<Option<ExitStatus>, PtyError> {
        if self.terminated {
            return Ok(None);
        }
        let mut child = self
            .child
            .lock()
            .map_err(|_| PtyError::Termination(String::from("pty_child_unavailable")))?;
        if let Some(status) = try_wait_child(&mut child)? {
            self.child_reaped = true;
            return Ok(Some(status));
        }
        let pid = child.process_id();
        if let Some(pid) = pid {
            match terminate_process_tree(self.process_group, pid)? {
                ProcessTermination::Signalled => {
                    confirm_child_exit(&mut child)?;
                    self.child_reaped = true;
                }
                ProcessTermination::AlreadyExited => {
                    if let Some(status) = try_wait_child(&mut child)? {
                        self.child_reaped = true;
                        return Ok(Some(status));
                    }
                    return Err(PtyError::Termination(String::from(
                        "pty exited before termination status was observable",
                    )));
                }
            }
        } else if !self.child_reaped {
            child
                .kill()
                .map_err(|error| PtyError::Termination(error.to_string()))?;
            confirm_child_exit(&mut child)?;
            self.child_reaped = true;
        }
        drop(child);
        self.close_pty_handles()?;
        self.terminated = true;
        Ok(None)
    }

    fn close_pty_handles(&mut self) -> Result<(), PtyError> {
        self.writer
            .lock()
            .map_err(|_| PtyError::Termination(String::from("pty_writer_unavailable")))?
            .take();
        self.master
            .lock()
            .map_err(|_| PtyError::Termination(String::from("pty_master_unavailable")))?
            .take();
        Ok(())
    }

    #[cfg(unix)]
    fn terminate_descendants(&self) -> Result<(), PtyError> {
        let (Some(process_group), Some(process_id)) = (self.process_group, self.process_id) else {
            return Ok(());
        };
        terminate_process_tree(Some(process_group), process_id).map(|_| ())
    }

    #[cfg(not(unix))]
    fn terminate_descendants(&self) -> Result<(), PtyError> {
        Ok(())
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        let termination = self.terminate_running_process();
        let descendants = self.terminate_descendants();
        if termination.is_ok() || self.child_reaped {
            let _ = self.reap_child();
        }
        if (termination.is_ok() || self.child_reaped) && descendants.is_ok() {
            if let Some(reader_thread) = self.reader_thread.take() {
                let _ = reader_thread.join();
            }
        } else {
            self.reader_thread.take();
        }
    }
}

fn spawn_reader(
    mut reader: Box<dyn Read + Send>,
    output_tx: SyncSender<Result<Vec<u8>, String>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; OUTPUT_CHUNK_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(size) => {
                    if output_tx.send(Ok(buffer[..size].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = output_tx.send(Err(error.to_string()));
                    return;
                }
            }
        }
    })
}

fn terminal_error(error: ade_host_core::terminal::TerminalError) -> PtyError {
    PtyError::Terminal(format!("{error:?}"))
}

fn confirm_child_exit(child: &mut Box<dyn Child + Send + Sync>) -> Result<(), PtyError> {
    let deadline = Instant::now() + READER_CLOSE_TIMEOUT;
    loop {
        if try_wait_child(child)?.is_some() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(PtyError::Termination(String::from(
                "pty child did not exit after termination",
            )));
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn try_wait_child(
    child: &mut Box<dyn Child + Send + Sync>,
) -> Result<Option<ExitStatus>, PtyError> {
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        if windows_process_has_exited(pid)? {
            return child
                .wait()
                .map(Some)
                .map_err(|error| PtyError::Termination(error.to_string()));
        }
    }
    child
        .try_wait()
        .map_err(|error| PtyError::Termination(error.to_string()))
}

#[cfg(windows)]
fn windows_process_has_exited(pid: u32) -> Result<bool, PtyError> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;

    unsafe extern "system" {
        #[link_name = "OpenProcess"]
        fn open_process(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        #[link_name = "WaitForSingleObject"]
        fn wait_for_single_object(handle: *mut c_void, milliseconds: u32) -> u32;
        #[link_name = "CloseHandle"]
        fn close_handle(handle: *mut c_void) -> i32;
    }

    // portable-pty maps exit code 259 to `Running`; the process handle is authoritative.
    let handle = unsafe { open_process(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid) };
    if handle == null_mut() {
        return Err(PtyError::Termination(String::from(
            "could not inspect Windows PTY process",
        )));
    }
    let result = unsafe { wait_for_single_object(handle, 0) };
    let close_result = unsafe { close_handle(handle) };
    if close_result == 0 {
        return Err(PtyError::Termination(String::from(
            "could not close Windows PTY process handle",
        )));
    }
    match result {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => Ok(false),
        _ => Err(PtyError::Termination(String::from(
            "could not observe Windows PTY process state",
        ))),
    }
}

enum ProcessTermination {
    Signalled,
    AlreadyExited,
}

#[cfg(unix)]
fn terminate_process_tree(
    process_group: Option<i32>,
    pid: u32,
) -> Result<ProcessTermination, PtyError> {
    let process_group = process_group.unwrap_or(pid as i32) as libc::pid_t;
    let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
    if result == 0 {
        return Ok(ProcessTermination::Signalled);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(libc::ESRCH) {
        return Err(PtyError::Termination(error.to_string()));
    }
    if unsafe { libc::kill(-process_group, 0) } == 0 {
        return Err(PtyError::Termination(String::from(
            "pty process group remains after termination",
        )));
    }
    Ok(ProcessTermination::AlreadyExited)
}

#[cfg(windows)]
fn terminate_process_tree(
    _process_group: Option<i32>,
    pid: u32,
) -> Result<ProcessTermination, PtyError> {
    let mut taskkill = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| PtyError::Termination(error.to_string()))?;
    let deadline = Instant::now() + READER_CLOSE_TIMEOUT;
    loop {
        match taskkill.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(ProcessTermination::Signalled),
            Ok(Some(status)) => {
                return Err(PtyError::Termination(format!(
                    "taskkill exited with {status}"
                )))
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = taskkill.kill();
                let _ = taskkill.wait();
                return Err(PtyError::Termination(String::from("taskkill timed out")));
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                return Err(PtyError::Termination(format!(
                    "taskkill wait failed: {error}"
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PtyError, PtySession, PtySpec};
    use ade_host_core::terminal::TerminalStatus;
    use std::collections::BTreeMap;
    use std::time::Duration;

    fn spec(program: &str, args: &[&str]) -> PtySpec {
        PtySpec {
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            current_dir: None,
            environment: BTreeMap::new(),
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn rejects_empty_program_before_opening_a_pty() {
        assert!(matches!(
            PtySession::spawn("pty-1", spec(" ", &[])),
            Err(PtyError::EmptyProgram)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn observes_pty_output_and_exit_from_authoritative_state() {
        let mut session = PtySession::spawn("pty-1", spec("printf", &["ready"])).unwrap();
        let snapshot = session.wait(Duration::from_secs(2)).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
        assert!(snapshot.output_sequence >= 1);
        assert!(snapshot.tail.contains("ready"));
    }

    #[cfg(unix)]
    #[test]
    fn natural_exit_terminates_a_descendant_holding_the_pty_open() {
        let mut session =
            PtySession::spawn("pty-1", spec("sh", &["-c", "sleep 5 & exit 0"])).unwrap();
        let snapshot = session.wait(Duration::from_secs(2)).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
    }

    #[cfg(unix)]
    #[test]
    fn writes_input_and_applies_resize_to_a_live_pty() {
        let mut session = PtySession::spawn(
            "pty-1",
            spec("sh", &["-c", "read line; printf 'got:%s' \"$line\""]),
        )
        .unwrap();
        session.resize(100, 40).unwrap();
        session.write(b"input\n").unwrap();
        let snapshot = session.wait(Duration::from_secs(2)).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
        assert!(snapshot.tail.contains("got:input"));
    }

    #[cfg(unix)]
    #[test]
    fn timeout_publishes_failure_and_does_not_report_success() {
        let mut session = PtySession::spawn("pty-1", spec("sleep", &["2"])).unwrap();
        let snapshot = session.wait(Duration::from_millis(20)).unwrap();

        assert!(matches!(snapshot.status, TerminalStatus::Failed { .. }));
        assert_eq!(snapshot.exit_code, None);
        assert_eq!(snapshot.failure_reason.as_deref(), Some("pty timed out"));
    }

    #[cfg(unix)]
    #[test]
    fn terminate_observes_a_natural_exit_before_marking_failure() {
        let mut session =
            PtySession::spawn("pty-1", spec("sh", &["-c", "printf 'ready'; exit 7"])).unwrap();
        std::thread::sleep(Duration::from_millis(50));

        let snapshot = session.terminate().unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 7 });
        assert_eq!(snapshot.exit_code, Some(7));
        assert_eq!(snapshot.failure_reason, None);
        assert!(snapshot.tail.contains("ready"));
    }

    #[cfg(windows)]
    #[test]
    fn terminate_observes_a_natural_windows_exit_before_marking_failure() {
        let mut session =
            PtySession::spawn("pty-1", spec("cmd.exe", &["/C", "exit", "0"])).unwrap();
        std::thread::sleep(Duration::from_millis(100));

        let snapshot = session.terminate().unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
        assert_eq!(snapshot.exit_code, Some(0));
    }

    #[cfg(windows)]
    #[test]
    fn observes_windows_exit_code_259_as_a_natural_exit() {
        let mut session =
            PtySession::spawn("pty-1", spec("cmd.exe", &["/C", "exit", "/B", "259"])).unwrap();

        let snapshot = session.wait(Duration::from_secs(2)).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 259 });
        assert_eq!(snapshot.exit_code, Some(259));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_utf8_output_without_replacing_the_bytes() {
        let mut session =
            PtySession::spawn("pty-1", spec("sh", &["-c", "printf '\\377'"])).unwrap();
        let result = session.wait(Duration::from_secs(2));

        assert!(
            matches!(result, Err(PtyError::Output(reason)) if reason.contains("not valid UTF-8"))
        );
        assert!(matches!(
            session.snapshot().unwrap().status,
            TerminalStatus::Failed { .. }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn preserves_a_utf8_codepoint_split_across_reader_chunks() {
        let mut session = PtySession::spawn("pty-1", spec("sleep", &["2"])).unwrap();

        session.record_output(vec![0xe2]).unwrap();
        session.record_output(vec![0x9c, 0x85]).unwrap();

        assert!(session.snapshot().unwrap().tail.contains('✅'));
    }
}
