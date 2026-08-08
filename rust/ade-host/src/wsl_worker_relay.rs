use ade_host_core::protocol::{
    WorkerHandshakeError, WorkerHandshakeRequest, WorkerHandshakeResponse,
};
use ade_host_platform::wsl_worker_endpoint::{WslWorkerEndpoint, WslWorkerEndpointError};
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WslRelayHandshakeFailure {
    Malformed,
    Mismatch(&'static str),
}

pub(crate) fn command_for_endpoint(endpoint: &WslWorkerEndpoint) -> Command {
    let spec = endpoint.relay_command();
    let mut command = Command::new(spec.program);
    command.args(spec.args);
    if let Some(working_directory) = spec.working_directory {
        command.current_dir(working_directory);
    }
    command
}

pub(crate) fn handshake_request(
    endpoint: &WslWorkerEndpoint,
    prefix: &str,
) -> Result<WorkerHandshakeRequest, WslRelayHandshakeFailure> {
    endpoint
        .handshake_request(format!("{prefix}-{}", endpoint.worker_incarnation()))
        .map_err(map_endpoint_error)
}

pub(crate) fn parse_handshake(
    endpoint: &WslWorkerEndpoint,
    request: &WorkerHandshakeRequest,
    line: &str,
) -> Result<WorkerHandshakeResponse, WslRelayHandshakeFailure> {
    let response: WorkerHandshakeResponse =
        serde_json::from_str(line).map_err(|_| WslRelayHandshakeFailure::Malformed)?;
    endpoint
        .validate_handshake(request, &response)
        .map_err(map_endpoint_error)?;
    Ok(response)
}

fn map_endpoint_error(error: WslWorkerEndpointError) -> WslRelayHandshakeFailure {
    match error {
        WslWorkerEndpointError::WorkerIdMismatch => WslRelayHandshakeFailure::Mismatch("worker_id"),
        WslWorkerEndpointError::WorkerIncarnationMismatch => {
            WslRelayHandshakeFailure::Mismatch("worker_incarnation")
        }
        WslWorkerEndpointError::WorkerVersionMismatch => {
            WslRelayHandshakeFailure::Mismatch("worker_version")
        }
        WslWorkerEndpointError::InvalidHandshake(error) => match error {
            WorkerHandshakeError::RequestIdMismatch | WorkerHandshakeError::EmptyRequestId => {
                WslRelayHandshakeFailure::Mismatch("request_id")
            }
            WorkerHandshakeError::UnsupportedVersion(_)
            | WorkerHandshakeError::ProtocolVersionMismatch => {
                WslRelayHandshakeFailure::Mismatch("protocol_version")
            }
            WorkerHandshakeError::EmptyWorkerId => WslRelayHandshakeFailure::Mismatch("worker_id"),
            WorkerHandshakeError::InvalidWorkerIncarnation => {
                WslRelayHandshakeFailure::Mismatch("worker_incarnation")
            }
            WorkerHandshakeError::EmptyWorkerVersion => {
                WslRelayHandshakeFailure::Mismatch("worker_version")
            }
        },
        WslWorkerEndpointError::EmptyDistro
        | WslWorkerEndpointError::InvalidServiceUser
        | WslWorkerEndpointError::RootServiceUser
        | WslWorkerEndpointError::InvalidWorkerId
        | WslWorkerEndpointError::InvalidWorkerIncarnation
        | WslWorkerEndpointError::InvalidWorkerVersion => WslRelayHandshakeFailure::Malformed,
    }
}
