use std::convert::TryFrom;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub path: String,
    pub status: String,
    pub generation: u64,
}

impl StoredWorkspace {
    pub fn new(
        workspace_id: impl Into<String>,
        path: impl Into<String>,
        status: impl Into<String>,
        generation: u64,
    ) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            path: path.into(),
            status: status.into(),
            generation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitResult {
    pub sequence: i64,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Sql(String),
    IdempotencyConflict,
    GenerationOutOfRange,
    GenerationConflict { current: u64, requested: u64 },
    UnsupportedSchema { version: i64, current: i64 },
}

impl From<rusqlite::Error> for StoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error.to_string())
    }
}

#[derive(Debug)]
struct JournalRow {
    sequence: i64,
    request_id: String,
    workspace: StoredWorkspace,
}

pub struct HostStore {
    connection: Mutex<Connection>,
}

impl HostStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let schema_version = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if schema_version > CURRENT_SCHEMA_VERSION {
            return Err(StoreError::UnsupportedSchema {
                version: schema_version,
                current: CURRENT_SCHEMA_VERSION,
            });
        }
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE IF NOT EXISTS workspace_snapshot (
                 workspace_id TEXT PRIMARY KEY NOT NULL,
                 path TEXT NOT NULL,
                 status TEXT NOT NULL,
                 generation INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workspace_journal (
                 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                 request_id TEXT NOT NULL UNIQUE,
                 workspace_id TEXT NOT NULL,
                 path TEXT NOT NULL,
                 status TEXT NOT NULL,
                 generation INTEGER NOT NULL
             );
             ",
        )?;
        if schema_version < CURRENT_SCHEMA_VERSION {
            connection.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
        }
        connection.execute_batch("COMMIT;")?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn schema_version(&self) -> Result<i64, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Sql(String::from("store lock poisoned")))?;
        Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    pub fn commit_workspace(
        &self,
        workspace: StoredWorkspace,
        request_id: &str,
    ) -> Result<CommitResult, StoreError> {
        let generation =
            i64::try_from(workspace.generation).map_err(|_| StoreError::GenerationOutOfRange)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Sql(String::from("store lock poisoned")))?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT sequence, request_id, workspace_id, path, status, generation
                 FROM workspace_journal WHERE request_id = ?1",
                params![request_id],
                |row| {
                    Ok(JournalRow {
                        sequence: row.get(0)?,
                        request_id: row.get(1)?,
                        workspace: StoredWorkspace {
                            workspace_id: row.get(2)?,
                            path: row.get(3)?,
                            status: row.get(4)?,
                            generation: row
                                .get::<_, i64>(5)?
                                .try_into()
                                .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(5, 0))?,
                        },
                    })
                },
            )
            .optional()?;
        if let Some(existing) = existing {
            if existing.request_id == request_id && existing.workspace == workspace {
                transaction.commit()?;
                return Ok(CommitResult {
                    sequence: existing.sequence,
                    changed: false,
                });
            }
            return Err(StoreError::IdempotencyConflict);
        }

        let current_generation = transaction
            .query_row(
                "SELECT generation FROM workspace_snapshot WHERE workspace_id = ?1",
                params![&workspace.workspace_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        if let Some(current_generation) = current_generation {
            let current_generation =
                u64::try_from(current_generation).map_err(|_| StoreError::GenerationOutOfRange)?;
            if current_generation >= workspace.generation {
                return Err(StoreError::GenerationConflict {
                    current: current_generation,
                    requested: workspace.generation,
                });
            }
        }

        transaction.execute(
            "INSERT INTO workspace_snapshot (workspace_id, path, status, generation)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(workspace_id) DO UPDATE SET
                 path = excluded.path,
                 status = excluded.status,
                 generation = excluded.generation",
            params![
                workspace.workspace_id,
                workspace.path,
                workspace.status,
                generation
            ],
        )?;
        transaction.execute(
            "INSERT INTO workspace_journal
                (request_id, workspace_id, path, status, generation)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                request_id,
                workspace.workspace_id,
                workspace.path,
                workspace.status,
                generation
            ],
        )?;
        let sequence = transaction.last_insert_rowid();
        transaction.commit()?;
        Ok(CommitResult {
            sequence,
            changed: true,
        })
    }

    pub fn snapshot(&self) -> Result<Vec<StoredWorkspace>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Sql(String::from("store lock poisoned")))?;
        let mut statement = connection.prepare(
            "SELECT workspace_id, path, status, generation
             FROM workspace_snapshot ORDER BY workspace_id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(StoredWorkspace {
                workspace_id: row.get(0)?,
                path: row.get(1)?,
                status: row.get(2)?,
                generation: row
                    .get::<_, i64>(3)?
                    .try_into()
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(3, 0))?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn journal_len(&self) -> Result<i64, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Sql(String::from("store lock poisoned")))?;
        Ok(
            connection.query_row("SELECT COUNT(*) FROM workspace_journal", [], |row| {
                row.get(0)
            })?,
        )
    }
}
