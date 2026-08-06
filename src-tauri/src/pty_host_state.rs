use ade_host::pty_router::WorkerIdentity;
use ade_host::pty_service::{PtyHostService, PtyHostServiceError};
use ade_host_core::protocol::PtyRequest;
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LOCAL_WORKER_ID: &str = "tauri-local-worker";
const WORKER_RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TauriPtyHostStatus {
    service: &'static str,
    state: &'static str,
    worker_id: Option<String>,
    worker_incarnation: Option<u64>,
    failure_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TauriPtyHostError {
    pub code: &'static str,
    pub message: String,
}

pub struct TauriPtyHostState {
    service: Option<PtyHostService>,
    failure_reason: Option<String>,
}

impl TauriPtyHostState {
    pub fn start() -> Self {
        let identity = WorkerIdentity {
            worker_id: LOCAL_WORKER_ID.to_string(),
            worker_incarnation: new_worker_incarnation(),
        };
        match PtyHostService::spawn_sibling(identity, WORKER_RESPONSE_TIMEOUT) {
            Ok(service) => Self::ready(service),
            Err(error) => Self::unavailable(format!("{error:?}")),
        }
    }

    pub fn ready(service: PtyHostService) -> Self {
        Self {
            service: Some(service),
            failure_reason: None,
        }
    }

    pub fn unavailable(reason: String) -> Self {
        Self {
            service: None,
            failure_reason: Some(reason),
        }
    }

    pub fn status_json(&self) -> Result<String, TauriPtyHostError> {
        let status = match &self.service {
            Some(service) => {
                let status = service.status();
                TauriPtyHostStatus {
                    service: status.service,
                    state: status.state,
                    worker_id: Some(status.worker_id),
                    worker_incarnation: Some(status.worker_incarnation),
                    failure_reason: status.failure_reason,
                }
            }
            None => TauriPtyHostStatus {
                service: "ade-host-pty",
                state: "unavailable",
                worker_id: None,
                worker_incarnation: None,
                failure_reason: self.failure_reason.clone(),
            },
        };
        serde_json::to_string(&status).map_err(serialization_error)
    }

    pub fn claim_workspace_json(
        &self,
        request_id: &str,
        workspace_id: &str,
    ) -> Result<String, TauriPtyHostError> {
        let claim = self
            .service()?
            .claim_workspace(request_id, workspace_id)
            .map_err(service_error)?;
        serde_json::to_string(&claim).map_err(serialization_error)
    }

    pub fn route_json(&self, request: PtyRequest) -> Result<String, TauriPtyHostError> {
        let response = self.service()?.route(request).map_err(service_error)?;
        serde_json::to_string(&response).map_err(serialization_error)
    }

    fn service(&self) -> Result<&PtyHostService, TauriPtyHostError> {
        self.service.as_ref().ok_or_else(|| TauriPtyHostError {
            code: "pty_host_unavailable",
            message: self
                .failure_reason
                .clone()
                .unwrap_or_else(|| String::from("PTY host is unavailable.")),
        })
    }
}

fn new_worker_incarnation() -> u64 {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let candidate = (elapsed.as_nanos() as u64 ^ u64::from(std::process::id())) % MAX_SAFE_INTEGER;
    candidate.max(1)
}

fn service_error(error: PtyHostServiceError) -> TauriPtyHostError {
    TauriPtyHostError {
        code: error.code(),
        message: format!("{error:?}"),
    }
}

fn serialization_error(error: serde_json::Error) -> TauriPtyHostError {
    TauriPtyHostError {
        code: "serialization_error",
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{new_worker_incarnation, TauriPtyHostState};

    #[test]
    fn unavailable_state_is_observable_and_fails_closed() {
        let state = TauriPtyHostState::unavailable(String::from("worker_missing"));
        assert_eq!(
            state.status_json().expect("status should serialize"),
            r#"{"service":"ade-host-pty","state":"unavailable","worker_id":null,"worker_incarnation":null,"failure_reason":"worker_missing"}"#
        );
        assert_eq!(
            state
                .claim_workspace_json("claim-1", "workspace-1")
                .expect_err("claim should fail")
                .code,
            "pty_host_unavailable"
        );
    }

    #[test]
    fn worker_incarnation_is_wire_safe_and_nonzero() {
        let incarnation = new_worker_incarnation();
        assert!(incarnation > 0);
        assert!(incarnation <= 9_007_199_254_740_991);
    }
}
