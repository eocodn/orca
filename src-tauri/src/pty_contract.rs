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
    pub workspace_id: String,
    pub worker_id: String,
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
    sessions: HashMap<String, PtySessionEntry>,
    session_reservations: HashMap<String, PtySessionReservation>,
    committed_requests: HashMap<String, (PtyRequest, Result<String, String>)>,
    committed_request_order: VecDeque<String>,
    in_flight_requests: HashMap<String, PtyRequest>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PtyOwner {
    workspace_id: String,
    worker_id: String,
}

struct PtySessionEntry {
    owner: PtyOwner,
    session: Arc<Mutex<PtySession>>,
}

struct PtySessionReservation {
    request_id: String,
    owner: PtyOwner,
}

#[derive(Debug, Serialize)]
struct PtyResult {
    request_id: String,
    capability: &'static str,
    operation: &'static str,
    session_id: String,
    generation: u64,
    status: String,
    exit_code: Option<i32>,
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
            Err(error) => {
                if error == "session_owner_conflict" {
                    if let Err(commit_error) =
                        commit_request_result(request, state, Err(error.clone()))
                    {
                        return Err(commit_error);
                    }
                }
                return Err(error);
            }
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
            | "session_id_conflict"
            | "session_owner_conflict"
    )
}

fn validate_request(request: &PtyRequest) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err(String::from("empty_request_id"));
    }
    if request.session_id.trim().is_empty() {
        return Err(String::from("empty_session_id"));
    }
    if request.workspace_id.trim().is_empty() {
        return Err(String::from("empty_workspace_id"));
    }
    if request.worker_id.trim().is_empty() {
        return Err(String::from("empty_worker_id"));
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
    let owner = owner_for_request(request);
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
    if let Some(entry) = registry.sessions.get(&request.session_id) {
        return Err(if entry.owner == owner {
            String::from("session_id_conflict")
        } else {
            String::from("session_owner_conflict")
        });
    }
    if let Some(reservation) = registry.session_reservations.get(&request.session_id) {
        return Err(if reservation.owner == owner {
            String::from("session_id_starting")
        } else {
            String::from("session_owner_conflict")
        });
    }
    registry
        .in_flight_requests
        .insert(request.request_id.clone(), request.clone());
    registry.session_reservations.insert(
        request.session_id.clone(),
        PtySessionReservation {
            request_id: request.request_id.clone(),
            owner: owner.clone(),
        },
    );
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
    registry.sessions.insert(
        request.session_id.clone(),
        PtySessionEntry {
            owner,
            session: Arc::clone(&session),
        },
    );
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
    let owner = owner_for_request(request);
    let session = if let Some(entry) = registry.sessions.get(&request.session_id) {
        if entry.owner != owner {
            return Err(String::from("session_owner_conflict"));
        }
        Arc::clone(&entry.session)
    } else if let Some(reservation) = registry.session_reservations.get(&request.session_id) {
        if reservation.owner != owner {
            return Err(String::from("session_owner_conflict"));
        }
        return Err(String::from("session_starting"));
    } else {
        return Err(String::from("session_not_found"));
    };
    registry
        .in_flight_requests
        .insert(request.request_id.clone(), request.clone());
    Ok(session)
}

fn owner_for_request(request: &PtyRequest) -> PtyOwner {
    PtyOwner {
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
    }
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
        exit_code: exit_code(&snapshot.status),
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

fn exit_code(status: &ade_host_core::terminal::TerminalStatus) -> Option<i32> {
    match status {
        ade_host_core::terminal::TerminalStatus::Exited { code } => Some(*code),
        _ => None,
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
        .is_some_and(|reservation| reservation.request_id == request.request_id)
    {
        registry.session_reservations.remove(&request.session_id);
    }
    let remove_session = matches!(request.operation, PtyOperation::Terminate) && result.is_ok();
    registry
        .committed_requests
        .insert(request.request_id.clone(), (request.clone(), result));
    if remove_session {
        registry.sessions.remove(&request.session_id);
    }
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
            .map(|(_, entry)| entry.session)
            .collect::<Vec<_>>();
        for session in sessions {
            if let Ok(mut session) = session.lock() {
                let _ = session.terminate();
            }
        }
    }
}

#[cfg(test)]
#[path = "pty_contract_tests.rs"]
mod tests;
