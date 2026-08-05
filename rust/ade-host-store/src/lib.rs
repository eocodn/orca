pub mod store;

#[cfg(test)]
mod contract_tests {
    use super::store::{
        HostStore, StoreError, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind,
        StoredWorkspaceLocation,
    };
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
        assert_eq!(store.schema_version().unwrap(), 2);
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
    fn migrates_a_schema_one_database_without_changing_existing_idempotency() {
        let path = temp_database("schema-one-upgrade");
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE workspace_snapshot (
                     workspace_id TEXT PRIMARY KEY NOT NULL,
                     path TEXT NOT NULL,
                     status TEXT NOT NULL,
                     generation INTEGER NOT NULL
                 );
                 CREATE TABLE workspace_journal (
                     sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                     request_id TEXT NOT NULL UNIQUE,
                     workspace_id TEXT NOT NULL,
                     path TEXT NOT NULL,
                     status TEXT NOT NULL,
                     generation INTEGER NOT NULL
                 );
                 INSERT INTO workspace_snapshot VALUES ('workspace-1', '/legacy', 'ready', 1);
                 INSERT INTO workspace_journal
                     (request_id, workspace_id, path, status, generation)
                     VALUES ('legacy-request', 'workspace-1', '/legacy', 'ready', 1);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);

        let store = HostStore::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        assert_eq!(
            store.snapshot().unwrap(),
            vec![StoredWorkspace::new("workspace-1", "/legacy", "ready", 1)]
        );
        assert_eq!(
            store
                .commit_workspace(
                    StoredWorkspace::new("workspace-1", "/legacy", "ready", 1),
                    "legacy-request",
                )
                .unwrap(),
            super::store::CommitResult {
                sequence: 1,
                changed: false,
            }
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn persists_workspace_location_across_reopen_and_replays_it_idempotently() {
        let path = temp_database("location");
        let store = HostStore::open(&path).unwrap();
        let workspace = StoredWorkspace::new("workspace-1", "/workspaces/repo", "ready", 1)
            .with_location(StoredWorkspaceLocation::new(
                StoredWorkspaceKind::GitWorktree,
                StoredExecutionTarget::Wsl2 {
                    distro: String::from("Ubuntu-22.04"),
                },
                "/workspaces/repo",
            ));
        let first = store
            .commit_workspace(workspace.clone(), "request-location")
            .unwrap();
        let replay = store
            .commit_workspace(workspace.clone(), "request-location")
            .unwrap();
        assert!(first.changed);
        assert!(!replay.changed);
        drop(store);

        let reopened = HostStore::open(&path).unwrap();
        assert_eq!(reopened.snapshot().unwrap(), vec![workspace]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_a_location_that_cannot_be_authoritative_for_the_workspace_path() {
        let path = temp_database("invalid-location");
        let store = HostStore::open(&path).unwrap();
        let workspace = StoredWorkspace::new("workspace-1", "/workspaces/repo", "ready", 1)
            .with_location(StoredWorkspaceLocation::new(
                StoredWorkspaceKind::Folder,
                StoredExecutionTarget::WindowsNative,
                "/other/path",
            ));
        assert_eq!(
            store.commit_workspace(workspace, "request-invalid-location"),
            Err(StoreError::InvalidLocation(String::from(
                "location path must equal workspace path"
            )))
        );
        assert_eq!(store.journal_len().unwrap(), 0);
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
    fn rejects_stale_workspace_generations_without_overwriting_the_snapshot() {
        let path = temp_database("generation");
        let store = HostStore::open(&path).unwrap();
        store
            .commit_workspace(
                StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
                "request-1",
            )
            .unwrap();
        assert_eq!(
            store.commit_workspace(
                StoredWorkspace::new("workspace-1", r"C:\workspaces\other", "failed", 4),
                "request-2",
            ),
            Err(StoreError::GenerationConflict {
                current: 4,
                requested: 4,
            })
        );
        assert_eq!(
            store.snapshot().unwrap(),
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

    #[test]
    fn refuses_a_newer_schema_instead_of_rewriting_it_as_current() {
        let path = temp_database("future-schema");
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.pragma_update(None, "user_version", 9).unwrap();
        drop(connection);

        assert!(matches!(
            HostStore::open(&path),
            Err(StoreError::UnsupportedSchema {
                version: 9,
                current: 2
            })
        ));
        std::fs::remove_file(path).unwrap();
    }
}
