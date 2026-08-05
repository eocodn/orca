use ade_host_core::ownership::{OwnershipRuntime, OwnershipState};
use ade_host_core::protocol::{PtyOperation, PtyRequest, PtyResponse};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
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
pub enum RouterError {
    InvalidRequest(String),
    WorkspaceUnowned,
    WorkerMismatch,
    StaleWorkerIncarnation,
    RequestIdConflict,
    RequestInFlight,
    WorkerError(String),
    Timeout,
    Eof,
    MalformedResponse,
    ResponseMismatch(&'static str),
    Transport(String),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerTransportError {
    ok: bool,
    request_id: Option<String>,
    error: String,
}

pub trait PtyWorkerTransport: Send {
    fn identity(&self) -> &WorkerIdentity;
    fn dispatch(&mut self, request: &PtyRequest) -> Result<PtyResponse, RouterError>;
}

struct Receipt {
    request: PtyRequest,
    result: Result<PtyResponse, RouterError>,
}

pub struct PtyHostRouter {
    ownership: OwnershipRuntime,
    transport: Mutex<Box<dyn PtyWorkerTransport>>,
    receipts: Mutex<HashMap<String, Receipt>>,
}

impl PtyHostRouter {
    pub fn new(ownership: OwnershipRuntime, transport: Box<dyn PtyWorkerTransport>) -> Self {
        Self {
            ownership,
            transport: Mutex::new(transport),
            receipts: Mutex::new(HashMap::new()),
        }
    }

    pub fn route(&self, request: PtyRequest) -> Result<PtyResponse, RouterError> {
        request
            .validate()
            .map_err(|error| RouterError::InvalidRequest(format!("{error:?}")))?;
        let request_id = request.envelope.request_id.clone();
        let mut receipts = self
            .receipts
            .lock()
            .map_err(|_| RouterError::Transport("receipt_lock_poisoned".into()))?;
        if let Some(receipt) = receipts.get(&request_id) {
            if receipt.request == request {
                return receipt.result.clone();
            }
            return Err(RouterError::RequestIdConflict);
        }
        let mut transport = self
            .transport
            .lock()
            .map_err(|_| RouterError::Transport("transport_lock_poisoned".into()))?;
        let identity = transport.identity().clone();
        let snapshot = self
            .ownership
            .snapshot(&request.workspace_id)
            .map_err(|error| RouterError::Transport(format!("{error:?}")))?;
        let Some(token) = snapshot.token else {
            return Err(RouterError::WorkspaceUnowned);
        };
        if snapshot.state != OwnershipState::Owned
            || token.workspace_id != request.workspace_id
            || token.worker_id != request.worker_id
            || identity.worker_id != request.worker_id
        {
            return Err(RouterError::WorkerMismatch);
        }
        if token.worker_incarnation != identity.worker_incarnation {
            return Err(RouterError::StaleWorkerIncarnation);
        }

        let result = transport
            .dispatch(&request)
            .and_then(|response| validate_response(&request, response));
        receipts.insert(
            request_id,
            Receipt {
                request,
                result: result.clone(),
            },
        );
        result
    }
}

fn validate_response(
    request: &PtyRequest,
    response: PtyResponse,
) -> Result<PtyResponse, RouterError> {
    if response.envelope.request_id != request.envelope.request_id {
        return Err(RouterError::ResponseMismatch("request_id"));
    }
    if response.envelope.capability != request.envelope.capability {
        return Err(RouterError::ResponseMismatch("capability"));
    }
    if response.envelope.protocol_version != request.envelope.protocol_version {
        return Err(RouterError::ResponseMismatch("protocol_version"));
    }
    if response.workspace_id != request.workspace_id {
        return Err(RouterError::ResponseMismatch("workspace_id"));
    }
    if response.worker_id != request.worker_id {
        return Err(RouterError::ResponseMismatch("worker_id"));
    }
    if response.session_id != request.session_id {
        return Err(RouterError::ResponseMismatch("session_id"));
    }
    if response.operation != operation_name(&request.operation) {
        return Err(RouterError::ResponseMismatch("operation"));
    }
    match request.session_generation {
        Some(generation) if response.session_generation != generation => {
            Err(RouterError::ResponseMismatch("session_generation"))
        }
        None if response.session_generation == 0 => {
            Err(RouterError::ResponseMismatch("session_generation"))
        }
        _ => Ok(response),
    }
}

fn operation_name(operation: &PtyOperation) -> &'static str {
    match operation {
        PtyOperation::Start { .. } => "start",
        PtyOperation::Write { .. } => "write",
        PtyOperation::Resize { .. } => "resize",
        PtyOperation::Poll => "poll",
        PtyOperation::Wait { .. } => "wait",
        PtyOperation::Terminate => "terminate",
    }
}

pub struct JsonlWorkerTransport {
    identity: WorkerIdentity,
    writer: BufWriter<ChildStdin>,
    responses: Receiver<Result<String, RouterError>>,
    child: Child,
    timeout: Duration,
}

impl JsonlWorkerTransport {
    pub fn spawn(
        worker_path: impl AsRef<Path>,
        identity: WorkerIdentity,
        timeout: Duration,
    ) -> Result<Self, RouterError> {
        let mut child = Command::new(worker_path.as_ref())
            .arg("--jsonl")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| RouterError::Transport(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RouterError::Transport("worker_stdin_unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RouterError::Transport("worker_stdout_unavailable".into()))?;
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

    pub fn sibling_worker_path() -> Result<PathBuf, RouterError> {
        let executable =
            std::env::current_exe().map_err(|error| RouterError::Transport(error.to_string()))?;
        let name = if cfg!(windows) {
            "ade-worker.exe"
        } else {
            "ade-worker"
        };
        Ok(executable.with_file_name(name))
    }
}

impl PtyWorkerTransport for JsonlWorkerTransport {
    fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    fn dispatch(&mut self, request: &PtyRequest) -> Result<PtyResponse, RouterError> {
        serde_json::to_writer(&mut self.writer, request)
            .map_err(|error| RouterError::Transport(error.to_string()))?;
        self.writer
            .write_all(b"\n")
            .and_then(|_| self.writer.flush())
            .map_err(|error| RouterError::Transport(error.to_string()))?;
        let line = match self.responses.recv_timeout(self.timeout) {
            Ok(result) => result?,
            Err(RecvTimeoutError::Timeout) => return Err(RouterError::Timeout),
            Err(RecvTimeoutError::Disconnected) => return Err(RouterError::Eof),
        };
        let value: Value =
            serde_json::from_str(&line).map_err(|_| RouterError::MalformedResponse)?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            let worker_error: WorkerTransportError =
                serde_json::from_value(value).map_err(|_| RouterError::MalformedResponse)?;
            if worker_error.ok {
                return Err(RouterError::MalformedResponse);
            }
            if worker_error
                .request_id
                .as_deref()
                .is_some_and(|request_id| request_id != request.envelope.request_id)
            {
                return Err(RouterError::ResponseMismatch("request_id"));
            }
            return Err(RouterError::WorkerError(worker_error.error));
        }
        serde_json::from_value(value).map_err(|_| RouterError::MalformedResponse)
    }
}

impl Drop for JsonlWorkerTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_reader(stdout: ChildStdout, sender: Sender<Result<String, RouterError>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = sender.send(Err(RouterError::Eof));
                    return;
                }
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']).to_owned();
                    if sender.send(Ok(trimmed)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(RouterError::Transport(error.to_string())));
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
}
