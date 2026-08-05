pub mod store;

#[cfg(test)]
mod contract_tests {
    use super::store::{HostStore, StoreError, StoredWorkspace};
    use std::sync::Arc;
    use std::thread;

    fn temp_database(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ade-host-store-{name}-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn migration_creates_versioned_schema_and_reopen_reads_authoritative_snapshot() {
        let path = temp_database("migration");
        let store = HostStore::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 1);
        store
            .commit_workspace(
                StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
                "request-1",
            )
            .unwrap();
        drop(store);

        let reopened = HostStore::open(&path).unwrap();
        assert_eq!(
            reopened.snapshot().unwrap(),
            vec![StoredWorkspace::new(
                "workspace-1",
                r"C:\workspaces\one",
                "ready",
                4
            )]
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn idempotency_replays_the_original_commit_without_duplicate_journal_rows() {
        let path = temp_database("idempotency");
        let store = HostStore::open(&path).unwrap();
        let workspace = StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 1);
        let first = store
            .commit_workspace(workspace.clone(), "request-1")
            .unwrap();
        let replay = store.commit_workspace(workspace, "request-1").unwrap();
        assert!(first.changed);
        assert!(!replay.changed);
        assert_eq!(first.sequence, replay.sequence);
        assert_eq!(store.journal_len().unwrap(), 1);
        assert_eq!(
            store.commit_workspace(
                StoredWorkspace::new("workspace-1", r"C:\workspaces\other", "ready", 2),
                "request-1"
            ),
            Err(StoreError::IdempotencyConflict)
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_retries_have_one_persisted_commit() {
        let path = temp_database("concurrent");
        let store = Arc::new(HostStore::open(&path).unwrap());
        let handles = (0..8)
            .map(|_| {
                let store = Arc::clone(&store);
                thread::spawn(move || {
                    store.commit_workspace(
                        StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 1),
                        "request-1",
                    )
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            results
                .iter()
                .filter(|result| result.as_ref().unwrap().changed)
                .count(),
            1
        );
        assert_eq!(store.journal_len().unwrap(), 1);
        std::fs::remove_file(path).unwrap();
    }
}
