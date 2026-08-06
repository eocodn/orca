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
