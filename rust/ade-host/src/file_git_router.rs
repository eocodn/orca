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
                let current_identity = transport.identity().clone();
                self.validate_fence(
                    &request.workspace_id,
                    &request.worker_id,
                    request.worker_incarnation,
                    request.ownership.lease_id,
                    &current_identity,
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
                let current_identity = transport.identity().clone();
                self.validate_fence(
                    &request.workspace_id,
                    &request.worker_id,
                    request.worker_incarnation,
                    request.ownership.lease_id,
                    &current_identity,
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
    terminal_error: Option<FileGitRouterError>,
}

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
            terminal_error: None,
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
        if let Some(error) = &self.terminal_error {
            return Err(error.clone());
        }
        if let Err(error) = serde_json::to_writer(&mut self.writer, request) {
            return Err(self.terminate(FileGitRouterError::Transport(error.to_string())));
        }
        if let Err(error) = self
            .writer
            .write_all(b"\n")
            .and_then(|_| self.writer.flush())
        {
            return Err(self.terminate(FileGitRouterError::Transport(error.to_string())));
        }
        let line = match self.responses.recv_timeout(self.timeout) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(self.terminate(error)),
            Err(RecvTimeoutError::Timeout) => {
                return Err(self.terminate(FileGitRouterError::Timeout));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(self.terminate(FileGitRouterError::Eof));
            }
        };
        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => return Err(self.terminate(FileGitRouterError::MalformedResponse)),
        };
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            let worker_error: WorkerTransportError = match serde_json::from_value(value) {
                Ok(error) => error,
                Err(_) => return Err(self.terminate(FileGitRouterError::MalformedResponse)),
            };
            if worker_error.ok {
                return Err(self.terminate(FileGitRouterError::MalformedResponse));
            }
            if worker_error.request_id.as_deref() != Some(request_id) {
                return Err(self.terminate(FileGitRouterError::ResponseMismatch("request_id")));
            }
            return Err(FileGitRouterError::WorkerError(worker_error.error));
        }
        if value
            .get("envelope")
            .and_then(|envelope| envelope.get("request_id"))
            .and_then(Value::as_str)
            != Some(request_id)
        {
            return Err(self.terminate(FileGitRouterError::ResponseMismatch("request_id")));
        }
        match serde_json::from_value(value) {
            Ok(response) => Ok(response),
            Err(_) => Err(self.terminate(FileGitRouterError::MalformedResponse)),
        }
    }

    fn terminate(&mut self, error: FileGitRouterError) -> FileGitRouterError {
        if self.terminal_error.is_none() {
            self.terminal_error = Some(error.clone());
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        error
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
#[path = "file_git_router_tests.rs"]
mod tests;
