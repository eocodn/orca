use crate::pty_target::{build_pty_spec, PtyExecutionTarget};
use ade_terminal::pty::{PtyError, PtySession};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_WAIT_MS: u64 = 30_000;
// Request IDs must be retried within this in-memory replay window.
const MAX_COMMITTED_REQUESTS: usize = 4096;

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
    pub current_dir: Option<String>,
    #[serde(default)]
    pub execution_target: Option<PtyExecutionTarget>,
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
    session_reservations: HashMap<String, String>,
    committed_requests: HashMap<String, (PtyRequest, Result<String, String>)>,
    committed_request_order: VecDeque<String>,
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
                return response.clone();
            }
            return Err(String::from("request_id_conflict"));
        }
    }
    let session = match request.operation {
        PtyOperation::Start => match start_session(request, state) {
            Ok(session) => session,
            Err(error) => {
                if should_commit_start_error(&error) {
                    if let Err(commit_error) =
                        commit_request_result(request, state, Err(error.clone()))
                    {
                        return Err(commit_error);
                    }
                }
                return Err(error);
            }
        },
        _ => match session_for_request(request, state) {
            Ok(session) => session,
            Err(error) => return Err(error),
        },
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
                .wait(Duration::from_millis(request.timeout_ms.unwrap()))
                .map_err(pty_error_code)?,
            PtyOperation::Terminate => session.terminate().map_err(pty_error_code)?,
        };
        Ok(render_result(request, snapshot)?)
    })();
    let response = match operation_result {
        Ok(response) => response,
        Err(error) => {
            if let Err(commit_error) = commit_request_result(request, state, Err(error.clone())) {
                return Err(commit_error);
            }
            return Err(error);
        }
    };
    commit_request_result(request, state, Ok(response.clone()))?;
    if matches!(request.operation, PtyOperation::Terminate) {
        if let Ok(mut registry) = state.registry.lock() {
            registry.sessions.remove(&request.session_id);
        }
    }
    Ok(response)
}

fn should_commit_start_error(error: &str) -> bool {
    matches!(
        error,
        "empty_program"
            | "invalid_size"
            | "invalid_working_directory"
            | "invalid_wsl_working_directory"
            | "wsl_distro_mismatch"
            | "pty_spawn_failed"
            | "pty_terminal_failed"
    )
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
            match request.execution_target.as_ref() {
                Some(PtyExecutionTarget::Wsl2 { distro }) if distro.trim().is_empty() => {
                    return Err(String::from("empty_wsl_distro"));
                }
                Some(PtyExecutionTarget::Ssh { host, .. }) if host.trim().is_empty() => {
                    return Err(String::from("empty_ssh_host"));
                }
                _ => {}
            }
        }
        _ if request.execution_target.is_some() => {
            return Err(String::from("execution_target_only_on_start"));
        }
        PtyOperation::Write if request.input.is_none() => {
            return Err(String::from("missing_input"));
        }
        PtyOperation::Resize
            if request.cols.unwrap_or(0) == 0 || request.rows.unwrap_or(0) == 0 =>
        {
            return Err(String::from("invalid_size"));
        }
        PtyOperation::Wait => {
            let timeout = request
                .timeout_ms
                .ok_or_else(|| String::from("missing_timeout"))?;
            if timeout == 0 || timeout > MAX_WAIT_MS {
                return Err(String::from("invalid_timeout"));
            }
        }
        _ => {}
    }
    Ok(())
}

fn start_session(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<Arc<Mutex<PtySession>>, String> {
    let spec = build_pty_spec(request)?;
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
    if registry.sessions.contains_key(&request.session_id) {
        return Err(String::from("session_id_conflict"));
    }
    if registry
        .session_reservations
        .contains_key(&request.session_id)
    {
        return Err(String::from("session_id_starting"));
    }
    registry
        .in_flight_requests
        .insert(request.request_id.clone(), request.clone());
    registry
        .session_reservations
        .insert(request.session_id.clone(), request.request_id.clone());
    drop(registry);

    let session = match PtySession::spawn(request.session_id.clone(), spec) {
        Ok(session) => session,
        Err(error) => {
            return Err(pty_error_code(error));
        }
    };
    let session = Arc::new(Mutex::new(session));
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
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
        .ok_or_else(|| {
            if registry
                .session_reservations
                .contains_key(&request.session_id)
            {
                String::from("session_starting")
            } else {
                String::from("session_not_found")
            }
        })?;
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

fn commit_request_result(
    request: &PtyRequest,
    state: &PtyExecutionState,
    result: Result<String, String>,
) -> Result<(), String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    registry.in_flight_requests.remove(&request.request_id);
    if registry
        .session_reservations
        .get(&request.session_id)
        .is_some_and(|request_id| request_id == &request.request_id)
    {
        registry.session_reservations.remove(&request.session_id);
    }
    registry
        .committed_requests
        .insert(request.request_id.clone(), (request.clone(), result));
    registry
        .committed_request_order
        .push_back(request.request_id.clone());
    while registry.committed_request_order.len() > MAX_COMMITTED_REQUESTS {
        if let Some(request_id) = registry.committed_request_order.pop_front() {
            registry.committed_requests.remove(&request_id);
        }
    }
    Ok(())
}

fn pty_error_code(error: ade_terminal::pty::PtyError) -> String {
    match error {
        PtyError::EmptyProgram => String::from("empty_program"),
        PtyError::InvalidSize => String::from("invalid_size"),
        PtyError::InvalidWorkingDirectory(_) => String::from("invalid_working_directory"),
        PtyError::Spawn(_) => String::from("pty_spawn_failed"),
        PtyError::Input(_) => String::from("pty_input_failed"),
        PtyError::Resize(_) => String::from("pty_resize_failed"),
        PtyError::Output(_) => String::from("pty_output_failed"),
        PtyError::Terminal(_) => String::from("pty_terminal_failed"),
        PtyError::Timeout => String::from("pty_timeout"),
        PtyError::Termination(_) => String::from("pty_termination_failed"),
    }
}

impl Drop for PtyExecutionState {
    fn drop(&mut self) {
        let Ok(registry) = self.registry.get_mut() else {
            return;
        };
        let sessions = registry
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
    use crate::pty_target::PtyExecutionTarget;
    #[cfg(unix)]
    use std::sync::Arc;

    fn request(request_id: &str, session_id: &str, operation: PtyOperation) -> PtyRequest {
        PtyRequest {
            request_id: request_id.to_string(),
            session_id: session_id.to_string(),
            operation,
            program: None,
            args: Vec::new(),
            current_dir: None,
            execution_target: None,
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

    #[test]
    fn rejects_an_execution_target_on_non_start_operations() {
        let mut write = request("write-1", "session-1", PtyOperation::Write);
        write.input = Some(String::from("input"));
        write.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });

        assert_eq!(
            execute_pty_request(&write, &PtyExecutionState::default()),
            Err(String::from("execution_target_only_on_start"))
        );
    }

    #[test]
    fn accepts_the_public_hyphenated_native_target_name() {
        let request: PtyRequest = serde_json::from_str(
            r#"{
                "request_id":"start-1",
                "session_id":"session-1",
                "operation":"start",
                "program":"bash",
                "args":[],
                "current_dir":null,
                "execution_target":{"kind":"windows-native"},
                "input":null,
                "cols":80,
                "rows":24,
                "timeout_ms":null
            }"#,
        )
        .unwrap();

        assert_eq!(
            request.execution_target,
            Some(PtyExecutionTarget::WindowsNative)
        );
    }

    #[test]
    fn replays_committed_errors_without_repeating_the_operation() {
        let state = PtyExecutionState::default();
        let mut write = request("write-1", "missing-session", PtyOperation::Write);
        write.input = Some(String::from("input"));

        let first = execute_pty_request(&write, &state);
        assert_eq!(first, Err(String::from("session_not_found")));

        let mut start = request("start-1", "missing-session", PtyOperation::Start);
        start.program = Some(String::from("cat"));
        start.cols = Some(80);
        start.rows = Some(24);
        execute_pty_request(&start, &state).unwrap();
        assert!(execute_pty_request(&write, &state).is_ok());

        let mut missing = request("missing-1", "missing-session-2", PtyOperation::Write);
        missing.input = Some(String::from("input"));
        let second = execute_pty_request(&missing, &state);
        assert_eq!(second, Err(String::from("session_not_found")));
        assert_eq!(execute_pty_request(&missing, &state), second);
    }

    #[test]
    fn requires_a_bounded_wait_timeout() {
        let state = PtyExecutionState::default();
        let wait = request("wait-1", "session-1", PtyOperation::Wait);

        assert_eq!(
            execute_pty_request(&wait, &state),
            Err(String::from("missing_timeout"))
        );
    }

    #[test]
    fn commits_spawn_failures_and_releases_the_session_reservation() {
        let state = PtyExecutionState::default();
        let mut start = request("start-1", "session-1", PtyOperation::Start);
        start.program = Some(String::from("ade-program-that-does-not-exist"));
        start.cols = Some(80);
        start.rows = Some(24);

        let first = execute_pty_request(&start, &state);
        assert_eq!(first, Err(String::from("pty_spawn_failed")));
        assert_eq!(execute_pty_request(&start, &state), first);

        let mut valid = request("start-2", "session-1", PtyOperation::Start);
        valid.program = Some(String::from("cat"));
        valid.cols = Some(80);
        valid.rows = Some(24);
        assert!(execute_pty_request(&valid, &state).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn waits_through_the_contract_and_observes_authoritative_exit() {
        let state = PtyExecutionState::default();
        let mut start = request("start-1", "session-1", PtyOperation::Start);
        start.program = Some(String::from("printf"));
        start.args = vec![String::from("ready")];
        start.cols = Some(80);
        start.rows = Some(24);
        execute_pty_request(&start, &state).unwrap();

        let mut wait = request("wait-1", "session-1", PtyOperation::Wait);
        wait.timeout_ms = Some(2_000);
        let response = execute_pty_request(&wait, &state).unwrap();
        assert!(response.contains(r#""status":"exited""#));
    }

    #[cfg(unix)]
    #[test]
    fn reserves_a_session_before_concurrent_starts_spawn() {
        use std::sync::Barrier;
        use std::thread;

        let state = Arc::new(PtyExecutionState::default());
        let barrier = Arc::new(Barrier::new(2));
        let mut handles = Vec::new();
        for request_id in ["start-a", "start-b"] {
            let state = Arc::clone(&state);
            let barrier = Arc::clone(&barrier);
            let mut start = request(request_id, "session-1", PtyOperation::Start);
            start.program = Some(String::from("sleep"));
            start.args = vec![String::from("1")];
            start.cols = Some(80);
            start.rows = Some(24);
            handles.push(thread::spawn(move || {
                barrier.wait();
                execute_pty_request(&start, &state)
            }));
        }

        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(results.iter().all(|result| {
            result.is_ok()
                || matches!(result.as_ref(), Err(error) if matches!(error.as_str(), "session_id_starting" | "session_id_conflict"))
        }));
    }
}
