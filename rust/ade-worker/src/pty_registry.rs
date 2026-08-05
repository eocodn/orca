use crate::pty_target::build_pty_spec;
use ade_host_core::protocol::{
    Capability, ProtocolEnvelope, PtyOperation, PtyRequest, PtyResponse, PtyStatus,
    PROTOCOL_VERSION,
};
use ade_host_core::terminal::TerminalStatus;
use ade_terminal::pty::{PtyError, PtySession};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_GENERATION: u64 = 9_007_199_254_740_991;
const MAX_COMMITTED_REQUESTS: usize = 4096;

#[derive(Default)]
pub struct PtyWorkerRegistry {
    registry: Mutex<Registry>,
}

pub type PtyExecutionState = PtyWorkerRegistry;

#[derive(Default)]
struct Registry {
    next_generation: u64,
    sessions: HashMap<String, SessionEntry>,
    reservations: HashMap<String, Reservation>,
    committed: HashMap<String, (PtyRequest, Result<PtyResponse, String>)>,
    committed_order: VecDeque<String>,
    in_flight: HashMap<String, PtyRequest>,
}

#[derive(Clone, PartialEq, Eq)]
struct Owner {
    workspace_id: String,
    worker_id: String,
}

struct SessionEntry {
    owner: Owner,
    generation: u64,
    session: Arc<Mutex<PtySession>>,
}
struct Reservation {
    request_id: String,
    owner: Owner,
    generation: u64,
}

impl PtyWorkerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn execute(&self, request: &PtyRequest) -> Result<PtyResponse, String> {
        if let Some(result) = self.begin(request)? {
            return result;
        }
        if let Err(error) = request.validate() {
            self.abort(request)?;
            return Err(format_protocol_error(error));
        }
        let handle = match request.operation {
            PtyOperation::Start { .. } => match self.start(request) {
                Ok(handle) => handle,
                Err(error) => {
                    self.commit(request, Err(error.clone()), None)?;
                    return Err(error);
                }
            },
            _ => match self.session_for(request) {
                Ok(Some(handle)) => handle,
                Ok(None) => {
                    self.abort(request)?;
                    return Err("session_not_found".into());
                }
                Err(error) => {
                    if error == "session_owner_conflict" {
                        self.commit(request, Err(error.clone()), None)?;
                    } else {
                        self.abort(request)?;
                    }
                    return Err(error);
                }
            },
        };
        let generation = handle.generation;
        let operation = self.apply_operation(request, &handle.session, generation);
        let result = match operation {
            Ok(response) => Ok(response.clone()),
            Err(error) => Err(error),
        };
        self.commit(request, result.clone(), Some(&handle.session))?;
        result
    }

    fn begin(&self, request: &PtyRequest) -> Result<Option<Result<PtyResponse, String>>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "pty_registry_unavailable".to_string())?;
        if let Some((committed, result)) = registry.committed.get(&request.envelope.request_id) {
            if committed == request {
                return Ok(Some(result.clone()));
            }
            return Err("request_id_conflict".into());
        }
        if let Some(in_flight) = registry.in_flight.get(&request.envelope.request_id) {
            if in_flight == request {
                return Err("request_in_flight".into());
            }
            return Err("request_id_conflict".into());
        }
        registry
            .in_flight
            .insert(request.envelope.request_id.clone(), request.clone());
        Ok(None)
    }

    fn abort(&self, request: &PtyRequest) -> Result<(), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "pty_registry_unavailable".to_string())?;
        if registry.in_flight.get(&request.envelope.request_id) == Some(request) {
            registry.in_flight.remove(&request.envelope.request_id);
        }
        Ok(())
    }

    fn start(&self, request: &PtyRequest) -> Result<SessionHandle, String> {
        let spec = build_pty_spec(request)?;
        let owner = owner(request);
        let generation = {
            let mut registry = self
                .registry
                .lock()
                .map_err(|_| "pty_registry_unavailable".to_string())?;
            if let Some(entry) = registry.sessions.get(&request.session_id) {
                return Err(if entry.owner == owner {
                    "session_id_conflict"
                } else {
                    "session_owner_conflict"
                }
                .into());
            }
            if let Some(reservation) = registry.reservations.get(&request.session_id) {
                return Err(if reservation.owner == owner {
                    "session_id_starting"
                } else {
                    "session_owner_conflict"
                }
                .into());
            }
            let generation = registry
                .next_generation
                .checked_add(1)
                .filter(|value| *value <= MAX_GENERATION)
                .ok_or_else(|| "session_generation_overflow".to_string())?;
            registry.next_generation = generation;
            registry.reservations.insert(
                request.session_id.clone(),
                Reservation {
                    request_id: request.envelope.request_id.clone(),
                    owner: owner.clone(),
                    generation,
                },
            );
            generation
        };
        let session = Arc::new(Mutex::new(
            PtySession::spawn(request.session_id.clone(), spec).map_err(pty_error)?,
        ));
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "pty_registry_unavailable".to_string())?;
        let reserved_generation = registry
            .reservations
            .get(&request.session_id)
            .filter(|item| item.request_id == request.envelope.request_id)
            .map(|item| item.generation)
            .ok_or_else(|| "session_reservation_lost".to_string())?;
        registry.sessions.insert(
            request.session_id.clone(),
            SessionEntry {
                owner,
                generation: reserved_generation,
                session: Arc::clone(&session),
            },
        );
        registry.reservations.remove(&request.session_id);
        Ok(SessionHandle {
            session,
            generation,
        })
    }

    fn session_for(&self, request: &PtyRequest) -> Result<Option<SessionHandle>, String> {
        let registry = self
            .registry
            .lock()
            .map_err(|_| "pty_registry_unavailable".to_string())?;
        let owner = owner(request);
        if let Some(reservation) = registry.reservations.get(&request.session_id) {
            return Err(if reservation.owner == owner {
                "session_starting"
            } else {
                "session_owner_conflict"
            }
            .into());
        }
        let Some(entry) = registry.sessions.get(&request.session_id) else {
            return Ok(None);
        };
        if entry.owner != owner {
            return Err("session_owner_conflict".into());
        }
        if request.session_generation != Some(entry.generation) {
            return Err("stale_session_generation".into());
        }
        Ok(Some(SessionHandle {
            session: Arc::clone(&entry.session),
            generation: entry.generation,
        }))
    }

    fn apply_operation(
        &self,
        request: &PtyRequest,
        session: &Arc<Mutex<PtySession>>,
        session_generation: u64,
    ) -> Result<PtyResponse, String> {
        let mut session = session
            .lock()
            .map_err(|_| "pty_session_unavailable".to_string())?;
        let snapshot = match &request.operation {
            PtyOperation::Start { .. } => session.snapshot(),
            PtyOperation::Write { input } => {
                session.write(input.as_bytes()).and_then(|_| session.poll())
            }
            PtyOperation::Resize { cols, rows } => {
                session.resize(*cols, *rows).and_then(|_| session.poll())
            }
            PtyOperation::Poll => session.poll(),
            PtyOperation::Wait { timeout_ms } => session.wait(Duration::from_millis(*timeout_ms)),
            PtyOperation::Terminate => session.terminate(),
        }
        .map_err(pty_error)?;
        Ok(response(request, snapshot, session_generation))
    }

    fn commit(
        &self,
        request: &PtyRequest,
        result: Result<PtyResponse, String>,
        session: Option<&Arc<Mutex<PtySession>>>,
    ) -> Result<(), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "pty_registry_unavailable".to_string())?;
        if registry.in_flight.get(&request.envelope.request_id) != Some(request) {
            return Ok(());
        }
        registry.in_flight.remove(&request.envelope.request_id);
        if registry
            .reservations
            .get(&request.session_id)
            .is_some_and(|item| item.request_id == request.envelope.request_id)
        {
            registry.reservations.remove(&request.session_id);
        }
        // Wait leaves the session addressable so cleanup can be explicit after observing exit.
        let completed = result
            .as_ref()
            .is_ok_and(|response| matches!(response.status, PtyStatus::Exited | PtyStatus::Closed));
        let remove = (completed && !matches!(request.operation, PtyOperation::Wait { .. }))
            || (matches!(request.operation, PtyOperation::Terminate) && result.is_ok());
        if remove {
            let same = registry
                .sessions
                .get(&request.session_id)
                .zip(session)
                .is_some_and(|(entry, current)| Arc::ptr_eq(&entry.session, current));
            if same {
                registry.sessions.remove(&request.session_id);
            }
        }
        registry.committed.insert(
            request.envelope.request_id.clone(),
            (request.clone(), result),
        );
        registry
            .committed_order
            .push_back(request.envelope.request_id.clone());
        while registry.committed_order.len() > MAX_COMMITTED_REQUESTS {
            if let Some(id) = registry.committed_order.pop_front() {
                registry.committed.remove(&id);
            }
        }
        Ok(())
    }
}

pub fn execute_shared_pty_request(
    request: &PtyRequest,
    state: &PtyWorkerRegistry,
) -> Result<PtyResponse, String> {
    state.execute(request)
}

struct SessionHandle {
    session: Arc<Mutex<PtySession>>,
    generation: u64,
}

fn owner(request: &PtyRequest) -> Owner {
    Owner {
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
    }
}

fn response(
    request: &PtyRequest,
    snapshot: ade_host_core::terminal::TerminalSnapshot,
    session_generation: u64,
) -> PtyResponse {
    PtyResponse {
        envelope: ProtocolEnvelope::new(
            request.envelope.request_id.clone(),
            Capability::Pty,
            PROTOCOL_VERSION,
        ),
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
        session_id: request.session_id.clone(),
        session_generation,
        generation: snapshot.generation,
        operation: operation_name(&request.operation).into(),
        status: status(&snapshot.status),
        exit_code: snapshot.exit_code,
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail,
        failure_reason: snapshot.failure_reason,
    }
}

fn operation_name(operation: &PtyOperation) -> &'static str {
    match operation {
        PtyOperation::Start { .. } => "start",
        PtyOperation::Write { .. } => "write",
        PtyOperation::Resize { .. } => "resize",
        PtyOperation::Poll => "poll",
        PtyOperation::Wait { .. } => "wait",
        PtyOperation::Terminate => "terminate",
    }
}
fn status(status: &TerminalStatus) -> PtyStatus {
    match status {
        TerminalStatus::Created => PtyStatus::Created,
        TerminalStatus::Running => PtyStatus::Running,
        TerminalStatus::Exited { .. } => PtyStatus::Exited,
        TerminalStatus::Failed { .. } => PtyStatus::Failed,
        TerminalStatus::Closed => PtyStatus::Closed,
    }
}
fn pty_error(error: PtyError) -> String {
    match error {
        PtyError::EmptyProgram => "empty_program",
        PtyError::InvalidSize => "invalid_size",
        PtyError::InvalidWorkingDirectory(_) => "invalid_working_directory",
        PtyError::Spawn(_) => "pty_spawn_failed",
        PtyError::Input(_) => "pty_input_failed",
        PtyError::Resize(_) => "pty_resize_failed",
        PtyError::Output(_) => "pty_output_failed",
        PtyError::Terminal(_) => "pty_terminal_failed",
        PtyError::Timeout => "pty_timeout",
        PtyError::Termination(_) => "pty_termination_failed",
    }
    .into()
}
fn format_protocol_error(error: ade_host_core::protocol::ProtocolError) -> String {
    use ade_host_core::protocol::ProtocolError;
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
    .into()
}

impl Drop for PtyWorkerRegistry {
    fn drop(&mut self) {
        let Ok(registry) = self.registry.get_mut() else {
            return;
        };
        for (_, entry) in registry.sessions.drain() {
            if let Ok(mut session) = entry.session.lock() {
                let _ = session.terminate();
            }
        }
    }
}
