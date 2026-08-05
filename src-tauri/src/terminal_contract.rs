use ade_host_core::protocol::{ProtocolError, TerminalOperation, TerminalRequest};
use ade_host_core::terminal::{
    TerminalCommand, TerminalError, TerminalRuntime, TerminalSnapshot, TerminalStatus,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct TerminalExecutionState {
    registry: Mutex<TerminalRegistry>,
}

#[derive(Default)]
struct TerminalRegistry {
    terminals: HashMap<String, TerminalRuntime>,
    committed_requests: HashMap<String, (TerminalRequest, String)>,
}

#[derive(Serialize)]
struct TerminalResult {
    request_id: String,
    capability: &'static str,
    protocol_version: u16,
    operation: &'static str,
    terminal_id: String,
    generation: u64,
    status: &'static str,
    exit_code: Option<i32>,
    failure_reason: Option<String>,
    output_sequence: u64,
    tail: String,
}

pub fn execute_terminal_request(
    request: &TerminalRequest,
    state: &TerminalExecutionState,
) -> Result<String, String> {
    request.validate().map_err(protocol_error_code)?;
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("terminal_registry_unavailable"))?;
    if let Some((committed, response)) = registry
        .committed_requests
        .get(&request.envelope.request_id)
    {
        if committed == request {
            return Ok(response.clone());
        }
        return Err(String::from("request_id_conflict"));
    }
    let terminal = if let Some(terminal) = registry.terminals.get(&request.terminal_id) {
        terminal.clone()
    } else if request.operation == TerminalOperation::Start {
        let terminal = TerminalRuntime::new(&request.terminal_id).map_err(terminal_error_code)?;
        let snapshot = terminal
            .apply(request.expected_generation, TerminalCommand::Start)
            .map_err(terminal_error_code)?;
        registry
            .terminals
            .insert(request.terminal_id.clone(), terminal);
        let response = render_terminal_result(request, snapshot)?;
        registry.committed_requests.insert(
            request.envelope.request_id.clone(),
            (request.clone(), response.clone()),
        );
        return Ok(response);
    } else {
        return Err(String::from("terminal_not_found"));
    };

    let snapshot = match &request.operation {
        TerminalOperation::Snapshot => {
            let snapshot = terminal.snapshot().map_err(terminal_error_code)?;
            if snapshot.generation != request.expected_generation {
                return Err(terminal_error_code(TerminalError::StaleGeneration {
                    expected: request.expected_generation,
                    actual: snapshot.generation,
                }));
            }
            snapshot
        }
        operation => terminal
            .apply(request.expected_generation, terminal_command(operation))
            .map_err(terminal_error_code)?,
    };
    let response = render_terminal_result(request, snapshot)?;
    registry.committed_requests.insert(
        request.envelope.request_id.clone(),
        (request.clone(), response.clone()),
    );
    Ok(response)
}

fn protocol_error_code(error: ProtocolError) -> String {
    match error {
        ProtocolError::UnsupportedVersion(_) => "unsupported_version",
        ProtocolError::CapabilityDenied(_) => "capability_denied",
        ProtocolError::EmptyRequestId => "empty_request_id",
        ProtocolError::EmptyTerminalId => "empty_terminal_id",
        ProtocolError::EmptyTerminalFailureReason => "empty_terminal_failure_reason",
        ProtocolError::InvalidTerminalGeneration => "invalid_terminal_generation",
        ProtocolError::InvalidTerminalOutputSequence => "invalid_terminal_output_sequence",
        ProtocolError::EmptyGitPath
        | ProtocolError::EmptyFilePath
        | ProtocolError::EmptyPtyWorkspaceId
        | ProtocolError::EmptyPtyWorkerId
        | ProtocolError::EmptyPtySessionId
        | ProtocolError::MissingPtySessionGeneration
        | ProtocolError::InvalidPtySessionGeneration
        | ProtocolError::EmptyPtyProgram
        | ProtocolError::InvalidPtySize
        | ProtocolError::InvalidPtyTimeout
        | ProtocolError::EmptyPtyExecutionTarget => "invalid_request",
    }
    .to_string()
}

fn terminal_error_code(error: TerminalError) -> String {
    match error {
        TerminalError::EmptyTerminalId => "empty_terminal_id",
        TerminalError::StaleGeneration { .. } => "stale_generation",
        TerminalError::InvalidTransition => "invalid_transition",
        TerminalError::StaleOutput { .. } => "invalid_terminal_output_sequence",
        TerminalError::EmptyFailureReason => "empty_terminal_failure_reason",
        TerminalError::GenerationOverflow => "generation_overflow",
        TerminalError::StateLockPoisoned => "terminal_state_unavailable",
    }
    .to_string()
}

fn terminal_command(operation: &TerminalOperation) -> TerminalCommand {
    match operation {
        TerminalOperation::Start => TerminalCommand::Start,
        TerminalOperation::Output { sequence, data } => TerminalCommand::Output {
            sequence: *sequence,
            data: data.clone(),
        },
        TerminalOperation::Exit { code } => TerminalCommand::Exit { code: *code },
        TerminalOperation::Fail { reason } => TerminalCommand::Fail {
            reason: reason.clone(),
        },
        TerminalOperation::Close => TerminalCommand::Close,
        TerminalOperation::Snapshot => unreachable!("snapshot does not mutate terminal state"),
    }
}

fn render_terminal_result(
    request: &TerminalRequest,
    snapshot: TerminalSnapshot,
) -> Result<String, String> {
    let status = match snapshot.status {
        TerminalStatus::Created => "created",
        TerminalStatus::Running => "running",
        TerminalStatus::Exited { .. } => "exited",
        TerminalStatus::Failed { .. } => "failed",
        TerminalStatus::Closed => "closed",
    };
    serde_json::to_string(&TerminalResult {
        request_id: request.envelope.request_id.clone(),
        capability: "terminal",
        protocol_version: request.envelope.protocol_version,
        operation: terminal_operation_name(&request.operation),
        terminal_id: snapshot.terminal_id,
        generation: snapshot.generation,
        status,
        exit_code: snapshot.exit_code,
        failure_reason: snapshot.failure_reason,
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail,
    })
    .map_err(|error| error.to_string())
}

fn terminal_operation_name(operation: &TerminalOperation) -> &'static str {
    match operation {
        TerminalOperation::Start => "start",
        TerminalOperation::Snapshot => "snapshot",
        TerminalOperation::Output { .. } => "output",
        TerminalOperation::Exit { .. } => "exit",
        TerminalOperation::Fail { .. } => "fail",
        TerminalOperation::Close => "close",
    }
}

#[cfg(test)]
mod tests {
    use super::{execute_terminal_request, TerminalExecutionState};
    use ade_host_core::protocol::{TerminalOperation, TerminalRequest};
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn executes_terminal_lifecycle_against_one_authoritative_registry() {
        let state = TerminalExecutionState::default();
        let started = TerminalRequest::start("request-start", "terminal-1", 0);
        assert_eq!(
            execute_terminal_request(&started, &state).expect("terminal should start"),
            r#"{"request_id":"request-start","capability":"terminal","protocol_version":1,"operation":"start","terminal_id":"terminal-1","generation":1,"status":"running","exit_code":null,"failure_reason":null,"output_sequence":0,"tail":""}"#
        );

        let output = TerminalRequest::new(
            "request-output",
            "terminal-1",
            1,
            TerminalOperation::Output {
                sequence: 1,
                data: String::from("ready"),
            },
        );
        assert!(execute_terminal_request(&output, &state)
            .expect("terminal output should be observed")
            .contains(r#""output_sequence":1,"tail":"ready""#));

        let exit = TerminalRequest::new(
            "request-exit",
            "terminal-1",
            2,
            TerminalOperation::Exit { code: 7 },
        );
        assert!(execute_terminal_request(&exit, &state)
            .expect("terminal exit should be observed")
            .contains(r#""status":"exited","exit_code":7"#));

        let close =
            TerminalRequest::new("request-close", "terminal-1", 3, TerminalOperation::Close);
        assert!(execute_terminal_request(&close, &state)
            .expect("terminal close should be observed")
            .contains(r#""status":"closed","exit_code":7"#));

        assert_eq!(
            execute_terminal_request(
                &TerminalRequest::start("request-start-stale", "terminal-1", 0),
                &state,
            ),
            Err(String::from("stale_generation"))
        );
    }

    #[test]
    fn snapshot_does_not_create_a_missing_terminal() {
        let state = TerminalExecutionState::default();
        let request = TerminalRequest::snapshot("request-snapshot", "terminal-missing", 0);

        assert_eq!(
            execute_terminal_request(&request, &state),
            Err(String::from("terminal_not_found"))
        );
    }

    #[test]
    fn replays_committed_request_ids_and_rejects_conflicting_reuse() {
        let state = TerminalExecutionState::default();
        let start = TerminalRequest::start("request-replay", "terminal-1", 0);
        let committed = execute_terminal_request(&start, &state).unwrap();
        assert_eq!(execute_terminal_request(&start, &state), Ok(committed));

        let conflict = TerminalRequest::snapshot("request-replay", "terminal-1", 1);
        assert_eq!(
            execute_terminal_request(&conflict, &state),
            Err(String::from("request_id_conflict"))
        );
    }

    #[test]
    fn concurrent_starts_have_one_registry_winner_without_failed_insertion() {
        let state = Arc::new(TerminalExecutionState::default());
        let invalid = TerminalRequest::start("request-invalid", "terminal-invalid", 1);
        assert!(execute_terminal_request(&invalid, &state).is_err());
        assert!(execute_terminal_request(
            &TerminalRequest::start("request-valid", "terminal-invalid", 0),
            &state,
        )
        .is_ok());

        let handles = (0..8)
            .map(|index| {
                let state = Arc::clone(&state);
                thread::spawn(move || {
                    execute_terminal_request(
                        &TerminalRequest::start(
                            format!("request-{index}"),
                            "terminal-concurrent",
                            0,
                        ),
                        &state,
                    )
                })
            })
            .collect::<Vec<_>>();
        let successes = handles
            .into_iter()
            .map(|handle| handle.join().expect("terminal start thread"))
            .filter(Result::is_ok)
            .count();

        assert_eq!(successes, 1);
    }
}
