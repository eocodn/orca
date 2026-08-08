use ade_control::{
    AgentControlChild, AgentControlClient, AgentControlCommand, AgentControlRequest,
    CONTROL_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, Runtime};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentControlIpcOperation {
    ControlStatus,
    HostStatus,
    WorkerStatus,
    WorkerMaintenance { enabled: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AgentControlIpcRequest {
    pub request_id: String,
    pub operation: AgentControlIpcOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentControlIpcError {
    pub code: String,
    pub message: String,
}

pub struct AgentControlAppState {
    child: Mutex<AgentControlChild>,
}

impl AgentControlAppState {
    fn endpoint_file(&self) -> Result<PathBuf, AgentControlIpcError> {
        self.child
            .lock()
            .map(|child| child.endpoint_file().to_path_buf())
            .map_err(|_| ipc_error("agent_control_state", "agent control state lock poisoned"))
    }
}

#[tauri::command]
pub fn agent_control_request(
    request: AgentControlIpcRequest,
    state: tauri::State<'_, AgentControlAppState>,
) -> Result<Value, AgentControlIpcError> {
    let endpoint_file = state.endpoint_file()?;
    execute_agent_control_request(&endpoint_file, &request)
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("agent-control")
        .setup(|app, _api| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let state_db = app_data.join("host-state.sqlite3");
            let endpoint_file = app_data.join(format!("agent-control-{}.json", std::process::id()));
            let binary = resolve_agent_control_binary()?;
            let child = AgentControlChild::spawn(binary, state_db, endpoint_file)
                .map_err(|error| io::Error::other(format!("agent control child: {error:?}")))?;
            app.manage(AgentControlAppState {
                child: Mutex::new(child),
            });
            Ok(())
        })
        .build()
}

fn resolve_agent_control_binary() -> Result<PathBuf, io::Error> {
    let path = match std::env::var_os("ADE_CONTROL_BIN") {
        Some(value) => {
            if value.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "ADE_CONTROL_BIN must be nonblank",
                ));
            }
            PathBuf::from(value)
        }
        None => {
            let executable = std::env::current_exe()?;
            let directory = executable
                .parent()
                .ok_or_else(|| io::Error::other("current executable has no parent directory"))?;
            directory.join(if cfg!(windows) {
                "ade-control.exe"
            } else {
                "ade-control"
            })
        }
    };
    let metadata = std::fs::metadata(&path).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!("agent control binary {}: {error}", path.display()),
        )
    })?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("agent control binary is not a file: {}", path.display()),
        ));
    }
    Ok(path)
}

fn execute_agent_control_request(
    endpoint_file: &Path,
    request: &AgentControlIpcRequest,
) -> Result<Value, AgentControlIpcError> {
    let wire = build_request(request)?;
    let line = serde_json::to_string(&wire)
        .map_err(|error| ipc_error("agent_control_request_serialization", error.to_string()))?;
    let mut client = AgentControlClient::connect(endpoint_file)
        .map_err(|error| ipc_error("agent_control_transport", format!("{error:?}")))?;
    let response = client
        .request_line(&line)
        .map_err(|error| ipc_error("agent_control_transport", format!("{error:?}")))?;
    parse_agent_control_response(&response)
}

fn build_request(
    request: &AgentControlIpcRequest,
) -> Result<AgentControlRequest, AgentControlIpcError> {
    if request.request_id.trim().is_empty() {
        return Err(ipc_error(
            "invalid_request_id",
            "request_id must be nonblank",
        ));
    }
    let (command, args) = match &request.operation {
        AgentControlIpcOperation::ControlStatus => (AgentControlCommand::ControlStatus, None),
        AgentControlIpcOperation::HostStatus => (AgentControlCommand::HostStatus, None),
        AgentControlIpcOperation::WorkerStatus => (AgentControlCommand::WorkerStatus, None),
        AgentControlIpcOperation::WorkerMaintenance { enabled } => (
            AgentControlCommand::WorkerMaintenance,
            Some(json!({ "enabled": *enabled })),
        ),
    };
    Ok(AgentControlRequest {
        protocol_version: CONTROL_PROTOCOL_VERSION,
        request_id: request.request_id.clone(),
        command,
        args,
    })
}

fn parse_agent_control_response(line: &str) -> Result<Value, AgentControlIpcError> {
    let value: Value = serde_json::from_str(line)
        .map_err(|error| ipc_error("invalid_agent_control_response", error.to_string()))?;
    let object = value.as_object().ok_or_else(|| {
        ipc_error(
            "invalid_agent_control_response",
            "response must be a JSON object",
        )
    })?;
    if object.get("protocol_version").and_then(Value::as_u64)
        != Some(u64::from(CONTROL_PROTOCOL_VERSION))
    {
        return Err(ipc_error(
            "agent_control_protocol_mismatch",
            "response protocol_version does not match",
        ));
    }
    match object.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(value),
        Some(false) => {
            let error = object
                .get("error")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    ipc_error(
                        "invalid_agent_control_response",
                        "error response is missing error object",
                    )
                })?;
            let code = error.get("code").and_then(Value::as_str).ok_or_else(|| {
                ipc_error(
                    "invalid_agent_control_response",
                    "error response is missing code",
                )
            })?;
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ipc_error(
                        "invalid_agent_control_response",
                        "error response is missing message",
                    )
                })?;
            Err(ipc_error(code, message))
        }
        None => Err(ipc_error(
            "invalid_agent_control_response",
            "response is missing boolean ok",
        )),
    }
}

fn ipc_error(code: impl Into<String>, message: impl Into<String>) -> AgentControlIpcError {
    AgentControlIpcError {
        code: code.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ade_control::AgentControlServer;
    use std::fs;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str, suffix: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ade-tauri-{name}-{}-{}.{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            suffix
        ))
    }

    #[test]
    fn frontend_request_is_camel_case_and_cannot_inject_endpoint() {
        let request: AgentControlIpcRequest = serde_json::from_value(json!({
            "requestId": "status-1",
            "operation": { "type": "worker_status" }
        }))
        .unwrap();
        assert_eq!(request.request_id, "status-1");
        assert!(serde_json::from_value::<AgentControlIpcRequest>(json!({
            "requestId": "status-1",
            "endpointFile": "/tmp/other.json",
            "operation": { "type": "worker_status" }
        }))
        .is_err());
    }

    #[test]
    fn typed_operation_builds_exact_agent_control_wire() {
        let request = AgentControlIpcRequest {
            request_id: "maintenance-1".into(),
            operation: AgentControlIpcOperation::WorkerMaintenance { enabled: true },
        };
        assert_eq!(
            serde_json::to_value(build_request(&request).unwrap()).unwrap(),
            json!({
                "protocol_version": 1,
                "request_id": "maintenance-1",
                "command": "worker_maintenance",
                "args": { "enabled": true }
            })
        );
    }

    #[test]
    fn remote_error_code_and_message_are_preserved() {
        let error = parse_agent_control_response(
            r#"{"protocol_version":1,"request_id":"status-1","ok":false,"error":{"code":"request_id_conflict","message":"conflict"}}"#,
        )
        .unwrap_err();
        assert_eq!(
            error,
            AgentControlIpcError {
                code: "request_id_conflict".into(),
                message: "conflict".into(),
            }
        );
    }

    #[test]
    fn separate_ipc_calls_observe_the_same_persistent_worker_runtime() {
        let state_db = temp_path("shared-runtime", "db");
        let endpoint = temp_path("shared-runtime", "json");
        let server = AgentControlServer::bind(&state_db, &endpoint).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let server_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || server.run_until(server_stop));

        let maintenance = execute_agent_control_request(
            &endpoint,
            &AgentControlIpcRequest {
                request_id: "maintenance-1".into(),
                operation: AgentControlIpcOperation::WorkerMaintenance { enabled: true },
            },
        )
        .unwrap();
        assert_eq!(maintenance["result"]["maintenance"], true);

        let status = execute_agent_control_request(
            &endpoint,
            &AgentControlIpcRequest {
                request_id: "status-1".into(),
                operation: AgentControlIpcOperation::WorkerStatus,
            },
        )
        .unwrap();
        assert_eq!(status["result"]["maintenance"], true);

        stop.store(true, Ordering::SeqCst);
        handle.join().unwrap().unwrap();
        assert!(!endpoint.exists());
        let _ = fs::remove_file(state_db);
    }
}
