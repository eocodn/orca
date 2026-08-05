use ade_host_core::terminal::{TerminalCommand, TerminalRuntime, TerminalSnapshot, TerminalStatus};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::BTreeMap;
#[cfg(unix)]
use std::io;
use std::io::{Read, Write};
use std::path::PathBuf;
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
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    output_rx: Receiver<Result<Vec<u8>, String>>,
    reader_thread: Option<JoinHandle<()>>,
    output_bytes: usize,
    output_sequence: u64,
    terminated: bool,
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
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| PtyError::Spawn(error.to_string()))?;
        let (output_tx, output_rx) = mpsc::sync_channel(OUTPUT_CHANNEL_CAPACITY);
        let reader_thread = Some(spawn_reader(reader, output_tx));

        Ok(Self {
            terminal,
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
            output_rx,
            reader_thread,
            output_bytes: 0,
            output_sequence: 0,
            terminated: false,
        })
    }

    pub fn write(&self, input: &[u8]) -> Result<(), PtyError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| PtyError::Input(String::from("pty_writer_unavailable")))?;
        writer
            .write_all(input)
            .and_then(|_| writer.flush())
            .map_err(|error| PtyError::Input(error.to_string()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        if cols == 0 || rows == 0 {
            return Err(PtyError::InvalidSize);
        }
        let master = self
            .master
            .lock()
            .map_err(|_| PtyError::Resize(String::from("pty_master_unavailable")))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| PtyError::Resize(error.to_string()))
    }

    pub fn poll(&mut self) -> Result<TerminalSnapshot, PtyError> {
        self.drain_output()?;
        let current = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(current.status, TerminalStatus::Running) {
            return Ok(current);
        }
        let exit = self
            .child
            .lock()
            .map_err(|_| PtyError::Terminal(String::from("pty_child_unavailable")))?
            .try_wait()
            .map_err(|error| PtyError::Terminal(error.to_string()))?;
        if let Some(status) = exit {
            self.terminate_owned_process(status.exit_code() as i32)?;
            self.drain_output_until_reader_closes()?;
            let code = status.exit_code().min(i32::MAX as u32) as i32;
            return self
                .terminal
                .complete_process("", code)
                .map_err(terminal_error);
        }
        self.terminal.snapshot().map_err(terminal_error)
    }

    pub fn wait(&mut self, timeout: Option<Duration>) -> Result<TerminalSnapshot, PtyError> {
        let started = Instant::now();
        loop {
            let snapshot = self.poll()?;
            if !matches!(snapshot.status, TerminalStatus::Running) {
                return Ok(snapshot);
            }
            if timeout.is_some_and(|limit| started.elapsed() >= limit) {
                self.terminate_running_process()?;
                self.drain_output_until_reader_closes()?;
                return self
                    .terminal
                    .fail_process("", "pty timed out")
                    .map_err(terminal_error);
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    pub fn terminate(&mut self) -> Result<TerminalSnapshot, PtyError> {
        let current = self.terminal.snapshot().map_err(terminal_error)?;
        if !matches!(current.status, TerminalStatus::Running) {
            return Ok(current);
        }
        self.terminate_running_process()?;
        self.drain_output_until_reader_closes()?;
        self.terminal
            .fail_process("", "pty terminated")
            .map_err(terminal_error)
    }

    pub fn snapshot(&self) -> Result<TerminalSnapshot, PtyError> {
        self.terminal.snapshot().map_err(terminal_error)
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
        let data = String::from_utf8_lossy(&bytes);
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
                    data: data.into_owned(),
                },
            )
            .map_err(terminal_error)?;
        Ok(())
    }

    fn terminate_owned_process(&mut self, code: i32) -> Result<(), PtyError> {
        self.terminate_running_process()?;
        if code < 0 {
            return Err(PtyError::Termination(String::from(
                "pty returned an invalid exit code",
            )));
        }
        Ok(())
    }

    fn terminate_running_process(&mut self) -> Result<(), PtyError> {
        if self.terminated {
            return Ok(());
        }
        let pid = self
            .child
            .lock()
            .map_err(|_| PtyError::Termination(String::from("pty_child_unavailable")))?
            .process_id();
        if let Some(pid) = pid {
            terminate_process_tree(pid)?;
        } else {
            self.child
                .lock()
                .map_err(|_| PtyError::Termination(String::from("pty_child_unavailable")))?
                .kill()
                .map_err(|error| PtyError::Termination(error.to_string()))?;
        }
        self.terminated = true;
        Ok(())
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if !self.terminated {
            let _ = self.terminate();
        }
        self.reader_thread.take();
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

#[cfg(unix)]
fn terminate_process_tree(pid: u32) -> Result<(), PtyError> {
    let pid = pid as libc::pid_t;
    let result = unsafe { libc::kill(-pid, libc::SIGKILL) };
    if result == -1 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(PtyError::Termination(error.to_string()));
        }
        if unsafe { libc::kill(-pid, 0) } == 0 {
            return Err(PtyError::Termination(String::from(
                "pty process group remains after termination",
            )));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) -> Result<(), PtyError> {
    let status = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|error| PtyError::Termination(error.to_string()))?;
    if !status.success() {
        return Err(PtyError::Termination(format!(
            "taskkill exited with {status}"
        )));
    }
    Ok(())
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
        let snapshot = session.wait(Some(Duration::from_secs(2))).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
        assert_eq!(snapshot.output_sequence, 1);
        assert!(snapshot.tail.contains("ready"));
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
        let snapshot = session.wait(Some(Duration::from_secs(2))).unwrap();

        assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
        assert!(snapshot.tail.contains("got:input"));
    }

    #[cfg(unix)]
    #[test]
    fn timeout_publishes_failure_and_does_not_report_success() {
        let mut session = PtySession::spawn("pty-1", spec("sleep", &["2"])).unwrap();
        let snapshot = session.wait(Some(Duration::from_millis(20))).unwrap();

        assert!(matches!(snapshot.status, TerminalStatus::Failed { .. }));
        assert_eq!(snapshot.failure_reason.as_deref(), Some("pty timed out"));
    }
}
