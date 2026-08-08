#[cfg(all(test, windows))]
use crate::pty_backend::windows_child_handle_has_exited;
#[cfg(windows)]
use crate::pty_backend::{capture_windows_process_identity, WindowsProcessIdentity};
use crate::pty_backend::{
    spawn_reader, terminate_process_tree, try_wait_child, ProcessTermination,
};
pub use crate::pty_contract::{PtyError, PtySpec};
use ade_host_core::terminal::{TerminalCommand, TerminalRuntime, TerminalSnapshot, TerminalStatus};
use portable_pty::{native_pty_system, Child, CommandBuilder, ExitStatus, MasterPty, PtySize};
use std::io::Write;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const OUTPUT_CHANNEL_CAPACITY: usize = 64;
pub const MAX_PTY_OUTPUT_BYTES: usize = 1024 * 1024;
pub(crate) const READER_CLOSE_TIMEOUT: Duration = Duration::from_secs(1);
pub(crate) const POLL_INTERVAL: Duration = Duration::from_millis(5);

pub struct PtySession {
    terminal: TerminalRuntime,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    process_id: Option<u32>,
    #[cfg(windows)]
    process_identity: Option<WindowsProcessIdentity>,
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
        #[cfg(windows)]
        let process_identity = match process_id.map(capture_windows_process_identity).transpose() {
            Ok(identity) => identity,
            Err(error) => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
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
            #[cfg(windows)]
            process_identity,
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
        let exit = self
            .try_wait_child(&mut child)
            .map_err(|error| PtyError::Terminal(format!("{error:?}")))?;
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
        if let Some(status) = self.try_wait_child(&mut child)? {
            self.child_reaped = true;
            return Ok(Some(status));
        }
        let pid = child.process_id();
        if let Some(pid) = pid {
            #[cfg(windows)]
            let termination =
                terminate_process_tree(self.process_group, pid, self.process_identity)?;
            #[cfg(not(windows))]
            let termination = terminate_process_tree(self.process_group, pid)?;
            match termination {
                ProcessTermination::Signalled => {
                    self.confirm_child_exit(&mut child)?;
                    self.child_reaped = true;
                }
                ProcessTermination::AlreadyExited => {
                    if let Some(status) = self.try_wait_child(&mut child)? {
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
            self.confirm_child_exit(&mut child)?;
            self.child_reaped = true;
        }
        drop(child);
        self.close_pty_handles()?;
        self.terminated = true;
        Ok(None)
    }

    fn try_wait_child(
        &self,
        child: &mut Box<dyn Child + Send + Sync>,
    ) -> Result<Option<ExitStatus>, PtyError> {
        #[cfg(windows)]
        {
            return try_wait_child(child, self.process_identity);
        }
        #[cfg(not(windows))]
        {
            try_wait_child(child)
        }
    }

    fn confirm_child_exit(&self, child: &mut Box<dyn Child + Send + Sync>) -> Result<(), PtyError> {
        let deadline = Instant::now() + READER_CLOSE_TIMEOUT;
        loop {
            if self.try_wait_child(child)?.is_some() {
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

fn terminal_error(error: ade_host_core::terminal::TerminalError) -> PtyError {
    PtyError::Terminal(format!("{error:?}"))
}

#[cfg(test)]
#[path = "pty_tests.rs"]
mod tests;
