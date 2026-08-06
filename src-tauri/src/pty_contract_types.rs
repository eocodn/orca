use crate::pty_target::PtyExecutionTarget;
use ade_terminal::pty::PtySession;
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

pub(super) const MAX_SESSION_GENERATION: u64 = 9_007_199_254_740_991;
pub(super) const MAX_COMMITTED_REQUESTS: usize = 4096;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PtyOperation {
    Start,
    Write,
    Resize,
    Poll,
    Wait,
    Terminate,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PtyRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub worker_id: String,
    pub session_id: String,
    #[serde(default)]
    pub session_generation: Option<u64>,
    pub operation: PtyOperation,
    pub program: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub current_dir: Option<String>,
    #[serde(default)]
    pub execution_target: Option<PtyExecutionTarget>,
    pub input: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PtyOwner {
    pub(super) workspace_id: String,
    pub(super) worker_id: String,
}

pub(super) struct PtySessionEntry {
    pub(super) owner: PtyOwner,
    pub(super) session_generation: u64,
    pub(super) session: Arc<Mutex<PtySession>>,
}

pub(super) struct PtySessionHandle {
    pub(super) session: Arc<Mutex<PtySession>>,
    pub(super) session_generation: u64,
}

pub(super) struct PtySessionReservation {
    pub(super) request_id: String,
    pub(super) owner: PtyOwner,
    pub(super) session_generation: u64,
}

#[derive(Default)]
pub(super) struct PtyRegistry {
    pub(super) next_session_generation: u64,
    pub(super) sessions: HashMap<String, PtySessionEntry>,
    pub(super) session_reservations: HashMap<String, PtySessionReservation>,
    pub(super) committed_requests: HashMap<String, (PtyRequest, Result<String, String>)>,
    pub(super) committed_request_order: VecDeque<String>,
    pub(super) in_flight_requests: HashMap<String, PtyRequest>,
}

#[derive(Default)]
pub struct PtyExecutionState {
    pub(super) registry: Mutex<PtyRegistry>,
}

impl Drop for PtyExecutionState {
    fn drop(&mut self) {
        let Ok(registry) = self.registry.get_mut() else {
            return;
        };
        let sessions = registry
            .sessions
            .drain()
            .map(|(_, entry)| entry.session)
            .collect::<Vec<_>>();
        for session in sessions {
            if let Ok(mut session) = session.lock() {
                let _ = session.terminate();
            }
        }
    }
}
