use ade_host::pty_router::{PtyWorkerTransport, RouterError, WorkerIdentity};
use ade_host::pty_service::PtyHostService;
use ade_host_core::protocol::{
    Capability, ProtocolEnvelope, PtyOperation, PtyRequest, PtyResponse, PtyStatus,
    PROTOCOL_VERSION,
};

struct EchoTransport {
    identity: WorkerIdentity,
    calls: usize,
}

impl PtyWorkerTransport for EchoTransport {
    fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    fn dispatch(&mut self, request: &PtyRequest) -> Result<PtyResponse, RouterError> {
        self.calls += 1;
        Ok(PtyResponse {
            envelope: ProtocolEnvelope::new(
                request.envelope.request_id.clone(),
                Capability::Pty,
                PROTOCOL_VERSION,
            ),
            workspace_id: request.workspace_id.clone(),
            worker_id: request.worker_id.clone(),
            session_id: request.session_id.clone(),
            session_generation: request.session_generation.unwrap_or(1),
            generation: 1,
            operation: match request.operation {
                PtyOperation::Start { .. } => "start",
                PtyOperation::Write { .. } => "write",
                PtyOperation::Resize { .. } => "resize",
                PtyOperation::Poll => "poll",
                PtyOperation::Wait { .. } => "wait",
                PtyOperation::Terminate => "terminate",
            }
            .into(),
            status: PtyStatus::Running,
            exit_code: None,
            output_sequence: 0,
            tail: String::new(),
            failure_reason: None,
        })
    }
}

fn service() -> PtyHostService {
    PtyHostService::new(Box::new(EchoTransport {
        identity: WorkerIdentity {
            worker_id: "worker-1".into(),
            worker_incarnation: 7,
        },
        calls: 0,
    }))
    .expect("service should accept a valid worker identity")
}

fn start_request(request_id: &str) -> PtyRequest {
    PtyRequest::new(
        request_id,
        "workspace-1",
        "worker-1",
        "session-1",
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

#[test]
fn requires_an_explicit_workspace_claim_before_dispatch() {
    let service = service();
    assert_eq!(
        service.route(start_request("request-1")),
        Err(RouterError::WorkspaceUnowned.into())
    );

    let claim = service
        .claim_workspace("claim-1", "workspace-1")
        .expect("claim should succeed");
    assert!(claim.changed);
    assert_eq!(claim.worker_id, "worker-1");
    assert_eq!(claim.worker_incarnation, 7);

    let replay = service
        .claim_workspace("claim-1", "workspace-1")
        .expect("identical claim should be idempotent");
    assert_eq!(replay.lease_id, claim.lease_id);
    assert!(!replay.changed);

    let response = service
        .route(start_request("request-1"))
        .expect("claimed route should reach the worker");
    assert_eq!(response.worker_id, "worker-1");
    assert_eq!(response.session_generation, 1);
}

#[test]
fn preserves_router_request_replay_and_conflict_semantics() {
    let service = service();
    service
        .claim_workspace("claim-1", "workspace-1")
        .expect("claim should succeed");
    let request = start_request("request-1");
    let first = service
        .route(request.clone())
        .expect("first route should pass");
    assert_eq!(service.route(request), Ok(first));

    let mut conflict = start_request("request-1");
    conflict.session_id = "other-session".into();
    assert_eq!(
        service.route(conflict),
        Err(RouterError::RequestIdConflict.into())
    );
}
