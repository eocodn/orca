use ade_host_core::host_runtime::HostSnapshot;
use ade_host_store::store::StoredWorkspace;
use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub struct HostCliOptions {
    pub json: bool,
    pub state_db: Option<PathBuf>,
    pub register_workspace: Option<WorkspaceRegistration>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct WorkspaceRegistration {
    pub workspace_id: String,
    pub path: String,
    pub request_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HostCliError {
    MissingStateDbPath,
    MissingWorkspaceId,
    MissingWorkspacePath,
    MissingRequestId,
    IncompleteWorkspaceRegistration,
    RegistrationRequiresStateDb,
    UnexpectedArgument(String),
    StateStore(String),
    Runtime(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<HostCliOptions, HostCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut state_db = None;
    let mut workspace_id = None;
    let mut workspace_path = None;
    let mut request_id = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => json = true,
            "--state-db" => {
                let path = args.next().ok_or(HostCliError::MissingStateDbPath)?;
                if path.is_empty() {
                    return Err(HostCliError::MissingStateDbPath);
                }
                state_db = Some(PathBuf::from(path));
            }
            "--register-workspace" => {
                let id = args.next().ok_or(HostCliError::MissingWorkspaceId)?;
                if id.is_empty() {
                    return Err(HostCliError::MissingWorkspaceId);
                }
                workspace_id = Some(id);
            }
            "--workspace-path" => {
                let path = args.next().ok_or(HostCliError::MissingWorkspacePath)?;
                if path.trim().is_empty() {
                    return Err(HostCliError::MissingWorkspacePath);
                }
                workspace_path = Some(path);
            }
            "--request-id" => {
                let request = args.next().ok_or(HostCliError::MissingRequestId)?;
                if request.is_empty() {
                    return Err(HostCliError::MissingRequestId);
                }
                request_id = Some(request);
            }
            _ => return Err(HostCliError::UnexpectedArgument(argument)),
        }
    }
    let register_workspace = match (workspace_id, workspace_path, request_id) {
        (None, None, None) => None,
        (Some(workspace_id), Some(path), Some(request_id)) => Some(WorkspaceRegistration {
            workspace_id,
            path,
            request_id,
        }),
        _ => return Err(HostCliError::IncompleteWorkspaceRegistration),
    };
    Ok(HostCliOptions {
        json,
        state_db,
        register_workspace,
    })
}

pub fn run_cli<I, S>(args: I) -> Result<String, HostCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let HostCliOptions {
        json,
        state_db,
        register_workspace,
    } = parse_cli_args(args)?;
    if let Some(path) = state_db {
        let store = ade_host_store::store::HostStore::open(path)
            .map_err(|error| HostCliError::StateStore(format!("{error:?}")))?;
        if let Some(registration) = register_workspace {
            store
                .commit_workspace(
                    StoredWorkspace::new(
                        registration.workspace_id,
                        registration.path,
                        "registered",
                        1,
                    ),
                    &registration.request_id,
                )
                .map_err(|error| HostCliError::StateStore(format!("{error:?}")))?;
        }
        let snapshot = store
            .snapshot()
            .map_err(|error| HostCliError::StateStore(format!("{error:?}")))?;
        return if json {
            Ok(render_persisted_status_json(&snapshot))
        } else {
            Ok(format!("ade-host persisted workspaces={}", snapshot.len()))
        };
    }

    if register_workspace.is_some() {
        return Err(HostCliError::RegistrationRequiresStateDb);
    }

    let snapshot = ade_host_core::host_runtime::HostRuntime::new()
        .snapshot()
        .map_err(|error| HostCliError::Runtime(format!("{error:?}")))?;
    if json {
        Ok(render_status_json(&snapshot))
    } else {
        Ok(format!("ade-host ready generation={}", snapshot.generation))
    }
}

pub fn render_status_json(snapshot: &HostSnapshot) -> String {
    format!(
        "{{\"service\":\"ade-host\",\"generation\":{},\"workspace_count\":{},\"ready_workspaces\":{}}}",
        snapshot.generation, snapshot.workspace_count, snapshot.ready_workspaces
    )
}

pub fn render_persisted_status_json(snapshot: &[StoredWorkspace]) -> String {
    let ready_workspaces = snapshot
        .iter()
        .filter(|workspace| workspace.status == "ready")
        .count();
    format!(
        "{{\"service\":\"ade-host\",\"workspace_count\":{},\"ready_workspaces\":{},\"source\":\"sqlite-snapshot\"}}",
        snapshot.len(), ready_workspaces
    )
}

#[cfg(test)]
mod tests {
    use super::{
        parse_cli_args, render_persisted_status_json, render_status_json, run_cli, HostCliError,
        HostCliOptions, WorkspaceRegistration,
    };
    use ade_host_core::host_runtime::HostSnapshot;
    use ade_host_store::store::StoredWorkspace;
    use std::path::PathBuf;

    #[test]
    fn parses_machine_observable_state_database_option() {
        assert_eq!(
            parse_cli_args(["--json", "--state-db", "C:\\ade\\state.db"]),
            Ok(HostCliOptions {
                json: true,
                state_db: Some(PathBuf::from(r"C:\ade\state.db")),
                register_workspace: None,
            })
        );
    }

    #[test]
    fn parses_idempotent_workspace_registration_arguments() {
        assert_eq!(
            parse_cli_args([
                "--json",
                "--state-db",
                r"C:\ade\state.db",
                "--register-workspace",
                "workspace-1",
                "--workspace-path",
                r"C:\workspaces\one",
                "--request-id",
                "request-1",
            ]),
            Ok(HostCliOptions {
                json: true,
                state_db: Some(PathBuf::from(r"C:\ade\state.db")),
                register_workspace: Some(WorkspaceRegistration {
                    workspace_id: String::from("workspace-1"),
                    path: String::from(r"C:\workspaces\one"),
                    request_id: String::from("request-1"),
                }),
            })
        );
    }

    #[test]
    fn rejects_state_database_without_a_path() {
        assert_eq!(
            parse_cli_args(["--state-db"]),
            Err(HostCliError::MissingStateDbPath)
        );
    }

    #[test]
    fn rejects_unknown_arguments_instead_of_silently_falling_back() {
        assert_eq!(
            parse_cli_args(["--legacy-mode"]),
            Err(HostCliError::UnexpectedArgument(String::from(
                "--legacy-mode"
            )))
        );
    }

    #[test]
    fn reports_empty_persisted_state_as_json() {
        let path = std::env::temp_dir().join(format!("ade-host-cli-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let output = run_cli([
            String::from("--json"),
            String::from("--state-db"),
            path.to_string_lossy().into_owned(),
        ])
        .expect("state database should be observable");
        assert_eq!(
            output,
            r#"{"service":"ade-host","workspace_count":0,"ready_workspaces":0,"source":"sqlite-snapshot"}"#
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn registers_workspace_in_the_authoritative_snapshot_and_replays_request() {
        let path = std::env::temp_dir().join(format!(
            "ade-host-cli-register-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ));
        let args = || {
            vec![
                String::from("--json"),
                String::from("--state-db"),
                path.to_string_lossy().into_owned(),
                String::from("--register-workspace"),
                String::from("workspace-1"),
                String::from("--workspace-path"),
                String::from(r"C:\workspaces\one"),
                String::from("--request-id"),
                String::from("request-1"),
            ]
        };
        let first = run_cli(args()).expect("registration should persist");
        let replay = run_cli(args()).expect("registration replay should be idempotent");
        assert_eq!(first, replay);
        assert_eq!(
            first,
            r#"{"service":"ade-host","workspace_count":1,"ready_workspaces":0,"source":"sqlite-snapshot"}"#
        );
        let store = ade_host_store::store::HostStore::open(&path).expect("store should reopen");
        assert_eq!(
            store.snapshot().expect("snapshot should be readable").len(),
            1
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn renders_machine_observable_host_status() {
        let snapshot = HostSnapshot {
            generation: 3,
            workspace_count: 2,
            ready_workspaces: 1,
        };
        assert_eq!(
            render_status_json(&snapshot),
            r#"{"service":"ade-host","generation":3,"workspace_count":2,"ready_workspaces":1}"#
        );
    }

    #[test]
    fn renders_authoritative_persisted_workspace_status() {
        let snapshot = vec![
            StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
            StoredWorkspace::new("workspace-2", r"C:\workspaces\two", "starting", 5),
        ];
        assert_eq!(
            render_persisted_status_json(&snapshot),
            r#"{"service":"ade-host","workspace_count":2,"ready_workspaces":1,"source":"sqlite-snapshot"}"#
        );
    }
}
