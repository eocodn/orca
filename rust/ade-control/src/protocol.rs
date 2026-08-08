use ade_host::wsl_worker_runtime::WslWorkerRuntimeStatus;
use ade_host_platform::wsl_worker_supervisor::WslWorkerStatus;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONTROL_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentControlRequest {
    pub protocol_version: u16,
    pub request_id: String,
    pub command: AgentControlCommand,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentControlCommand {
    HostStatus,
    WorkerStatus,
    WorkerMaintenance,
    WorkerUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerMaintenanceArgs {
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerUpdateArgs {
    pub distro: String,
    pub service_user: String,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub worker_version: String,
    pub expected_sha256: String,
    pub binary_path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentControlResponse {
    pub protocol_version: u16,
    pub request_id: Option<String>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AgentControlResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AgentControlError>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub(crate) enum AgentControlResult {
    HostStatus(HostStatusResult),
    Worker(WorkerStatusResult),
}

#[derive(Debug, Serialize)]
pub(crate) struct HostStatusResult {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub workspace_count: usize,
    pub ready_workspaces: usize,
    pub source: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct WorkerStatusResult {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub generation: u64,
    pub maintenance: bool,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distro: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_incarnation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AgentControlError {
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn success_response(
    request_id: String,
    result: AgentControlResult,
) -> AgentControlResponse {
    AgentControlResponse {
        protocol_version: CONTROL_PROTOCOL_VERSION,
        request_id: Some(request_id),
        ok: true,
        result: Some(result),
        error: None,
    }
}

pub(crate) fn error_response(
    request_id: Option<String>,
    code: &'static str,
    message: String,
) -> AgentControlResponse {
    AgentControlResponse {
        protocol_version: CONTROL_PROTOCOL_VERSION,
        request_id,
        ok: false,
        result: None,
        error: Some(AgentControlError { code, message }),
    }
}

pub(crate) fn worker_status_result(
    kind: &'static str,
    status: WslWorkerRuntimeStatus,
) -> WorkerStatusResult {
    let snapshot = status.supervisor;
    let (state, distro, worker_id, worker_incarnation, failure_reason) = match snapshot.status {
        WslWorkerStatus::Stopped => ("stopped", None, None, None, None),
        WslWorkerStatus::AwaitingHandshake { distro } => {
            ("awaiting_handshake", Some(distro), None, None, None)
        }
        WslWorkerStatus::Ready {
            distro,
            worker_id,
            worker_incarnation,
        } => (
            "ready",
            Some(distro),
            Some(worker_id),
            Some(worker_incarnation),
            None,
        ),
        WslWorkerStatus::Failed { distro, reason } => {
            ("failed", Some(distro), None, None, Some(reason))
        }
    };
    let (active_generation, service_user, worker_version) = status
        .active
        .map(|active| {
            (
                Some(active.generation),
                Some(active.endpoint.service_user().to_string()),
                Some(active.endpoint.worker_version().to_string()),
            )
        })
        .unwrap_or((None, None, None));
    WorkerStatusResult {
        kind,
        generation: snapshot.generation,
        maintenance: snapshot.maintenance,
        state,
        distro,
        worker_id,
        worker_incarnation,
        failure_reason,
        active_generation,
        service_user,
        worker_version,
    }
}
