use super::wsl_worker_supervisor::{
    WslWorkerCommandExecutor, WslWorkerCommandOutput, WslWorkerControlError, WslWorkerHandshake,
    WslWorkerStatus, WslWorkerSupervisor,
};
use super::CommandSpec;
use ade_host_core::protocol::PROTOCOL_VERSION;
use std::collections::VecDeque;
use std::io;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct RecordingExecutor {
    calls: Mutex<Vec<CommandSpec>>,
    outputs: Mutex<VecDeque<io::Result<WslWorkerCommandOutput>>>,
}

impl RecordingExecutor {
    fn with_outputs(outputs: Vec<WslWorkerCommandOutput>) -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(Vec::new()),
            outputs: Mutex::new(outputs.into_iter().map(Ok).collect()),
        })
    }

    fn calls(&self) -> Vec<CommandSpec> {
        self.calls.lock().unwrap().clone()
    }
}

impl WslWorkerCommandExecutor for RecordingExecutor {
    fn execute(&self, command: &CommandSpec) -> io::Result<WslWorkerCommandOutput> {
        self.calls.lock().unwrap().push(command.clone());
        self.outputs
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| panic!("unexpected command: {command:?}"))
    }
}

fn success(stdout: &str) -> WslWorkerCommandOutput {
    WslWorkerCommandOutput {
        success: true,
        code: Some(0),
        stdout: stdout.into(),
        stderr: String::new(),
    }
}

fn failure(code: i32, stderr: &str) -> WslWorkerCommandOutput {
    WslWorkerCommandOutput {
        success: false,
        code: Some(code),
        stdout: String::new(),
        stderr: stderr.into(),
    }
}

fn ready_executor() -> Arc<RecordingExecutor> {
    RecordingExecutor::with_outputs(vec![success(""), success("active\n")])
}

fn handshake() -> WslWorkerHandshake {
    WslWorkerHandshake {
        worker_id: "wsl-ubuntu-worker".into(),
        worker_incarnation: 7,
        protocol_version: PROTOCOL_VERSION,
    }
}

#[test]
fn maintenance_blocks_wsl_wake_without_running_commands() {
    let executor = ready_executor();
    let mut supervisor = WslWorkerSupervisor::new(executor.clone());
    supervisor.set_maintenance(true);

    assert_eq!(
        supervisor.start("Ubuntu-24.04"),
        Err(WslWorkerControlError::MaintenanceMode)
    );
    assert!(executor.calls().is_empty());
    assert_eq!(supervisor.snapshot().generation, 0);
    assert!(supervisor.snapshot().maintenance);
}

#[test]
fn blank_distro_is_rejected_before_process_execution() {
    let executor = ready_executor();
    let mut supervisor = WslWorkerSupervisor::new(executor.clone());

    assert_eq!(
        supervisor.start("   "),
        Err(WslWorkerControlError::EmptyDistro)
    );
    assert!(executor.calls().is_empty());
}

#[test]
fn boot_and_service_probe_are_ordered_and_require_a_later_handshake() {
    let executor = ready_executor();
    let mut supervisor = WslWorkerSupervisor::new(executor.clone());

    let snapshot = supervisor.start("Ubuntu-24.04").unwrap();

    assert_eq!(snapshot.generation, 1);
    assert_eq!(
        snapshot.status,
        WslWorkerStatus::AwaitingHandshake {
            distro: "Ubuntu-24.04".into()
        }
    );
    assert_eq!(
        executor.calls(),
        vec![
            CommandSpec {
                program: "wsl.exe".into(),
                args: vec![
                    "--distribution".into(),
                    "Ubuntu-24.04".into(),
                    "--exec".into(),
                    "/bin/true".into(),
                ],
                working_directory: None,
            },
            CommandSpec {
                program: "wsl.exe".into(),
                args: vec![
                    "--distribution".into(),
                    "Ubuntu-24.04".into(),
                    "--exec".into(),
                    "systemctl".into(),
                    "is-active".into(),
                    "ade-worker.service".into(),
                ],
                working_directory: None,
            },
        ]
    );
}

#[test]
fn boot_or_inactive_service_failure_is_observable_and_never_ready() {
    let boot_executor = RecordingExecutor::with_outputs(vec![failure(1, "boot failed")]);
    let mut boot = WslWorkerSupervisor::new(boot_executor.clone());
    let boot_snapshot = boot.start("Ubuntu-24.04").unwrap();
    assert!(matches!(
        boot_snapshot.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason.contains("boot")
    ));
    assert_eq!(boot_executor.calls().len(), 1);

    let service_executor =
        RecordingExecutor::with_outputs(vec![success(""), success("inactive\n")]);
    let mut service = WslWorkerSupervisor::new(service_executor.clone());
    let service_snapshot = service.start("Ubuntu-24.04").unwrap();
    assert!(matches!(
        service_snapshot.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason.contains("inactive")
    ));
    assert_eq!(service_executor.calls().len(), 2);
}

#[test]
fn exact_generation_handshake_is_the_only_ready_transition() {
    let executor = ready_executor();
    let mut supervisor = WslWorkerSupervisor::new(executor);
    let awaiting = supervisor.start("Ubuntu-24.04").unwrap();

    assert_eq!(
        supervisor.accept_handshake(awaiting.generation + 1, handshake()),
        Err(WslWorkerControlError::StaleGeneration {
            expected: awaiting.generation,
            actual: awaiting.generation + 1,
        })
    );
    assert!(matches!(
        supervisor.snapshot().status,
        WslWorkerStatus::AwaitingHandshake { .. }
    ));

    let ready = supervisor
        .accept_handshake(awaiting.generation, handshake())
        .unwrap();
    assert_eq!(
        ready.status,
        WslWorkerStatus::Ready {
            distro: "Ubuntu-24.04".into(),
            worker_id: "wsl-ubuntu-worker".into(),
            worker_incarnation: 7,
        }
    );
}

#[test]
fn invalid_handshake_identity_or_protocol_fails_the_current_generation() {
    let executor = ready_executor();
    let mut protocol = WslWorkerSupervisor::new(executor);
    let generation = protocol.start("Ubuntu-24.04").unwrap().generation;
    let mut mismatched = handshake();
    mismatched.protocol_version += 1;
    let failed = protocol.accept_handshake(generation, mismatched).unwrap();
    assert!(matches!(
        failed.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason.contains("protocol")
    ));

    let executor = ready_executor();
    let mut identity = WslWorkerSupervisor::new(executor);
    let generation = identity.start("Ubuntu-24.04").unwrap().generation;
    let mut invalid = handshake();
    invalid.worker_incarnation = 0;
    let failed = identity.accept_handshake(generation, invalid).unwrap();
    assert!(matches!(
        failed.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason.contains("incarnation")
    ));
}

#[test]
fn service_loss_is_generation_fenced_and_failed_generation_can_restart() {
    let executor = RecordingExecutor::with_outputs(vec![
        success(""),
        success("active\n"),
        success(""),
        success("active\n"),
    ]);
    let mut supervisor = WslWorkerSupervisor::new(executor.clone());
    let generation = supervisor.start("Ubuntu-24.04").unwrap().generation;
    supervisor
        .accept_handshake(generation, handshake())
        .unwrap();

    assert_eq!(
        supervisor.service_lost(generation + 1, "worker exited"),
        Err(WslWorkerControlError::StaleGeneration {
            expected: generation,
            actual: generation + 1,
        })
    );
    let failed = supervisor
        .service_lost(generation, "worker exited")
        .unwrap();
    assert!(matches!(
        failed.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason == "worker exited"
    ));

    let restarted = supervisor.start("Ubuntu-24.04").unwrap();
    assert_eq!(restarted.generation, generation + 1);
    assert!(matches!(
        restarted.status,
        WslWorkerStatus::AwaitingHandshake { .. }
    ));
    assert_eq!(executor.calls().len(), 4);
}
