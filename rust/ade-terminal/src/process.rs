#[path = "process_output_capture.rs"]
mod process_output_capture;
#[path = "process_termination.rs"]
mod process_termination;

use ade_host_core::terminal::{TerminalCommand, TerminalRuntime, TerminalSnapshot};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;
use std::time::{Duration, Instant};

const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const PROCESS_TERMINATION_TIMEOUT: Duration = Duration::from_secs(3);
use process_termination::{configure_child, terminate_child, termination_reason};

#[derive(Debug, Clone)]
pub struct ProcessSpec {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
    pub timeout: Option<Duration>,
    pub cancellation: Option<Arc<AtomicBool>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutcome {
    pub snapshot: TerminalSnapshot,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessError {
    EmptyProgram,
    InvalidWorkingDirectory(PathBuf),
    Output(String),
    Terminal(String),
}

pub fn run_process(
    terminal: &TerminalRuntime,
    spec: &ProcessSpec,
) -> Result<ProcessOutcome, ProcessError> {
    if spec.program.trim().is_empty() {
        return Err(ProcessError::EmptyProgram);
    }
    if let Some(current_dir) = &spec.current_dir {
        if !current_dir.is_dir() {
            return Err(ProcessError::InvalidWorkingDirectory(current_dir.clone()));
        }
    }

    let deadline = match spec.timeout {
        Some(timeout) => Some(
            Instant::now()
                .checked_add(timeout)
                .ok_or_else(|| ProcessError::Terminal(String::from("process timeout overflow")))?,
        ),
        None => None,
    };
    let (capture, stdout_file, stderr_file) = process_output_capture::create()?;
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    if let Some(current_dir) = &spec.current_dir {
        command.current_dir(current_dir);
    }
    configure_child(&mut command);
    command
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    terminal
        .apply(0, TerminalCommand::Start)
        .map_err(|error| ProcessError::Terminal(format!("{error:?}")))?;
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return record_process_failure(terminal, "", format!("process spawn failed: {error}"))
        }
    };

    let mut termination_cleanup_failed = false;
    let result = loop {
        if spec
            .cancellation
            .as_ref()
            .is_some_and(|token| token.load(Ordering::Acquire))
        {
            let termination = termination_reason("process cancelled", &mut child);
            termination_cleanup_failed = termination.cleanup_failed;
            break Err(termination.reason);
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            let termination = termination_reason("process timed out", &mut child);
            termination_cleanup_failed = termination.cleanup_failed;
            break Err(termination.reason);
        }
        match capture.exceeds_limit() {
            Ok(false) => {}
            Ok(true) => {
                let termination =
                    termination_reason("process output exceeded capture limit", &mut child);
                termination_cleanup_failed = termination.cleanup_failed;
                break Err(termination.reason);
            }
            Err(error) => {
                let termination =
                    termination_reason("process output observation failed", &mut child);
                termination_cleanup_failed = termination.cleanup_failed;
                break Err(format!("{error:?}; {}", termination.reason));
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                match capture.exceeds_limit() {
                    Ok(false) => {}
                    Ok(true) => {
                        let termination =
                            termination_reason("process output exceeded capture limit", &mut child);
                        termination_cleanup_failed = termination.cleanup_failed;
                        break Err(termination.reason);
                    }
                    Err(error) => {
                        let termination =
                            termination_reason("process output observation failed", &mut child);
                        termination_cleanup_failed = termination.cleanup_failed;
                        break Err(format!("{error:?}; {}", termination.reason));
                    }
                }
                #[cfg(unix)]
                if let Err(error) = terminate_child(&mut child) {
                    termination_cleanup_failed = true;
                    break Err(format!("process descendant cleanup failed: {error}"));
                }
                break Ok(status);
            }
            Ok(None) => {}
            Err(error) => {
                let cleanup = termination_reason("process wait failed", &mut child);
                termination_cleanup_failed = cleanup.cleanup_failed;
                break Err(format!("process wait failed: {error}; {}", cleanup.reason));
            }
        }
        match capture.exceeds_limit() {
            Ok(false) => {}
            Ok(true) => {
                let termination =
                    termination_reason("process output exceeded capture limit", &mut child);
                termination_cleanup_failed = termination.cleanup_failed;
                break Err(termination.reason);
            }
            Err(error) => {
                let termination =
                    termination_reason("process output observation failed", &mut child);
                termination_cleanup_failed = termination.cleanup_failed;
                break Err(format!("{error:?}; {}", termination.reason));
            }
        }
        thread::sleep(Duration::from_millis(10));
    };

    let output = if termination_cleanup_failed {
        String::new()
    } else {
        match capture.read() {
            Ok(output) => output,
            Err(error) => {
                return record_process_failure(
                    terminal,
                    "",
                    format!("process output collection failed: {error:?}"),
                );
            }
        }
    };
    if let Err(error) = capture.remove() {
        return record_process_failure(
            terminal,
            &output,
            format!("process output cleanup failed: {error:?}"),
        );
    }
    match result {
        Ok(status) => match status.code() {
            Some(code) => {
                let snapshot = terminal
                    .complete_process(&output, code)
                    .map_err(|error| ProcessError::Terminal(format!("{error:?}")))?;
                Ok(ProcessOutcome { snapshot, output })
            }
            None => {
                record_process_failure(terminal, &output, "process terminated without an exit code")
            }
        },
        Err(reason) => record_process_failure(terminal, &output, reason),
    }
}

fn record_process_failure(
    terminal: &TerminalRuntime,
    output: &str,
    reason: impl Into<String>,
) -> Result<ProcessOutcome, ProcessError> {
    let snapshot = terminal
        .fail_process(output, reason)
        .map_err(|error| ProcessError::Terminal(format!("{error:?}")))?;
    Ok(ProcessOutcome {
        snapshot,
        output: String::from(output),
    })
}

#[cfg(test)]
mod tests {
    use super::{run_process, ProcessError, ProcessSpec};
    use ade_host_core::terminal::{TerminalRuntime, TerminalStatus};
    use std::path::PathBuf;
    use std::sync::{atomic::AtomicBool, Arc};
    use std::time::Duration;

    #[test]
    fn executes_a_process_without_shell_interpolation_and_observes_output_and_exit() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let spec = if cfg!(windows) {
            ProcessSpec {
                program: String::from("cmd"),
                args: vec![String::from("/C"), String::from("echo ready")],
                current_dir: None,
                timeout: None,
                cancellation: None,
            }
        } else {
            ProcessSpec {
                program: String::from("printf"),
                args: vec![String::from("ready")],
                current_dir: None,
                timeout: None,
                cancellation: None,
            }
        };

        let outcome = run_process(&terminal, &spec).unwrap();

        assert_eq!(outcome.output, "ready");
        assert_eq!(outcome.snapshot.status, TerminalStatus::Exited { code: 0 });
        assert_eq!(outcome.snapshot.output_sequence, 1);
        assert_eq!(outcome.snapshot.tail, "ready");
    }

    #[test]
    fn preserves_nonzero_exit_and_stderr_as_authoritative_result() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let spec = if cfg!(windows) {
            ProcessSpec {
                program: String::from("cmd"),
                args: vec![
                    String::from("/C"),
                    String::from("echo warning 1>&2 & exit /B 7"),
                ],
                current_dir: None,
                timeout: None,
                cancellation: None,
            }
        } else {
            ProcessSpec {
                program: String::from("sh"),
                args: vec![
                    String::from("-c"),
                    String::from("printf warning >&2; exit 7"),
                ],
                current_dir: None,
                timeout: None,
                cancellation: None,
            }
        };

        let outcome = run_process(&terminal, &spec).unwrap();

        assert_eq!(outcome.snapshot.status, TerminalStatus::Exited { code: 7 });
        assert!(outcome.output.contains("warning"));
        assert!(outcome.snapshot.tail.contains("warning"));
    }

    #[test]
    fn records_spawn_failure_as_authoritative_failed_state() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let outcome = run_process(
            &terminal,
            &ProcessSpec {
                program: String::from("ade-command-that-does-not-exist"),
                args: Vec::new(),
                current_dir: None,
                timeout: None,
                cancellation: None,
            },
        )
        .unwrap();

        let reason = outcome.snapshot.failure_reason.clone().unwrap();
        assert_eq!(
            outcome.snapshot.status,
            TerminalStatus::Failed {
                reason: reason.clone()
            }
        );
        assert!(reason.contains("process spawn failed"));
    }

    #[test]
    fn rejects_empty_program_and_missing_working_directory_before_starting() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        assert_eq!(
            run_process(
                &terminal,
                &ProcessSpec {
                    program: String::from(" "),
                    args: Vec::new(),
                    current_dir: None,
                    timeout: None,
                    cancellation: None,
                },
            ),
            Err(ProcessError::EmptyProgram)
        );
        assert!(matches!(
            run_process(
                &terminal,
                &ProcessSpec {
                    program: String::from("printf"),
                    args: Vec::new(),
                    current_dir: Some(PathBuf::from("/path/that/does/not/exist")),
                    timeout: None,
                    cancellation: None,
                },
            ),
            Err(ProcessError::InvalidWorkingDirectory(_))
        ));
    }

    #[test]
    fn timeout_publishes_failed_state_without_treating_kill_as_success() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let spec = long_running_spec(Some(Duration::from_millis(20)), None);

        let outcome = run_process(&terminal, &spec).unwrap();

        let reason = outcome.snapshot.failure_reason.unwrap();
        assert_eq!(
            outcome.snapshot.status,
            TerminalStatus::Failed {
                reason: reason.clone()
            }
        );
        assert!(reason.contains("process timed out"));
    }

    #[test]
    fn cancellation_publishes_failed_state() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let cancellation = Arc::new(AtomicBool::new(true));
        let spec = long_running_spec(None, Some(cancellation));

        let outcome = run_process(&terminal, &spec).unwrap();

        let reason = outcome.snapshot.failure_reason.unwrap();
        assert_eq!(
            outcome.snapshot.status,
            TerminalStatus::Failed {
                reason: reason.clone()
            }
        );
        assert!(reason.contains("process cancelled"));
    }

    #[test]
    fn cancellation_wins_over_a_process_that_exits_immediately() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let cancellation = Arc::new(AtomicBool::new(true));
        let spec = if cfg!(windows) {
            ProcessSpec {
                program: String::from("cmd"),
                args: vec![String::from("/C"), String::from("exit /B 0")],
                current_dir: None,
                timeout: None,
                cancellation: Some(cancellation),
            }
        } else {
            ProcessSpec {
                program: String::from("true"),
                args: Vec::new(),
                current_dir: None,
                timeout: None,
                cancellation: Some(cancellation),
            }
        };

        let outcome = run_process(&terminal, &spec).unwrap();

        assert!(matches!(
            outcome.snapshot.status,
            TerminalStatus::Failed { .. }
        ));
        assert!(outcome
            .snapshot
            .failure_reason
            .unwrap()
            .contains("process cancelled"));
    }

    #[cfg(unix)]
    #[test]
    fn output_limit_publishes_failed_state_before_unbounded_capture() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let outcome = run_process(
            &terminal,
            &ProcessSpec {
                program: String::from("head"),
                args: vec![
                    String::from("-c"),
                    String::from("1048577"),
                    String::from("/dev/zero"),
                ],
                current_dir: None,
                timeout: None,
                cancellation: None,
            },
        )
        .unwrap();

        let reason = outcome.snapshot.failure_reason.unwrap();
        assert!(reason.contains("capture limit"));
        assert!(outcome.output.len() <= 1024 * 1024);
    }

    #[cfg(unix)]
    #[test]
    fn normal_completion_does_not_wait_for_descendant_output_holders() {
        let terminal = TerminalRuntime::new("terminal-process").unwrap();
        let outcome = run_process(
            &terminal,
            &ProcessSpec {
                program: String::from("sh"),
                args: vec![
                    String::from("-c"),
                    String::from("printf ready; (sleep 1 &)"),
                ],
                current_dir: None,
                timeout: None,
                cancellation: None,
            },
        )
        .unwrap();

        assert_eq!(outcome.snapshot.status, TerminalStatus::Exited { code: 0 });
        assert_eq!(outcome.output, "ready");
    }

    fn long_running_spec(
        timeout: Option<Duration>,
        cancellation: Option<Arc<AtomicBool>>,
    ) -> ProcessSpec {
        if cfg!(windows) {
            ProcessSpec {
                program: String::from("cmd"),
                args: vec![
                    String::from("/C"),
                    String::from("ping -n 5 127.0.0.1 > nul"),
                ],
                current_dir: None,
                timeout,
                cancellation,
            }
        } else {
            ProcessSpec {
                program: String::from("sleep"),
                args: vec![String::from("1")],
                current_dir: None,
                timeout,
                cancellation,
            }
        }
    }
}
