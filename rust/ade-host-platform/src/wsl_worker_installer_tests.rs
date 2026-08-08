use super::wsl_worker_installer::{
    WslWorkerInstallCommand, WslWorkerInstallCommandExecutor, WslWorkerInstallCommandOutput,
    WslWorkerInstallFailure, WslWorkerInstallRequest, WslWorkerInstallStage, WslWorkerInstaller,
};
use ade_host_core::protocol::{WorkerHandshakeRequest, WorkerHandshakeResponse, PROTOCOL_VERSION};
use std::collections::VecDeque;
use std::io;
use std::sync::{Arc, Mutex};

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct RecordingExecutor {
    calls: Mutex<Vec<WslWorkerInstallCommand>>,
    outputs: Mutex<VecDeque<io::Result<WslWorkerInstallCommandOutput>>>,
}

impl RecordingExecutor {
    fn with_outputs(outputs: Vec<WslWorkerInstallCommandOutput>) -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(Vec::new()),
            outputs: Mutex::new(outputs.into_iter().map(Ok).collect()),
        })
    }

    fn calls(&self) -> Vec<WslWorkerInstallCommand> {
        self.calls.lock().unwrap().clone()
    }
}

impl WslWorkerInstallCommandExecutor for RecordingExecutor {
    fn execute(
        &self,
        command: &WslWorkerInstallCommand,
    ) -> io::Result<WslWorkerInstallCommandOutput> {
        self.calls.lock().unwrap().push(command.clone());
        self.outputs
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| panic!("unexpected install command: {command:?}"))
    }
}

fn success(stdout: &str) -> WslWorkerInstallCommandOutput {
    WslWorkerInstallCommandOutput {
        success: true,
        code: Some(0),
        stdout: stdout.into(),
        stderr: String::new(),
    }
}

fn failure(code: i32, stderr: &str) -> WslWorkerInstallCommandOutput {
    WslWorkerInstallCommandOutput {
        success: false,
        code: Some(code),
        stdout: String::new(),
        stderr: stderr.into(),
    }
}

fn request() -> WslWorkerInstallRequest {
    WslWorkerInstallRequest {
        distro: "Ubuntu-24.04".into(),
        service_user: "alice".into(),
        worker_id: "wsl-ubuntu".into(),
        worker_incarnation: 7,
        worker_version: "0.1.0".into(),
        expected_sha256: SHA.into(),
        binary: b"worker-binary".to_vec(),
    }
}

fn handshake_json(request_id: &str, worker_id: &str, incarnation: u64, version: &str) -> String {
    serde_json::to_string(&WorkerHandshakeResponse {
        kind: ade_host_core::protocol::WorkerHandshakeKind::WorkerHandshake,
        request_id: request_id.into(),
        protocol_version: PROTOCOL_VERSION,
        worker_id: worker_id.into(),
        worker_incarnation: incarnation,
        worker_version: version.into(),
    })
    .unwrap()
}

fn success_outputs() -> Vec<WslWorkerInstallCommandOutput> {
    let request_id = "wsl-worker-install-7";
    vec![
        success("1000\n"),
        success(""),
        success(""),
        success(""),
        success(&format!(
            "{SHA}  /usr/lib/ade/versions/.ade-worker-0.1.0-7.tmp\n"
        )),
        success(""),
        success(""),
        success(""),
        success(""),
        success(""),
        success(""),
        success(""),
        success(""),
        success(""),
        success("active\n"),
        success(&format!(
            "{}\n",
            handshake_json(request_id, "wsl-ubuntu", 7, "0.1.0")
        )),
    ]
}

#[test]
fn invalid_input_and_root_service_user_fail_before_install_mutation() {
    let executor = RecordingExecutor::with_outputs(Vec::new());
    let installer = WslWorkerInstaller::new(executor.clone());
    let mut invalid = request();
    invalid.worker_version = "../escape".into();
    assert_eq!(
        installer.install(&invalid),
        Err(WslWorkerInstallFailure {
            stage: WslWorkerInstallStage::Validate,
            reason: "invalid_worker_version".into(),
        })
    );
    assert!(executor.calls().is_empty());

    let root_executor = RecordingExecutor::with_outputs(vec![success("0\n")]);
    let root_installer = WslWorkerInstaller::new(root_executor.clone());
    assert_eq!(
        root_installer.install(&request()),
        Err(WslWorkerInstallFailure {
            stage: WslWorkerInstallStage::ProbeServiceUser,
            reason: "service_user_is_root".into(),
        })
    );
    assert_eq!(root_executor.calls().len(), 1);
}

#[test]
fn checksum_mismatch_stops_before_binary_activation_or_service_restart() {
    let executor = RecordingExecutor::with_outputs(vec![
        success("1000\n"),
        success(""),
        success(""),
        success(""),
        success("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  temp\n"),
    ]);
    let installer = WslWorkerInstaller::new(executor.clone());

    let failure = installer.install(&request()).unwrap_err();
    assert_eq!(failure.stage, WslWorkerInstallStage::VerifyChecksum);
    assert!(failure.reason.contains("checksum_mismatch"));
    assert_eq!(executor.calls().len(), 5);
    assert!(!executor.calls().iter().any(|call| {
        call.command
            .args
            .iter()
            .any(|arg| arg == "restart" || arg == "mv")
    }));
}

#[test]
fn restart_failure_is_terminal_and_does_not_attempt_handshake() {
    let mut outputs = success_outputs();
    outputs.truncate(14);
    outputs[13] = failure(1, "restart failed");
    let executor = RecordingExecutor::with_outputs(outputs);
    let installer = WslWorkerInstaller::new(executor.clone());

    let failure = installer.install(&request()).unwrap_err();
    assert_eq!(failure.stage, WslWorkerInstallStage::RestartService);
    assert!(failure.reason.contains("restart failed"));
    assert_eq!(executor.calls().len(), 14);
}

#[test]
fn active_service_with_mismatched_handshake_is_not_installed() {
    let mut outputs = success_outputs();
    outputs[15] = success(&format!(
        "{}\n",
        handshake_json("wsl-worker-install-7", "wsl-ubuntu", 7, "0.0.9")
    ));
    let executor = RecordingExecutor::with_outputs(outputs);
    let installer = WslWorkerInstaller::new(executor);

    let failure = installer.install(&request()).unwrap_err();
    assert_eq!(failure.stage, WslWorkerInstallStage::Handshake);
    assert!(failure.reason.contains("worker_version_mismatch"));
}

#[test]
fn successful_upgrade_writes_private_daemon_unit_and_observes_versioned_handshake() {
    let executor = RecordingExecutor::with_outputs(success_outputs());
    let installer = WslWorkerInstaller::new(executor.clone());
    let installed = installer.install(&request()).unwrap();

    assert_eq!(installed.worker_id, "wsl-ubuntu");
    assert_eq!(installed.worker_incarnation, 7);
    assert_eq!(installed.worker_version, "0.1.0");
    assert_eq!(installed.service_user, "alice");
    assert_eq!(installed.socket_path, "/run/ade/worker.sock");
    assert_eq!(
        installed.binary_path,
        "/usr/lib/ade/versions/ade-worker-0.1.0"
    );

    let calls = executor.calls();
    assert_eq!(calls.len(), 16);
    assert_eq!(calls[0].command.program, "wsl.exe");
    assert_eq!(
        calls[0].command.args,
        vec![
            "--distribution",
            "Ubuntu-24.04",
            "--user",
            "root",
            "--exec",
            "id",
            "-u",
            "alice",
        ]
    );
    assert_eq!(calls[2].stdin, b"worker-binary");
    assert!(calls[2]
        .command
        .args
        .iter()
        .any(|arg| arg == "of=/usr/lib/ade/versions/.ade-worker-0.1.0-7.tmp"));

    let unit_write = &calls[9];
    let unit = String::from_utf8(unit_write.stdin.clone()).unwrap();
    assert!(unit.contains("User=alice\n"));
    assert!(unit.contains("RuntimeDirectory=ade\nRuntimeDirectoryMode=0700\n"));
    assert!(unit.contains("UMask=0077\nNoNewPrivileges=true\n"));
    assert!(unit.contains("Restart=always\nRestartSec=2\nKillMode=mixed\nTimeoutStopSec=30\n"));
    assert!(unit.contains(
        "ExecStart=/usr/lib/ade/ade-worker --serve-unix /run/ade/worker.sock --worker-id wsl-ubuntu --worker-incarnation 7\n"
    ));
    assert!(!unit.contains("User=root"));

    let handshake_call = &calls[15];
    assert!(handshake_call
        .command
        .args
        .windows(2)
        .any(|args| args == ["--user", "alice"]));
    let handshake: WorkerHandshakeRequest =
        serde_json::from_slice(&handshake_call.stdin[..handshake_call.stdin.len() - 1]).unwrap();
    assert_eq!(handshake.request_id, "wsl-worker-install-7");
}
