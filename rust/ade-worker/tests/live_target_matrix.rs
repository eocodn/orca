use ade_control::AgentControlClient;
use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, GitWorkerRequest,
    GitWorkerResponse, OwnershipContext, PtyExecutionTarget, PtyOperation, PtyRequest, PtyResponse,
    PtySshShell, PtyStatus, WorkspaceKind,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

const CONTROL_PROTOCOL_VERSION: u64 = 1;

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

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiveTargetKind {
    WindowsNative,
    Wsl2,
}

#[derive(Debug, Clone, Copy)]
enum LiveOperation {
    File,
    Git,
    Pty,
}

struct AcceptanceContext {
    control_endpoint: PathBuf,
    windows_worker: PathBuf,
    wsl_worker: PathBuf,
    distro: String,
    worker_id: String,
    worker_incarnation: u64,
    worker_version: String,
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

    fn case(&self, target: LiveTargetKind, workspace_kind: LiveWorkspaceKind) -> &LiveTargetCase {
        let matches = self
            .cases
            .iter()
            .filter(|case| {
                case.workspace_kind == workspace_kind && case.target_kind() == Some(target)
            })
            .collect::<Vec<_>>();
        assert_eq!(
            matches.len(),
            1,
            "live matrix must contain exactly one {target:?}/{workspace_kind:?} case; matches={:?}",
            matches
                .iter()
                .map(|case| case.name.as_str())
                .collect::<Vec<_>>()
        );
        matches[0]
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

    fn target_kind(&self) -> Option<LiveTargetKind> {
        match self.target {
            LiveTarget::WindowsNative => Some(LiveTargetKind::WindowsNative),
            LiveTarget::Wsl2 { .. } => Some(LiveTargetKind::Wsl2),
            LiveTarget::Ssh { .. } => None,
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

impl AcceptanceContext {
    fn load() -> Self {
        let endpoint = required_env("ADE_ACCEPTANCE_CONTROL_ENDPOINT");
        let context = Self {
            control_endpoint: PathBuf::from(endpoint),
            windows_worker: required_path("ADE_ACCEPTANCE_WINDOWS_WORKER_BIN"),
            wsl_worker: required_path("ADE_ACCEPTANCE_WSL_WORKER_BIN"),
            distro: required_env("ADE_ACCEPTANCE_DISTRO"),
            worker_id: required_env("ADE_ACCEPTANCE_WORKER_ID"),
            worker_incarnation: required_env("ADE_ACCEPTANCE_WORKER_INCARNATION")
                .parse()
                .expect("ADE_ACCEPTANCE_WORKER_INCARNATION must be a positive u64"),
            worker_version: required_env("ADE_ACCEPTANCE_WORKER_VERSION"),
        };
        assert!(
            context.control_endpoint.is_file(),
            "control endpoint must exist"
        );
        assert!(
            context.windows_worker.is_file(),
            "Windows worker binary must exist"
        );
        assert!(context.wsl_worker.is_file(), "WSL worker binary must exist");
        assert!(
            context.worker_incarnation > 0,
            "worker incarnation must be positive"
        );
        context
    }

    fn verify_ready(&self, test_name: &str) {
        let mut client = AgentControlClient::connect(&self.control_endpoint)
            .expect("acceptance control endpoint must be authenticated and reachable");
        let request_id = format!("acceptance-{test_name}");
        let request = json!({
            "protocol_version": CONTROL_PROTOCOL_VERSION,
            "request_id": request_id,
            "command": "worker_status"
        });
        let response = client
            .request_line(&request.to_string())
            .expect("worker_status request must complete");
        let value: Value = serde_json::from_str(&response).expect("worker_status must be JSON");
        assert_eq!(value["protocol_version"], CONTROL_PROTOCOL_VERSION);
        assert_eq!(value["ok"], true);
        assert_eq!(value["result"]["type"], "worker_status");
        assert_eq!(value["result"]["state"], "ready");
        assert_eq!(value["result"]["maintenance"], false);
        assert_eq!(value["result"]["distro"], self.distro);
        assert_eq!(value["result"]["worker_id"], self.worker_id);
        assert_eq!(
            value["result"]["worker_incarnation"],
            self.worker_incarnation
        );
        assert_eq!(value["result"]["worker_version"], self.worker_version);
    }
}

fn required_env(name: &str) -> String {
    let value = std::env::var(name).unwrap_or_else(|_| panic!("{name} must be set for acceptance"));
    assert!(!value.trim().is_empty(), "{name} must be nonblank");
    value
}

fn required_path(name: &str) -> PathBuf {
    PathBuf::from(required_env(name))
}

struct WorkerJsonlChild {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl WorkerJsonlChild {
    fn spawn(binary: &Path) -> Self {
        let mut child = Command::new(binary)
            .arg("--jsonl")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap_or_else(|error| {
                panic!("ade-worker {} should start: {error}", binary.display())
            });
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
    target: ExecutionTarget,
    remote_identity: Option<String>,
    acceptance: &AcceptanceContext,
) -> ExecutionContext {
    ExecutionContext::new(
        format!("acceptance-{}", case.name),
        case.workspace_kind(),
        acceptance.worker_id.clone(),
        acceptance.worker_incarnation,
        OwnershipContext::new(1),
        target,
        remote_identity,
    )
}

fn run_file(worker: &mut WorkerJsonlChild, case: &LiveTargetCase, context: ExecutionContext) {
    let request = FileWorkerRequest::read(
        format!("acceptance-{}-file", case.name),
        context,
        case.marker_path.clone(),
    );
    let response: FileWorkerResponse = worker.request(&request);
    let marker_text = String::from_utf8_lossy(&response.bytes);
    assert!(
        marker_text.contains(&case.marker_contains),
        "{}: marker file did not contain {:?}; actual={marker_text:?}",
        case.name,
        case.marker_contains
    );
}

fn run_git(worker: &mut WorkerJsonlChild, case: &LiveTargetCase, context: ExecutionContext) {
    let request = GitWorkerRequest::worktree_list(
        format!("acceptance-{}-git", case.name),
        context,
        case.repository_path.clone(),
    );
    let response: GitWorkerResponse = worker.request(&request);
    assert!(
        response
            .worktrees
            .iter()
            .any(|worktree| worktree.path == case.expected_worktree_path),
        "{}: expected worktree path {:?}; actual={:?}",
        case.name,
        case.expected_worktree_path,
        response
            .worktrees
            .iter()
            .map(|worktree| worktree.path.as_str())
            .collect::<Vec<_>>()
    );
}

fn run_pty(
    worker: &mut WorkerJsonlChild,
    case: &LiveTargetCase,
    context: &ExecutionContext,
    pty_target: PtyExecutionTarget,
) {
    let session_id = format!("acceptance-{}-pty", case.name);
    let start_request = PtyRequest::new(
        format!("acceptance-{}-pty-start", case.name),
        context.workspace_id.clone(),
        context.worker_id.clone(),
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
            format!("acceptance-{}-pty-wait", case.name),
            context.workspace_id.clone(),
            context.worker_id.clone(),
            session_id,
            Some(start.session_generation),
            PtyOperation::Wait { timeout_ms: 10_000 },
        );
        worker.request::<PtyResponse, _>(&wait_request)
    };
    assert_eq!(final_response.status, PtyStatus::Exited, "PTY did not exit");
    assert_eq!(
        final_response.exit_code,
        Some(0),
        "PTY exited unsuccessfully"
    );
    assert!(
        final_response.tail.contains(&case.pty_marker),
        "{}: PTY tail did not contain {:?}; tail={:?}",
        case.name,
        case.pty_marker,
        final_response.tail
    );
}

fn run_live_test(
    test_name: &str,
    target: LiveTargetKind,
    workspace_kind: LiveWorkspaceKind,
    operation: LiveOperation,
) {
    let acceptance = AcceptanceContext::load();
    acceptance.verify_ready(test_name);

    let matrix_path = required_env("ADE_LIVE_TARGET_MATRIX");
    let matrix_text = fs::read_to_string(Path::new(&matrix_path))
        .unwrap_or_else(|error| panic!("failed to read {matrix_path}: {error}"));
    let matrix = LiveTargetMatrix::parse(&matrix_text)
        .unwrap_or_else(|error| panic!("invalid live target matrix {matrix_path}: {error}"));
    let case = matrix.case(target, workspace_kind);
    let (execution_target, pty_target, remote_identity) = case.execution_targets();
    let context = execution_context(case, execution_target, remote_identity, &acceptance);
    let mut worker = WorkerJsonlChild::spawn(&acceptance.windows_worker);

    match operation {
        LiveOperation::File => run_file(&mut worker, case, context),
        LiveOperation::Git => run_git(&mut worker, case, context),
        LiveOperation::Pty => run_pty(&mut worker, case, &context, pty_target),
    }
}

macro_rules! live_test {
    ($name:ident, $target:expr, $workspace:expr, $operation:expr) => {
        #[test]
        #[ignore = "requires Windows live acceptance runner"]
        fn $name() {
            run_live_test(stringify!($name), $target, $workspace, $operation);
        }
    };
}

live_test!(
    windows_native_file_folder,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::Folder,
    LiveOperation::File
);
live_test!(
    windows_native_file_worktree,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::File
);
live_test!(
    windows_native_git_folder,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::Folder,
    LiveOperation::Git
);
live_test!(
    windows_native_git_worktree,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::Git
);
live_test!(
    windows_native_pty_folder,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::Folder,
    LiveOperation::Pty
);
live_test!(
    windows_native_pty_worktree,
    LiveTargetKind::WindowsNative,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::Pty
);
live_test!(
    wsl2_file_folder,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::Folder,
    LiveOperation::File
);
live_test!(
    wsl2_file_worktree,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::File
);
live_test!(
    wsl2_git_folder,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::Folder,
    LiveOperation::Git
);
live_test!(
    wsl2_git_worktree,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::Git
);
live_test!(
    wsl2_pty_folder,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::Folder,
    LiveOperation::Pty
);
live_test!(
    wsl2_pty_worktree,
    LiveTargetKind::Wsl2,
    LiveWorkspaceKind::GitWorktree,
    LiveOperation::Pty
);

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
