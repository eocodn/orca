//! Host-side routing for the strict File/Git worker protocol.
//!
//! The worker is treated as an untrusted transport.  Ownership and worker
//! identity are checked before dispatch, and every response is correlated to
//! the exact request context before it is exposed to callers.

use ade_host_core::ownership::{OwnershipRuntime, OwnershipState};
use ade_host_core::protocol::{
    FileWorkerRequest, FileWorkerResponse, GitWorkerRequest, GitWorkerResponse,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerIdentity {
    pub worker_id: String,
    pub worker_incarnation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileGitRouterError {
    InvalidRequest(String),
    WorkspaceUnowned,
    WorkerMismatch,
    StaleWorkerIncarnation,
    OwnershipLeaseMismatch,
    RequestIdConflict,
    WorkerError(String),
    Timeout,
    Eof,
    MalformedResponse,
    ResponseMismatch(&'static str),
    Transport(String),
}

/// Transport abstraction shared by File and Git routing.  Implementations may
/// be local pipes, WSL relays, SSH channels, or deterministic test fakes.
pub trait FileGitWorkerTransport: Send {
    fn identity(&self) -> &WorkerIdentity;
    fn dispatch_file(
        &mut self,
        request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError>;
    fn dispatch_git(
        &mut self,
        request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError>;
}

pub use FileGitWorkerTransport as FileGitTransport;

#[derive(Clone)]
enum RoutedRequest {
    File(FileWorkerRequest),
    Git(GitWorkerRequest),
}

#[derive(Clone)]
enum RoutedResult {
    File(Result<FileWorkerResponse, FileGitRouterError>),
    Git(Result<GitWorkerResponse, FileGitRouterError>),
}

#[derive(Clone)]
struct Receipt {
    request: RoutedRequest,
    result: RoutedResult,
}

pub struct FileGitHostRouter {
    ownership: OwnershipRuntime,
    transport: Mutex<Box<dyn FileGitWorkerTransport>>,
    receipts: Mutex<HashMap<String, Receipt>>,
}

pub type FileGitRouter = FileGitHostRouter;

impl FileGitHostRouter {
    pub fn new(ownership: OwnershipRuntime, transport: Box<dyn FileGitWorkerTransport>) -> Self {
        Self {
            ownership,
            transport: Mutex::new(transport),
            receipts: Mutex::new(HashMap::new()),
        }
    }

    pub fn route_file(
        &self,
        request: FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        request
            .validate()
            .map_err(|error| FileGitRouterError::InvalidRequest(format!("{error:?}")))?;
        let request_id = request.envelope.request_id.clone();
        let mut receipts = self
            .receipts
            .lock()
            .map_err(|_| FileGitRouterError::Transport("receipt_lock_poisoned".into()))?;
        if let Some(receipt) = receipts.get(&request_id) {
            return match (&receipt.request, &receipt.result) {
                (RoutedRequest::File(committed), RoutedResult::File(result))
                    if committed == &request =>
                {
                    result.clone()
                }
                _ => Err(FileGitRouterError::RequestIdConflict),
            };
        }

        let mut transport = self
            .transport
            .lock()
            .map_err(|_| FileGitRouterError::Transport("transport_lock_poisoned".into()))?;
        let identity = transport.identity().clone();
        self.validate_fence(
            &request.workspace_id,
            &request.worker_id,
            request.worker_incarnation,
            request.ownership.lease_id,
            &identity,
        )?;
        let result = transport
            .dispatch_file(&request)
            .and_then(|response| {
                response
                    .validate_for(&request)
                    .map(|_| response)
                    .map_err(|error| {
                        FileGitRouterError::ResponseMismatch(protocol_mismatch_name(error))
                    })
            })
            .and_then(|response| {
                self.validate_fence(
                    &request.workspace_id,
                    &request.worker_id,
                    request.worker_incarnation,
                    request.ownership.lease_id,
                    &identity,
                )?;
                Ok(response)
            });
        receipts.insert(
            request_id,
            Receipt {
                request: RoutedRequest::File(request),
                result: RoutedResult::File(result.clone()),
            },
        );
        result
    }

    pub fn route_git(
        &self,
        request: GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        request
            .validate()
            .map_err(|error| FileGitRouterError::InvalidRequest(format!("{error:?}")))?;
        let request_id = request.envelope.request_id.clone();
        let mut receipts = self
            .receipts
            .lock()
            .map_err(|_| FileGitRouterError::Transport("receipt_lock_poisoned".into()))?;
        if let Some(receipt) = receipts.get(&request_id) {
            return match (&receipt.request, &receipt.result) {
                (RoutedRequest::Git(committed), RoutedResult::Git(result))
                    if committed == &request =>
                {
                    result.clone()
                }
                _ => Err(FileGitRouterError::RequestIdConflict),
            };
        }

        let mut transport = self
            .transport
            .lock()
            .map_err(|_| FileGitRouterError::Transport("transport_lock_poisoned".into()))?;
        let identity = transport.identity().clone();
        self.validate_fence(
            &request.workspace_id,
            &request.worker_id,
            request.worker_incarnation,
            request.ownership.lease_id,
            &identity,
        )?;
        let result = transport
            .dispatch_git(&request)
            .and_then(|response| {
                response
                    .validate_for(&request)
                    .map(|_| response)
                    .map_err(|error| {
                        FileGitRouterError::ResponseMismatch(protocol_mismatch_name(error))
                    })
            })
            .and_then(|response| {
                self.validate_fence(
                    &request.workspace_id,
                    &request.worker_id,
                    request.worker_incarnation,
                    request.ownership.lease_id,
                    &identity,
                )?;
                Ok(response)
            });
        receipts.insert(
            request_id,
            Receipt {
                request: RoutedRequest::Git(request),
                result: RoutedResult::Git(result.clone()),
            },
        );
        result
    }

    fn validate_fence(
        &self,
        workspace_id: &str,
        worker_id: &str,
        worker_incarnation: u64,
        lease_id: u64,
        identity: &WorkerIdentity,
    ) -> Result<(), FileGitRouterError> {
        let snapshot = self
            .ownership
            .snapshot(workspace_id)
            .map_err(|error| FileGitRouterError::Transport(format!("{error:?}")))?;
        let Some(token) = snapshot.token else {
            return Err(FileGitRouterError::WorkspaceUnowned);
        };
        if snapshot.state != OwnershipState::Owned
            || token.workspace_id != workspace_id
            || token.worker_id != worker_id
            || identity.worker_id != worker_id
        {
            return Err(FileGitRouterError::WorkerMismatch);
        }
        if token.worker_incarnation != worker_incarnation
            || identity.worker_incarnation != worker_incarnation
        {
            return Err(FileGitRouterError::StaleWorkerIncarnation);
        }
        if token.lease_id != lease_id {
            return Err(FileGitRouterError::OwnershipLeaseMismatch);
        }
        Ok(())
    }
}

fn protocol_mismatch_name(error: ade_host_core::protocol::ProtocolError) -> &'static str {
    match error {
        ade_host_core::protocol::ProtocolError::ResponseMismatch(name) => name,
        _ => "protocol",
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerTransportError {
    ok: bool,
    request_id: Option<String>,
    error: String,
}

/// JSONL transport for a worker process.  The worker dispatch implementation
/// is intentionally separate; this type only owns framing and observability.
pub struct JsonlFileGitWorkerTransport {
    identity: WorkerIdentity,
    writer: BufWriter<ChildStdin>,
    responses: Receiver<Result<String, FileGitRouterError>>,
    child: Child,
    timeout: Duration,
}

pub type JsonlFileGitTransport = JsonlFileGitWorkerTransport;
pub type JsonlWorkerTransport = JsonlFileGitWorkerTransport;

impl JsonlFileGitWorkerTransport {
    pub fn spawn(
        worker_path: impl AsRef<Path>,
        identity: WorkerIdentity,
        timeout: Duration,
    ) -> Result<Self, FileGitRouterError> {
        let mut child = Command::new(worker_path.as_ref())
            .arg("--jsonl")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| FileGitRouterError::Transport(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| FileGitRouterError::Transport("worker_stdin_unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| FileGitRouterError::Transport("worker_stdout_unavailable".into()))?;
        let (sender, responses) = mpsc::channel();
        spawn_reader(stdout, sender);
        Ok(Self {
            identity,
            writer: BufWriter::new(stdin),
            responses,
            child,
            timeout,
        })
    }

    pub fn sibling_worker_path() -> Result<std::path::PathBuf, FileGitRouterError> {
        let executable = std::env::current_exe()
            .map_err(|error| FileGitRouterError::Transport(error.to_string()))?;
        let name = if cfg!(windows) {
            "ade-worker.exe"
        } else {
            "ade-worker"
        };
        Ok(executable.with_file_name(name))
    }

    fn dispatch<Q: serde::Serialize, R: serde::de::DeserializeOwned>(
        &mut self,
        request: &Q,
        request_id: &str,
    ) -> Result<R, FileGitRouterError> {
        serde_json::to_writer(&mut self.writer, request)
            .map_err(|error| FileGitRouterError::Transport(error.to_string()))?;
        self.writer
            .write_all(b"\n")
            .and_then(|_| self.writer.flush())
            .map_err(|error| FileGitRouterError::Transport(error.to_string()))?;
        let line = match self.responses.recv_timeout(self.timeout) {
            Ok(result) => result?,
            Err(RecvTimeoutError::Timeout) => return Err(FileGitRouterError::Timeout),
            Err(RecvTimeoutError::Disconnected) => return Err(FileGitRouterError::Eof),
        };
        let value: Value =
            serde_json::from_str(&line).map_err(|_| FileGitRouterError::MalformedResponse)?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            let worker_error: WorkerTransportError =
                serde_json::from_value(value).map_err(|_| FileGitRouterError::MalformedResponse)?;
            if worker_error.ok {
                return Err(FileGitRouterError::MalformedResponse);
            }
            if worker_error
                .request_id
                .as_deref()
                .is_some_and(|response_id| response_id != request_id)
            {
                return Err(FileGitRouterError::ResponseMismatch("request_id"));
            }
            return Err(FileGitRouterError::WorkerError(worker_error.error));
        }
        serde_json::from_value(value).map_err(|_| FileGitRouterError::MalformedResponse)
    }
}

impl FileGitWorkerTransport for JsonlFileGitWorkerTransport {
    fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    fn dispatch_file(
        &mut self,
        request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, FileGitRouterError> {
        self.dispatch(request, &request.envelope.request_id)
    }

    fn dispatch_git(
        &mut self,
        request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, FileGitRouterError> {
        self.dispatch(request, &request.envelope.request_id)
    }
}

impl Drop for JsonlFileGitWorkerTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_reader(stdout: ChildStdout, sender: Sender<Result<String, FileGitRouterError>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = sender.send(Err(FileGitRouterError::Eof));
                    return;
                }
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']).to_owned();
                    if sender.send(Ok(trimmed)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(FileGitRouterError::Transport(error.to_string())));
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use ade_host_core::ownership::{OwnershipCommand, OwnershipToken};
    use ade_host_core::protocol::{
        ExecutionContext, ExecutionTarget, FileWorkerOperation, FileWorkerResponse,
        GitWorkerOperation, GitWorkerResponse, OwnershipContext, WorkspaceKind,
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
}
