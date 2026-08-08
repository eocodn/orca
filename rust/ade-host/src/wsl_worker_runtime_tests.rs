use crate::file_git_router::{
    FileGitRouterError, FileGitWorkerTransport, WorkerIdentity as FileGitWorkerIdentity,
};
use crate::pty_router::{PtyWorkerTransport, RouterError, WorkerIdentity as PtyWorkerIdentity};
use crate::wsl_worker_runtime::{WslWorkerRuntime, WslWorkerRuntimeError};
use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, GitWorkerRequest,
    GitWorkerResponse, OwnershipContext, PtyOperation, PtyRequest, PtyResponse,
    WorkerHandshakeKind, WorkerHandshakeRequest, WorkerHandshakeResponse, WorkspaceKind,
    PROTOCOL_VERSION,
};
use ade_host_platform::wsl_worker_installer::{
    WslWorkerInstallCommand, WslWorkerInstallCommandExecutor, WslWorkerInstallCommandOutput,
    WslWorkerInstallRequest, WslWorkerInstaller,
};
use ade_host_platform::wsl_worker_supervisor::{
    WslWorkerCommandExecutor, WslWorkerCommandOutput, WslWorkerStatus, WslWorkerSupervisor,
};
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct SupervisorExecutor;

impl WslWorkerCommandExecutor for SupervisorExecutor {
    fn execute(
        &self,
        command: &ade_host_platform::CommandSpec,
    ) -> io::Result<WslWorkerCommandOutput> {
        let active = command
            .args
            .windows(3)
            .any(|args| args == ["systemctl", "is-active", "ade-worker.service"]);
        Ok(WslWorkerCommandOutput {
            success: true,
            code: Some(0),
            stdout: if active { "active\n" } else { "" }.into(),
            stderr: String::new(),
        })
    }
}

#[derive(Default)]
struct InstallerExecutor {
    fail_restart: Mutex<bool>,
    probes: AtomicUsize,
}

impl InstallerExecutor {
    fn fail_restart(&self) {
        *self.fail_restart.lock().unwrap() = true;
    }
}

impl WslWorkerInstallCommandExecutor for InstallerExecutor {
    fn execute(
        &self,
        command: &WslWorkerInstallCommand,
    ) -> io::Result<WslWorkerInstallCommandOutput> {
        let args = &command.command.args;
        let tail = args
            .iter()
            .position(|arg| arg == "--exec")
            .map(|index| &args[index + 1..])
            .unwrap_or(&[]);
        if tail.first().map(String::as_str) == Some("id") {
            self.probes.fetch_add(1, Ordering::SeqCst);
            return Ok(success("1000\n"));
        }
        if tail.first().map(String::as_str) == Some("sha256sum") {
            return Ok(success(&format!("{SHA}  temp\n")));
        }
        if tail == ["systemctl", "restart", "ade-worker.service"]
            && std::mem::take(&mut *self.fail_restart.lock().unwrap())
        {
            return Ok(WslWorkerInstallCommandOutput {
                success: false,
                code: Some(1),
                stdout: String::new(),
                stderr: "restart failed".into(),
            });
        }
        if tail == ["systemctl", "is-active", "ade-worker.service"] {
            return Ok(success("active\n"));
        }
        if tail.first().map(String::as_str) == Some("/usr/lib/ade/ade-worker") {
            let request: WorkerHandshakeRequest =
                serde_json::from_slice(&command.stdin[..command.stdin.len() - 1]).unwrap();
            let incarnation = request
                .request_id
                .rsplit('-')
                .next()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            let response = WorkerHandshakeResponse {
                kind: WorkerHandshakeKind::WorkerHandshake,
                request_id: request.request_id,
                protocol_version: PROTOCOL_VERSION,
                worker_id: "wsl-worker".into(),
                worker_incarnation: incarnation,
                worker_version: "0.1.0".into(),
            };
            return Ok(success(&format!(
                "{}\n",
                serde_json::to_string(&response).unwrap()
            )));
        }
        Ok(success(""))
    }
}

fn success(stdout: &str) -> WslWorkerInstallCommandOutput {
    WslWorkerInstallCommandOutput {
        success: true,
        code: Some(0),
        stdout: stdout.into(),
        stderr: String::new(),
    }
}

fn request(incarnation: u64) -> WslWorkerInstallRequest {
    WslWorkerInstallRequest {
        distro: "Ubuntu-24.04".into(),
        service_user: "alice".into(),
        worker_id: "wsl-worker".into(),
        worker_incarnation: incarnation,
        worker_version: "0.1.0".into(),
        expected_sha256: SHA.into(),
        binary: b"worker-binary".to_vec(),
    }
}

fn runtime(installer: Arc<InstallerExecutor>) -> WslWorkerRuntime {
    WslWorkerRuntime::new(
        WslWorkerSupervisor::new(Arc::new(SupervisorExecutor)),
        WslWorkerInstaller::new(installer),
    )
}

#[test]
fn successful_update_publishes_endpoint_and_invalid_preflight_preserves_it() {
    let installer = Arc::new(InstallerExecutor::default());
    let runtime = runtime(installer.clone());
    let status = runtime.update(&request(7)).unwrap();
    let active = status.active.unwrap();
    assert_eq!(active.generation, 1);
    assert_eq!(active.endpoint.worker_id(), "wsl-worker");
    assert_eq!(active.endpoint.worker_incarnation(), 7);
    assert!(matches!(
        status.supervisor.status,
        WslWorkerStatus::Ready { .. }
    ));

    let mut invalid = request(8);
    invalid.worker_version = "../escape".into();
    assert!(matches!(
        runtime.update(&invalid),
        Err(WslWorkerRuntimeError::Validate(_))
    ));
    let preserved = runtime.status().unwrap().active.unwrap();
    assert_eq!(preserved.generation, 1);
    assert_eq!(preserved.endpoint.worker_incarnation(), 7);
    assert_eq!(installer.probes.load(Ordering::SeqCst), 1);
}

#[test]
fn failed_real_update_unpublishes_old_endpoint_and_keeps_maintenance() {
    let installer = Arc::new(InstallerExecutor::default());
    let runtime = runtime(installer.clone());
    runtime.update(&request(7)).unwrap();
    installer.fail_restart();

    assert!(matches!(
        runtime.update(&request(8)),
        Err(WslWorkerRuntimeError::Update(_))
    ));
    let status = runtime.status().unwrap();
    assert!(status.active.is_none());
    assert!(status.supervisor.maintenance);
    assert!(matches!(
        status.supervisor.status,
        WslWorkerStatus::Failed { .. }
    ));
}

struct CountingFileGitTransport {
    identity: FileGitWorkerIdentity,
    calls: Arc<AtomicUsize>,
}

impl FileGitWorkerTransport for CountingFileGitTransport {
    fn identity(&self) -> &FileGitWorkerIdentity {
        &self.identity
    }

    fn dispatch_file(
        &mut self,
        _request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(FileGitRouterError::WorkerError("inner".into()))
    }

    fn dispatch_git(
        &mut self,
        _request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(FileGitRouterError::WorkerError("inner".into()))
    }
}

struct CountingPtyTransport {
    identity: PtyWorkerIdentity,
    calls: Arc<AtomicUsize>,
}

impl PtyWorkerTransport for CountingPtyTransport {
    fn identity(&self) -> &PtyWorkerIdentity {
        &self.identity
    }

    fn dispatch(&mut self, _request: &PtyRequest) -> Result<PtyResponse, RouterError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(RouterError::WorkerError("inner".into()))
    }
}

fn file_request(incarnation: u64) -> FileWorkerRequest {
    FileWorkerRequest::read(
        "file-1",
        ExecutionContext::new(
            "workspace-1",
            WorkspaceKind::Folder,
            "wsl-worker",
            incarnation,
            OwnershipContext::new(1),
            ExecutionTarget::Wsl2 {
                distro: "Ubuntu-24.04".into(),
            },
            Some("Ubuntu-24.04".into()),
        ),
        "/home/alice/file.txt",
    )
}

fn pty_request() -> PtyRequest {
    PtyRequest::new(
        "pty-1",
        "workspace-1",
        "wsl-worker",
        "session-1",
        None,
        PtyOperation::Poll,
    )
}

#[test]
fn fenced_file_git_and_pty_transports_fail_before_inner_call_when_maintenance_or_stale() {
    let runtime = runtime(Arc::new(InstallerExecutor::default()));
    runtime.update(&request(7)).unwrap();
    let file_calls = Arc::new(AtomicUsize::new(0));
    let pty_calls = Arc::new(AtomicUsize::new(0));
    let mut file = runtime
        .fence_file_git_for_test(Box::new(CountingFileGitTransport {
            identity: FileGitWorkerIdentity {
                worker_id: "wsl-worker".into(),
                worker_incarnation: 7,
            },
            calls: file_calls.clone(),
        }))
        .unwrap();
    let mut pty = runtime
        .fence_pty_for_test(Box::new(CountingPtyTransport {
            identity: PtyWorkerIdentity {
                worker_id: "wsl-worker".into(),
                worker_incarnation: 7,
            },
            calls: pty_calls.clone(),
        }))
        .unwrap();

    assert_eq!(
        file.dispatch_file(&file_request(7)),
        Err(FileGitRouterError::WorkerError("inner".into()))
    );
    assert_eq!(
        pty.dispatch(&pty_request()),
        Err(RouterError::WorkerError("inner".into()))
    );
    assert_eq!(file_calls.load(Ordering::SeqCst), 1);
    assert_eq!(pty_calls.load(Ordering::SeqCst), 1);

    runtime.set_maintenance_for_test(true).unwrap();
    assert!(matches!(
        file.dispatch_file(&file_request(7)),
        Err(FileGitRouterError::Transport(ref reason)) if reason == "wsl_worker_fence:maintenance"
    ));
    assert!(matches!(
        pty.dispatch(&pty_request()),
        Err(RouterError::Transport(ref reason)) if reason == "wsl_worker_fence:maintenance"
    ));
    assert_eq!(file_calls.load(Ordering::SeqCst), 1);
    assert_eq!(pty_calls.load(Ordering::SeqCst), 1);

    runtime.set_maintenance_for_test(false).unwrap();
    runtime.update(&request(8)).unwrap();
    assert!(matches!(
        file.dispatch_file(&file_request(7)),
        Err(FileGitRouterError::Transport(ref reason)) if reason == "wsl_worker_fence:stale_generation"
    ));
    assert!(matches!(
        pty.dispatch(&pty_request()),
        Err(RouterError::Transport(ref reason)) if reason == "wsl_worker_fence:stale_generation"
    ));
    assert_eq!(file_calls.load(Ordering::SeqCst), 1);
    assert_eq!(pty_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn fenced_transport_rejects_inner_identity_drift_before_dispatch() {
    let runtime = runtime(Arc::new(InstallerExecutor::default()));
    runtime.update(&request(7)).unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut file = runtime
        .fence_file_git_for_test(Box::new(CountingFileGitTransport {
            identity: FileGitWorkerIdentity {
                worker_id: "other-worker".into(),
                worker_incarnation: 7,
            },
            calls: calls.clone(),
        }))
        .unwrap();

    assert!(matches!(
        file.dispatch_file(&file_request(7)),
        Err(FileGitRouterError::Transport(ref reason)) if reason == "wsl_worker_fence:endpoint_mismatch"
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

struct BlockingFileGitTransport {
    identity: FileGitWorkerIdentity,
    entered: Arc<(Mutex<bool>, Condvar)>,
    release: Arc<(Mutex<bool>, Condvar)>,
}

impl FileGitWorkerTransport for BlockingFileGitTransport {
    fn identity(&self) -> &FileGitWorkerIdentity {
        &self.identity
    }

    fn dispatch_file(
        &mut self,
        _request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        let (entered, entered_cv) = &*self.entered;
        *entered.lock().unwrap() = true;
        entered_cv.notify_all();
        let (release, release_cv) = &*self.release;
        let mut released = release.lock().unwrap();
        while !*released {
            released = release_cv.wait(released).unwrap();
        }
        Err(FileGitRouterError::WorkerError("done".into()))
    }

    fn dispatch_git(
        &mut self,
        _request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        unreachable!()
    }
}

#[test]
fn in_flight_dispatch_holds_read_gate_until_round_trip_finishes() {
    let runtime = Arc::new(runtime(Arc::new(InstallerExecutor::default())));
    runtime.update(&request(7)).unwrap();
    let entered = Arc::new((Mutex::new(false), Condvar::new()));
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let mut transport = runtime
        .fence_file_git_for_test(Box::new(BlockingFileGitTransport {
            identity: FileGitWorkerIdentity {
                worker_id: "wsl-worker".into(),
                worker_incarnation: 7,
            },
            entered: entered.clone(),
            release: release.clone(),
        }))
        .unwrap();
    let dispatch = thread::spawn(move || transport.dispatch_file(&file_request(7)));
    {
        let (lock, cv) = &*entered;
        let mut value = lock.lock().unwrap();
        while !*value {
            value = cv.wait(value).unwrap();
        }
    }
    assert!(!runtime.try_update_write_gate_for_test());
    {
        let (lock, cv) = &*release;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }
    assert_eq!(
        dispatch.join().unwrap(),
        Err(FileGitRouterError::WorkerError("done".into()))
    );
    assert!(runtime.try_update_write_gate_for_test());
}
