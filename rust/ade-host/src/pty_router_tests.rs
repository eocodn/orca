use super::*;
use ade_host_core::ownership::{OwnershipCommand, OwnershipToken};
use ade_host_core::protocol::{
    Capability, ProtocolEnvelope, PtyOperation, PtyStatus, PROTOCOL_VERSION,
};

struct FakeTransport {
    identity: WorkerIdentity,
    response: Option<Result<PtyResponse, RouterError>>,
    calls: usize,
}
impl PtyWorkerTransport for FakeTransport {
    fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }
    fn dispatch(&mut self, _request: &PtyRequest) -> Result<PtyResponse, RouterError> {
        self.calls += 1;
        self.response.take().unwrap()
    }
}

fn owned() -> (OwnershipRuntime, OwnershipToken) {
    let runtime = OwnershipRuntime::new();
    let acquired = runtime
        .apply(OwnershipCommand::Acquire {
            operation_id: "acquire".into(),
            workspace_id: "ws".into(),
            worker_id: "worker".into(),
            worker_incarnation: 7,
        })
        .unwrap();
    let token = acquired.token.unwrap();
    runtime
        .apply(OwnershipCommand::ClaimReady {
            operation_id: "ready".into(),
            token: token.clone(),
        })
        .unwrap();
    (runtime, token)
}

fn request(id: &str) -> PtyRequest {
    PtyRequest::new(
        id,
        "ws",
        "worker",
        "session",
        None,
        PtyOperation::Start {
            program: "sh".into(),
            args: vec![],
            current_dir: None,
            execution_target: None,
            cols: 80,
            rows: 24,
        },
    )
}

fn response(request: &PtyRequest) -> PtyResponse {
    PtyResponse {
        envelope: ProtocolEnvelope::new(
            request.envelope.request_id.clone(),
            Capability::Pty,
            PROTOCOL_VERSION,
        ),
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
        session_id: request.session_id.clone(),
        session_generation: 1,
        generation: 1,
        operation: "start".into(),
        status: PtyStatus::Running,
        exit_code: None,
        output_sequence: 0,
        tail: String::new(),
        failure_reason: None,
    }
}

#[test]
fn rejects_unowned_and_stale_incarnation_before_dispatch() {
    let ownership = OwnershipRuntime::new();
    let transport = FakeTransport {
        identity: WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 7,
        },
        response: None,
        calls: 0,
    };
    let router = PtyHostRouter::new(ownership.clone(), Box::new(transport));
    assert_eq!(
        router.route(request("unowned")),
        Err(RouterError::WorkspaceUnowned)
    );
    let acquired = ownership
        .apply(OwnershipCommand::Acquire {
            operation_id: "acquire".into(),
            workspace_id: "ws".into(),
            worker_id: "worker".into(),
            worker_incarnation: 7,
        })
        .unwrap();
    let token = acquired.token.unwrap();
    ownership
        .apply(OwnershipCommand::ClaimReady {
            operation_id: "ready".into(),
            token: token.clone(),
        })
        .unwrap();
    let router = PtyHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: token.worker_incarnation + 1,
            },
            response: Some(Ok(response(&request("stale")))),
            calls: 0,
        }),
    );
    assert_eq!(
        router.route(request("stale")),
        Err(RouterError::StaleWorkerIncarnation)
    );
}

#[test]
fn replays_identical_receipt_and_rejects_conflicting_request_id() {
    let (ownership, _) = owned();
    let first = request("same");
    let mut conflict = first.clone();
    conflict.session_id = "other".into();
    let router = PtyHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            response: Some(Ok(response(&first))),
            calls: 0,
        }),
    );
    assert_eq!(router.route(first.clone()).unwrap().session_generation, 1);
    assert_eq!(router.route(first).unwrap().session_generation, 1);
    assert_eq!(router.route(conflict), Err(RouterError::RequestIdConflict));
}

#[test]
fn rejects_response_correlation_and_worker_errors_without_success() {
    let (ownership, _) = owned();
    let mut mismatched = response(&request("mismatch"));
    mismatched.session_id = "wrong".into();
    let router = PtyHostRouter::new(
        ownership.clone(),
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            response: Some(Ok(mismatched)),
            calls: 0,
        }),
    );
    assert_eq!(
        router.route(request("mismatch")),
        Err(RouterError::ResponseMismatch("session_id"))
    );
    let router = PtyHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            response: Some(Err(RouterError::Timeout)),
            calls: 0,
        }),
    );
    assert_eq!(router.route(request("timeout")), Err(RouterError::Timeout));
}

#[test]
fn rejects_response_generation_and_envelope_mismatches() {
    let (ownership, _) = owned();
    let start = request("generation");
    let mut wrong = response(&start);
    wrong.session_generation = 0;
    let router = PtyHostRouter::new(
        ownership.clone(),
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            response: Some(Ok(wrong)),
            calls: 0,
        }),
    );
    assert_eq!(
        router.route(start),
        Err(RouterError::ResponseMismatch("session_generation"))
    );

    let start = request("envelope");
    let mut wrong = response(&start);
    wrong.envelope.protocol_version = PROTOCOL_VERSION + 1;
    let router = PtyHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            response: Some(Ok(wrong)),
            calls: 0,
        }),
    );
    assert_eq!(
        router.route(start),
        Err(RouterError::ResponseMismatch("protocol_version"))
    );
}

#[cfg(unix)]
#[test]
fn wsl_relay_requires_handshake_before_pty_dispatch() {
    use ade_host_platform::wsl_worker_endpoint::WslWorkerEndpoint;
    use std::fs;

    let path = std::env::temp_dir().join(format!(
        "ade-pty-wsl-handshake-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(
        &path,
        "#!/bin/sh\nIFS= read -r first || exit 60\ncase \"$first\" in *'\"type\":\"worker_handshake\"'*'\"request_id\":\"host-pty-relay-7\"'*) ;; *) exit 61 ;; esac\nprintf '%s\\n' '{\"type\":\"worker_handshake\",\"request_id\":\"host-pty-relay-7\",\"protocol_version\":1,\"worker_id\":\"worker\",\"worker_incarnation\":7,\"worker_version\":\"0.1.0\"}'\nIFS= read -r second || exit 62\ncase \"$second\" in *'\"request_id\":\"after-handshake\"'*) ;; *) exit 63 ;; esac\nprintf '%s\\n' '{\"ok\":false,\"request_id\":\"after-handshake\",\"error\":\"after-handshake\"}'\n",
    )
    .unwrap();
    let endpoint = WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker", 7, "0.1.0").unwrap();
    let mut transport =
        JsonlWorkerTransport::spawn_wsl_script_for_test(&path, endpoint, Duration::from_secs(1))
            .unwrap();
    assert_eq!(
        transport.dispatch(&request("after-handshake")),
        Err(RouterError::WorkerError("after-handshake".into()))
    );
    drop(transport);
    fs::remove_file(path).unwrap();
}

#[cfg(unix)]
#[test]
fn wsl_relay_rejects_worker_incarnation_mismatch_during_spawn() {
    use ade_host_platform::wsl_worker_endpoint::WslWorkerEndpoint;
    use std::fs;

    let path = std::env::temp_dir().join(format!(
        "ade-pty-wsl-mismatch-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(
        &path,
        "#!/bin/sh\nIFS= read -r first || exit 70\nprintf '%s\\n' '{\"type\":\"worker_handshake\",\"request_id\":\"host-pty-relay-7\",\"protocol_version\":1,\"worker_id\":\"worker\",\"worker_incarnation\":8,\"worker_version\":\"0.1.0\"}'\nsleep 5\n",
    )
    .unwrap();
    let endpoint = WslWorkerEndpoint::new("Ubuntu-24.04", "alice", "worker", 7, "0.1.0").unwrap();
    let result =
        JsonlWorkerTransport::spawn_wsl_script_for_test(&path, endpoint, Duration::from_secs(1));
    assert!(matches!(
        result,
        Err(RouterError::ResponseMismatch("worker_incarnation"))
    ));
    fs::remove_file(path).unwrap();
}
