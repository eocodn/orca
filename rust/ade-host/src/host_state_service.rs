use crate::WorkspaceRegistration;
use ade_host_store::store::{CommitResult, HostStore, StoredWorkspace};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostStateServiceError {
    Store(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostStateStatus {
    pub workspace_count: usize,
    pub ready_workspaces: usize,
}

pub struct HostStateService {
    store: HostStore,
}

impl HostStateService {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, HostStateServiceError> {
        Ok(Self {
            store: HostStore::open(path).map_err(store_error)?,
        })
    }

    pub fn register_workspace(
        &self,
        registration: WorkspaceRegistration,
    ) -> Result<CommitResult, HostStateServiceError> {
        let WorkspaceRegistration {
            workspace_id,
            path,
            request_id,
            location,
        } = registration;
        let workspace = StoredWorkspace::new(workspace_id, path, "registered", 1);
        let workspace = match location {
            Some(location) => workspace.with_location(location),
            None => workspace,
        };
        self.store
            .commit_workspace(workspace, &request_id)
            .map_err(store_error)
    }

    pub fn snapshot(&self) -> Result<Vec<StoredWorkspace>, HostStateServiceError> {
        self.store.snapshot().map_err(store_error)
    }

    pub fn status(&self) -> Result<HostStateStatus, HostStateServiceError> {
        let snapshot = self.snapshot()?;
        Ok(HostStateStatus {
            workspace_count: snapshot.len(),
            ready_workspaces: snapshot
                .iter()
                .filter(|workspace| workspace.status == "ready")
                .count(),
        })
    }
}

fn store_error(error: impl std::fmt::Debug) -> HostStateServiceError {
    HostStateServiceError::Store(format!("{error:?}"))
}
