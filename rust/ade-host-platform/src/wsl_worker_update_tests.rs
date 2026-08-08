use super::wsl_worker_installer::{
    WslWorkerInstallCommand, WslWorkerInstallCommandExecutor, WslWorkerInstallCommandOutput,
    WslWorkerInstallRequest, WslWorkerInstaller,
};
use super::wsl_worker_supervisor::{
    WslWorkerCommandExecutor, WslWorkerCommandOutput, WslWorkerHandshake, WslWorkerStatus,
    WslWorkerSupervisor,
};
use super::wsl_worker_update::{WslWorkerUpdateCoordinator, WslWorkerUpdateStage};
use super::CommandSpec;
use ade_host_core::protocol::{
    WorkerHandshakeKind, WorkerHandshakeRequest, WorkerHandshakeResponse, PROTOCOL_VERSION,
};
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct SupervisorExecutor {
    calls: Mutex<Vec<CommandSpec>>,
    fail_next_service_probe: Mutex<bool>,
}

impl SupervisorExecutor {
    fn fail_next_service_probe(&self) {
        *self.fail_next_service_probe.lock().unwrap() = true;
    }

    fn calls(&self) -> Vec<CommandSpec> {
        self.calls.lock().unwrap().clone()
    }
}

impl WslWorkerCommandExecutor for SupervisorExecutor {
    fn execute(&self, command: &CommandSpec) -> io::Result<WslWorkerCommandOutput> {
        self.calls.lock().unwrap().push(command.clone());
        let is_service_probe = command
            .args
            .windows(3)
            .any(|args| args == ["systemctl", "is-active", "ade-worker.service"]);
        if is_service_probe && std::mem::take(&mut *self.fail_next_service_probe.lock().unwrap()) {
            return Ok(WslWorkerCommandOutput {
                success: true,
                code: Some(0),
                stdout: "inactive\n".into(),
                stderr: String::new(),
            });
        }
        Ok(WslWorkerCommandOutput {
            success: true,
            code: Some(0),
            stdout: if is_service_probe {
                "active\n".into()
            } else {
                String::new()
            },
            stderr: String::new(),
        })
    }
}

#[derive(Default)]
struct InstallerExecutor {
    calls: Mutex<Vec<WslWorkerInstallCommand>>,
    fail_restart: Mutex<bool>,
}

impl InstallerExecutor {
    fn fail_restart(&self) {
        *self.fail_restart.lock().unwrap() = true;
    }

    fn calls(&self) -> Vec<WslWorkerInstallCommand> {
        self.calls.lock().unwrap().clone()
    }
}

impl WslWorkerInstallCommandExecutor for InstallerExecutor {
    fn execute(
        &self,
        command: &WslWorkerInstallCommand,
    ) -> io::Result<WslWorkerInstallCommandOutput> {
        self.calls.lock().unwrap().push(command.clone());
        let args = &command.command.args;
        let tail = args
            .iter()
            .position(|arg| arg == "--exec")
            .map(|index| &args[index + 1..])
            .unwrap_or(&[]);
        if tail.first().map(String::as_str) == Some("id") {
            return Ok(success("1000\n"));
        }
        if tail.first().map(String::as_str) == Some("sha256sum") {
            return Ok(success(&format!("{SHA}  temp\n")));
        }
        if tail == ["systemctl", "restart", "ade-worker.service"]
            && std::mem::take(&mut *self.fail_restart.lock().unwrap())
        {
            return Ok(WslWorkerInstallCommandOutput {
                success: false,
                code: Some(1),
                stdout: String::new(),
                stderr: "restart failed".into(),
            });
        }
        if tail == ["systemctl", "is-active", "ade-worker.service"] {
            return Ok(success("active\n"));
        }
        if tail.first().map(String::as_str) == Some("/usr/lib/ade/ade-worker") {
            let request: WorkerHandshakeRequest =
                serde_json::from_slice(&command.stdin[..command.stdin.len() - 1]).unwrap();
            let incarnation = request
                .request_id
                .rsplit('-')
                .next()
                .unwrap()
                .parse::<u64>()
                .unwrap();
            let response = WorkerHandshakeResponse {
                kind: WorkerHandshakeKind::WorkerHandshake,
                request_id: request.request_id,
                protocol_version: PROTOCOL_VERSION,
                worker_id: "wsl-worker".into(),
                worker_incarnation: incarnation,
                worker_version: "0.1.0".into(),
            };
            return Ok(success(&format!(
                "{}\n",
                serde_json::to_string(&response).unwrap()
            )));
        }
        Ok(success(""))
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

fn request(incarnation: u64) -> WslWorkerInstallRequest {
    WslWorkerInstallRequest {
        distro: "Ubuntu-24.04".into(),
        service_user: "alice".into(),
        worker_id: "wsl-worker".into(),
        worker_incarnation: incarnation,
        worker_version: "0.1.0".into(),
        expected_sha256: SHA.into(),
        binary: b"worker-binary".to_vec(),
    }
}

fn ready_supervisor(executor: Arc<SupervisorExecutor>, incarnation: u64) -> WslWorkerSupervisor {
    let mut supervisor = WslWorkerSupervisor::new(executor);
    let generation = supervisor.start("Ubuntu-24.04").unwrap().generation;
    supervisor
        .accept_handshake(
            generation,
            WslWorkerHandshake {
                worker_id: "wsl-worker".into(),
                worker_incarnation: incarnation,
                protocol_version: PROTOCOL_VERSION,
            },
        )
        .unwrap();
    supervisor
}

#[test]
fn invalid_preflight_preserves_existing_ready_generation_and_maintenance_state() {
    let supervisor_executor = Arc::new(SupervisorExecutor::default());
    let supervisor = ready_supervisor(supervisor_executor.clone(), 6);
    let installer_executor = Arc::new(InstallerExecutor::default());
    let coordinator = WslWorkerUpdateCoordinator::new(
        supervisor,
        WslWorkerInstaller::new(installer_executor.clone()),
    );
    let before = coordinator.snapshot().unwrap();
    let mut invalid = request(7);
    invalid.worker_version = "../escape".into();

    let failure = coordinator.update(&invalid).unwrap_err();

    assert_eq!(failure.stage, WslWorkerUpdateStage::Validate);
    assert_eq!(failure.snapshot, Some(before.clone()));
    assert!(!failure.snapshot.as_ref().unwrap().maintenance);
    assert!(matches!(before.status, WslWorkerStatus::Ready { .. }));
    assert!(installer_executor.calls().is_empty());
    assert_eq!(supervisor_executor.calls().len(), 2);
}

#[test]
fn successful_update_invalidates_old_ready_and_publishes_new_ready_generation() {
    let supervisor_executor = Arc::new(SupervisorExecutor::default());
    let supervisor = ready_supervisor(supervisor_executor.clone(), 6);
    let installer_executor = Arc::new(InstallerExecutor::default());
    let coordinator = WslWorkerUpdateCoordinator::new(
        supervisor,
        WslWorkerInstaller::new(installer_executor.clone()),
    );

    let ready = coordinator.update(&request(7)).unwrap();

    assert_eq!(ready.generation, 2);
    assert!(!ready.maintenance);
    assert_eq!(
        ready.status,
        WslWorkerStatus::Ready {
            distro: "Ubuntu-24.04".into(),
            worker_id: "wsl-worker".into(),
            worker_incarnation: 7,
        }
    );
    assert_eq!(installer_executor.calls().len(), 16);
    assert_eq!(supervisor_executor.calls().len(), 4);
}

#[test]
fn installer_failure_keeps_maintenance_and_never_restores_old_ready_worker() {
    let supervisor_executor = Arc::new(SupervisorExecutor::default());
    let supervisor = ready_supervisor(supervisor_executor, 6);
    let installer_executor = Arc::new(InstallerExecutor::default());
    installer_executor.fail_restart();
    let coordinator =
        WslWorkerUpdateCoordinator::new(supervisor, WslWorkerInstaller::new(installer_executor));

    let failure = coordinator.update(&request(7)).unwrap_err();

    assert_eq!(failure.stage, WslWorkerUpdateStage::Install);
    let snapshot = failure.snapshot.unwrap();
    assert!(snapshot.maintenance);
    assert!(matches!(
        snapshot.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason == "worker_update_in_progress"
    ));
}

#[test]
fn post_install_service_recheck_failure_returns_to_maintenance() {
    let supervisor_executor = Arc::new(SupervisorExecutor::default());
    let supervisor = ready_supervisor(supervisor_executor.clone(), 6);
    supervisor_executor.fail_next_service_probe();
    let coordinator = WslWorkerUpdateCoordinator::new(
        supervisor,
        WslWorkerInstaller::new(Arc::new(InstallerExecutor::default())),
    );

    let failure = coordinator.update(&request(7)).unwrap_err();

    assert_eq!(failure.stage, WslWorkerUpdateStage::ObserveInstalledWorker);
    let snapshot = failure.snapshot.unwrap();
    assert!(snapshot.maintenance);
    assert!(matches!(
        snapshot.status,
        WslWorkerStatus::Failed { ref reason, .. } if reason.contains("service_not_active")
    ));
}

struct BlockingInstallerExecutor {
    inner: InstallerExecutor,
    probes: AtomicUsize,
    gate: Arc<(Mutex<bool>, Condvar)>,
}

impl WslWorkerInstallCommandExecutor for BlockingInstallerExecutor {
    fn execute(
        &self,
        command: &WslWorkerInstallCommand,
    ) -> io::Result<WslWorkerInstallCommandOutput> {
        let is_probe = command.command.args.iter().any(|arg| arg == "id");
        if is_probe && self.probes.fetch_add(1, Ordering::SeqCst) == 0 {
            let (lock, cv) = &*self.gate;
            let mut released = lock.lock().unwrap();
            while !*released {
                released = cv.wait(released).unwrap();
            }
        }
        self.inner.execute(command)
    }
}

#[test]
fn concurrent_updates_are_serialized_across_install_and_ready_publication() {
    let supervisor_executor = Arc::new(SupervisorExecutor::default());
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let installer_executor = Arc::new(BlockingInstallerExecutor {
        inner: InstallerExecutor::default(),
        probes: AtomicUsize::new(0),
        gate: Arc::clone(&gate),
    });
    let coordinator = Arc::new(WslWorkerUpdateCoordinator::new(
        WslWorkerSupervisor::new(supervisor_executor),
        WslWorkerInstaller::new(installer_executor.clone()),
    ));

    let first = {
        let coordinator = Arc::clone(&coordinator);
        thread::spawn(move || coordinator.update(&request(7)))
    };
    while installer_executor.probes.load(Ordering::SeqCst) == 0 {
        thread::yield_now();
    }
    let second = {
        let coordinator = Arc::clone(&coordinator);
        thread::spawn(move || coordinator.update(&request(8)))
    };
    thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(installer_executor.probes.load(Ordering::SeqCst), 1);
    {
        let (lock, cv) = &*gate;
        *lock.lock().unwrap() = true;
        cv.notify_all();
    }

    let first = first.join().unwrap().unwrap();
    let second = second.join().unwrap().unwrap();
    assert_eq!(first.generation, 1);
    assert_eq!(second.generation, 2);
    assert_eq!(
        second.status,
        WslWorkerStatus::Ready {
            distro: "Ubuntu-24.04".into(),
            worker_id: "wsl-worker".into(),
            worker_incarnation: 8,
        }
    );
}
