use ade_host::pty_router::{JsonlWorkerTransport, PtyHostRouter, WorkerIdentity};
use ade_host_core::ownership::{OwnershipCommand, OwnershipRuntime};
use ade_host_core::protocol::{PtyOperation, PtyRequest};
use std::time::Duration;

fn request(id: &str, session_generation: Option<u64>, operation: PtyOperation) -> PtyRequest {
    PtyRequest::new(
        id,
        "workspace",
        "worker",
        "session",
        session_generation,
        operation,
    )
}

#[test]
fn routes_shared_pty_lifecycle_through_real_jsonl_worker() {
    let worker_path = std::env::var_os("ADE_WORKER_BIN")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/debug/ade-worker")
        });
    assert!(
        worker_path.exists(),
        "worker binary missing: {}",
        worker_path.display()
    );

    let ownership = OwnershipRuntime::new();
    let acquired = ownership
        .apply(OwnershipCommand::Acquire {
            operation_id: "acquire".into(),
            workspace_id: "workspace".into(),
            worker_id: "worker".into(),
            worker_incarnation: 1,
        })
        .expect("ownership acquire");
    ownership
        .apply(OwnershipCommand::ClaimReady {
            operation_id: "ready".into(),
            token: acquired.token.expect("lease token"),
        })
        .expect("ownership ready");

    let transport = JsonlWorkerTransport::spawn(
        worker_path,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 1,
        },
        Duration::from_secs(3),
    )
    .expect("worker process");
    let router = PtyHostRouter::new(ownership, Box::new(transport));

    let started = router
        .route(request(
            "start",
            None,
            PtyOperation::Start {
                program: "sh".into(),
                args: vec!["-c".into(), "printf ready; sleep 1".into()],
                current_dir: None,
                execution_target: None,
                cols: 80,
                rows: 24,
            },
        ))
        .expect("start");
    let generation = started.session_generation;
    assert!(generation > 0);
    router
        .route(request(
            "write",
            Some(generation),
            PtyOperation::Write {
                input: "input\n".into(),
            },
        ))
        .expect("write");
    router
        .route(request("poll", Some(generation), PtyOperation::Poll))
        .expect("poll");
    router
        .route(request(
            "wait",
            Some(generation),
            PtyOperation::Wait { timeout_ms: 2_000 },
        ))
        .expect("wait");
    router
        .route(request(
            "terminate",
            Some(generation),
            PtyOperation::Terminate,
        ))
        .expect("terminate");
}
