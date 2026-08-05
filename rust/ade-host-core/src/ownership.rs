use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnershipState {
    Unowned,
    Claiming,
    Owned,
    Releasing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnershipToken {
    pub workspace_id: String,
    pub worker_id: String,
    pub lease_id: u64,
    pub worker_incarnation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipCommand {
    Acquire {
        operation_id: String,
        workspace_id: String,
        worker_id: String,
        worker_incarnation: u64,
    },
    ClaimReady {
        operation_id: String,
        token: OwnershipToken,
    },
    Heartbeat {
        operation_id: String,
        token: OwnershipToken,
        sequence: u64,
    },
    BeginRelease {
        operation_id: String,
        token: OwnershipToken,
    },
    Release {
        operation_id: String,
        token: OwnershipToken,
    },
    ReconcileStopped {
        operation_id: String,
        token: OwnershipToken,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnershipSnapshot {
    pub workspace_id: String,
    pub state: OwnershipState,
    pub token: Option<OwnershipToken>,
    pub heartbeat_sequence: u64,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnershipResult {
    pub changed: bool,
    pub workspace_id: String,
    pub state: OwnershipState,
    pub token: Option<OwnershipToken>,
    pub heartbeat_sequence: u64,
    pub revision: u64,
}

impl OwnershipResult {
    pub fn as_unchanged(&self) -> Self {
        Self {
            changed: false,
            ..self.clone()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    EmptyOperationId,
    EmptyWorkspaceId,
    EmptyWorkerId,
    InvalidWorkerIncarnation,
    InvalidLeaseId,
    OwnershipConflict,
    OperationConflict,
    InvalidTransition,
    StaleLease,
    StaleHeartbeat { received: u64, actual: u64 },
    GenerationOverflow,
    StateLockPoisoned,
}

// Ownership is ephemeral; the workspace store remains lifecycle metadata only.
#[derive(Clone, Debug, Default)]
pub struct OwnershipRuntime {
    state: Arc<Mutex<OwnershipStateStore>>,
}

#[derive(Debug, Default)]
struct OwnershipStateStore {
    records: BTreeMap<String, OwnershipRecord>,
    receipts: BTreeMap<String, (OwnershipCommand, Result<OwnershipResult, OwnershipError>)>,
    next_lease_id: u64,
}

#[derive(Debug, Clone)]
struct OwnershipRecord {
    state: OwnershipState,
    token: Option<OwnershipToken>,
    heartbeat_sequence: u64,
    revision: u64,
}

impl OwnershipRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn apply(&self, command: OwnershipCommand) -> Result<OwnershipResult, OwnershipError> {
        let operation_id = command.operation_id().to_string();
        let mut store = self
            .state
            .lock()
            .map_err(|_| OwnershipError::StateLockPoisoned)?;

        if let Some((committed, result)) = store.receipts.get(&operation_id) {
            if committed == &command {
                return result.clone();
            }
            return Err(OwnershipError::OperationConflict);
        }

        validate_command(&command)?;
        let result = store.apply_command(&command);
        store
            .receipts
            .insert(operation_id, (command, result.clone()));
        result
    }

    pub fn snapshot(&self, workspace_id: &str) -> Result<OwnershipSnapshot, OwnershipError> {
        if workspace_id.trim().is_empty() {
            return Err(OwnershipError::EmptyWorkspaceId);
        }
        let store = self
            .state
            .lock()
            .map_err(|_| OwnershipError::StateLockPoisoned)?;
        Ok(store.snapshot(workspace_id))
    }
}

impl OwnershipStateStore {
    fn apply_command(
        &mut self,
        command: &OwnershipCommand,
    ) -> Result<OwnershipResult, OwnershipError> {
        match command {
            OwnershipCommand::Acquire {
                workspace_id,
                worker_id,
                worker_incarnation,
                ..
            } => {
                let record =
                    self.records
                        .entry(workspace_id.clone())
                        .or_insert_with(|| OwnershipRecord {
                            state: OwnershipState::Unowned,
                            token: None,
                            heartbeat_sequence: 0,
                            revision: 0,
                        });
                if record.state != OwnershipState::Unowned {
                    return Err(OwnershipError::OwnershipConflict);
                }
                self.next_lease_id = self
                    .next_lease_id
                    .checked_add(1)
                    .ok_or(OwnershipError::GenerationOverflow)?;
                record.token = Some(OwnershipToken {
                    workspace_id: workspace_id.clone(),
                    worker_id: worker_id.clone(),
                    lease_id: self.next_lease_id,
                    worker_incarnation: *worker_incarnation,
                });
                record.state = OwnershipState::Claiming;
                record.heartbeat_sequence = 0;
                bump_revision(record)?;
                Ok(result(workspace_id, record, true))
            }
            OwnershipCommand::ClaimReady { token, .. } => {
                let record = self.record_for_token(token)?;
                ensure_token(record, token)?;
                match record.state {
                    OwnershipState::Claiming => {
                        record.state = OwnershipState::Owned;
                        bump_revision(record)?;
                        Ok(result(&token.workspace_id, record, true))
                    }
                    OwnershipState::Owned => Ok(result(&token.workspace_id, record, false)),
                    _ => Err(OwnershipError::InvalidTransition),
                }
            }
            OwnershipCommand::Heartbeat {
                token, sequence, ..
            } => {
                let record = self.record_for_token(token)?;
                ensure_token(record, token)?;
                if record.state != OwnershipState::Owned {
                    return Err(OwnershipError::InvalidTransition);
                }
                if *sequence < record.heartbeat_sequence {
                    return Err(OwnershipError::StaleHeartbeat {
                        received: *sequence,
                        actual: record.heartbeat_sequence,
                    });
                }
                if *sequence == record.heartbeat_sequence {
                    return Ok(result(&token.workspace_id, record, false));
                }
                record.heartbeat_sequence = *sequence;
                bump_revision(record)?;
                Ok(result(&token.workspace_id, record, true))
            }
            OwnershipCommand::BeginRelease { token, .. } => {
                let record = self.record_for_token(token)?;
                ensure_token(record, token)?;
                match record.state {
                    OwnershipState::Owned => {
                        record.state = OwnershipState::Releasing;
                        bump_revision(record)?;
                        Ok(result(&token.workspace_id, record, true))
                    }
                    OwnershipState::Releasing => Ok(result(&token.workspace_id, record, false)),
                    _ => Err(OwnershipError::InvalidTransition),
                }
            }
            OwnershipCommand::Release { token, .. } => {
                let record = self.record_for_token(token)?;
                ensure_token(record, token)?;
                if record.state != OwnershipState::Releasing {
                    return Err(OwnershipError::InvalidTransition);
                }
                release_record(record)?;
                Ok(result(&token.workspace_id, record, true))
            }
            OwnershipCommand::ReconcileStopped { token, .. } => {
                let record = self.record_for_token(token)?;
                ensure_token(record, token)?;
                if record.state == OwnershipState::Unowned {
                    return Ok(result(&token.workspace_id, record, false));
                }
                release_record(record)?;
                Ok(result(&token.workspace_id, record, true))
            }
        }
    }

    fn record_for_token(
        &mut self,
        token: &OwnershipToken,
    ) -> Result<&mut OwnershipRecord, OwnershipError> {
        self.records
            .get_mut(&token.workspace_id)
            .ok_or(OwnershipError::StaleLease)
    }

    fn snapshot(&self, workspace_id: &str) -> OwnershipSnapshot {
        let record = self.records.get(workspace_id);
        OwnershipSnapshot {
            workspace_id: workspace_id.to_string(),
            state: record
                .map(|record| record.state)
                .unwrap_or(OwnershipState::Unowned),
            token: record.and_then(|record| record.token.clone()),
            heartbeat_sequence: record.map(|record| record.heartbeat_sequence).unwrap_or(0),
            revision: record.map(|record| record.revision).unwrap_or(0),
        }
    }
}

impl OwnershipCommand {
    fn operation_id(&self) -> &str {
        match self {
            Self::Acquire { operation_id, .. }
            | Self::ClaimReady { operation_id, .. }
            | Self::Heartbeat { operation_id, .. }
            | Self::BeginRelease { operation_id, .. }
            | Self::Release { operation_id, .. }
            | Self::ReconcileStopped { operation_id, .. } => operation_id,
        }
    }
}

fn validate_command(command: &OwnershipCommand) -> Result<(), OwnershipError> {
    if command.operation_id().trim().is_empty() {
        return Err(OwnershipError::EmptyOperationId);
    }
    match command {
        OwnershipCommand::Acquire {
            workspace_id,
            worker_id,
            worker_incarnation,
            ..
        } => {
            if workspace_id.trim().is_empty() {
                return Err(OwnershipError::EmptyWorkspaceId);
            }
            if worker_id.trim().is_empty() {
                return Err(OwnershipError::EmptyWorkerId);
            }
            if *worker_incarnation == 0 {
                return Err(OwnershipError::InvalidWorkerIncarnation);
            }
        }
        OwnershipCommand::ClaimReady { token, .. }
        | OwnershipCommand::Heartbeat { token, .. }
        | OwnershipCommand::BeginRelease { token, .. }
        | OwnershipCommand::Release { token, .. }
        | OwnershipCommand::ReconcileStopped { token, .. } => validate_token(token)?,
    }
    Ok(())
}

fn validate_token(token: &OwnershipToken) -> Result<(), OwnershipError> {
    if token.workspace_id.trim().is_empty() {
        return Err(OwnershipError::EmptyWorkspaceId);
    }
    if token.worker_id.trim().is_empty() {
        return Err(OwnershipError::EmptyWorkerId);
    }
    if token.lease_id == 0 {
        return Err(OwnershipError::InvalidLeaseId);
    }
    if token.worker_incarnation == 0 {
        return Err(OwnershipError::InvalidWorkerIncarnation);
    }
    Ok(())
}

fn ensure_token(record: &OwnershipRecord, token: &OwnershipToken) -> Result<(), OwnershipError> {
    if record.token.as_ref() == Some(token) {
        Ok(())
    } else {
        Err(OwnershipError::StaleLease)
    }
}

fn release_record(record: &mut OwnershipRecord) -> Result<(), OwnershipError> {
    record.state = OwnershipState::Unowned;
    record.token = None;
    record.heartbeat_sequence = 0;
    bump_revision(record)
}

fn bump_revision(record: &mut OwnershipRecord) -> Result<(), OwnershipError> {
    record.revision = record
        .revision
        .checked_add(1)
        .ok_or(OwnershipError::GenerationOverflow)?;
    Ok(())
}

fn result(workspace_id: &str, record: &OwnershipRecord, changed: bool) -> OwnershipResult {
    OwnershipResult {
        changed,
        workspace_id: workspace_id.to_string(),
        state: record.state,
        token: record.token.clone(),
        heartbeat_sequence: record.heartbeat_sequence,
        revision: record.revision,
    }
}

#[cfg(test)]
#[path = "ownership_tests.rs"]
mod tests;
