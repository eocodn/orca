use ade_host::run_cli;
use ade_host_store::store::{
    HostStore, StoredExecutionTarget, StoredWorkspaceKind, StoredWorkspaceLocation,
};
use serde_json::Value;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

struct MatrixCase {
    workspace_id: &'static str,
    kind_arg: &'static str,
    kind: StoredWorkspaceKind,
    target_arg: &'static str,
    target: StoredExecutionTarget,
    identity_flag: Option<&'static str>,
    identity: Option<&'static str>,
    path: &'static str,
}

fn state_db_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "ade-host-workspace-target-matrix-{}-{}.db",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos()
    ))
}

fn register_args(case: &MatrixCase, state_db: &str) -> Vec<String> {
    let mut args = vec![
        String::from("--json"),
        String::from("--state-db"),
        String::from(state_db),
        String::from("--register-workspace"),
        String::from(case.workspace_id),
        String::from("--workspace-path"),
        String::from(case.path),
        String::from("--request-id"),
        format!("request-{}", case.workspace_id),
        String::from("--workspace-kind"),
        String::from(case.kind_arg),
        String::from("--execution-target"),
        String::from(case.target_arg),
    ];
    if let (Some(flag), Some(identity)) = (case.identity_flag, case.identity) {
        args.push(String::from(flag));
        args.push(String::from(identity));
    }
    args
}

#[test]
fn persists_all_six_workspace_target_cells_through_cli_replay_and_reopen() {
    let cases = [
        MatrixCase {
            workspace_id: "folder-native",
            kind_arg: "folder",
            kind: StoredWorkspaceKind::Folder,
            target_arg: "windows-native",
            target: StoredExecutionTarget::WindowsNative,
            identity_flag: None,
            identity: None,
            path: r"C:\workspaces\folder-native",
        },
        MatrixCase {
            workspace_id: "worktree-native",
            kind_arg: "git-worktree",
            kind: StoredWorkspaceKind::GitWorktree,
            target_arg: "windows-native",
            target: StoredExecutionTarget::WindowsNative,
            identity_flag: None,
            identity: None,
            path: r"C:\workspaces\worktree-native",
        },
        MatrixCase {
            workspace_id: "folder-wsl",
            kind_arg: "folder",
            kind: StoredWorkspaceKind::Folder,
            target_arg: "wsl2",
            target: StoredExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-22.04"),
            },
            identity_flag: Some("--wsl-distro"),
            identity: Some("Ubuntu-22.04"),
            path: "/home/dev/folder-wsl",
        },
        MatrixCase {
            workspace_id: "worktree-wsl",
            kind_arg: "git-worktree",
            kind: StoredWorkspaceKind::GitWorktree,
            target_arg: "wsl2",
            target: StoredExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-24.04"),
            },
            identity_flag: Some("--wsl-distro"),
            identity: Some("Ubuntu-24.04"),
            path: "/home/dev/worktree-wsl",
        },
        MatrixCase {
            workspace_id: "folder-ssh",
            kind_arg: "folder",
            kind: StoredWorkspaceKind::Folder,
            target_arg: "ssh",
            target: StoredExecutionTarget::Ssh {
                host: String::from("builder-a.example"),
            },
            identity_flag: Some("--ssh-host"),
            identity: Some("builder-a.example"),
            path: "/srv/folder-ssh",
        },
        MatrixCase {
            workspace_id: "worktree-ssh",
            kind_arg: "git-worktree",
            kind: StoredWorkspaceKind::GitWorktree,
            target_arg: "ssh",
            target: StoredExecutionTarget::Ssh {
                host: String::from("builder-b.example"),
            },
            identity_flag: Some("--ssh-host"),
            identity: Some("builder-b.example"),
            path: "/srv/worktree-ssh",
        },
    ];

    let state_db = state_db_path();
    let state_db_text = state_db.to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&state_db);

    for (index, case) in cases.iter().enumerate() {
        let args = register_args(case, &state_db_text);
        let first = run_cli(args.clone()).expect("matrix cell should register");
        let replay = run_cli(args).expect("same request should replay idempotently");
        assert_eq!(replay, first);
        let status: Value = serde_json::from_str(&first).expect("status should be JSON");
        assert_eq!(status["workspace_count"], Value::from(index + 1));
    }

    let store = HostStore::open(&state_db).expect("matrix state should reopen");
    assert_eq!(store.journal_len().expect("journal should be readable"), 6);
    let snapshot = store.snapshot().expect("snapshot should be readable");
    assert_eq!(snapshot.len(), cases.len());

    for case in &cases {
        let workspace = snapshot
            .iter()
            .find(|workspace| workspace.workspace_id == case.workspace_id)
            .expect("every matrix cell should remain observable");
        assert_eq!(workspace.path, case.path);
        assert_eq!(
            workspace.location,
            Some(StoredWorkspaceLocation::new(
                case.kind.clone(),
                case.target.clone(),
                case.path,
            ))
        );
    }

    drop(store);
    let _ = std::fs::remove_file(state_db);
}
