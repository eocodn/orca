use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerStatus {
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerCommand {
    Start,
    Ready,
    Heartbeat { sequence: u64 },
    Fail,
    Stop,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerError {
    EmptyWorkerId,
    StaleGeneration { expected: u64, actual: u64 },
    InvalidTransition,
    StaleHeartbeat { received: u64, actual: u64 },
    StateLockPoisoned,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerSnapshot {
    pub worker_id: String,
    pub generation: u64,
    pub status: WorkerStatus,
    pub heartbeat_sequence: u64,
}

#[derive(Debug)]
struct WorkerState {
    worker_id: String,
    generation: u64,
    status: WorkerStatus,
    heartbeat_sequence: u64,
}

#[derive(Clone, Debug)]
pub struct WorkerRuntime {
    state: Arc<Mutex<WorkerState>>,
}

impl WorkerRuntime {
    pub fn new(worker_id: impl Into<String>) -> Result<Self, WorkerError> {
        let worker_id = worker_id.into();
        if worker_id.trim().is_empty() {
            return Err(WorkerError::EmptyWorkerId);
        }
        Ok(Self {
            state: Arc::new(Mutex::new(WorkerState {
                worker_id,
                generation: 0,
                status: WorkerStatus::Stopped,
                heartbeat_sequence: 0,
            })),
        })
    }

    pub fn apply(
        &self,
        expected_generation: u64,
        command: WorkerCommand,
    ) -> Result<WorkerSnapshot, WorkerError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| WorkerError::StateLockPoisoned)?;
        if expected_generation != state.generation {
            return Err(WorkerError::StaleGeneration {
                expected: expected_generation,
                actual: state.generation,
            });
        }

        match command {
            WorkerCommand::Start if state.status == WorkerStatus::Stopped => {
                state.status = WorkerStatus::Starting;
            }
            WorkerCommand::Ready if state.status == WorkerStatus::Starting => {
                state.status = WorkerStatus::Ready;
            }
            WorkerCommand::Heartbeat { sequence } if state.status == WorkerStatus::Ready => {
                if sequence <= state.heartbeat_sequence {
                    return Err(WorkerError::StaleHeartbeat {
                        received: sequence,
                        actual: state.heartbeat_sequence,
                    });
                }
                state.heartbeat_sequence = sequence;
            }
            WorkerCommand::Fail
                if matches!(state.status, WorkerStatus::Starting | WorkerStatus::Ready) =>
            {
                state.status = WorkerStatus::Failed;
            }
            WorkerCommand::Stop
                if matches!(state.status, WorkerStatus::Ready | WorkerStatus::Failed) =>
            {
                state.status = WorkerStatus::Stopped;
            }
            _ => return Err(WorkerError::InvalidTransition),
        }

        state.generation += 1;
        Ok(WorkerSnapshot {
            worker_id: state.worker_id.clone(),
            generation: state.generation,
            status: state.status,
            heartbeat_sequence: state.heartbeat_sequence,
        })
    }

    pub fn snapshot(&self) -> Result<WorkerSnapshot, WorkerError> {
        let state = self
            .state
            .lock()
            .map_err(|_| WorkerError::StateLockPoisoned)?;
        Ok(WorkerSnapshot {
            worker_id: state.worker_id.clone(),
            generation: state.generation,
            status: state.status,
            heartbeat_sequence: state.heartbeat_sequence,
        })
    }
}
