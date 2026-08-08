use super::wsl_worker_endpoint::{WslWorkerEndpoint, WslWorkerEndpointError};
use super::wsl_worker_installer::{WSL_WORKER_LINK, WSL_WORKER_SOCKET};
use ade_host_core::protocol::{WorkerHandshakeKind, WorkerHandshakeResponse, PROTOCOL_VERSION};

#[test]
fn endpoint_rejects_unsafe_or_privileged_identity_before_command_building() {
    assert_eq!(
        WslWorkerEndpoint::new("", "alice", "worker", 7, "0.1.0"),
        Err(WslWorkerEndpointError::EmptyDistro)
    );
    assert_eq!(
        WslWorkerEndpoint::new("Ubuntu-24.04", "root", "worker", 7, "0.1.0"),
        Err(WslWorkerEndpointError::RootServiceUser)
    );
    assert_eq!(
        WslWorkerEndpoint::new("Ubuntu-24.04", "alice;id", "worker", 7, "0.1.0"),
        Err(WslWorkerEndpointError::InvalidServiceUser)
    );
    assert_eq!(
        WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "", 7, "0.1.0"),
        Err(WslWorkerEndpointError::InvalidWorkerId)
    );
    assert_eq!(
        WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker", 0, "0.1.0"),
        Err(WslWorkerEndpointError::InvalidWorkerIncarnation)
    );
    assert_eq!(
        WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker", 7, ""),
        Err(WslWorkerEndpointError::InvalidWorkerVersion)
    );
}

#[test]
fn endpoint_builds_the_exact_non_root_wsl_relay_command() {
    let endpoint = WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker-1", 7, "0.1.0").unwrap();
    let command = endpoint.relay_command();

    assert_eq!(command.program, "wsl.exe");
    assert_eq!(
        command.args,
        vec![
            "--distribution",
            "Ubuntu-24.04",
            "--user",
            "alice",
            "--exec",
            WSL_WORKER_LINK,
            "--connect-unix",
            WSL_WORKER_SOCKET,
        ]
    );
    assert_eq!(command.working_directory, None);
}

#[test]
fn endpoint_requires_correlated_protocol_identity_incarnation_and_version_handshake() {
    let endpoint = WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker-1", 7, "0.1.0").unwrap();
    let request = endpoint.handshake_request("host-relay-7").unwrap();
    let response = WorkerHandshakeResponse {
        kind: WorkerHandshakeKind::WorkerHandshake,
        request_id: request.request_id.clone(),
        protocol_version: PROTOCOL_VERSION,
        worker_id: "worker-1".into(),
        worker_incarnation: 7,
        worker_version: "0.1.0".into(),
    };
    assert_eq!(endpoint.validate_handshake(&request, &response), Ok(()));

    let mut wrong = response.clone();
    wrong.worker_version = "0.0.9".into();
    assert_eq!(
        endpoint.validate_handshake(&request, &wrong),
        Err(WslWorkerEndpointError::WorkerVersionMismatch)
    );
    wrong = response.clone();
    wrong.worker_incarnation = 8;
    assert_eq!(
        endpoint.validate_handshake(&request, &wrong),
        Err(WslWorkerEndpointError::WorkerIncarnationMismatch)
    );
    wrong = response;
    wrong.worker_id = "worker-2".into();
    assert_eq!(
        endpoint.validate_handshake(&request, &wrong),
        Err(WslWorkerEndpointError::WorkerIdMismatch)
    );
}
