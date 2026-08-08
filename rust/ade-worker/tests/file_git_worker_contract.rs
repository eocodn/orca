use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, GitWorkerRequest,
    OwnershipContext, WorkspaceKind,
};
use ade_worker::jsonl_transport::serve_mixed_jsonl;
use ade_worker::pty_registry::PtyWorkerRegistry;
use ade_worker::worker_dispatch::FileGitWorkerRegistry;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;

fn temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "ade-worker-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn context(incarnation: u64, lease_id: u64) -> ExecutionContext {
    ExecutionContext::new(
        "workspace-1",
        WorkspaceKind::Folder,
        "worker-1",
        incarnation,
        OwnershipContext::new(lease_id),
        ExecutionTarget::WindowsNative,
        None,
    )
}

#[test]
fn file_dispatch_replays_identical_requests_and_fences_owner_lease_conflicts() {
    let path = temp_dir("file").join("note.txt");
    let registry = FileGitWorkerRegistry::default();
    let path_string = path.to_string_lossy().into_owned();
    let request = FileWorkerRequest::write(
        "request-1",
        context(1, 7),
        path_string.clone(),
        b"hello".to_vec(),
    );

    let first = registry.execute_file(&request).unwrap();
    let replay = registry.execute_file(&request).unwrap();
    assert_eq!(first, replay);
    assert!(replay.changed);

    let conflict = FileWorkerRequest::write(
        "request-1",
        context(1, 8),
        path_string.clone(),
        b"other".to_vec(),
    );
    assert_eq!(
        registry.execute_file(&conflict),
        Err("request_id_conflict".into())
    );
    let newer = FileWorkerRequest::read("request-2", context(2, 7), path_string.clone());
    assert!(registry.execute_file(&newer).is_ok());
    let stale = FileWorkerRequest::read("request-3", context(1, 7), path_string);
    assert_eq!(
        registry.execute_file(&stale),
        Err("stale_worker_incarnation".into())
    );
    let _ = fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn git_dispatch_executes_against_a_real_folder_repository_and_jsonl_correlates() {
    let git_status = Command::new("git")
        .arg("--version")
        .status()
        .expect("required Git integration test tool must be installed");
    assert!(git_status.success(), "Git version probe must succeed");
    let repository = temp_dir("git");
    run_git(&repository, &["init", "-q"]);
    run_git(&repository, &["config", "user.email", "ade@example.test"]);
    run_git(&repository, &["config", "user.name", "ADE"]);
    fs::write(repository.join("README"), b"hello").unwrap();
    run_git(&repository, &["add", "README"]);
    run_git(&repository, &["commit", "-qm", "initial"]);

    let repository_string = repository.to_string_lossy().into_owned();
    let request = GitWorkerRequest::worktree_list("git-1", context(1, 9), repository_string);
    let registry = FileGitWorkerRegistry::default();
    let response = registry.execute_git(&request).unwrap();
    assert_eq!(response.envelope.request_id, "git-1");
    assert_eq!(response.worktrees.len(), 1);
    assert!(response.worktrees[0].is_main);

    let file_path = repository.join("README");
    let file_request = FileWorkerRequest::read(
        "file-1",
        context(1, 9),
        file_path.to_string_lossy().into_owned(),
    );
    let input = format!(
        "{}\n{}\n",
        serde_json::to_string(&file_request).unwrap(),
        serde_json::to_string(&request).unwrap()
    );
    let mut output = Vec::new();
    serve_mixed_jsonl(
        Cursor::new(input),
        &mut output,
        &PtyWorkerRegistry::default(),
        &registry,
    )
    .unwrap();
    let lines = String::from_utf8(output).unwrap();
    let responses = lines.lines().collect::<Vec<_>>();
    let file_response: FileWorkerResponse = serde_json::from_str(responses[0]).unwrap();
    assert_eq!(file_response.envelope.request_id, "file-1");
    assert_eq!(file_response.bytes, b"hello");
    let git_response: ade_host_core::protocol::GitWorkerResponse =
        serde_json::from_str(responses[1]).unwrap();
    assert_eq!(git_response.envelope.request_id, "git-1");
    let _ = fs::remove_dir_all(repository);
}

#[test]
fn git_dispatch_handles_a_real_bare_repository_without_inventing_a_head() {
    let git_status = Command::new("git")
        .arg("--version")
        .status()
        .expect("required Git integration test tool must be installed");
    assert!(git_status.success(), "Git version probe must succeed");
    let repository = temp_dir("bare-git");
    run_git(&repository, &["init", "--bare", "-q"]);

    let repository_string = repository.to_string_lossy().into_owned();
    let request = GitWorkerRequest::worktree_list("bare-git-1", context(1, 9), repository_string);
    let response = FileGitWorkerRegistry::default()
        .execute_git(&request)
        .unwrap();

    assert_eq!(response.worktrees.len(), 1);
    assert!(response.worktrees[0].is_bare);
    assert!(response.worktrees[0].head.is_empty());
    let _ = fs::remove_dir_all(repository);
}

fn run_git(path: &std::path::Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(path)
        .status()
        .unwrap();
    assert!(status.success(), "git command failed: {args:?}");
}

#[derive(Default)]
struct RecordingFileExecutor {
    calls: std::sync::Mutex<Vec<(ade_host_platform::CommandSpec, Vec<u8>)>>,
    outputs: std::sync::Mutex<
        std::collections::VecDeque<ade_host_platform::file_execution::FileCommandOutput>,
    >,
}

impl RecordingFileExecutor {
    fn with_outputs(outputs: Vec<ade_host_platform::file_execution::FileCommandOutput>) -> Self {
        Self {
            calls: std::sync::Mutex::new(Vec::new()),
            outputs: std::sync::Mutex::new(outputs.into()),
        }
    }
}

impl ade_host_platform::file_execution::FileCommandExecutor for RecordingFileExecutor {
    fn execute(
        &self,
        command: &ade_host_platform::CommandSpec,
        stdin: &[u8],
    ) -> std::io::Result<ade_host_platform::file_execution::FileCommandOutput> {
        self.calls
            .lock()
            .unwrap()
            .push((command.clone(), stdin.to_vec()));
        Ok(self.outputs.lock().unwrap().pop_front().unwrap())
    }
}

#[test]
fn file_dispatch_routes_wsl_reads_and_ssh_writes_without_touching_host_paths() {
    use ade_host_core::protocol::PtySshShell;
    use ade_host_platform::file_execution::FileCommandOutput;
    use std::sync::Arc;

    let remote_decoy_root = temp_dir("remote-file-decoy");
    let remote_decoy = remote_decoy_root.join("ssh-write.bin");
    let remote_decoy_text = remote_decoy.to_string_lossy().into_owned();
    let executor = Arc::new(RecordingFileExecutor::with_outputs(vec![
        FileCommandOutput {
            success: true,
            code: Some(0),
            stdout: vec![0, 1, 0xff, b'\n'],
            stderr: Vec::new(),
        },
        FileCommandOutput {
            success: true,
            code: Some(0),
            stdout: b"changed\n".to_vec(),
            stderr: Vec::new(),
        },
    ]));
    let registry = FileGitWorkerRegistry::with_file_executor(executor.clone());

    let wsl_context = ExecutionContext::new(
        "workspace-wsl",
        WorkspaceKind::Folder,
        "worker-wsl",
        1,
        OwnershipContext::new(7),
        ExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        },
        Some(String::from("Ubuntu-24.04")),
    );
    let read = FileWorkerRequest::read("file-wsl-read", wsl_context, "/home/dev/blob.bin");
    let read_response = registry.execute_file(&read).expect("WSL read should route");
    assert_eq!(read_response.bytes, vec![0, 1, 0xff, b'\n']);

    let ssh_context = ExecutionContext::new(
        "workspace-ssh",
        WorkspaceKind::GitWorktree,
        "worker-ssh",
        1,
        OwnershipContext::new(9),
        ExecutionTarget::Ssh {
            host: String::from("builder.example"),
            shell: PtySshShell::Posix,
        },
        Some(String::from("builder.example")),
    );
    let write_bytes = vec![0, b'a', 0xff, b'\n'];
    let write = FileWorkerRequest::write(
        "file-ssh-write",
        ssh_context,
        remote_decoy_text.clone(),
        write_bytes.clone(),
    );
    let write_response = registry
        .execute_file(&write)
        .expect("SSH write should route");
    assert!(write_response.changed);
    assert_eq!(write_response.bytes_written, write_bytes.len() as u64);
    assert!(
        !remote_decoy.exists(),
        "remote write must not touch the Host path"
    );

    let calls = executor.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0.program, "wsl.exe");
    assert_eq!(
        calls[0].0.args,
        vec![
            "--distribution",
            "Ubuntu-24.04",
            "--",
            "cat",
            "--",
            "/home/dev/blob.bin"
        ]
    );
    assert!(calls[0].1.is_empty());
    assert_eq!(calls[1].0.program, "ssh");
    assert_eq!(calls[1].0.args[0..2], ["--", "builder.example"]);
    assert_eq!(calls[1].1, write_bytes);

    let _ = fs::remove_dir_all(remote_decoy_root);
}
