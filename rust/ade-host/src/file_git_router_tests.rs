use super::*;
use ade_host_core::ownership::{OwnershipCommand, OwnershipToken};
use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerOperation, FileWorkerResponse, GitWorkerOperation,
    GitWorkerResponse, OwnershipContext, WorkspaceKind,
};

struct FakeTransport {
    identity: WorkerIdentity,
    file_result: Option<Result<FileWorkerResponse, FileGitRouterError>>,
    git_result: Option<Result<GitWorkerResponse, FileGitRouterError>>,
    file_calls: usize,
    git_calls: usize,
}

impl FileGitWorkerTransport for FakeTransport {
    fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    fn dispatch_file(
        &mut self,
        _request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        self.file_calls += 1;
        self.file_result.take().expect("file result")
    }

    fn dispatch_git(
        &mut self,
        _request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        self.git_calls += 1;
        self.git_result.take().expect("git result")
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

fn context(token: &OwnershipToken) -> ExecutionContext {
    ExecutionContext::new(
        "ws",
        WorkspaceKind::Folder,
        "worker",
        token.worker_incarnation,
        OwnershipContext::new(token.lease_id),
        ExecutionTarget::WindowsNative,
        None,
    )
}

fn file_request(id: &str, token: &OwnershipToken) -> FileWorkerRequest {
    FileWorkerRequest::new(
        id,
        context(token),
        FileWorkerOperation::Read {
            path: "note.txt".into(),
        },
    )
}

fn git_request(id: &str, token: &OwnershipToken) -> GitWorkerRequest {
    GitWorkerRequest::new(
        id,
        context(token),
        GitWorkerOperation::WorktreeList {
            repository_path: "/repo".into(),
        },
    )
}

#[test]
fn fences_lease_and_incarnation_before_file_dispatch() {
    let (ownership, token) = owned();
    let request = file_request("stale", &token);
    let mut stale = request.clone();
    stale.worker_incarnation += 1;
    let router = FileGitHostRouter::new(
        ownership.clone(),
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            file_result: Some(Ok(FileWorkerResponse::from_read_request(&request, vec![]))),
            git_result: None,
            file_calls: 0,
            git_calls: 0,
        }),
    );
    assert_eq!(
        router.route_file(stale),
        Err(FileGitRouterError::StaleWorkerIncarnation)
    );

    let mut wrong_lease = request;
    wrong_lease.ownership.lease_id += 1;
    assert_eq!(
        router.route_file(wrong_lease),
        Err(FileGitRouterError::OwnershipLeaseMismatch)
    );
}

#[test]
fn replays_file_and_rejects_cross_capability_request_id_conflicts() {
    let (ownership, token) = owned();
    let file = file_request("same", &token);
    let git = git_request("same", &token);
    let response = FileWorkerResponse::from_read_request(&file, vec![1, 2]);
    let router = FileGitHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            file_result: Some(Ok(response)),
            git_result: None,
            file_calls: 0,
            git_calls: 0,
        }),
    );
    assert_eq!(router.route_file(file.clone()).unwrap().bytes, vec![1, 2]);
    assert_eq!(router.route_file(file).unwrap().bytes, vec![1, 2]);
    assert_eq!(
        router.route_git(git),
        Err(FileGitRouterError::RequestIdConflict)
    );
}

#[test]
fn preserves_worker_timeout_and_rejects_stale_response_context() {
    let (ownership, token) = owned();
    let request = file_request("timeout", &token);
    let router = FileGitHostRouter::new(
        ownership.clone(),
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            file_result: Some(Err(FileGitRouterError::Timeout)),
            git_result: None,
            file_calls: 0,
            git_calls: 0,
        }),
    );
    assert_eq!(
        router.route_file(request.clone()),
        Err(FileGitRouterError::Timeout)
    );
    // Delivery-unknown failures are receipts, not permission to resend.
    assert_eq!(router.route_file(request), Err(FileGitRouterError::Timeout));

    let request = file_request("mismatch", &token);
    let mut response = FileWorkerResponse::from_read_request(&request, vec![]);
    response.workspace_id = "other".into();
    let router = FileGitHostRouter::new(
        ownership,
        Box::new(FakeTransport {
            identity: WorkerIdentity {
                worker_id: "worker".into(),
                worker_incarnation: 7,
            },
            file_result: Some(Ok(response)),
            git_result: None,
            file_calls: 0,
            git_calls: 0,
        }),
    );
    assert_eq!(
        router.route_file(request),
        Err(FileGitRouterError::ResponseMismatch("context"))
    );
}

#[test]
fn routes_file_and_git_operations_through_the_real_worker_process() {
    use std::fs;
    use std::process::Command;
    use std::time::Duration;

    let root = std::env::temp_dir().join(format!(
        "ade-file-git-child-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let note = root.join("note.txt");
    let run_git = |args: &[&str]| {
        let status = Command::new("git")
            .args(args)
            .current_dir(&root)
            .status()
            .expect("Git integration test requires an installed git binary");
        assert!(status.success(), "git command failed: {args:?}");
    };
    run_git(&["init", "-q"]);
    run_git(&["config", "user.email", "ade@example.test"]);
    run_git(&["config", "user.name", "ADE"]);
    fs::write(root.join("README"), b"hello").unwrap();
    run_git(&["add", "README"]);
    run_git(&["commit", "-qm", "initial"]);

    let (ownership, token) = owned();
    let worker_path = JsonlFileGitWorkerTransport::sibling_worker_path().unwrap();
    assert!(
        worker_path.is_file(),
        "real child lifecycle test must execute ade-worker; expected {}",
        worker_path.display()
    );
    let transport = JsonlFileGitWorkerTransport::spawn(
        worker_path,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: token.worker_incarnation,
        },
        Duration::from_secs(3),
    )
    .unwrap();
    let router = FileGitHostRouter::new(ownership, Box::new(transport));
    let note_path = note.to_string_lossy().into_owned();

    let write = FileWorkerRequest::write(
        "child-file-write",
        context(&token),
        note_path.clone(),
        b"through-worker".to_vec(),
    );
    let write_response = router.route_file(write.clone()).unwrap();
    assert!(write_response.changed);
    assert_eq!(write_response.bytes_written, 14);
    // The host receipt and worker registry both make retries idempotent.
    assert_eq!(router.route_file(write).unwrap(), write_response);

    let read = FileWorkerRequest::read("child-file-read", context(&token), note_path);
    let read_response = router.route_file(read).unwrap();
    assert_eq!(read_response.bytes, b"through-worker");

    let repository_path = root.to_string_lossy().into_owned();
    let list =
        GitWorkerRequest::worktree_list("child-git-list", context(&token), repository_path.clone());
    let list_response = router.route_git(list).unwrap();
    assert_eq!(list_response.worktrees.len(), 1);
    assert!(list_response.worktrees[0].is_main);

    let git_dir = GitWorkerRequest::repository_git_dir(
        "child-git-dir",
        context(&token),
        repository_path.clone(),
    );
    let git_dir_response = router.route_git(git_dir).unwrap();
    assert_eq!(git_dir_response.worktrees.len(), 1);
    assert_eq!(
        git_dir_response.worktrees[0].path,
        root.join(".git").to_string_lossy().into_owned()
    );

    drop(router);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn jsonl_transport_requires_error_correlation_and_replays_terminal_failure() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let path = std::env::temp_dir().join(format!(
        "ade-file-git-error-correlation-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(
        &path,
        "#!/bin/sh\nIFS= read -r line\nprintf '%s\\n' '{\"ok\":false,\"error\":\"worker failed\"}'\n",
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

    let (_, token) = owned();
    let request = file_request("missing-error-id", &token);
    let mut transport = JsonlFileGitWorkerTransport::spawn(
        &path,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 7,
        },
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::ResponseMismatch("request_id"))
    );
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::ResponseMismatch("request_id"))
    );
    drop(transport);
    let _ = fs::remove_file(path);
}

#[cfg(unix)]
#[test]
fn jsonl_timeout_poisons_transport_before_late_response_can_be_reused() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let path = std::env::temp_dir().join(format!(
        "ade-file-git-timeout-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::write(
        &path,
        "#!/bin/sh\nIFS= read -r line\nsleep 1\nprintf '%s\\n' '{\"ok\":false,\"request_id\":null,\"error\":\"late\"}'\n",
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

    let (_, token) = owned();
    let request = file_request("timeout", &token);
    let mut transport = JsonlFileGitWorkerTransport::spawn(
        &path,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 7,
        },
        Duration::from_millis(10),
    )
    .unwrap();
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::Timeout)
    );
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::Timeout)
    );
    drop(transport);
    let _ = fs::remove_file(path);
}

#[cfg(unix)]
#[test]
fn jsonl_child_crash_and_malformed_response_are_terminal_without_retry() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let make_worker = |body: &str| {
        let path = std::env::temp_dir().join(format!(
            "ade-file-git-terminal-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, body).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    };
    let (_, token) = owned();
    let request = file_request("terminal", &token);

    let crash = make_worker("#!/bin/sh\nexit 0\n");
    let mut transport = JsonlFileGitWorkerTransport::spawn(
        &crash,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 7,
        },
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::Eof)
    );
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::Eof)
    );
    drop(transport);
    fs::remove_file(crash).unwrap();

    let malformed = make_worker("#!/bin/sh\nIFS= read -r line\nprintf '%s\\n' 'not-json'\n");
    let mut transport = JsonlFileGitWorkerTransport::spawn(
        &malformed,
        WorkerIdentity {
            worker_id: "worker".into(),
            worker_incarnation: 7,
        },
        Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::MalformedResponse)
    );
    assert_eq!(
        transport.dispatch_file(&request),
        Err(FileGitRouterError::MalformedResponse)
    );
    drop(transport);
    fs::remove_file(malformed).unwrap();
}
