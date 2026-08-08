use crate::CommandSpec;
use ade_host_core::protocol::{
    WorkerHandshakeError, WorkerHandshakeRequest, WorkerHandshakeResponse,
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const WSL_WORKER_LINK: &str = "/usr/lib/ade/ade-worker";
pub const WSL_WORKER_SOCKET: &str = "/run/ade/worker.sock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerEndpoint {
    distro: String,
    service_user: String,
    worker_id: String,
    worker_incarnation: u64,
    worker_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WslWorkerEndpointError {
    EmptyDistro,
    InvalidServiceUser,
    RootServiceUser,
    InvalidWorkerId,
    InvalidWorkerIncarnation,
    InvalidWorkerVersion,
    InvalidHandshake(WorkerHandshakeError),
    WorkerIdMismatch,
    WorkerIncarnationMismatch,
    WorkerVersionMismatch,
}

impl WslWorkerEndpoint {
    pub fn new(
        distro: impl Into<String>,
        service_user: impl Into<String>,
        worker_id: impl Into<String>,
        worker_incarnation: u64,
        worker_version: impl Into<String>,
    ) -> Result<Self, WslWorkerEndpointError> {
        let distro = distro.into();
        let service_user = service_user.into();
        let worker_id = worker_id.into();
        let worker_version = worker_version.into();
        if distro.trim().is_empty() {
            return Err(WslWorkerEndpointError::EmptyDistro);
        }
        if !is_safe_identifier(&service_user) {
            return Err(WslWorkerEndpointError::InvalidServiceUser);
        }
        if service_user == "root" {
            return Err(WslWorkerEndpointError::RootServiceUser);
        }
        if !is_safe_identifier(&worker_id) {
            return Err(WslWorkerEndpointError::InvalidWorkerId);
        }
        if worker_incarnation == 0 || worker_incarnation > MAX_SAFE_INTEGER {
            return Err(WslWorkerEndpointError::InvalidWorkerIncarnation);
        }
        if !is_safe_version(&worker_version) {
            return Err(WslWorkerEndpointError::InvalidWorkerVersion);
        }
        Ok(Self {
            distro,
            service_user,
            worker_id,
            worker_incarnation,
            worker_version,
        })
    }

    pub fn distro(&self) -> &str {
        &self.distro
    }

    pub fn service_user(&self) -> &str {
        &self.service_user
    }

    pub fn worker_id(&self) -> &str {
        &self.worker_id
    }

    pub fn worker_incarnation(&self) -> u64 {
        self.worker_incarnation
    }

    pub fn worker_version(&self) -> &str {
        &self.worker_version
    }

    pub fn relay_command(&self) -> CommandSpec {
        CommandSpec {
            program: "wsl.exe".into(),
            args: vec![
                "--distribution".into(),
                self.distro.clone(),
                "--user".into(),
                self.service_user.clone(),
                "--exec".into(),
                WSL_WORKER_LINK.into(),
                "--connect-unix".into(),
                WSL_WORKER_SOCKET.into(),
            ],
            working_directory: None,
        }
    }

    pub fn handshake_request(
        &self,
        request_id: impl Into<String>,
    ) -> Result<WorkerHandshakeRequest, WslWorkerEndpointError> {
        let request = WorkerHandshakeRequest::new(request_id);
        request
            .validate()
            .map_err(WslWorkerEndpointError::InvalidHandshake)?;
        Ok(request)
    }

    pub fn validate_handshake(
        &self,
        request: &WorkerHandshakeRequest,
        response: &WorkerHandshakeResponse,
    ) -> Result<(), WslWorkerEndpointError> {
        response
            .validate_for(request)
            .map_err(WslWorkerEndpointError::InvalidHandshake)?;
        if response.worker_id != self.worker_id {
            return Err(WslWorkerEndpointError::WorkerIdMismatch);
        }
        if response.worker_incarnation != self.worker_incarnation {
            return Err(WslWorkerEndpointError::WorkerIncarnationMismatch);
        }
        if response.worker_version != self.worker_version {
            return Err(WslWorkerEndpointError::WorkerVersionMismatch);
        }
        Ok(())
    }
}

fn is_safe_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    (first.is_ascii_alphanumeric() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn is_safe_version(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'+'))
}
