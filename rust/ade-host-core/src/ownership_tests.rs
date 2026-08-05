use super::{OwnershipCommand, OwnershipError, OwnershipRuntime, OwnershipState, OwnershipToken};
use std::sync::{Arc, Barrier};
use std::thread;

fn acquire(operation_id: &str, worker_id: &str) -> OwnershipCommand {
    OwnershipCommand::Acquire {
        operation_id: operation_id.to_string(),
        workspace_id: String::from("workspace-1"),
        worker_id: worker_id.to_string(),
        worker_incarnation: 1,
    }
}

#[test]
fn acquire_is_idempotent_and_conflicts_are_rejected() {
    let runtime = OwnershipRuntime::new();
    let command = acquire("acquire-1", "worker-1");

    let first = runtime.apply(command.clone()).unwrap();
    assert!(first.changed);
    assert_eq!(first.state, OwnershipState::Claiming);
    assert!(first.token.is_some());
    assert_eq!(runtime.apply(command).unwrap(), first);

    assert_eq!(
        runtime.apply(acquire("acquire-2", "worker-2")),
        Err(OwnershipError::OwnershipConflict)
    );
}

#[test]
fn worker_events_are_fenced_by_lease_and_incarnation() {
    let runtime = OwnershipRuntime::new();
    let acquired = runtime.apply(acquire("acquire-1", "worker-1")).unwrap();
    let token = acquired.token.clone().unwrap();
    let stale_token = OwnershipToken {
        lease_id: token.lease_id,
        worker_incarnation: token.worker_incarnation + 1,
        ..token.clone()
    };

    assert_eq!(
        runtime.apply(OwnershipCommand::ClaimReady {
            operation_id: String::from("ready-stale"),
            token: stale_token.clone(),
        }),
        Err(OwnershipError::StaleLease)
    );
    assert_eq!(
        runtime.snapshot("workspace-1").unwrap().state,
        OwnershipState::Claiming
    );

    let ready = runtime
        .apply(OwnershipCommand::ClaimReady {
            operation_id: String::from("ready-1"),
            token: token.clone(),
        })
        .unwrap();
    assert_eq!(ready.state, OwnershipState::Owned);

    assert_eq!(
        runtime.apply(OwnershipCommand::Heartbeat {
            operation_id: String::from("heartbeat-stale"),
            token: stale_token,
            sequence: 1,
        }),
        Err(OwnershipError::StaleLease)
    );
    let heartbeat = runtime
        .apply(OwnershipCommand::Heartbeat {
            operation_id: String::from("heartbeat-1"),
            token: token.clone(),
            sequence: 1,
        })
        .unwrap();
    assert!(heartbeat.changed);
    assert!(
        !runtime
            .apply(OwnershipCommand::Heartbeat {
                operation_id: String::from("heartbeat-duplicate"),
                token,
                sequence: 1,
            })
            .unwrap()
            .changed
    );
}

#[test]
fn release_requires_authoritative_worker_state() {
    let runtime = OwnershipRuntime::new();
    let acquired = runtime.apply(acquire("acquire-1", "worker-1")).unwrap();
    let token = acquired.token.unwrap();
    assert_eq!(
        runtime.apply(OwnershipCommand::Release {
            operation_id: String::from("release-early"),
            token: token.clone(),
        }),
        Err(OwnershipError::InvalidTransition)
    );

    runtime
        .apply(OwnershipCommand::ClaimReady {
            operation_id: String::from("ready-1"),
            token: token.clone(),
        })
        .unwrap();
    runtime
        .apply(OwnershipCommand::BeginRelease {
            operation_id: String::from("release-1"),
            token: token.clone(),
        })
        .unwrap();
    let released = runtime
        .apply(OwnershipCommand::Release {
            operation_id: String::from("release-2"),
            token,
        })
        .unwrap();
    assert_eq!(released.state, OwnershipState::Unowned);
}

#[test]
fn a_new_runtime_does_not_restore_ephemeral_ownership() {
    let runtime = OwnershipRuntime::new();
    runtime.apply(acquire("acquire-1", "worker-1")).unwrap();

    let restarted = OwnershipRuntime::new();
    let snapshot = restarted.snapshot("workspace-1").unwrap();
    assert_eq!(snapshot.state, OwnershipState::Unowned);
    assert_eq!(snapshot.token, None);
}

#[test]
fn concurrent_acquires_have_one_linearized_winner() {
    let runtime = Arc::new(OwnershipRuntime::new());
    let barrier = Arc::new(Barrier::new(8));
    let handles = (0..8)
        .map(|index| {
            let runtime = Arc::clone(&runtime);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                runtime.apply(acquire(
                    &format!("acquire-{index}"),
                    &format!("worker-{index}"),
                ))
            })
        })
        .collect::<Vec<_>>();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| **result == Err(OwnershipError::OwnershipConflict))
            .count(),
        7
    );
}
