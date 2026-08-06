use super::pty_contract_types::{PtyOperation, PtyRequest, MAX_SESSION_GENERATION};
use crate::pty_target::PtyExecutionTarget;
use ade_host_core::protocol::{
    ProtocolError, PtyOperation as HostPtyOperation, PtyRequest as HostPtyRequest,
};

pub(super) const MAX_WAIT_MS: u64 = 30_000;

pub(super) fn local_request(request: &HostPtyRequest) -> PtyRequest {
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

pub(super) fn should_commit_start_error(error: &str) -> bool {
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

pub(super) fn validate_request(request: &PtyRequest) -> Result<(), String> {
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

pub(super) fn shared_protocol_request(request: &PtyRequest) -> HostPtyRequest {
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

pub(super) fn shared_protocol_error_code(error: ProtocolError) -> String {
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
