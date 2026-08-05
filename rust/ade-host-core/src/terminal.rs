use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

const MAX_TAIL_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerminalStatus {
    Created,
    Running,
    Exited { code: i32 },
    Failed { reason: String },
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalSnapshot {
    pub terminal_id: String,
    pub generation: u64,
    pub status: TerminalStatus,
    pub failure_reason: Option<String>,
    pub output_sequence: u64,
    pub tail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalCommand {
    Start,
    Output { sequence: u64, data: String },
    Exit { code: i32 },
    Fail { reason: String },
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalError {
    EmptyTerminalId,
    StaleGeneration { expected: u64, actual: u64 },
    InvalidTransition,
    StaleOutput { received: u64, actual: u64 },
    EmptyFailureReason,
    GenerationOverflow,
    StateLockPoisoned,
}

#[derive(Debug)]
struct TerminalState {
    terminal_id: String,
    generation: u64,
    status: TerminalStatus,
    failure_reason: Option<String>,
    output_sequence: u64,
    tail: String,
}

#[derive(Clone, Debug)]
pub struct TerminalRuntime {
    state: Arc<RwLock<TerminalState>>,
}

impl TerminalRuntime {
    pub fn new(terminal_id: impl Into<String>) -> Result<Self, TerminalError> {
        let terminal_id = terminal_id.into();
        if terminal_id.trim().is_empty() {
            return Err(TerminalError::EmptyTerminalId);
        }
        Ok(Self {
            state: Arc::new(RwLock::new(TerminalState {
                terminal_id,
                generation: 0,
                status: TerminalStatus::Created,
                failure_reason: None,
                output_sequence: 0,
                tail: String::new(),
            })),
        })
    }

    pub fn apply(
        &self,
        expected_generation: u64,
        command: TerminalCommand,
    ) -> Result<TerminalSnapshot, TerminalError> {
        let mut state = self
            .state
            .write()
            .map_err(|_| TerminalError::StateLockPoisoned)?;
        if expected_generation != state.generation {
            return Err(TerminalError::StaleGeneration {
                expected: expected_generation,
                actual: state.generation,
            });
        }

        match command {
            TerminalCommand::Start if state.status == TerminalStatus::Created => {
                state.status = TerminalStatus::Running;
            }
            TerminalCommand::Output { sequence, data }
                if state.status == TerminalStatus::Running =>
            {
                if sequence <= state.output_sequence {
                    return Err(TerminalError::StaleOutput {
                        received: sequence,
                        actual: state.output_sequence,
                    });
                }
                state.output_sequence = sequence;
                state.tail.push_str(&data);
                trim_tail(&mut state.tail);
            }
            TerminalCommand::Exit { code } if state.status == TerminalStatus::Running => {
                state.status = TerminalStatus::Exited { code };
            }
            TerminalCommand::Fail { reason } if state.status == TerminalStatus::Running => {
                if reason.trim().is_empty() {
                    return Err(TerminalError::EmptyFailureReason);
                }
                state.failure_reason = Some(reason.clone());
                state.status = TerminalStatus::Failed { reason };
            }
            TerminalCommand::Close
                if matches!(
                    state.status,
                    TerminalStatus::Exited { .. } | TerminalStatus::Failed { .. }
                ) =>
            {
                state.status = TerminalStatus::Closed;
            }
            TerminalCommand::Close if state.status == TerminalStatus::Closed => {
                return Ok(snapshot(&state));
            }
            _ => return Err(TerminalError::InvalidTransition),
        }

        state.generation = state
            .generation
            .checked_add(1)
            .ok_or(TerminalError::GenerationOverflow)?;
        Ok(snapshot(&state))
    }

    pub fn snapshot(&self) -> Result<TerminalSnapshot, TerminalError> {
        let state = self
            .state
            .read()
            .map_err(|_| TerminalError::StateLockPoisoned)?;
        Ok(snapshot(&state))
    }
}

fn snapshot(state: &TerminalState) -> TerminalSnapshot {
    TerminalSnapshot {
        terminal_id: state.terminal_id.clone(),
        generation: state.generation,
        status: state.status.clone(),
        failure_reason: state.failure_reason.clone(),
        output_sequence: state.output_sequence,
        tail: state.tail.clone(),
    }
}

fn trim_tail(tail: &mut String) {
    if tail.len() <= MAX_TAIL_BYTES {
        return;
    }
    let mut start = tail.len() - MAX_TAIL_BYTES;
    while !tail.is_char_boundary(start) {
        start += 1;
    }
    tail.drain(..start);
}

#[cfg(test)]
mod contract_tests {
    use super::{TerminalCommand, TerminalError, TerminalRuntime, TerminalStatus};
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn terminal_checkpoint_observes_output_and_strict_lifecycle() {
        let terminal = TerminalRuntime::new("terminal-1").unwrap();

        let started = terminal.apply(0, TerminalCommand::Start).unwrap();
        assert_eq!(started.status, TerminalStatus::Running);

        let output = terminal
            .apply(
                started.generation,
                TerminalCommand::Output {
                    sequence: 1,
                    data: String::from("ready\n"),
                },
            )
            .unwrap();
        assert_eq!(output.output_sequence, 1);
        assert_eq!(output.tail, "ready\n");

        let exited = terminal
            .apply(output.generation, TerminalCommand::Exit { code: 0 })
            .unwrap();
        assert_eq!(exited.status, TerminalStatus::Exited { code: 0 });

        let closed = terminal
            .apply(exited.generation, TerminalCommand::Close)
            .unwrap();
        assert_eq!(closed.status, TerminalStatus::Closed);
    }

    #[test]
    fn terminal_rejects_stale_generations_and_duplicate_output() {
        let terminal = TerminalRuntime::new("terminal-1").unwrap();
        let started = terminal.apply(0, TerminalCommand::Start).unwrap();

        assert_eq!(
            terminal.apply(
                0,
                TerminalCommand::Output {
                    sequence: 1,
                    data: String::from("stale"),
                }
            ),
            Err(TerminalError::StaleGeneration {
                expected: 0,
                actual: 1,
            })
        );

        let output = terminal
            .apply(
                started.generation,
                TerminalCommand::Output {
                    sequence: 1,
                    data: String::from("one"),
                },
            )
            .unwrap();
        assert_eq!(
            terminal.apply(
                output.generation,
                TerminalCommand::Output {
                    sequence: 1,
                    data: String::from("duplicate"),
                },
            ),
            Err(TerminalError::StaleOutput {
                received: 1,
                actual: 1,
            })
        );
    }

    #[test]
    fn terminal_tail_is_bounded_without_splitting_utf8() {
        let terminal = TerminalRuntime::new("terminal-1").unwrap();
        let started = terminal.apply(0, TerminalCommand::Start).unwrap();
        let output = terminal
            .apply(
                started.generation,
                TerminalCommand::Output {
                    sequence: 1,
                    data: format!("{}끝", "x".repeat(4096)),
                },
            )
            .unwrap();

        assert!(output.tail.len() <= 4096);
        assert!(output.tail.ends_with('끝'));
        assert!(std::str::from_utf8(output.tail.as_bytes()).is_ok());
    }

    #[test]
    fn terminal_checkpoint_preserves_failure_reason_after_close() {
        let terminal = TerminalRuntime::new("terminal-1").unwrap();
        let started = terminal.apply(0, TerminalCommand::Start).unwrap();
        let failed = terminal
            .apply(
                started.generation,
                TerminalCommand::Fail {
                    reason: String::from("spawn failed"),
                },
            )
            .unwrap();
        let closed = terminal
            .apply(failed.generation, TerminalCommand::Close)
            .unwrap();

        assert_eq!(failed.failure_reason.as_deref(), Some("spawn failed"));
        assert_eq!(closed.failure_reason.as_deref(), Some("spawn failed"));
    }

    #[test]
    fn concurrent_starts_have_one_authoritative_winner() {
        let terminal = Arc::new(TerminalRuntime::new("terminal-1").unwrap());
        let handles = (0..8)
            .map(|_| {
                let terminal = Arc::clone(&terminal);
                thread::spawn(move || terminal.apply(0, TerminalCommand::Start))
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(terminal.snapshot().unwrap().generation, 1);
    }
}
