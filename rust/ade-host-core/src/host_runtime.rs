use std::sync::{Arc, RwLock};

use crate::state::{ApplyResult, HostCommand, HostError, HostState};

#[derive(Clone, Default)]
pub struct HostRuntime {
    state: Arc<RwLock<HostState>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostSnapshot {
    pub generation: u64,
    pub workspace_count: usize,
    pub ready_workspaces: usize,
}

impl HostRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(
        &self,
        expected_generation: u64,
        command: HostCommand,
    ) -> Result<ApplyResult, HostError> {
        let mut state = self
            .state
            .write()
            .map_err(|_| HostError::StateLockPoisoned)?;
        state.apply_if_generation(expected_generation, command)
    }

    pub fn snapshot(&self) -> Result<HostSnapshot, HostError> {
        let state = self
            .state
            .read()
            .map_err(|_| HostError::StateLockPoisoned)?;
        Ok(HostSnapshot {
            generation: state.generation(),
            workspace_count: state.workspace_count(),
            ready_workspaces: state.ready_workspace_count(),
        })
    }
}
