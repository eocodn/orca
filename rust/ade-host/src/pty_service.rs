use crate::pty_router::{
    JsonlWorkerTransport, PtyHostRouter, PtyWorkerTransport, RouterError, WorkerIdentity,
};
use ade_host_core::ownership::{
    OwnershipCommand, OwnershipError, OwnershipRuntime, OwnershipState, OwnershipToken,
};
use ade_host_core::protocol::{PtyRequest, PtyResponse};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyHostServiceError {
    EmptyRequestId,
    EmptyWorkspaceId,
    EmptyWorkerId,
    InvalidWorkerIncarnation,
    OwnershipConflict,
    Ownership(String),
    Router(RouterError),
    ClaimLockPoisoned,
}

impl From<RouterError> for PtyHostServiceError {
    fn from(error: RouterError) -> Self {
        Self::Router(error)
    }
}

impl PtyHostServiceError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::EmptyRequestId => "empty_request_id",
            Self::EmptyWorkspaceId => "empty_workspace_id",
            Self::EmptyWorkerId => "empty_worker_id",
            Self::InvalidWorkerIncarnation => "invalid_worker_incarnation",
            Self::OwnershipConflict => "ownership_conflict",
            Self::Ownership(_) => "ownership_error",
            Self::Router(error) => error.code(),
            Self::ClaimLockPoisoned => "claim_lock_poisoned",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PtyWorkspaceClaim {
    pub request_id: String,
    pub workspace_id: String,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub lease_id: u64,
    pub changed: bool,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PtyHostServiceStatus {
    pub service: &'static str,
    pub state: &'static str,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub failure_reason: Option<String>,
}

pub struct PtyHostService {
    identity: WorkerIdentity,
    ownership: OwnershipRuntime,
    router: PtyHostRouter,
    claim_lock: Mutex<()>,
}

impl PtyHostService {
    pub fn new(transport: Box<dyn PtyWorkerTransport>) -> Result<Self, PtyHostServiceError> {
        let identity = transport.identity().clone();
        validate_identity(&identity)?;
        let ownership = OwnershipRuntime::new();
        let router = PtyHostRouter::new(ownership.clone(), transport);
        Ok(Self {
            identity,
            ownership,
            router,
            claim_lock: Mutex::new(()),
        })
    }

    pub fn spawn_sibling(
        identity: WorkerIdentity,
        timeout: Duration,
    ) -> Result<Self, PtyHostServiceError> {
        let worker_path = JsonlWorkerTransport::sibling_worker_path()?;
        Self::spawn(worker_path, identity, timeout)
    }

    pub fn spawn(
        worker_path: impl AsRef<Path>,
        identity: WorkerIdentity,
        timeout: Duration,
    ) -> Result<Self, PtyHostServiceError> {
        validate_identity(&identity)?;
        let transport = JsonlWorkerTransport::spawn(worker_path, identity, timeout)?;
        Self::new(Box::new(transport))
    }

    pub fn status(&self) -> PtyHostServiceStatus {
        PtyHostServiceStatus {
            service: "ade-host-pty",
            state: "ready",
            worker_id: self.identity.worker_id.clone(),
            worker_incarnation: self.identity.worker_incarnation,
            failure_reason: None,
        }
    }

    pub fn claim_workspace(
        &self,
        request_id: &str,
        workspace_id: &str,
    ) -> Result<PtyWorkspaceClaim, PtyHostServiceError> {
        if request_id.trim().is_empty() {
            return Err(PtyHostServiceError::EmptyRequestId);
        }
        if workspace_id.trim().is_empty() {
            return Err(PtyHostServiceError::EmptyWorkspaceId);
        }
        let _guard = self
            .claim_lock
            .lock()
            .map_err(|_| PtyHostServiceError::ClaimLockPoisoned)?;
        let snapshot = self
            .ownership
            .snapshot(workspace_id)
            .map_err(ownership_error)?;
        if snapshot.state == OwnershipState::Owned {
            let token = snapshot.token.ok_or_else(|| {
                PtyHostServiceError::Ownership(String::from("owned_workspace_missing_token"))
            })?;
            return claim_from_token(request_id, token, false, &self.identity);
        }
        if snapshot.state != OwnershipState::Unowned {
            return Err(PtyHostServiceError::OwnershipConflict);
        }

        let acquired = self
            .ownership
            .apply(OwnershipCommand::Acquire {
                operation_id: format!("{request_id}:acquire"),
                workspace_id: workspace_id.to_string(),
                worker_id: self.identity.worker_id.clone(),
                worker_incarnation: self.identity.worker_incarnation,
            })
            .map_err(ownership_error)?;
        let token = acquired
            .token
            .ok_or_else(|| PtyHostServiceError::Ownership(String::from("claim_missing_token")))?;
        match self.ownership.apply(OwnershipCommand::ClaimReady {
            operation_id: format!("{request_id}:ready"),
            token: token.clone(),
        }) {
            Ok(ready) => {
                let token = ready.token.ok_or_else(|| {
                    PtyHostServiceError::Ownership(String::from("ready_missing_token"))
                })?;
                claim_from_token(request_id, token, true, &self.identity)
            }
            Err(error) => {
                let _ = self.ownership.apply(OwnershipCommand::ReconcileStopped {
                    operation_id: format!("{request_id}:rollback"),
                    token,
                });
                Err(ownership_error(error))
            }
        }
    }

    pub fn route(&self, request: PtyRequest) -> Result<PtyResponse, PtyHostServiceError> {
        self.router.route(request).map_err(Into::into)
    }
}

fn validate_identity(identity: &WorkerIdentity) -> Result<(), PtyHostServiceError> {
    if identity.worker_id.trim().is_empty() {
        return Err(PtyHostServiceError::EmptyWorkerId);
    }
    if identity.worker_incarnation == 0 || identity.worker_incarnation > MAX_SAFE_INTEGER {
        return Err(PtyHostServiceError::InvalidWorkerIncarnation);
    }
    Ok(())
}

fn claim_from_token(
    request_id: &str,
    token: OwnershipToken,
    changed: bool,
    identity: &WorkerIdentity,
) -> Result<PtyWorkspaceClaim, PtyHostServiceError> {
    if token.worker_id != identity.worker_id
        || token.worker_incarnation != identity.worker_incarnation
    {
        return Err(PtyHostServiceError::OwnershipConflict);
    }
    Ok(PtyWorkspaceClaim {
        request_id: request_id.to_string(),
        workspace_id: token.workspace_id,
        worker_id: token.worker_id,
        worker_incarnation: token.worker_incarnation,
        lease_id: token.lease_id,
        changed,
        state: "owned",
    })
}

fn ownership_error(error: OwnershipError) -> PtyHostServiceError {
    match error {
        OwnershipError::OwnershipConflict | OwnershipError::StaleLease => {
            PtyHostServiceError::OwnershipConflict
        }
        value => PtyHostServiceError::Ownership(format!("{value:?}")),
    }
}
