#![cfg(unix)]

use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, OwnershipContext,
    PtySshShell, WorkspaceKind,
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
            .env("ADE_WSL_REMOTE_SOURCE", root.join("wsl-remote-source.bin"))
            .env("ADE_WSL_INVOCATION_LOG", root.join("wsl-invocation.log"))
            .env("ADE_SSH_REMOTE_SINK", root.join("ssh-remote-sink.bin"))
            .env("ADE_SSH_INVOCATION_LOG", root.join("ssh-invocation.log"))
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

    fn execute_file(&mut self, request: &FileWorkerRequest) -> FileWorkerResponse {
        serde_json::to_writer(&mut self.stdin, request).expect("request should serialize");
        self.stdin.write_all(b"\n").unwrap();
        self.stdin.flush().unwrap();

        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "worker must answer one JSONL response");
        serde_json::from_str(&line).unwrap_or_else(|error| {
            panic!("worker response should be a FileWorkerResponse: {error}: {line}")
        })
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
        "ade-target-file-worker-child-{}-{}",
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
        OwnershipContext::new(7),
        target,
        Some(String::from(remote_identity)),
    )
}

#[test]
fn real_jsonl_worker_routes_wsl_reads_and_ssh_writes_to_target_processes() {
    let root = test_root();
    let shim_dir = root.join("bin");
    fs::create_dir_all(&shim_dir).unwrap();
    let wsl_remote_source = root.join("wsl-remote-source.bin");
    let ssh_remote_sink = root.join("ssh-remote-sink.bin");
    let wsl_host_decoy = root.join("wsl-host-decoy.bin");
    let ssh_host_decoy = root.join("ssh-host-decoy.bin");
    let wsl_bytes = vec![0, b'w', 0xff, b'\n'];
    let ssh_bytes = vec![0, b's', 0xfe, b'\n'];
    fs::write(&wsl_remote_source, &wsl_bytes).unwrap();
    fs::write(&wsl_host_decoy, b"host-local-wrong-bytes").unwrap();

    install_shim(
        &shim_dir.join("wsl.exe"),
        r#"#!/bin/sh
set -eu
printf '%s\n' "$@" > "$ADE_WSL_INVOCATION_LOG"
cat -- "$ADE_WSL_REMOTE_SOURCE"
"#,
    );
    install_shim(
        &shim_dir.join("ssh"),
        r#"#!/bin/sh
set -eu
printf '%s\n' "$@" > "$ADE_SSH_INVOCATION_LOG"
tmp="$ADE_SSH_REMOTE_SINK.tmp"
cat > "$tmp"
if [ -f "$ADE_SSH_REMOTE_SINK" ] && cmp -s -- "$tmp" "$ADE_SSH_REMOTE_SINK"; then
  rm -f -- "$tmp"
  printf 'unchanged\n'
else
  mv -f -- "$tmp" "$ADE_SSH_REMOTE_SINK"
  printf 'changed\n'
fi
"#,
    );

    let mut worker = WorkerJsonlChild::spawn(&shim_dir, &root);
    let wsl_path = wsl_host_decoy.to_string_lossy().into_owned();
    let read = FileWorkerRequest::read(
        "process-wsl-read",
        context(
            ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-24.04"),
            },
            "Ubuntu-24.04",
        ),
        wsl_path.clone(),
    );
    let read_response = worker.execute_file(&read);
    assert_eq!(read_response.bytes, wsl_bytes);
    assert_eq!(
        fs::read(&wsl_host_decoy).unwrap(),
        b"host-local-wrong-bytes"
    );
    assert_eq!(
        fs::read_to_string(root.join("wsl-invocation.log")).unwrap(),
        format!("--distribution\nUbuntu-24.04\n--\ncat\n--\n{wsl_path}\n")
    );

    let ssh_path = ssh_host_decoy.to_string_lossy().into_owned();
    let write = FileWorkerRequest::write(
        "process-ssh-write",
        context(
            ExecutionTarget::Ssh {
                host: String::from("builder.example"),
                shell: PtySshShell::Posix,
            },
            "builder.example",
        ),
        ssh_path.clone(),
        ssh_bytes.clone(),
    );
    let write_response = worker.execute_file(&write);
    assert!(write_response.changed);
    assert_eq!(write_response.bytes_written, ssh_bytes.len() as u64);
    assert!(
        !ssh_host_decoy.exists(),
        "SSH target must not touch the Host path"
    );
    assert_eq!(fs::read(&ssh_remote_sink).unwrap(), ssh_bytes);

    let replay = worker.execute_file(&write);
    assert_eq!(
        replay, write_response,
        "worker request replay must remain idempotent"
    );
    assert_eq!(fs::read(&ssh_remote_sink).unwrap(), ssh_bytes);
    let ssh_log = fs::read_to_string(root.join("ssh-invocation.log")).unwrap();
    let ssh_args = ssh_log.lines().collect::<Vec<_>>();
    assert_eq!(ssh_args[0..2], ["--", "builder.example"]);
    assert!(ssh_args.iter().any(|arg| arg.contains(&ssh_path)));

    drop(worker);
    let _ = fs::remove_dir_all(root);
}
