use std::convert::TryFrom;
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

const CURRENT_SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredWorkspaceKind {
    Folder,
    GitWorktree,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredExecutionTarget {
    WindowsNative,
    Wsl2 { distro: String },
    Ssh { host: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspaceLocation {
    pub kind: StoredWorkspaceKind,
    pub target: StoredExecutionTarget,
    pub path: String,
}

impl StoredWorkspaceLocation {
    pub fn new(
        kind: StoredWorkspaceKind,
        target: StoredExecutionTarget,
        path: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            target,
            path: path.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub path: String,
    pub status: String,
    pub generation: u64,
    pub location: Option<StoredWorkspaceLocation>,
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
            location: None,
        }
    }

    pub fn with_location(mut self, location: StoredWorkspaceLocation) -> Self {
        self.location = Some(location);
        self
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
    InvalidLocation(String),
    UnsupportedSchema { version: i64, current: i64 },
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for StoreError {}

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

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), StoreError> {
    let exists = connection
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .any(|name| name == column);
    if !exists {
        connection.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn location_columns(
    location: Option<&StoredWorkspaceLocation>,
) -> (Option<&str>, Option<&str>, Option<&str>, Option<&str>) {
    match location {
        None => (None, None, None, None),
        Some(location) => {
            let kind = match location.kind {
                StoredWorkspaceKind::Folder => "folder",
                StoredWorkspaceKind::GitWorktree => "git-worktree",
            };
            match &location.target {
                StoredExecutionTarget::WindowsNative => (
                    Some(kind),
                    Some("windows-native"),
                    None,
                    Some(&location.path),
                ),
                StoredExecutionTarget::Wsl2 { distro } => {
                    (Some(kind), Some("wsl2"), Some(distro), Some(&location.path))
                }
                StoredExecutionTarget::Ssh { host } => {
                    (Some(kind), Some("ssh"), Some(host), Some(&location.path))
                }
            }
        }
    }
}

fn validate_workspace_location(workspace: &StoredWorkspace) -> Result<(), StoreError> {
    let Some(location) = workspace.location.as_ref() else {
        return Ok(());
    };
    if location.path.trim().is_empty() || location.path != workspace.path {
        return Err(StoreError::InvalidLocation(String::from(
            "location path must equal workspace path",
        )));
    }
    match &location.target {
        StoredExecutionTarget::WindowsNative => {}
        StoredExecutionTarget::Wsl2 { distro } if distro.trim().is_empty() => {
            return Err(StoreError::InvalidLocation(String::from("empty distro")));
        }
        StoredExecutionTarget::Ssh { host } if host.trim().is_empty() => {
            return Err(StoreError::InvalidLocation(String::from("empty host")));
        }
        StoredExecutionTarget::Wsl2 { .. } | StoredExecutionTarget::Ssh { .. } => {}
    }
    Ok(())
}

fn decode_location(
    kind: Option<String>,
    target: Option<String>,
    identity: Option<String>,
    path: Option<String>,
) -> Result<Option<StoredWorkspaceLocation>, StoreError> {
    let fields_present = kind.is_some() || target.is_some() || identity.is_some() || path.is_some();
    if !fields_present {
        return Ok(None);
    }
    let kind = match kind.as_deref() {
        Some("folder") => StoredWorkspaceKind::Folder,
        Some("git-worktree") => StoredWorkspaceKind::GitWorktree,
        Some(value) => return Err(StoreError::InvalidLocation(value.to_string())),
        None => return Err(StoreError::InvalidLocation(String::from("missing kind"))),
    };
    let target = match target.as_deref() {
        Some("windows-native") if identity.is_none() => StoredExecutionTarget::WindowsNative,
        Some("wsl2") => StoredExecutionTarget::Wsl2 {
            distro: identity
                .ok_or_else(|| StoreError::InvalidLocation(String::from("missing distro")))?,
        },
        Some("ssh") => StoredExecutionTarget::Ssh {
            host: identity
                .ok_or_else(|| StoreError::InvalidLocation(String::from("missing host")))?,
        },
        Some(value) => return Err(StoreError::InvalidLocation(value.to_string())),
        None => return Err(StoreError::InvalidLocation(String::from("missing target"))),
    };
    let path = path.ok_or_else(|| StoreError::InvalidLocation(String::from("missing path")))?;
    Ok(Some(StoredWorkspaceLocation { kind, target, path }))
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
             CREATE TABLE IF NOT EXISTS workspace_location (
                 workspace_id TEXT PRIMARY KEY NOT NULL,
                 kind TEXT NOT NULL,
                 target TEXT NOT NULL,
                 identity TEXT,
                 path TEXT NOT NULL,
                 FOREIGN KEY(workspace_id) REFERENCES workspace_snapshot(workspace_id)
             );
             CREATE TABLE IF NOT EXISTS workspace_journal (
                 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                 request_id TEXT NOT NULL UNIQUE,
                 workspace_id TEXT NOT NULL,
                 path TEXT NOT NULL,
                 status TEXT NOT NULL,
                 generation INTEGER NOT NULL
             );",
        )?;
        ensure_column(&connection, "workspace_journal", "location_kind", "TEXT")?;
        ensure_column(&connection, "workspace_journal", "location_target", "TEXT")?;
        ensure_column(
            &connection,
            "workspace_journal",
            "location_identity",
            "TEXT",
        )?;
        ensure_column(&connection, "workspace_journal", "location_path", "TEXT")?;
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
        validate_workspace_location(&workspace)?;
        let generation =
            i64::try_from(workspace.generation).map_err(|_| StoreError::GenerationOutOfRange)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Sql(String::from("store lock poisoned")))?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT sequence, request_id, workspace_id, path, status, generation,
                        location_kind, location_target, location_identity, location_path
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
                            location: decode_location(
                                row.get(6)?,
                                row.get(7)?,
                                row.get(8)?,
                                row.get(9)?,
                            )
                            .map_err(|error| {
                                rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                            })?,
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

        let (location_kind, location_target, location_identity, location_path) =
            location_columns(workspace.location.as_ref());

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
        match workspace.location.as_ref() {
            Some(location) => {
                transaction.execute(
                    "INSERT INTO workspace_location
                        (workspace_id, kind, target, identity, path)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(workspace_id) DO UPDATE SET
                         kind = excluded.kind,
                         target = excluded.target,
                         identity = excluded.identity,
                         path = excluded.path",
                    params![
                        &workspace.workspace_id,
                        location_kind,
                        location_target,
                        location_identity,
                        &location.path,
                    ],
                )?;
            }
            None => {
                transaction.execute(
                    "DELETE FROM workspace_location WHERE workspace_id = ?1",
                    params![&workspace.workspace_id],
                )?;
            }
        }
        transaction.execute(
            "INSERT INTO workspace_journal
                (request_id, workspace_id, path, status, generation,
                 location_kind, location_target, location_identity, location_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                request_id,
                &workspace.workspace_id,
                &workspace.path,
                &workspace.status,
                generation,
                location_kind,
                location_target,
                location_identity,
                location_path,
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
            "SELECT snapshot.workspace_id, snapshot.path, snapshot.status, snapshot.generation,
                    location.kind, location.target, location.identity, location.path
             FROM workspace_snapshot AS snapshot
             LEFT JOIN workspace_location AS location
               ON location.workspace_id = snapshot.workspace_id
             ORDER BY snapshot.workspace_id",
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
                location: decode_location(row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?,
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
