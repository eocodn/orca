use super::{MAX_SAFE_INTEGER, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkerHandshakeKind {
    #[serde(rename = "worker_handshake")]
    WorkerHandshake,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerHandshakeRequest {
    #[serde(rename = "type")]
    pub kind: WorkerHandshakeKind,
    pub request_id: String,
    pub protocol_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkerHandshakeResponse {
    #[serde(rename = "type")]
    pub kind: WorkerHandshakeKind,
    pub request_id: String,
    pub protocol_version: u16,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub worker_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerHandshakeError {
    EmptyRequestId,
    UnsupportedVersion(u16),
    RequestIdMismatch,
    ProtocolVersionMismatch,
    EmptyWorkerId,
    InvalidWorkerIncarnation,
    EmptyWorkerVersion,
}

impl WorkerHandshakeRequest {
    pub fn new(request_id: impl Into<String>) -> Self {
        Self {
            kind: WorkerHandshakeKind::WorkerHandshake,
            request_id: request_id.into(),
            protocol_version: PROTOCOL_VERSION,
        }
    }

    pub fn validate(&self) -> Result<(), WorkerHandshakeError> {
        if self.request_id.trim().is_empty() {
            return Err(WorkerHandshakeError::EmptyRequestId);
        }
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(WorkerHandshakeError::UnsupportedVersion(
                self.protocol_version,
            ));
        }
        Ok(())
    }
}

impl WorkerHandshakeResponse {
    pub fn new(
        request: &WorkerHandshakeRequest,
        worker_id: impl Into<String>,
        worker_incarnation: u64,
        worker_version: impl Into<String>,
    ) -> Self {
        Self {
            kind: WorkerHandshakeKind::WorkerHandshake,
            request_id: request.request_id.clone(),
            protocol_version: PROTOCOL_VERSION,
            worker_id: worker_id.into(),
            worker_incarnation,
            worker_version: worker_version.into(),
        }
    }

    pub fn validate_for(
        &self,
        request: &WorkerHandshakeRequest,
    ) -> Result<(), WorkerHandshakeError> {
        request.validate()?;
        if self.request_id != request.request_id {
            return Err(WorkerHandshakeError::RequestIdMismatch);
        }
        if self.protocol_version != request.protocol_version {
            return Err(WorkerHandshakeError::ProtocolVersionMismatch);
        }
        if self.worker_id.trim().is_empty() {
            return Err(WorkerHandshakeError::EmptyWorkerId);
        }
        if self.worker_incarnation == 0 || self.worker_incarnation > MAX_SAFE_INTEGER {
            return Err(WorkerHandshakeError::InvalidWorkerIncarnation);
        }
        if self.worker_version.trim().is_empty() {
            return Err(WorkerHandshakeError::EmptyWorkerVersion);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_wire_is_strict_versioned_and_correlated() {
        let request = WorkerHandshakeRequest::new("handshake-1");
        assert_eq!(request.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&request).unwrap(),
            r#"{"type":"worker_handshake","request_id":"handshake-1","protocol_version":1}"#
        );
        assert!(serde_json::from_str::<WorkerHandshakeRequest>(
            r#"{"type":"worker_handshake","request_id":"handshake-1","protocol_version":1,"unexpected":true}"#
        )
        .is_err());

        let response = WorkerHandshakeResponse::new(&request, "worker-1", 7, "0.1.0");
        assert_eq!(response.validate_for(&request), Ok(()));
        let other = WorkerHandshakeRequest::new("handshake-2");
        assert_eq!(
            response.validate_for(&other),
            Err(WorkerHandshakeError::RequestIdMismatch)
        );
    }
}
