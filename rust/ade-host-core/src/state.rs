use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct WorkspaceId(String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    EmptyWorkspaceId,
    WorkspaceNotFound,
    WorkspacePathConflict,
    InvalidTransition,
    StaleGeneration { expected: u64, actual: u64 },
}

impl WorkspaceId {
    pub fn new(value: impl Into<String>) -> Result<Self, HostError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(HostError::EmptyWorkspaceId);
        }
        Ok(Self(value))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceStatus {
    Registered,
    Starting,
    Ready,
    Failed,
    Stopping,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRecord {
    pub id: WorkspaceId,
    pub path: String,
    pub status: WorkspaceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostCommand {
    Register { id: WorkspaceId, path: String },
    Start { id: WorkspaceId },
    Ready { id: WorkspaceId },
    Fail { id: WorkspaceId },
    Stop { id: WorkspaceId },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyResult {
    pub changed: bool,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalEntry {
    pub generation: u64,
    pub command: HostCommand,
}

#[derive(Debug, Default)]
pub struct HostState {
    generation: u64,
    workspaces: BTreeMap<WorkspaceId, WorkspaceRecord>,
    journal: Vec<JournalEntry>,
}

impl HostState {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn workspace(&self, id: &WorkspaceId) -> Option<&WorkspaceRecord> {
        self.workspaces.get(id)
    }

    pub fn journal(&self) -> &[JournalEntry] {
        &self.journal
    }

    pub fn apply(&mut self, command: HostCommand) -> Result<ApplyResult, HostError> {
        self.apply_if_generation(self.generation, command)
    }

    pub fn apply_if_generation(
        &mut self,
        expected_generation: u64,
        command: HostCommand,
    ) -> Result<ApplyResult, HostError> {
        if expected_generation != self.generation {
            return Err(HostError::StaleGeneration {
                expected: expected_generation,
                actual: self.generation,
            });
        }

        if let HostCommand::Register { ref id, ref path } = command {
            if let Some(existing) = self.workspaces.get(id) {
                if existing.path == *path {
                    return Ok(ApplyResult {
                        changed: false,
                        generation: self.generation,
                    });
                }
                return Err(HostError::WorkspacePathConflict);
            }
        }

        self.apply_command(&command)?;
        self.generation += 1;
        self.journal.push(JournalEntry {
            generation: self.generation,
            command,
        });
        Ok(ApplyResult {
            changed: true,
            generation: self.generation,
        })
    }

    fn apply_command(&mut self, command: &HostCommand) -> Result<(), HostError> {
        match command {
            HostCommand::Register { id, path } => {
                self.workspaces.insert(
                    id.clone(),
                    WorkspaceRecord {
                        id: id.clone(),
                        path: path.clone(),
                        status: WorkspaceStatus::Registered,
                    },
                );
                Ok(())
            }
            HostCommand::Start { id } => self.transition(
                id,
                WorkspaceStatus::Starting,
                &[WorkspaceStatus::Registered],
            ),
            HostCommand::Ready { id } => {
                self.transition(id, WorkspaceStatus::Ready, &[WorkspaceStatus::Starting])
            }
            HostCommand::Fail { id } => {
                self.transition(id, WorkspaceStatus::Failed, &[WorkspaceStatus::Starting])
            }
            HostCommand::Stop { id } => self.transition(
                id,
                WorkspaceStatus::Stopped,
                &[
                    WorkspaceStatus::Ready,
                    WorkspaceStatus::Failed,
                    WorkspaceStatus::Stopping,
                ],
            ),
        }
    }

    fn transition(
        &mut self,
        id: &WorkspaceId,
        next: WorkspaceStatus,
        allowed: &[WorkspaceStatus],
    ) -> Result<(), HostError> {
        let workspace = self
            .workspaces
            .get_mut(id)
            .ok_or(HostError::WorkspaceNotFound)?;
        if !allowed.contains(&workspace.status) {
            return Err(HostError::InvalidTransition);
        }
        workspace.status = next;
        Ok(())
    }
}
