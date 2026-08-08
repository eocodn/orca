#![cfg(unix)]

use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, GitWorkerRequest, GitWorkerResponse, OwnershipContext,
    PtyExecutionTarget, PtyOperation, PtyRequest, PtyResponse, PtySshShell, PtyStatus,
    WorkspaceKind,
};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

struct WorkerJsonlChild {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl WorkerJsonlChild {
    fn spawn(shim_dir: &Path, root: &Path) -> Self {
        let path = std::env::var("PATH").unwrap_or_default();
        let mut child = Command::new(env!("CARGO_BIN_EXE_ade-worker"))
            .arg("--jsonl")
            .env("PATH", format!("{}:{path}", shim_dir.display()))
            .env("ADE_WSL_PROCESS_LOG", root.join("wsl-process.log"))
            .env("ADE_SSH_PROCESS_LOG", root.join("ssh-process.log"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("ade-worker child should start");
        let stdin = BufWriter::new(child.stdin.take().expect("worker stdin"));
        let stdout = BufReader::new(child.stdout.take().expect("worker stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn request<R: serde::de::DeserializeOwned, Q: serde::Serialize>(&mut self, request: &Q) -> R {
        serde_json::to_writer(&mut self.stdin, request).expect("request should serialize");
        self.stdin.write_all(b"\n").unwrap();
        self.stdin.flush().unwrap();

        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "worker must answer one JSONL response");
        serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("worker response should decode: {error}: {line}"))
    }
}

impl Drop for WorkerJsonlChild {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn test_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "ade-target-git-pty-worker-child-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos()
    ))
}

fn install_shim(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}

fn context(target: ExecutionTarget, remote_identity: &str) -> ExecutionContext {
    ExecutionContext::new(
        "workspace-remote",
        WorkspaceKind::GitWorktree,
        "worker-remote",
        1,
        OwnershipContext::new(11),
        target,
        Some(String::from(remote_identity)),
    )
}

fn start_pty(
    worker: &mut WorkerJsonlChild,
    request_id: &str,
    session_id: &str,
    current_dir: &str,
    target: PtyExecutionTarget,
) -> PtyResponse {
    let start = PtyRequest::new(
        request_id,
        "workspace-remote",
        "worker-remote",
        session_id,
        None,
        PtyOperation::Start {
            program: String::from("sh"),
            args: vec![
                String::from("-lc"),
                String::from("printf ADE_TARGET_PTY_OK"),
            ],
            current_dir: Some(String::from(current_dir)),
            execution_target: Some(target),
            cols: 80,
            rows: 24,
        },
    );
    worker.request(&start)
}

fn wait_pty(
    worker: &mut WorkerJsonlChild,
    request_id: &str,
    session_id: &str,
    generation: u64,
) -> PtyResponse {
    let wait = PtyRequest::new(
        request_id,
        "workspace-remote",
        "worker-remote",
        session_id,
        Some(generation),
        PtyOperation::Wait { timeout_ms: 5_000 },
    );
    worker.request(&wait)
}

#[test]
fn real_jsonl_worker_routes_git_and_pty_across_wsl_and_ssh_target_processes() {
    let root = test_root();
    let shim_dir = root.join("bin");
    fs::create_dir_all(&shim_dir).unwrap();

    install_shim(
        &shim_dir.join("wsl.exe"),
        r#"#!/bin/sh
set -eu
printf '%s\n' "$@" >> "$ADE_WSL_PROCESS_LOG"
printf '%s\n' '---' >> "$ADE_WSL_PROCESS_LOG"
case " $* " in
  *" git "*) printf 'worktree /remote/wsl-repo\0HEAD aabbcc\0branch refs/heads/main\0\0' ;;
  *" sh -lc "*) printf 'ADE_WSL_PTY_OK\n' ;;
  *) printf 'unexpected wsl invocation: %s\n' "$*" >&2; exit 64 ;;
esac
"#,
    );
    install_shim(
        &shim_dir.join("ssh"),
        r#"#!/bin/sh
set -eu
printf '%s\n' "$@" >> "$ADE_SSH_PROCESS_LOG"
printf '%s\n' '---' >> "$ADE_SSH_PROCESS_LOG"
case " $* " in
  *"'worktree'"*) printf 'worktree /remote/ssh-repo\0HEAD ddeeff\0branch refs/heads/main\0\0' ;;
  *" -tt "*) printf 'ADE_SSH_PTY_OK\n' ;;
  *) printf 'unexpected ssh invocation: %s\n' "$*" >&2; exit 64 ;;
esac
"#,
    );

    let mut worker = WorkerJsonlChild::spawn(&shim_dir, &root);

    let wsl_git = GitWorkerRequest::worktree_list(
        "process-wsl-git",
        context(
            ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-24.04"),
            },
            "Ubuntu-24.04",
        ),
        "/remote/wsl-repo",
    );
    let wsl_git_response: GitWorkerResponse = worker.request(&wsl_git);
    assert_eq!(wsl_git_response.worktrees.len(), 1);
    assert_eq!(wsl_git_response.worktrees[0].path, "/remote/wsl-repo");
    assert_eq!(wsl_git_response.worktrees[0].head, "aabbcc");

    let ssh_git = GitWorkerRequest::worktree_list(
        "process-ssh-git",
        context(
            ExecutionTarget::Ssh {
                host: String::from("builder.example"),
                shell: PtySshShell::Posix,
            },
            "builder.example",
        ),
        "/remote/ssh-repo",
    );
    let ssh_git_response: GitWorkerResponse = worker.request(&ssh_git);
    assert_eq!(ssh_git_response.worktrees.len(), 1);
    assert_eq!(ssh_git_response.worktrees[0].path, "/remote/ssh-repo");
    assert_eq!(ssh_git_response.worktrees[0].head, "ddeeff");

    let wsl_start = start_pty(
        &mut worker,
        "process-wsl-pty-start",
        "session-wsl",
        "/remote/wsl-repo",
        PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        },
    );
    assert_eq!(wsl_start.status, PtyStatus::Running);
    let wsl_wait = wait_pty(
        &mut worker,
        "process-wsl-pty-wait",
        "session-wsl",
        wsl_start.session_generation,
    );
    assert_eq!(wsl_wait.status, PtyStatus::Exited);
    assert_eq!(wsl_wait.exit_code, Some(0));
    assert!(wsl_wait.tail.contains("ADE_WSL_PTY_OK"));

    let ssh_start = start_pty(
        &mut worker,
        "process-ssh-pty-start",
        "session-ssh",
        "/remote/ssh-repo",
        PtyExecutionTarget::Ssh {
            host: String::from("builder.example"),
            shell: PtySshShell::Posix,
        },
    );
    assert_eq!(ssh_start.status, PtyStatus::Running);
    let ssh_wait = wait_pty(
        &mut worker,
        "process-ssh-pty-wait",
        "session-ssh",
        ssh_start.session_generation,
    );
    assert_eq!(ssh_wait.status, PtyStatus::Exited);
    assert_eq!(ssh_wait.exit_code, Some(0));
    assert!(ssh_wait.tail.contains("ADE_SSH_PTY_OK"));

    let wsl_log = fs::read_to_string(root.join("wsl-process.log")).unwrap();
    assert!(wsl_log.contains("--distribution\nUbuntu-24.04\n--\ngit\n-C\n/remote/wsl-repo"));
    assert!(wsl_log.contains("sh\n-lc"));
    assert!(wsl_log.contains("/remote/wsl-repo"));

    let ssh_log = fs::read_to_string(root.join("ssh-process.log")).unwrap();
    assert!(ssh_log.contains("--\nbuilder.example"));
    assert!(ssh_log.contains("worktree"));
    assert!(ssh_log
        .contains("-tt\n-oServerAliveInterval=5\n-oServerAliveCountMax=3\n--\nbuilder.example"));
    assert!(ssh_log.contains("/remote/ssh-repo"));

    drop(worker);
    let _ = fs::remove_dir_all(root);
}
