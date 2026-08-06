use ade_host::pty_router::WorkerIdentity;
use ade_host::pty_service::PtyHostService;
use ade_host_core::protocol::{PtyOperation, PtyRequest, PtyStatus};
use std::time::Duration;

const WORKSPACE_ID: &str = "workspace";
const WORKER_ID: &str = "worker";
const SESSION_ID: &str = "session";

fn request(id: &str, session_generation: Option<u64>, operation: PtyOperation) -> PtyRequest {
    PtyRequest::new(
        id,
        WORKSPACE_ID,
        WORKER_ID,
        SESSION_ID,
        session_generation,
        operation,
    )
}

#[test]
fn routes_shared_pty_lifecycle_through_real_jsonl_worker() {
    let worker_path = worker_path();
    assert!(
        worker_path.exists(),
        "worker binary missing: {}",
        worker_path.display()
    );

    let service = PtyHostService::spawn(
        worker_path,
        WorkerIdentity {
            worker_id: WORKER_ID.into(),
            worker_incarnation: 1,
        },
        Duration::from_secs(3),
    )
    .expect("worker process");
    service
        .claim_workspace("claim", WORKSPACE_ID)
        .expect("explicit workspace claim");

    let started = service
        .route(request("start", None, start_operation()))
        .expect("start");
    let generation = started.session_generation;
    assert!(generation > 0);

    service
        .route(request(
            "write",
            Some(generation),
            PtyOperation::Write {
                input: exit_command().into(),
            },
        ))
        .expect("write");
    let completed = service
        .route(request(
            "wait",
            Some(generation),
            PtyOperation::Wait { timeout_ms: 2_000 },
        ))
        .expect("wait");

    assert_eq!(completed.status, PtyStatus::Exited);
    assert_eq!(completed.exit_code, Some(0));
    assert!(
        completed.tail.contains("host-worker-ok"),
        "{}",
        completed.tail
    );
}

fn worker_path() -> std::path::PathBuf {
    std::env::var_os("ADE_WORKER_BIN")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            let name = if cfg!(windows) {
                "ade-worker.exe"
            } else {
                "ade-worker"
            };
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../target/debug")
                .join(name)
        })
}

#[cfg(windows)]
fn start_operation() -> PtyOperation {
    PtyOperation::Start {
        program: "cmd.exe".into(),
        args: vec![],
        current_dir: None,
        execution_target: None,
        cols: 80,
        rows: 24,
    }
}

#[cfg(not(windows))]
fn start_operation() -> PtyOperation {
    PtyOperation::Start {
        program: "/bin/sh".into(),
        args: vec![],
        current_dir: None,
        execution_target: None,
        cols: 80,
        rows: 24,
    }
}

#[cfg(windows)]
fn exit_command() -> &'static str {
    "echo host-worker-ok & exit\r\n"
}

#[cfg(not(windows))]
fn exit_command() -> &'static str {
    "printf 'host-worker-ok\\n'; exit\n"
}
