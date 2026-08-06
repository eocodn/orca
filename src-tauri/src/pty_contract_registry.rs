use super::pty_contract_types::{
    PtyExecutionState, PtyOwner, PtySessionEntry, PtySessionHandle, PtySessionReservation,
    MAX_COMMITTED_REQUESTS, MAX_SESSION_GENERATION,
};
use super::{PtyOperation, PtyRequest};
use crate::pty_target::build_pty_spec;
use ade_terminal::pty::{PtyError, PtySession};
use std::sync::{Arc, Mutex};

pub(super) fn begin_request(
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

pub(super) fn abort_request(request: &PtyRequest, state: &PtyExecutionState) -> Result<(), String> {
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

pub(super) fn start_session(
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

    let session = PtySession::spawn(request.session_id.clone(), spec).map_err(pty_error_code)?;
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

pub(super) fn session_for_request(
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

pub(super) fn owner_for_request(request: &PtyRequest) -> PtyOwner {
    PtyOwner {
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
    }
}

pub(super) fn commit_request_result(
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

pub(super) fn pty_error_code(error: PtyError) -> String {
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
