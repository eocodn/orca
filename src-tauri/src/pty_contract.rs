#[path = "pty_contract_protocol.rs"]
mod pty_contract_protocol;
#[path = "pty_contract_registry.rs"]
mod pty_contract_registry;
#[path = "pty_contract_response.rs"]
mod pty_contract_response;
#[path = "pty_contract_types.rs"]
mod pty_contract_types;

pub use pty_contract_types::{PtyExecutionState, PtyOperation, PtyRequest};

#[cfg(test)]
use crate::pty_target::build_pty_spec;
use pty_contract_protocol::{
    local_request, shared_protocol_error_code, should_commit_start_error, validate_request,
};
#[cfg(test)]
use pty_contract_registry::owner_for_request;
use pty_contract_registry::{
    abort_request, begin_request, commit_request_result, pty_error_code, session_for_request,
    start_session,
};
use pty_contract_response::render_result;
#[cfg(test)]
use pty_contract_types::{PtySessionEntry, MAX_SESSION_GENERATION};

use ade_host_core::protocol::PtyRequest as HostPtyRequest;
use std::time::Duration;

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
                    commit_request_result(request, state, Err(error.clone()), None, false)?;
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
                    commit_request_result(request, state, Err(error.clone()), None, false)?;
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
            commit_request_result(
                request,
                state,
                Err(error.clone()),
                Some(&session.session),
                false,
            )?;
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

#[cfg(test)]
#[path = "pty_contract_tests.rs"]
mod tests;
