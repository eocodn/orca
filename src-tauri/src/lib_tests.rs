use super::{
    execute_file_request, execute_git_worktree_request, host_status, parse_git_execution_target,
    parse_workspace_location, register_host_workspace, register_host_workspace_with_location,
    register_workspace, render_file_request, render_git_request, render_host_status, FileRequest,
};
use ade_host_platform::git_capability::GitCapabilityRegistry;
use ade_host_platform::ExecutionTarget;
use ade_host_store::store::{
    HostStore, StoredExecutionTarget, StoredWorkspace, StoredWorkspaceKind, StoredWorkspaceLocation,
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
fn registers_all_workspace_target_cells_through_the_tauri_command() {
    let state_db = std::env::temp_dir().join(format!(
        "ade-tauri-workspace-matrix-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos()
    ));
    let state_db = state_db.to_string_lossy().into_owned();
    let cases = [
        (
            "folder-native",
            "folder",
            "windows-native",
            None,
            r"C:\workspaces\folder-native",
        ),
        (
            "folder-wsl",
            "folder",
            "wsl2",
            Some("Ubuntu-24.04"),
            "/home/dev/folder-wsl",
        ),
        (
            "folder-ssh",
            "folder",
            "ssh",
            Some("builder.example"),
            "/srv/folder-ssh",
        ),
        (
            "worktree-native",
            "git-worktree",
            "windows-native",
            None,
            r"C:\workspaces\worktree-native",
        ),
        (
            "worktree-wsl",
            "git-worktree",
            "wsl2",
            Some("Ubuntu-24.04"),
            "/home/dev/worktree-wsl",
        ),
        (
            "worktree-ssh",
            "git-worktree",
            "ssh",
            Some("builder.example"),
            "/srv/worktree-ssh",
        ),
    ];

    for (index, (workspace_id, kind, target, identity, path)) in cases.iter().enumerate() {
        let response = register_workspace(
            state_db.clone(),
            String::from(*workspace_id),
            String::from(*path),
            format!("request-{workspace_id}"),
            Some(String::from(*kind)),
            Some(String::from(*target)),
            identity.map(String::from),
        )
        .expect("workspace registration should succeed");
        let status: serde_json::Value =
            serde_json::from_str(&response).expect("status should deserialize");
        assert_eq!(status["workspace_count"], index + 1);
        let workspace = status["workspaces"]
            .as_array()
            .expect("workspaces should be an array")
            .iter()
            .find(|workspace| workspace["workspace_id"] == *workspace_id)
            .expect("registered workspace should be present");
        assert_eq!(workspace["path"], *path);
        assert_eq!(workspace["location"]["kind"], *kind);
        assert_eq!(workspace["location"]["target"], *target);
        assert_eq!(workspace["location"]["path"], *path);
        match identity {
            Some(identity) => assert_eq!(workspace["location"]["identity"], *identity),
            None => assert!(workspace["location"]["identity"].is_null()),
        }
    }

    let replay = register_workspace(
        state_db.clone(),
        String::from("worktree-ssh"),
        String::from("/srv/worktree-ssh"),
        String::from("request-worktree-ssh"),
        Some(String::from("git-worktree")),
        Some(String::from("ssh")),
        Some(String::from("builder.example")),
    )
    .expect("identical workspace registration replay should succeed");
    let replay: serde_json::Value =
        serde_json::from_str(&replay).expect("replay status should deserialize");
    assert_eq!(replay["workspace_count"], 6);

    let status = host_status(state_db.clone()).expect("host status should succeed");
    let status: serde_json::Value =
        serde_json::from_str(&status).expect("host status should deserialize");
    assert_eq!(status["workspace_count"], 6);
    assert_eq!(status["workspaces"].as_array().map(Vec::len), Some(6));

    let _ = std::fs::remove_file(&state_db);
    let _ = std::fs::remove_file(format!("{state_db}-shm"));
    let _ = std::fs::remove_file(format!("{state_db}-wal"));
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
    let replay = register_host_workspace(&store, "workspace-1", r"C:\workspaces\one", "request-1")
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
