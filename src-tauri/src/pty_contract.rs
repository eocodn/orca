use ade_terminal::pty::{PtySession, PtySpec};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PtyOperation {
    Start,
    Write,
    Resize,
    Poll,
    Wait,
    Terminate,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PtyRequest {
    pub request_id: String,
    pub session_id: String,
    pub operation: PtyOperation,
    pub program: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
    pub input: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub timeout_ms: Option<u64>,
}

#[derive(Default)]
pub struct PtyExecutionState {
    registry: Mutex<PtyRegistry>,
}

#[derive(Default)]
struct PtyRegistry {
    sessions: HashMap<String, Arc<Mutex<PtySession>>>,
    committed_requests: HashMap<String, (PtyRequest, String)>,
    in_flight_requests: HashMap<String, PtyRequest>,
}

#[derive(Debug, Serialize)]
struct PtyResult {
    request_id: String,
    capability: &'static str,
    operation: &'static str,
    session_id: String,
    generation: u64,
    status: String,
    output_sequence: u64,
    tail: String,
    failure_reason: Option<String>,
}

pub fn execute_pty_request(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<String, String> {
    validate_request(request)?;
    {
        let registry = state
            .registry
            .lock()
            .map_err(|_| String::from("pty_registry_unavailable"))?;
        if let Some((committed, response)) = registry.committed_requests.get(&request.request_id) {
            if committed == request {
                return Ok(response.clone());
            }
            return Err(String::from("request_id_conflict"));
        }
    }
    let session = match request.operation {
        PtyOperation::Start => start_session(request, state)?,
        _ => session_for_request(request, state)?,
    };

    let operation_result = (|| -> Result<String, String> {
        let mut session = session
            .lock()
            .map_err(|_| String::from("pty_session_unavailable"))?;
        let snapshot = match request.operation {
            PtyOperation::Start => session.snapshot().map_err(pty_error_code)?,
            PtyOperation::Write => {
                session
                    .write(request.input.as_deref().unwrap().as_bytes())
                    .map_err(pty_error_code)?;
                session.poll().map_err(pty_error_code)?
            }
            PtyOperation::Resize => {
                session
                    .resize(request.cols.unwrap(), request.rows.unwrap())
                    .map_err(pty_error_code)?;
                session.poll().map_err(pty_error_code)?
            }
            PtyOperation::Poll => session.poll().map_err(pty_error_code)?,
            PtyOperation::Wait => session
                .wait(request.timeout_ms.map(Duration::from_millis))
                .map_err(pty_error_code)?,
            PtyOperation::Terminate => session.terminate().map_err(pty_error_code)?,
        };
        Ok(render_result(request, snapshot)?)
    })();
    let response = match operation_result {
        Ok(response) => response,
        Err(error) => {
            if let Ok(mut registry) = state.registry.lock() {
                registry.in_flight_requests.remove(&request.request_id);
            }
            return Err(error);
        }
    };

    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    registry.in_flight_requests.remove(&request.request_id);
    registry.committed_requests.insert(
        request.request_id.clone(),
        (request.clone(), response.clone()),
    );
    if matches!(request.operation, PtyOperation::Terminate) {
        registry.sessions.remove(&request.session_id);
    }
    Ok(response)
}

fn validate_request(request: &PtyRequest) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err(String::from("empty_request_id"));
    }
    if request.session_id.trim().is_empty() {
        return Err(String::from("empty_session_id"));
    }
    match request.operation {
        PtyOperation::Start => {
            if request.program.as_deref().is_none_or(str::is_empty) {
                return Err(String::from("empty_program"));
            }
            if request.cols.unwrap_or(0) == 0 || request.rows.unwrap_or(0) == 0 {
                return Err(String::from("invalid_size"));
            }
        }
        PtyOperation::Write if request.input.is_none() => {
            return Err(String::from("missing_input"));
        }
        PtyOperation::Resize
            if request.cols.unwrap_or(0) == 0 || request.rows.unwrap_or(0) == 0 =>
        {
            return Err(String::from("invalid_size"));
        }
        PtyOperation::Wait if request.timeout_ms == Some(0) => {
            return Err(String::from("invalid_timeout"));
        }
        _ => {}
    }
    Ok(())
}

fn start_session(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<Arc<Mutex<PtySession>>, String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    if registry.sessions.contains_key(&request.session_id) {
        return Err(String::from("session_id_conflict"));
    }
    if let Some(in_flight) = registry.in_flight_requests.get(&request.request_id) {
        if in_flight == request {
            return Err(String::from("request_in_flight"));
        }
        return Err(String::from("request_id_conflict"));
    }
    registry
        .in_flight_requests
        .insert(request.request_id.clone(), request.clone());
    drop(registry);

    let session = match PtySession::spawn(
        request.session_id.clone(),
        PtySpec {
            program: request.program.clone().unwrap(),
            args: request.args.clone(),
            current_dir: request.current_dir.clone(),
            environment: Default::default(),
            cols: request.cols.unwrap(),
            rows: request.rows.unwrap(),
        },
    ) {
        Ok(session) => session,
        Err(error) => {
            let mut registry = state
                .registry
                .lock()
                .map_err(|_| String::from("pty_registry_unavailable"))?;
            registry.in_flight_requests.remove(&request.request_id);
            return Err(pty_error_code(error));
        }
    };
    let session = Arc::new(Mutex::new(session));
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    registry.in_flight_requests.remove(&request.request_id);
    if registry.sessions.contains_key(&request.session_id) {
        let mut session = session
            .lock()
            .map_err(|_| String::from("pty_session_unavailable"))?;
        let _ = session.terminate();
        return Err(String::from("session_id_conflict"));
    }
    registry
        .sessions
        .insert(request.session_id.clone(), Arc::clone(&session));
    Ok(session)
}

fn session_for_request(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<Arc<Mutex<PtySession>>, String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    if let Some(in_flight) = registry.in_flight_requests.get(&request.request_id) {
        if in_flight == request {
            return Err(String::from("request_in_flight"));
        }
        return Err(String::from("request_id_conflict"));
    }
    let session = registry
        .sessions
        .get(&request.session_id)
        .cloned()
        .ok_or_else(|| String::from("session_not_found"))?;
    registry
        .in_flight_requests
        .insert(request.request_id.clone(), request.clone());
    Ok(session)
}

fn render_result(
    request: &PtyRequest,
    snapshot: ade_host_core::terminal::TerminalSnapshot,
) -> Result<String, String> {
    serde_json::to_string(&PtyResult {
        request_id: request.request_id.clone(),
        capability: "pty",
        operation: operation_name(&request.operation),
        session_id: request.session_id.clone(),
        generation: snapshot.generation,
        status: status_name(&snapshot.status).to_string(),
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail,
        failure_reason: snapshot.failure_reason,
    })
    .map_err(|error| error.to_string())
}

fn operation_name(operation: &PtyOperation) -> &'static str {
    match operation {
        PtyOperation::Start => "start",
        PtyOperation::Write => "write",
        PtyOperation::Resize => "resize",
        PtyOperation::Poll => "poll",
        PtyOperation::Wait => "wait",
        PtyOperation::Terminate => "terminate",
    }
}

fn status_name(status: &ade_host_core::terminal::TerminalStatus) -> &'static str {
    match status {
        ade_host_core::terminal::TerminalStatus::Created => "created",
        ade_host_core::terminal::TerminalStatus::Running => "running",
        ade_host_core::terminal::TerminalStatus::Exited { .. } => "exited",
        ade_host_core::terminal::TerminalStatus::Failed { .. } => "failed",
        ade_host_core::terminal::TerminalStatus::Closed => "closed",
    }
}

fn pty_error_code(error: ade_terminal::pty::PtyError) -> String {
    format!("{error:?}")
}

impl Drop for PtyExecutionState {
    fn drop(&mut self) {
        let sessions = self
            .registry
            .get_mut()
            .expect("pty registry must not be poisoned during state drop")
            .sessions
            .drain()
            .map(|(_, session)| session)
            .collect::<Vec<_>>();
        for session in sessions {
            if let Ok(mut session) = session.lock() {
                let _ = session.terminate();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{execute_pty_request, PtyExecutionState, PtyOperation, PtyRequest};

    fn request(request_id: &str, session_id: &str, operation: PtyOperation) -> PtyRequest {
        PtyRequest {
            request_id: request_id.to_string(),
            session_id: session_id.to_string(),
            operation,
            program: None,
            args: Vec::new(),
            current_dir: None,
            input: None,
            cols: None,
            rows: None,
            timeout_ms: None,
        }
    }

    #[cfg(unix)]
    #[test]
    fn starts_writes_waits_and_replays_one_authoritative_session() {
        let state = PtyExecutionState::default();
        let mut start = request("start-1", "session-1", PtyOperation::Start);
        start.program = Some(String::from("cat"));
        start.cols = Some(80);
        start.rows = Some(24);
        let started = execute_pty_request(&start, &state).unwrap();
        assert!(started.contains(r#""status":"running""#));

        let mut write = request("write-1", "session-1", PtyOperation::Write);
        write.input = Some(String::from("ready\n"));
        let write_response = execute_pty_request(&write, &state).unwrap();
        let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
        let terminated = execute_pty_request(&terminate, &state).unwrap();
        assert!(terminated.contains(r#""status":"failed""#));

        assert_eq!(execute_pty_request(&write, &state), Ok(write_response));
    }

    #[test]
    fn rejects_unknown_fields_during_deserialization() {
        let error = serde_json::from_str::<PtyRequest>(
            r#"{"request_id":"r","session_id":"s","operation":"poll","unknown":true}"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));
    }
}
