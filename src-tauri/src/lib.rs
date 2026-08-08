mod pty_host_state;
mod terminal_contract;

use ade_host_core::protocol::{
    FileOperation, FileRequest, GitOperation, GitRequest, PtyRequest as HostPtyRequest,
    TerminalRequest, HOST_CAPABILITIES, PROTOCOL_VERSION,
};
use ade_host_platform::file_service::FileService;
use ade_host_platform::git_capability::GitCapabilityRegistry;
use ade_host_platform::git_execution::ProcessGitCommandExecutor;
use ade_host_platform::git_protocol_execution::execute_git_request;
use ade_host_platform::{git_worktree::GitWorktree, ExecutionTarget};
use ade_host_store::store::{
    HostStore, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind, StoredWorkspaceLocation,
};
use pty_host_state::{TauriPtyHostError, TauriPtyHostState};
use serde::Serialize;
use terminal_contract::{execute_terminal_request, TerminalExecutionState};

#[derive(Default)]
struct GitExecutionState {
    capability_registry: GitCapabilityRegistry,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriHostProtocol {
    version: u16,
    capabilities: Vec<&'static str>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriWorkspaceLocation {
    kind: &'static str,
    target: &'static str,
    identity: Option<String>,
    path: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriWorkspaceStatus {
    workspace_id: String,
    path: String,
    status: String,
    generation: u64,
    location: Option<TauriWorkspaceLocation>,
}

impl From<&StoredWorkspace> for TauriWorkspaceStatus {
    fn from(workspace: &StoredWorkspace) -> Self {
        let location = workspace.location.as_ref().map(|location| {
            let kind = match location.kind {
                StoredWorkspaceKind::Folder => "folder",
                StoredWorkspaceKind::GitWorktree => "git-worktree",
            };
            let (target, identity) = match &location.target {
                StoredExecutionTarget::WindowsNative => ("windows-native", None),
                StoredExecutionTarget::Wsl2 { distro } => ("wsl2", Some(distro.clone())),
                StoredExecutionTarget::Ssh { host } => ("ssh", Some(host.clone())),
            };
            TauriWorkspaceLocation {
                kind,
                target,
                identity,
                path: location.path.clone(),
            }
        });
        Self {
            workspace_id: workspace.workspace_id.clone(),
            path: workspace.path.clone(),
            status: workspace.status.clone(),
            generation: workspace.generation,
            location,
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TauriHostStatus {
    service: &'static str,
    workspace_count: usize,
    ready_workspaces: usize,
    source: &'static str,
    workspaces: Vec<TauriWorkspaceStatus>,
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
        workspaces: snapshot.iter().map(TauriWorkspaceStatus::from).collect(),
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

pub fn render_file_request(
    request_id: &str,
    operation: &str,
    path: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let request = match operation {
        "read" => FileRequest::read(request_id, path),
        "write" => FileRequest::write(request_id, path, bytes),
        value => return Err(format!("unsupported file operation: {value}")),
    };
    request.validate().map_err(|error| format!("{error:?}"))?;
    serde_json::to_string(&request).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriFileResult {
    request_id: String,
    capability: &'static str,
    operation: &'static str,
    path: String,
    bytes: Vec<u8>,
    bytes_written: usize,
    changed: bool,
}

fn execute_file_request(request: &FileRequest) -> Result<String, String> {
    request.validate().map_err(|error| format!("{error:?}"))?;
    match &request.operation {
        FileOperation::Read { path } => {
            let result = FileService::read(path).map_err(|error| format!("{error:?}"))?;
            serde_json::to_string(&TauriFileResult {
                request_id: request.envelope.request_id.clone(),
                capability: "file",
                operation: "read",
                path: result.path.to_string_lossy().into_owned(),
                bytes_written: 0,
                bytes: result.bytes,
                changed: false,
            })
            .map_err(|error| error.to_string())
        }
        FileOperation::Write { path, bytes } => {
            let result =
                FileService::write_atomic(path, bytes).map_err(|error| format!("{error:?}"))?;
            serde_json::to_string(&TauriFileResult {
                request_id: request.envelope.request_id.clone(),
                capability: "file",
                operation: "write",
                path: result.path.to_string_lossy().into_owned(),
                bytes_written: result.bytes_written,
                bytes: Vec::new(),
                changed: result.changed,
            })
            .map_err(|error| error.to_string())
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct TauriGitWorktreeResult {
    request_id: String,
    capability: &'static str,
    operation: &'static str,
    worktrees: Vec<GitWorktree>,
}

fn require_remote_identity(identity: Option<String>, message: &str) -> Result<String, String> {
    let identity = identity.ok_or_else(|| String::from(message))?;
    if identity.trim().is_empty() {
        Err(String::from(message))
    } else {
        Ok(identity)
    }
}

fn parse_git_execution_target(
    target: &str,
    remote_identity: Option<String>,
) -> Result<ExecutionTarget, String> {
    match target {
        "windows-native" if remote_identity.is_none() => Ok(ExecutionTarget::WindowsNative),
        "windows-native" => Err(String::from("native target cannot have a remote identity")),
        "wsl2" => Ok(ExecutionTarget::Wsl2 {
            distro: require_remote_identity(remote_identity, "WSL2 distro is required")?,
        }),
        "ssh" => Ok(ExecutionTarget::Ssh {
            host: require_remote_identity(remote_identity, "SSH host is required")?,
        }),
        value => Err(format!("unsupported execution target: {value}")),
    }
}

fn execute_git_worktree_request(
    request_id: &str,
    path: &str,
    target: &str,
    remote_identity: Option<String>,
    capability_registry: &GitCapabilityRegistry,
) -> Result<String, String> {
    let request = GitRequest::worktree_list(request_id, path);
    let target = parse_git_execution_target(target, remote_identity)?;
    let worktrees = execute_git_request(
        &request,
        &target,
        capability_registry,
        &ProcessGitCommandExecutor,
    )
    .map_err(|error| format!("{error:?}"))?;
    serde_json::to_string(&TauriGitWorktreeResult {
        request_id: request_id.to_string(),
        capability: "git",
        operation: "worktree-list",
        worktrees,
    })
    .map_err(|error| error.to_string())
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
            distro: require_remote_identity(identity, "WSL2 distro is required")?,
        },
        Some("ssh") => StoredExecutionTarget::Ssh {
            host: require_remote_identity(identity, "SSH host is required")?,
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

#[tauri::command]
fn file_request(
    request_id: String,
    operation: String,
    path: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let request = match operation.as_str() {
        "read" => FileRequest::read(request_id, path),
        "write" => FileRequest::write(request_id, path, bytes),
        value => return Err(format!("unsupported file operation: {value}")),
    };
    execute_file_request(&request)
}

#[tauri::command]
fn terminal_request(
    request: TerminalRequest,
    state: tauri::State<'_, TerminalExecutionState>,
) -> Result<String, String> {
    execute_terminal_request(&request, &state)
}

#[tauri::command]
fn pty_host_status(
    state: tauri::State<'_, TauriPtyHostState>,
) -> Result<String, TauriPtyHostError> {
    state.status_json()
}

#[tauri::command]
fn claim_pty_workspace(
    request_id: String,
    workspace_id: String,
    state: tauri::State<'_, TauriPtyHostState>,
) -> Result<String, TauriPtyHostError> {
    state.claim_workspace_json(&request_id, &workspace_id)
}

#[tauri::command]
fn pty_request(
    request: HostPtyRequest,
    state: tauri::State<'_, TauriPtyHostState>,
) -> Result<String, TauriPtyHostError> {
    state.route_json(request)
}

#[tauri::command]
fn git_worktree_list(
    request_id: String,
    path: String,
    execution_target: String,
    remote_identity: Option<String>,
    state: tauri::State<'_, GitExecutionState>,
) -> Result<String, String> {
    execute_git_worktree_request(
        &request_id,
        &path,
        &execution_target,
        remote_identity,
        &state.capability_registry,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(GitExecutionState::default())
        .manage(TerminalExecutionState::default())
        .manage(TauriPtyHostState::start())
        .invoke_handler(tauri::generate_handler![
            host_status,
            register_workspace,
            git_request,
            git_worktree_list,
            file_request,
            terminal_request,
            pty_host_status,
            claim_pty_workspace,
            pty_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running ADE Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        execute_file_request, execute_git_worktree_request, parse_git_execution_target,
        parse_workspace_location, register_host_workspace, register_host_workspace_with_location,
        render_file_request, render_git_request, render_host_status, FileRequest,
    };
    use ade_host_platform::git_capability::GitCapabilityRegistry;
    use ade_host_platform::ExecutionTarget;
    use ade_host_store::store::{
        HostStore, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind,
        StoredWorkspaceLocation,
    };

    #[test]
    fn renders_the_same_authoritative_host_status_as_other_clients() {
        let snapshot = vec![
            StoredWorkspace::new("workspace-1", r"C:\\workspaces\\one", "ready", 4).with_location(
                StoredWorkspaceLocation::new(
                    StoredWorkspaceKind::Folder,
                    StoredExecutionTarget::WindowsNative,
                    r"C:\\workspaces\\one",
                ),
            ),
            StoredWorkspace::new("workspace-2", "/home/dev/two", "starting", 5).with_location(
                StoredWorkspaceLocation::new(
                    StoredWorkspaceKind::GitWorktree,
                    StoredExecutionTarget::Wsl2 {
                        distro: String::from("Ubuntu-22.04"),
                    },
                    "/home/dev/two",
                ),
            ),
        ];
        assert_eq!(
            render_host_status(&snapshot).expect("status must serialize"),
            r#"{"service":"ade-host","workspace_count":2,"ready_workspaces":1,"source":"sqlite-snapshot","workspaces":[{"workspace_id":"workspace-1","path":"C:\\\\workspaces\\\\one","status":"ready","generation":4,"location":{"kind":"folder","target":"windows-native","identity":null,"path":"C:\\\\workspaces\\\\one"}},{"workspace_id":"workspace-2","path":"/home/dev/two","status":"starting","generation":5,"location":{"kind":"git-worktree","target":"wsl2","identity":"Ubuntu-22.04","path":"/home/dev/two"}}],"hostProtocol":{"version":1,"capabilities":["workspace.read","workspace.write","terminal","pty","git","file"]}}"#
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
    fn renders_a_stable_file_request_for_mobile_and_web_hosts() {
        assert_eq!(
            render_file_request(
                "request-file",
                "write",
                r"C:\workspaces\file.txt",
                vec![1, 2],
            )
            .expect("file request must serialize"),
            r#"{"envelope":{"request_id":"request-file","capability":"file","protocol_version":1},"operation":{"type":"write","path":"C:\\workspaces\\file.txt","bytes":[1,2]}}"#
        );
    }

    #[test]
    fn executes_file_requests_and_returns_authoritative_state() {
        let path = std::env::temp_dir().join(format!(
            "ade-tauri-file-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ));
        let request = FileRequest::write(
            "request-file",
            path.to_string_lossy().into_owned(),
            vec![1, 2],
        );
        assert_eq!(
            execute_file_request(&request).expect("file write should succeed"),
            format!(
                "{{\"request_id\":\"request-file\",\"capability\":\"file\",\"operation\":\"write\",\"path\":{},\"bytes\":[],\"bytes_written\":2,\"changed\":true}}",
                serde_json::to_string(&path.to_string_lossy()).expect("path should serialize")
            )
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_git_operations_before_they_reach_the_host() {
        assert_eq!(
            render_git_request("request-7", "status", "/repo"),
            Err(String::from("unsupported git operation: status"))
        );
    }

    #[test]
    fn parses_git_execution_targets_without_local_only_fallbacks() {
        assert_eq!(
            parse_git_execution_target("windows-native", None).expect("native target"),
            ExecutionTarget::WindowsNative
        );
        assert_eq!(
            parse_git_execution_target("wsl2", Some(String::from("Ubuntu-22.04")))
                .expect("WSL2 target"),
            ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-22.04")
            }
        );
        assert_eq!(
            parse_git_execution_target("ssh", Some(String::from("builder"))).expect("SSH target"),
            ExecutionTarget::Ssh {
                host: String::from("builder")
            }
        );
        assert_eq!(
            parse_git_execution_target("windows-native", Some(String::from("unexpected"))),
            Err(String::from("native target cannot have a remote identity"))
        );
        assert_eq!(
            parse_git_execution_target("wsl2", Some(String::from("   "))),
            Err(String::from("WSL2 distro is required"))
        );
        assert_eq!(
            parse_git_execution_target("ssh", Some(String::new())),
            Err(String::from("SSH host is required"))
        );
    }

    #[test]
    fn rejects_blank_remote_workspace_location_identities() {
        assert_eq!(
            parse_workspace_location(
                "/repo",
                Some(String::from("folder")),
                Some(String::from("wsl2")),
                Some(String::from(" \t ")),
            ),
            Err(String::from("WSL2 distro is required"))
        );
        assert_eq!(
            parse_workspace_location(
                "/repo",
                Some(String::from("git-worktree")),
                Some(String::from("ssh")),
                Some(String::new()),
            ),
            Err(String::from("SSH host is required"))
        );
    }

    #[test]
    fn rejects_an_empty_git_path_before_process_execution() {
        assert!(execute_git_worktree_request(
            "request-7",
            "  ",
            "windows-native",
            None,
            &GitCapabilityRegistry::new(),
        )
        .is_err());
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
