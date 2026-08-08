use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, GitWorkerRequest,
    GitWorkerResponse, OwnershipContext, PtyExecutionTarget, PtyOperation, PtyRequest, PtyResponse,
    PtySshShell, PtyStatus, WorkspaceKind,
};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LiveTargetMatrix {
    cases: Vec<LiveTargetCase>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LiveTargetCase {
    name: String,
    workspace_kind: LiveWorkspaceKind,
    target: LiveTarget,
    workspace_path: String,
    repository_path: String,
    expected_worktree_path: String,
    marker_path: String,
    marker_contains: String,
    pty_program: String,
    pty_args: Vec<String>,
    pty_marker: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum LiveWorkspaceKind {
    Folder,
    GitWorktree,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum LiveTarget {
    WindowsNative,
    Wsl2 { identity: String },
    Ssh { identity: String },
}

impl LiveTargetMatrix {
    fn parse(json: &str) -> Result<Self, String> {
        let matrix: Self = serde_json::from_str(json).map_err(|error| error.to_string())?;
        matrix.validate()?;
        Ok(matrix)
    }

    fn validate(&self) -> Result<(), String> {
        if self.cases.is_empty() {
            return Err(String::from(
                "live target matrix must contain at least one case",
            ));
        }
        let mut names = HashSet::new();
        for case in &self.cases {
            require_nonblank(&case.name, "case name")?;
            if !names.insert(case.name.as_str()) {
                return Err(format!("duplicate live target case: {}", case.name));
            }
            require_nonblank(&case.workspace_path, "workspace_path")?;
            require_nonblank(&case.repository_path, "repository_path")?;
            require_nonblank(&case.expected_worktree_path, "expected_worktree_path")?;
            require_nonblank(&case.marker_path, "marker_path")?;
            require_nonblank(&case.marker_contains, "marker_contains")?;
            require_nonblank(&case.pty_program, "pty_program")?;
            require_nonblank(&case.pty_marker, "pty_marker")?;
            match &case.target {
                LiveTarget::WindowsNative => {}
                LiveTarget::Wsl2 { identity } | LiveTarget::Ssh { identity } => {
                    require_nonblank(identity, "remote target identity")?;
                }
            }
        }
        Ok(())
    }
}

fn require_nonblank(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} must be nonblank"))
    } else {
        Ok(())
    }
}

impl LiveTargetCase {
    fn workspace_kind(&self) -> WorkspaceKind {
        match self.workspace_kind {
            LiveWorkspaceKind::Folder => WorkspaceKind::Folder,
            LiveWorkspaceKind::GitWorktree => WorkspaceKind::GitWorktree,
        }
    }

    fn execution_targets(&self) -> (ExecutionTarget, PtyExecutionTarget, Option<String>) {
        match &self.target {
            LiveTarget::WindowsNative => (
                ExecutionTarget::WindowsNative,
                PtyExecutionTarget::WindowsNative,
                None,
            ),
            LiveTarget::Wsl2 { identity } => (
                ExecutionTarget::Wsl2 {
                    distro: identity.clone(),
                },
                PtyExecutionTarget::Wsl2 {
                    distro: identity.clone(),
                },
                Some(identity.clone()),
            ),
            LiveTarget::Ssh { identity } => (
                ExecutionTarget::Ssh {
                    host: identity.clone(),
                    shell: PtySshShell::Posix,
                },
                PtyExecutionTarget::Ssh {
                    host: identity.clone(),
                    shell: PtySshShell::Posix,
                },
                Some(identity.clone()),
            ),
        }
    }
}

struct WorkerJsonlChild {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl WorkerJsonlChild {
    fn spawn() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ade-worker"))
            .arg("--jsonl")
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

fn execution_context(
    case: &LiveTargetCase,
    index: usize,
    target: ExecutionTarget,
    remote_identity: Option<String>,
) -> ExecutionContext {
    ExecutionContext::new(
        format!("live-workspace-{index}"),
        case.workspace_kind(),
        format!("live-worker-{index}"),
        1,
        OwnershipContext::new(index as u64 + 1),
        target,
        remote_identity,
    )
}

fn run_case(worker: &mut WorkerJsonlChild, case: &LiveTargetCase, index: usize) {
    let (target, pty_target, remote_identity) = case.execution_targets();
    let context = execution_context(case, index, target, remote_identity);

    let file_request = FileWorkerRequest::read(
        format!("live-{index}-file"),
        context.clone(),
        case.marker_path.clone(),
    );
    let file_response: FileWorkerResponse = worker.request(&file_request);
    let marker_text = String::from_utf8_lossy(&file_response.bytes);
    assert!(
        marker_text.contains(&case.marker_contains),
        "{}: marker file did not contain {:?}; actual={marker_text:?}",
        case.name,
        case.marker_contains
    );

    let git_request = GitWorkerRequest::worktree_list(
        format!("live-{index}-git"),
        context,
        case.repository_path.clone(),
    );
    let git_response: GitWorkerResponse = worker.request(&git_request);
    assert!(
        git_response
            .worktrees
            .iter()
            .any(|worktree| worktree.path == case.expected_worktree_path),
        "{}: expected worktree path {:?}; actual={:?}",
        case.name,
        case.expected_worktree_path,
        git_response
            .worktrees
            .iter()
            .map(|worktree| worktree.path.as_str())
            .collect::<Vec<_>>()
    );

    let session_id = format!("live-session-{index}");
    let start_request = PtyRequest::new(
        format!("live-{index}-pty-start"),
        format!("live-workspace-{index}"),
        format!("live-worker-{index}"),
        session_id.clone(),
        None,
        PtyOperation::Start {
            program: case.pty_program.clone(),
            args: case.pty_args.clone(),
            current_dir: Some(case.workspace_path.clone()),
            execution_target: Some(pty_target),
            cols: 80,
            rows: 24,
        },
    );
    let start: PtyResponse = worker.request(&start_request);
    assert!(
        matches!(start.status, PtyStatus::Running | PtyStatus::Exited),
        "{}: PTY start failed: {start:?}",
        case.name
    );

    let final_response = if start.status == PtyStatus::Exited {
        start
    } else {
        let wait_request = PtyRequest::new(
            format!("live-{index}-pty-wait"),
            format!("live-workspace-{index}"),
            format!("live-worker-{index}"),
            session_id,
            Some(start.session_generation),
            PtyOperation::Wait { timeout_ms: 10_000 },
        );
        worker.request::<PtyResponse, _>(&wait_request)
    };
    assert_eq!(
        final_response.status,
        PtyStatus::Exited,
        "{}: PTY did not exit: {final_response:?}",
        case.name
    );
    assert_eq!(
        final_response.exit_code,
        Some(0),
        "{}: PTY exited unsuccessfully: {final_response:?}",
        case.name
    );
    assert!(
        final_response.tail.contains(&case.pty_marker),
        "{}: PTY tail did not contain {:?}; tail={:?}",
        case.name,
        case.pty_marker,
        final_response.tail
    );
}

#[test]
fn live_target_matrix_config_is_strict_and_rejects_ambiguous_cases() {
    let valid = r#"{
      "cases": [
        {
          "name": "wsl-worktree",
          "workspace_kind": "git-worktree",
          "target": { "kind": "wsl2", "identity": "Ubuntu-24.04" },
          "workspace_path": "/home/dev/repo",
          "repository_path": "/home/dev/repo",
          "expected_worktree_path": "/home/dev/repo",
          "marker_path": "/home/dev/repo/.ade-live-marker",
          "marker_contains": "ready",
          "pty_program": "sh",
          "pty_args": ["-lc", "printf ready"],
          "pty_marker": "ready"
        }
      ]
    }"#;
    assert_eq!(LiveTargetMatrix::parse(valid).unwrap().cases.len(), 1);
    let example = LiveTargetMatrix::parse(include_str!("live_target_matrix.example.json")).unwrap();
    assert_eq!(example.cases.len(), 6);

    let duplicate = valid.replace(
        "]\n    }",
        ", {\n          \"name\": \"wsl-worktree\",\n          \"workspace_kind\": \"folder\",\n          \"target\": { \"kind\": \"windows-native\" },\n          \"workspace_path\": \"C:\\\\repo\",\n          \"repository_path\": \"C:\\\\repo\",\n          \"expected_worktree_path\": \"C:\\\\repo\",\n          \"marker_path\": \"C:\\\\repo\\\\marker\",\n          \"marker_contains\": \"ready\",\n          \"pty_program\": \"cmd.exe\",\n          \"pty_args\": [\"/C\", \"echo ready\"],\n          \"pty_marker\": \"ready\"\n        }]\n    }",
    );
    assert!(LiveTargetMatrix::parse(&duplicate)
        .unwrap_err()
        .contains("duplicate live target case"));

    let blank_identity = valid.replace("Ubuntu-24.04", "   ");
    assert!(LiveTargetMatrix::parse(&blank_identity)
        .unwrap_err()
        .contains("remote target identity must be nonblank"));

    let unknown = valid.replace(
        "\"pty_marker\": \"ready\"",
        "\"pty_marker\": \"ready\", \"unexpected\": true",
    );
    assert!(LiveTargetMatrix::parse(&unknown).is_err());
}

#[test]
#[ignore = "requires ADE_LIVE_TARGET_MATRIX and configured native/WSL2/SSH fixtures"]
fn live_target_matrix_runs_file_git_and_pty_through_the_real_worker() {
    let matrix_path = std::env::var("ADE_LIVE_TARGET_MATRIX").expect(
        "set ADE_LIVE_TARGET_MATRIX to a strict JSON config; see live_target_matrix.example.json",
    );
    let matrix_text = fs::read_to_string(Path::new(&matrix_path))
        .unwrap_or_else(|error| panic!("failed to read {matrix_path}: {error}"));
    let matrix = LiveTargetMatrix::parse(&matrix_text)
        .unwrap_or_else(|error| panic!("invalid live target matrix {matrix_path}: {error}"));
    let mut worker = WorkerJsonlChild::spawn();

    for (index, case) in matrix.cases.iter().enumerate() {
        eprintln!("[live-target] running {}", case.name);
        run_case(&mut worker, case, index);
        eprintln!("[live-target] passed {}", case.name);
    }
}
