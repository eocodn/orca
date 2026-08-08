use crate::cli::ControlCliError;
use crate::protocol::{
    error_response, success_response, worker_status_result, AgentControlCommand,
    AgentControlRequest, AgentControlResponse, AgentControlResult, ControlStatusResult,
    HostStatusResult, WorkerMaintenanceArgs, WorkerUpdateArgs, CONTROL_PROTOCOL_VERSION,
};
use crate::receipts::{ReceiptClaim, ReceiptRegistry, ReceiptRegistryError};
use ade_host::host_state_service::HostStateService;
use ade_host::wsl_worker_runtime::{WslWorkerRuntime, WslWorkerRuntimeError};
use ade_host_platform::wsl_worker_installer::{WslWorkerInstallRequest, WslWorkerInstaller};
use ade_host_platform::wsl_worker_supervisor::WslWorkerSupervisor;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::io::{BufRead, Write};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct AgentControlSession {
    host: Mutex<HostStateService>,
    worker: WslWorkerRuntime,
    receipts: ReceiptRegistry,
    started_at_unix_ms: u64,
}

impl AgentControlSession {
    pub fn open(state_db: impl AsRef<Path>) -> Result<Self, ControlCliError> {
        let host = HostStateService::open(state_db)
            .map_err(|error| ControlCliError::Session(format!("host_state:{error:?}")))?;
        Ok(Self {
            host: Mutex::new(host),
            worker: WslWorkerRuntime::new(
                WslWorkerSupervisor::default(),
                WslWorkerInstaller::default(),
            ),
            receipts: ReceiptRegistry::new(),
            started_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| ControlCliError::Session(format!("system_time:{error}")))?
                .as_millis()
                .try_into()
                .map_err(|_| ControlCliError::Session("system_time_overflow".into()))?,
        })
    }

    pub fn handle_line(&self, line: &str) -> String {
        let request = match parse_request(line) {
            Ok(request) => request,
            Err(failure) => {
                return serialize_response(error_response(
                    failure.request_id,
                    failure.code,
                    failure.message,
                ));
            }
        };
        if request.protocol_version != CONTROL_PROTOCOL_VERSION {
            return serialize_response(error_response(
                Some(request.request_id),
                "unsupported_protocol_version",
                format!(
                    "expected={CONTROL_PROTOCOL_VERSION}:actual={}",
                    request.protocol_version
                ),
            ));
        }
        if request.request_id.trim().is_empty() {
            return serialize_response(error_response(
                Some(request.request_id),
                "empty_request_id",
                "request_id must be nonblank".into(),
            ));
        }
        if let Err(message) = validate_operation_args(&request) {
            return serialize_response(error_response(
                Some(request.request_id),
                "invalid_request",
                message,
            ));
        }
        let canonical_request = match serde_json::to_string(&request) {
            Ok(value) => value,
            Err(error) => {
                return serialize_response(error_response(
                    Some(request.request_id),
                    "request_serialization",
                    error.to_string(),
                ));
            }
        };
        let request_id = request.request_id.clone();
        let receipt_count = match self.receipts.claim(&request_id, &canonical_request) {
            Ok(ReceiptClaim::Replay(response)) => return response,
            Ok(ReceiptClaim::Execute { receipt_count }) => receipt_count,
            Err(error) => return serialize_response(receipt_error(request_id, error)),
        };
        let response = serialize_response(self.execute(request, receipt_count));
        if let Err(error) = self.receipts.complete(&request_id, response.clone()) {
            return serialize_response(receipt_error(request_id, error));
        }
        response
    }

    pub fn run_jsonl<R: BufRead, W: Write>(
        &self,
        reader: R,
        mut writer: W,
    ) -> Result<(), std::io::Error> {
        for line in reader.lines() {
            let response = self.handle_line(&line?);
            writer.write_all(response.as_bytes())?;
            writer.write_all(b"\n")?;
            writer.flush()?;
        }
        Ok(())
    }

    fn execute(&self, request: AgentControlRequest, receipt_count: usize) -> AgentControlResponse {
        let request_id = request.request_id;
        match request.command {
            AgentControlCommand::ControlStatus => success_response(
                request_id,
                AgentControlResult::ControlStatus(ControlStatusResult {
                    kind: "control_status",
                    server_pid: std::process::id(),
                    started_at_unix_ms: self.started_at_unix_ms,
                    receipt_count,
                }),
            ),
            AgentControlCommand::HostStatus => self.host_status(request_id),
            AgentControlCommand::WorkerStatus => match self.worker.status() {
                Ok(status) => success_response(
                    request_id,
                    AgentControlResult::Worker(worker_status_result("worker_status", status)),
                ),
                Err(error) => worker_runtime_error(request_id, error),
            },
            AgentControlCommand::WorkerMaintenance => {
                let args: WorkerMaintenanceArgs = match decode_args(request.args) {
                    Ok(args) => args,
                    Err(message) => {
                        return error_response(Some(request_id), "invalid_request", message);
                    }
                };
                match self.worker.set_maintenance(args.enabled) {
                    Ok(status) => success_response(
                        request_id,
                        AgentControlResult::Worker(worker_status_result(
                            "worker_maintenance",
                            status,
                        )),
                    ),
                    Err(error) => worker_runtime_error(request_id, error),
                }
            }
            AgentControlCommand::WorkerUpdate => {
                let args: WorkerUpdateArgs = match decode_args(request.args) {
                    Ok(args) => args,
                    Err(message) => {
                        return error_response(Some(request_id), "invalid_request", message);
                    }
                };
                self.worker_update(request_id, args)
            }
        }
    }

    fn host_status(&self, request_id: String) -> AgentControlResponse {
        let host = match self.host.lock() {
            Ok(host) => host,
            Err(_) => {
                return error_response(
                    Some(request_id),
                    "host_state_lock_poisoned",
                    "host state lock poisoned".into(),
                );
            }
        };
        match host.status() {
            Ok(status) => success_response(
                request_id,
                AgentControlResult::HostStatus(HostStatusResult {
                    kind: "host_status",
                    workspace_count: status.workspace_count,
                    ready_workspaces: status.ready_workspaces,
                    source: "sqlite-snapshot",
                }),
            ),
            Err(error) => {
                error_response(Some(request_id), "host_state_error", format!("{error:?}"))
            }
        }
    }

    fn worker_update(&self, request_id: String, args: WorkerUpdateArgs) -> AgentControlResponse {
        let binary = match std::fs::read(&args.binary_path) {
            Ok(binary) => binary,
            Err(error) => {
                return error_response(Some(request_id), "worker_binary_read", error.to_string());
            }
        };
        let install = WslWorkerInstallRequest {
            distro: args.distro,
            service_user: args.service_user,
            worker_id: args.worker_id,
            worker_incarnation: args.worker_incarnation,
            worker_version: args.worker_version,
            expected_sha256: args.expected_sha256,
            binary,
        };
        match self.worker.update(&install) {
            Ok(status) => success_response(
                request_id,
                AgentControlResult::Worker(worker_status_result("worker_update", status)),
            ),
            Err(error) => worker_runtime_error(request_id, error),
        }
    }
}

struct RequestParseFailure {
    request_id: Option<String>,
    code: &'static str,
    message: String,
}

fn parse_request(line: &str) -> Result<AgentControlRequest, RequestParseFailure> {
    let value: Value = serde_json::from_str(line).map_err(|error| RequestParseFailure {
        request_id: None,
        code: "invalid_json",
        message: error.to_string(),
    })?;
    let request_id = value
        .get("request_id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    serde_json::from_value(value).map_err(|error| RequestParseFailure {
        request_id,
        code: "invalid_request",
        message: error.to_string(),
    })
}

fn validate_operation_args(request: &AgentControlRequest) -> Result<(), String> {
    match request.command {
        AgentControlCommand::ControlStatus
        | AgentControlCommand::HostStatus
        | AgentControlCommand::WorkerStatus => {
            if request.args.is_some() {
                Err("command does not accept args".into())
            } else {
                Ok(())
            }
        }
        AgentControlCommand::WorkerMaintenance => {
            decode_args::<WorkerMaintenanceArgs>(request.args.clone()).map(|_| ())
        }
        AgentControlCommand::WorkerUpdate => {
            decode_args::<WorkerUpdateArgs>(request.args.clone()).map(|_| ())
        }
    }
}

fn receipt_error(request_id: String, error: ReceiptRegistryError) -> AgentControlResponse {
    let (code, message) = match error {
        ReceiptRegistryError::Conflict => (
            "request_id_conflict",
            "request_id already belongs to a different request".into(),
        ),
        ReceiptRegistryError::CapacityExceeded => (
            "receipt_capacity_exceeded",
            "maximum receipt capacity exceeded".into(),
        ),
        ReceiptRegistryError::LockPoisoned => {
            ("receipt_lock_poisoned", "receipt lock poisoned".into())
        }
        ReceiptRegistryError::MissingInFlight => (
            "receipt_state_invalid",
            "receipt completion state is invalid".into(),
        ),
    };
    error_response(Some(request_id), code, message)
}

fn decode_args<T: DeserializeOwned>(args: Option<Value>) -> Result<T, String> {
    let args = args.ok_or_else(|| String::from("command requires args"))?;
    serde_json::from_value(args).map_err(|error| error.to_string())
}

fn worker_runtime_error(request_id: String, error: WslWorkerRuntimeError) -> AgentControlResponse {
    error_response(
        Some(request_id),
        "worker_runtime_error",
        format!("{error:?}"),
    )
}

fn serialize_response(response: AgentControlResponse) -> String {
    serde_json::to_string(&response).unwrap_or_else(|error| {
        format!(
            "{{\"protocol_version\":{CONTROL_PROTOCOL_VERSION},\"request_id\":null,\"ok\":false,\"error\":{{\"code\":\"response_serialization\",\"message\":{}}}}}",
            serde_json::to_string(&error.to_string())
                .unwrap_or_else(|_| String::from("\"response serialization failed\""))
        )
    })
}
