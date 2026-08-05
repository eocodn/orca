use ade_host_core::protocol::{GitOperation, GitRequest, HOST_CAPABILITIES, PROTOCOL_VERSION};
use ade_host_store::store::{
    HostStore, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind, StoredWorkspaceLocation,
};
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriHostProtocol {
    version: u16,
    capabilities: Vec<&'static str>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TauriHostStatus {
    service: &'static str,
    workspace_count: usize,
    ready_workspaces: usize,
    source: &'static str,
    #[serde(rename = "hostProtocol")]
    host_protocol: TauriHostProtocol,
}

pub fn render_host_status(snapshot: &[StoredWorkspace]) -> Result<String, serde_json::Error> {
    let status = TauriHostStatus {
        service: "ade-host",
        workspace_count: snapshot.len(),
        ready_workspaces: snapshot
            .iter()
            .filter(|workspace| workspace.status == "ready")
            .count(),
        source: "sqlite-snapshot",
        host_protocol: TauriHostProtocol {
            version: PROTOCOL_VERSION,
            capabilities: HOST_CAPABILITIES
                .iter()
                .map(|capability| capability.wire_name())
                .collect(),
        },
    };
    serde_json::to_string(&status)
}

pub fn render_git_request(request_id: &str, operation: &str, path: &str) -> Result<String, String> {
    let operation = match operation {
        "worktree-list" => GitOperation::WorktreeList {
            repository_path: String::from(path),
        },
        "repository-git-dir" => GitOperation::RepositoryGitDir {
            path: String::from(path),
        },
        value => return Err(format!("unsupported git operation: {value}")),
    };
    let request = GitRequest::new(request_id, operation, PROTOCOL_VERSION);
    request.validate().map_err(|error| format!("{error:?}"))?;
    serde_json::to_string(&request).map_err(|error| error.to_string())
}

pub fn register_host_workspace(
    store: &HostStore,
    workspace_id: impl Into<String>,
    path: impl Into<String>,
    request_id: &str,
) -> Result<Vec<StoredWorkspace>, ade_host_store::store::StoreError> {
    register_host_workspace_with_location(store, workspace_id, path, request_id, None)
}

pub fn register_host_workspace_with_location(
    store: &HostStore,
    workspace_id: impl Into<String>,
    path: impl Into<String>,
    request_id: &str,
    location: Option<StoredWorkspaceLocation>,
) -> Result<Vec<StoredWorkspace>, ade_host_store::store::StoreError> {
    let workspace = StoredWorkspace::new(workspace_id, path, "registered", 1);
    let workspace = match location {
        Some(location) => workspace.with_location(location),
        None => workspace,
    };
    store.commit_workspace(workspace, request_id)?;
    store.snapshot()
}

fn parse_workspace_location(
    path: &str,
    kind: Option<String>,
    target: Option<String>,
    identity: Option<String>,
) -> Result<Option<StoredWorkspaceLocation>, String> {
    if kind.is_none() && target.is_none() && identity.is_none() {
        return Ok(None);
    }
    let kind = match kind.as_deref() {
        Some("folder") => StoredWorkspaceKind::Folder,
        Some("git-worktree") => StoredWorkspaceKind::GitWorktree,
        Some(value) => return Err(format!("unsupported workspace kind: {value}")),
        None => return Err(String::from("workspace kind is required")),
    };
    let target = match target.as_deref() {
        Some("windows-native") if identity.is_none() => StoredExecutionTarget::WindowsNative,
        Some("wsl2") => StoredExecutionTarget::Wsl2 {
            distro: identity.ok_or_else(|| String::from("WSL2 distro is required"))?,
        },
        Some("ssh") => StoredExecutionTarget::Ssh {
            host: identity.ok_or_else(|| String::from("SSH host is required"))?,
        },
        Some("windows-native") => {
            return Err(String::from("native target cannot have a remote identity"))
        }
        Some(value) => return Err(format!("unsupported execution target: {value}")),
        None => return Err(String::from("execution target is required")),
    };
    Ok(Some(StoredWorkspaceLocation::new(kind, target, path)))
}

#[tauri::command]
fn host_status(state_db: String) -> Result<String, String> {
    let store = HostStore::open(state_db).map_err(|error| format!("{error:?}"))?;
    let snapshot = store.snapshot().map_err(|error| format!("{error:?}"))?;
    render_host_status(&snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn register_workspace(
    state_db: String,
    workspace_id: String,
    path: String,
    request_id: String,
    workspace_kind: Option<String>,
    execution_target: Option<String>,
    remote_identity: Option<String>,
) -> Result<String, String> {
    let store = HostStore::open(state_db).map_err(|error| format!("{error:?}"))?;
    let location =
        parse_workspace_location(&path, workspace_kind, execution_target, remote_identity)?;
    let snapshot =
        register_host_workspace_with_location(&store, workspace_id, path, &request_id, location)
            .map_err(|error| format!("{error:?}"))?;
    render_host_status(&snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn git_request(request_id: String, operation: String, path: String) -> Result<String, String> {
    render_git_request(&request_id, &operation, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            host_status,
            register_workspace,
            git_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running ADE Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        register_host_workspace, register_host_workspace_with_location, render_git_request,
        render_host_status,
    };
    use ade_host_store::store::{
        HostStore, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind,
        StoredWorkspaceLocation,
    };

    #[test]
    fn renders_the_same_authoritative_host_status_as_other_clients() {
        let snapshot = vec![
            StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
            StoredWorkspace::new("workspace-2", r"C:\workspaces\two", "starting", 5),
        ];
        assert_eq!(
            render_host_status(&snapshot).expect("status must serialize"),
            r#"{"service":"ade-host","workspace_count":2,"ready_workspaces":1,"source":"sqlite-snapshot","hostProtocol":{"version":1,"capabilities":["workspace.read","workspace.write","terminal","git"]}}"#
        );
    }

    #[test]
    fn renders_a_stable_git_request_for_mobile_and_web_hosts() {
        assert_eq!(
            render_git_request("request-7", "worktree-list", r"C:\workspaces\repo",)
                .expect("git request must serialize"),
            r#"{"envelope":{"request_id":"request-7","capability":"git","protocol_version":1},"operation":{"type":"worktree_list","repository_path":"C:\\workspaces\\repo"}}"#
        );
    }

    #[test]
    fn rejects_unknown_git_operations_before_they_reach_the_host() {
        assert_eq!(
            render_git_request("request-7", "status", "/repo"),
            Err(String::from("unsupported git operation: status"))
        );
    }

    #[test]
    fn registers_workspace_through_the_shared_host_store_boundary() {
        let path = std::env::temp_dir().join(format!(
            "ade-tauri-register-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ));
        let store = HostStore::open(&path).expect("store should open");
        let snapshot =
            register_host_workspace(&store, "workspace-1", r"C:\workspaces\one", "request-1")
                .expect("workspace should register");
        assert_eq!(snapshot.len(), 1);
        let replay =
            register_host_workspace(&store, "workspace-1", r"C:\workspaces\one", "request-1")
                .expect("replay should be idempotent");
        assert_eq!(replay, snapshot);
        drop(store);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn registers_workspace_location_through_the_shared_host_store_boundary() {
        let path = std::env::temp_dir().join(format!(
            "ade-tauri-register-location-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ));
        let store = HostStore::open(&path).expect("store should open");
        let location = StoredWorkspaceLocation::new(
            StoredWorkspaceKind::Folder,
            StoredExecutionTarget::Ssh {
                host: String::from("build.example"),
            },
            "/srv/project",
        );
        let snapshot = register_host_workspace_with_location(
            &store,
            "workspace-1",
            "/srv/project",
            "request-1",
            Some(location.clone()),
        )
        .expect("workspace should register");
        assert_eq!(snapshot[0].location, Some(location));
        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
