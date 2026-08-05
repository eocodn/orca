use crate::pty_target::{build_pty_spec, PtyExecutionTarget};
use ade_host_core::protocol::{
    Capability, ProtocolEnvelope, ProtocolError, PtyOperation as HostPtyOperation,
    PtyRequest as HostPtyRequest, PtyResponse, PtyStatus,
};
use ade_terminal::pty::{PtyError, PtySession};
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_WAIT_MS: u64 = 30_000;
const MAX_SESSION_GENERATION: u64 = 9_007_199_254_740_991;
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
    #[serde(default)]
    pub session_generation: Option<u64>,
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
    next_session_generation: u64,
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
    session_generation: u64,
    session: Arc<Mutex<PtySession>>,
}

struct PtySessionHandle {
    session: Arc<Mutex<PtySession>>,
    session_generation: u64,
}

struct PtySessionReservation {
    request_id: String,
    owner: PtyOwner,
    session_generation: u64,
}

pub fn execute_pty_request(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<String, String> {
    if let Some(response) = begin_request(request, state)? {
        return response;
    }
    if let Err(error) = validate_request(request) {
        abort_request(request, state)?;
        return Err(error);
    }
    let session = match request.operation {
        PtyOperation::Start => match start_session(request, state) {
            Ok(session) => session,
            Err(error) => {
                if should_commit_start_error(&error) {
                    if let Err(commit_error) =
                        commit_request_result(request, state, Err(error.clone()), None, false)
                    {
                        return Err(commit_error);
                    }
                } else {
                    abort_request(request, state)?;
                }
                return Err(error);
            }
        },
        _ => match session_for_request(request, state) {
            Ok(session) => session,
            Err(error) => {
                if error == "session_owner_conflict" {
                    if let Err(commit_error) =
                        commit_request_result(request, state, Err(error.clone()), None, false)
                    {
                        return Err(commit_error);
                    }
                } else {
                    abort_request(request, state)?;
                }
                return Err(error);
            }
        },
    };

    let session_generation = session.session_generation;
    let operation_result = (|| -> Result<(String, bool), String> {
        let mut session = session
            .session
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
        let completed = matches!(
            &snapshot.status,
            ade_host_core::terminal::TerminalStatus::Exited { .. }
        );
        let timed_out = matches!(request.operation, PtyOperation::Wait)
            && matches!(
                &snapshot.status,
                ade_host_core::terminal::TerminalStatus::Failed { .. }
            );
        Ok((
            render_result(request, snapshot, session_generation)?,
            completed || timed_out,
        ))
    })();
    let (response, completed) = match operation_result {
        Ok(response) => response,
        Err(error) => {
            if let Err(commit_error) = commit_request_result(
                request,
                state,
                Err(error.clone()),
                Some(&session.session),
                false,
            ) {
                return Err(commit_error);
            }
            return Err(error);
        }
    };
    commit_request_result(
        request,
        state,
        Ok(response.clone()),
        Some(&session.session),
        completed,
    )?;
    Ok(response)
}

pub fn execute_shared_pty_request(
    request: &HostPtyRequest,
    state: &PtyExecutionState,
) -> Result<String, String> {
    request.validate().map_err(shared_protocol_error_code)?;
    execute_pty_request(&local_request(request), state)
}

fn local_request(request: &HostPtyRequest) -> PtyRequest {
    let (operation, program, args, current_dir, execution_target, input, cols, rows, timeout_ms) =
        match &request.operation {
            HostPtyOperation::Start {
                program,
                args,
                current_dir,
                execution_target,
                cols,
                rows,
            } => (
                PtyOperation::Start,
                Some(program.clone()),
                args.clone(),
                current_dir.clone(),
                execution_target.clone(),
                None,
                Some(*cols),
                Some(*rows),
                None,
            ),
            HostPtyOperation::Write { input } => (
                PtyOperation::Write,
                None,
                Vec::new(),
                None,
                None,
                Some(input.clone()),
                None,
                None,
                None,
            ),
            HostPtyOperation::Resize { cols, rows } => (
                PtyOperation::Resize,
                None,
                Vec::new(),
                None,
                None,
                None,
                Some(*cols),
                Some(*rows),
                None,
            ),
            HostPtyOperation::Poll => (
                PtyOperation::Poll,
                None,
                Vec::new(),
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            HostPtyOperation::Wait { timeout_ms } => (
                PtyOperation::Wait,
                None,
                Vec::new(),
                None,
                None,
                None,
                None,
                None,
                Some(*timeout_ms),
            ),
            HostPtyOperation::Terminate => (
                PtyOperation::Terminate,
                None,
                Vec::new(),
                None,
                None,
                None,
                None,
                None,
                None,
            ),
        };
    PtyRequest {
        request_id: request.envelope.request_id.clone(),
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
        session_id: request.session_id.clone(),
        session_generation: request.session_generation,
        operation,
        program,
        args,
        current_dir,
        execution_target,
        input,
        cols,
        rows,
        timeout_ms,
    }
}

fn begin_request(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<Option<Result<String, String>>, String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    if let Some((committed, response)) = registry.committed_requests.get(&request.request_id) {
        if committed == request {
            return Ok(Some(response.clone()));
        }
        return Err(String::from("request_id_conflict"));
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
    Ok(None)
}

fn abort_request(request: &PtyRequest, state: &PtyExecutionState) -> Result<(), String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    if registry
        .in_flight_requests
        .get(&request.request_id)
        .is_some_and(|in_flight| in_flight == request)
    {
        registry.in_flight_requests.remove(&request.request_id);
    }
    Ok(())
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
    if request
        .session_generation
        .is_some_and(|generation| generation > MAX_SESSION_GENERATION)
    {
        return Err(String::from("invalid_session_generation"));
    }
    match request.operation {
        PtyOperation::Start => {
            if request.session_generation.is_some() {
                return Err(String::from("session_generation_only_on_non_start"));
            }
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
        _ if request.session_generation.is_none() => {
            return Err(String::from("missing_session_generation"));
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
    shared_protocol_request(request)
        .validate()
        .map_err(shared_protocol_error_code)
}

fn shared_protocol_request(request: &PtyRequest) -> HostPtyRequest {
    let operation = match request.operation {
        PtyOperation::Start => HostPtyOperation::Start {
            program: request.program.clone().unwrap_or_default(),
            args: request.args.clone(),
            current_dir: request.current_dir.clone(),
            execution_target: request.execution_target.clone(),
            cols: request.cols.unwrap_or(0),
            rows: request.rows.unwrap_or(0),
        },
        PtyOperation::Write => HostPtyOperation::Write {
            input: request.input.clone().unwrap_or_default(),
        },
        PtyOperation::Resize => HostPtyOperation::Resize {
            cols: request.cols.unwrap_or(0),
            rows: request.rows.unwrap_or(0),
        },
        PtyOperation::Poll => HostPtyOperation::Poll,
        PtyOperation::Wait => HostPtyOperation::Wait {
            timeout_ms: request.timeout_ms.unwrap_or(0),
        },
        PtyOperation::Terminate => HostPtyOperation::Terminate,
    };
    HostPtyRequest::new(
        request.request_id.clone(),
        request.workspace_id.clone(),
        request.worker_id.clone(),
        request.session_id.clone(),
        request.session_generation,
        operation,
    )
}

fn shared_protocol_error_code(error: ProtocolError) -> String {
    match error {
        ProtocolError::UnsupportedVersion(_) => "unsupported_version",
        ProtocolError::CapabilityDenied(_) => "capability_denied",
        ProtocolError::EmptyRequestId => "empty_request_id",
        ProtocolError::EmptyPtyWorkspaceId => "empty_workspace_id",
        ProtocolError::EmptyPtyWorkerId => "empty_worker_id",
        ProtocolError::EmptyPtySessionId => "empty_session_id",
        ProtocolError::MissingPtySessionGeneration => "missing_session_generation",
        ProtocolError::InvalidPtySessionGeneration => "invalid_session_generation",
        ProtocolError::EmptyPtyProgram => "empty_program",
        ProtocolError::InvalidPtySize => "invalid_size",
        ProtocolError::InvalidPtyTimeout => "invalid_timeout",
        ProtocolError::EmptyPtyExecutionTarget => "empty_execution_target",
        _ => "invalid_request",
    }
    .to_string()
}

fn start_session(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<PtySessionHandle, String> {
    let spec = build_pty_spec(request)?;
    let owner = owner_for_request(request);
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
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
    let session_generation = registry
        .next_session_generation
        .checked_add(1)
        .filter(|generation| *generation <= MAX_SESSION_GENERATION)
        .ok_or_else(|| String::from("session_generation_overflow"))?;
    registry.next_session_generation = session_generation;
    registry.session_reservations.insert(
        request.session_id.clone(),
        PtySessionReservation {
            request_id: request.request_id.clone(),
            owner: owner.clone(),
            session_generation,
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
    let session_generation = registry
        .session_reservations
        .get(&request.session_id)
        .filter(|reservation| reservation.request_id == request.request_id)
        .map(|reservation| reservation.session_generation)
        .ok_or_else(|| String::from("session_reservation_lost"))?;
    registry.sessions.insert(
        request.session_id.clone(),
        PtySessionEntry {
            owner,
            session_generation,
            session: Arc::clone(&session),
        },
    );
    Ok(PtySessionHandle {
        session,
        session_generation,
    })
}

fn session_for_request(
    request: &PtyRequest,
    state: &PtyExecutionState,
) -> Result<PtySessionHandle, String> {
    let registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    let owner = owner_for_request(request);
    let session = if let Some(reservation) = registry.session_reservations.get(&request.session_id)
    {
        if reservation.owner != owner {
            return Err(String::from("session_owner_conflict"));
        }
        return Err(String::from("session_starting"));
    } else if let Some(entry) = registry.sessions.get(&request.session_id) {
        if entry.owner != owner {
            return Err(String::from("session_owner_conflict"));
        }
        if request.session_generation != Some(entry.session_generation) {
            return Err(String::from("stale_session_generation"));
        }
        PtySessionHandle {
            session: Arc::clone(&entry.session),
            session_generation: entry.session_generation,
        }
    } else {
        return Err(String::from("session_not_found"));
    };
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
    session_generation: u64,
) -> Result<String, String> {
    serde_json::to_string(&PtyResponse {
        envelope: ProtocolEnvelope::new(request.request_id.clone(), Capability::Pty, 1),
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
        session_id: request.session_id.clone(),
        session_generation,
        generation: snapshot.generation,
        operation: operation_name(&request.operation).to_string(),
        status: response_status(&snapshot.status),
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

fn response_status(status: &ade_host_core::terminal::TerminalStatus) -> PtyStatus {
    match status {
        ade_host_core::terminal::TerminalStatus::Created => PtyStatus::Created,
        ade_host_core::terminal::TerminalStatus::Running => PtyStatus::Running,
        ade_host_core::terminal::TerminalStatus::Exited { .. } => PtyStatus::Exited,
        ade_host_core::terminal::TerminalStatus::Failed { .. } => PtyStatus::Failed,
        ade_host_core::terminal::TerminalStatus::Closed => PtyStatus::Closed,
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
    session: Option<&Arc<Mutex<PtySession>>>,
    completed: bool,
) -> Result<(), String> {
    let mut registry = state
        .registry
        .lock()
        .map_err(|_| String::from("pty_registry_unavailable"))?;
    if registry.in_flight_requests.get(&request.request_id) != Some(request) {
        return Ok(());
    }
    registry.in_flight_requests.remove(&request.request_id);
    if registry
        .session_reservations
        .get(&request.session_id)
        .is_some_and(|reservation| reservation.request_id == request.request_id)
    {
        registry.session_reservations.remove(&request.session_id);
    }
    let remove_session =
        (matches!(request.operation, PtyOperation::Terminate) && result.is_ok()) || completed;
    registry
        .committed_requests
        .insert(request.request_id.clone(), (request.clone(), result));
    if remove_session {
        let should_remove = registry
            .sessions
            .get(&request.session_id)
            .zip(session)
            .is_some_and(|(entry, session)| Arc::ptr_eq(&entry.session, session));
        if should_remove {
            registry.sessions.remove(&request.session_id);
        }
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
