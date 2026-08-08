use std::collections::HashMap;
use std::sync::{Condvar, Mutex};

const MAX_RECEIPTS: usize = 4_096;

#[derive(Debug)]
enum ReceiptState {
    InFlight {
        canonical_request: String,
    },
    Complete {
        canonical_request: String,
        response: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReceiptClaim {
    Execute { receipt_count: usize },
    Replay(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReceiptRegistryError {
    Conflict,
    CapacityExceeded,
    LockPoisoned,
    MissingInFlight,
}

pub(crate) struct ReceiptRegistry {
    states: Mutex<HashMap<String, ReceiptState>>,
    changed: Condvar,
}

impl ReceiptRegistry {
    pub(crate) fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
            changed: Condvar::new(),
        }
    }

    pub(crate) fn claim(
        &self,
        request_id: &str,
        canonical_request: &str,
    ) -> Result<ReceiptClaim, ReceiptRegistryError> {
        let mut states = self
            .states
            .lock()
            .map_err(|_| ReceiptRegistryError::LockPoisoned)?;
        loop {
            match states.get(request_id) {
                Some(ReceiptState::Complete {
                    canonical_request: existing,
                    response,
                }) => {
                    return if existing == canonical_request {
                        Ok(ReceiptClaim::Replay(response.clone()))
                    } else {
                        Err(ReceiptRegistryError::Conflict)
                    };
                }
                Some(ReceiptState::InFlight {
                    canonical_request: existing,
                }) if existing != canonical_request => {
                    return Err(ReceiptRegistryError::Conflict);
                }
                Some(ReceiptState::InFlight { .. }) => {
                    states = self
                        .changed
                        .wait(states)
                        .map_err(|_| ReceiptRegistryError::LockPoisoned)?;
                }
                None => {
                    if states.len() >= MAX_RECEIPTS {
                        return Err(ReceiptRegistryError::CapacityExceeded);
                    }
                    states.insert(
                        request_id.to_string(),
                        ReceiptState::InFlight {
                            canonical_request: canonical_request.to_string(),
                        },
                    );
                    return Ok(ReceiptClaim::Execute {
                        receipt_count: states.len(),
                    });
                }
            }
        }
    }

    pub(crate) fn complete(
        &self,
        request_id: &str,
        response: String,
    ) -> Result<(), ReceiptRegistryError> {
        let mut states = self
            .states
            .lock()
            .map_err(|_| ReceiptRegistryError::LockPoisoned)?;
        let state = states
            .get_mut(request_id)
            .ok_or(ReceiptRegistryError::MissingInFlight)?;
        let canonical_request = match state {
            ReceiptState::InFlight { canonical_request } => canonical_request.clone(),
            ReceiptState::Complete { .. } => return Err(ReceiptRegistryError::MissingInFlight),
        };
        *state = ReceiptState::Complete {
            canonical_request,
            response,
        };
        self.changed.notify_all();
        Ok(())
    }
}

impl Default for ReceiptRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn distinct_request_ids_claim_without_waiting_for_other_in_flight_work() {
        let receipts = ReceiptRegistry::new();
        assert!(matches!(
            receipts.claim("request-a", "canonical-a").unwrap(),
            ReceiptClaim::Execute { receipt_count: 1 }
        ));
        assert!(matches!(
            receipts.claim("request-b", "canonical-b").unwrap(),
            ReceiptClaim::Execute { receipt_count: 2 }
        ));
    }

    #[test]
    fn identical_in_flight_request_waits_and_replays_completed_response() {
        let receipts = Arc::new(ReceiptRegistry::new());
        assert!(matches!(
            receipts.claim("request-a", "canonical-a").unwrap(),
            ReceiptClaim::Execute { .. }
        ));
        let waiting = {
            let receipts = Arc::clone(&receipts);
            thread::spawn(move || receipts.claim("request-a", "canonical-a").unwrap())
        };
        thread::sleep(Duration::from_millis(20));
        assert!(!waiting.is_finished());
        receipts.complete("request-a", "response-a".into()).unwrap();
        assert_eq!(
            waiting.join().unwrap(),
            ReceiptClaim::Replay("response-a".into())
        );
    }

    #[test]
    fn conflicting_in_flight_request_id_fails_without_waiting() {
        let receipts = ReceiptRegistry::new();
        receipts.claim("request-a", "canonical-a").unwrap();
        assert_eq!(
            receipts.claim("request-a", "different"),
            Err(ReceiptRegistryError::Conflict)
        );
    }
}
