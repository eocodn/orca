use crate::wsl_worker_relay::{
    command_for_endpoint, handshake_request, parse_handshake, WslRelayHandshakeFailure,
};
use ade_host_core::ownership::{OwnershipRuntime, OwnershipState};
use ade_host_core::protocol::{PtyOperation, PtyRequest, PtyResponse};
use ade_host_platform::wsl_worker_endpoint::WslWorkerEndpoint;
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

impl RouterError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::WorkspaceUnowned => "workspace_unowned",
            Self::WorkerMismatch => "worker_mismatch",
            Self::StaleWorkerIncarnation => "stale_worker_incarnation",
            Self::RequestIdConflict => "request_id_conflict",
            Self::RequestInFlight => "request_in_flight",
            Self::WorkerError(_) => "worker_error",
            Self::Timeout => "timeout",
            Self::Eof => "eof",
            Self::MalformedResponse => "malformed_response",
            Self::ResponseMismatch(_) => "response_mismatch",
            Self::Transport(_) => "transport_error",
        }
    }
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
        let mut command = Command::new(worker_path.as_ref());
        command.arg("--jsonl");
        Self::spawn_command(command, identity, timeout)
    }

    pub fn spawn_wsl(endpoint: WslWorkerEndpoint, timeout: Duration) -> Result<Self, RouterError> {
        let command = command_for_endpoint(&endpoint);
        Self::spawn_wsl_command(command, endpoint, timeout)
    }

    fn spawn_wsl_command(
        command: Command,
        endpoint: WslWorkerEndpoint,
        timeout: Duration,
    ) -> Result<Self, RouterError> {
        let identity = WorkerIdentity {
            worker_id: endpoint.worker_id().into(),
            worker_incarnation: endpoint.worker_incarnation(),
        };
        let mut transport = Self::spawn_command(command, identity, timeout)?;
        if let Err(error) = transport.perform_wsl_handshake(&endpoint) {
            let _ = transport.child.kill();
            let _ = transport.child.wait();
            return Err(error);
        }
        Ok(transport)
    }

    #[cfg(all(test, unix))]
    fn spawn_wsl_script_for_test(
        script_path: impl AsRef<Path>,
        endpoint: WslWorkerEndpoint,
        timeout: Duration,
    ) -> Result<Self, RouterError> {
        let spec = endpoint.relay_command();
        let mut command = Command::new("sh");
        command.arg(script_path.as_ref()).args(spec.args);
        Self::spawn_wsl_command(command, endpoint, timeout)
    }

    fn spawn_command(
        mut command: Command,
        identity: WorkerIdentity,
        timeout: Duration,
    ) -> Result<Self, RouterError> {
        let mut child = command
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

    fn perform_wsl_handshake(&mut self, endpoint: &WslWorkerEndpoint) -> Result<(), RouterError> {
        let request =
            handshake_request(endpoint, "host-pty-relay").map_err(map_wsl_handshake_failure)?;
        serde_json::to_writer(&mut self.writer, &request)
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
        parse_handshake(endpoint, &request, &line).map_err(map_wsl_handshake_failure)?;
        Ok(())
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

fn map_wsl_handshake_failure(error: WslRelayHandshakeFailure) -> RouterError {
    match error {
        WslRelayHandshakeFailure::Malformed => RouterError::MalformedResponse,
        WslRelayHandshakeFailure::Mismatch(field) => RouterError::ResponseMismatch(field),
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
#[path = "pty_router_tests.rs"]
mod tests;
