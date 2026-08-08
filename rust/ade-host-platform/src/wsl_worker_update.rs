use crate::wsl_worker_installer::{
    WslWorkerInstallFailure, WslWorkerInstallRequest, WslWorkerInstaller,
};
use crate::wsl_worker_supervisor::{
    WslWorkerControlError, WslWorkerHandshake, WslWorkerSnapshot, WslWorkerStatus,
    WslWorkerSupervisor,
};
use ade_host_core::protocol::PROTOCOL_VERSION;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslWorkerUpdateStage {
    Validate,
    InvalidateCurrent,
    Install,
    ObserveInstalledWorker,
    Handshake,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerUpdateFailure {
    pub stage: WslWorkerUpdateStage,
    pub reason: String,
    pub snapshot: Option<WslWorkerSnapshot>,
}

pub struct WslWorkerUpdateCoordinator {
    supervisor: Mutex<WslWorkerSupervisor>,
    installer: WslWorkerInstaller,
    update_lock: Mutex<()>,
}

impl WslWorkerUpdateCoordinator {
    pub fn new(supervisor: WslWorkerSupervisor, installer: WslWorkerInstaller) -> Self {
        Self {
            supervisor: Mutex::new(supervisor),
            installer,
            update_lock: Mutex::new(()),
        }
    }

    pub fn snapshot(&self) -> Result<WslWorkerSnapshot, WslWorkerUpdateFailure> {
        self.supervisor
            .lock()
            .map(|supervisor| supervisor.snapshot())
            .map_err(|_| WslWorkerUpdateFailure {
                stage: WslWorkerUpdateStage::ObserveInstalledWorker,
                reason: "supervisor_lock_poisoned".into(),
                snapshot: None,
            })
    }

    pub fn update(
        &self,
        request: &WslWorkerInstallRequest,
    ) -> Result<WslWorkerSnapshot, WslWorkerUpdateFailure> {
        if let Err(failure) = WslWorkerInstaller::validate_request(request) {
            return Err(self.failure_from_install(WslWorkerUpdateStage::Validate, failure));
        }

        let _update = self.update_lock.lock().map_err(|_| {
            self.failure(
                WslWorkerUpdateStage::Validate,
                "update_lock_poisoned".into(),
            )
        })?;

        {
            let mut supervisor = self.supervisor.lock().map_err(|_| {
                self.failure(
                    WslWorkerUpdateStage::InvalidateCurrent,
                    "supervisor_lock_poisoned".into(),
                )
            })?;
            supervisor.set_maintenance(true);
            let snapshot = supervisor.snapshot();
            if matches!(
                snapshot.status,
                WslWorkerStatus::AwaitingHandshake { .. } | WslWorkerStatus::Ready { .. }
            ) {
                supervisor
                    .invalidate_generation(snapshot.generation, "worker_update_in_progress")
                    .map_err(|error| {
                        failure_with_snapshot(
                            WslWorkerUpdateStage::InvalidateCurrent,
                            format!("{error:?}"),
                            supervisor.snapshot(),
                        )
                    })?;
            }
        }

        let installation = self
            .installer
            .install(request)
            .map_err(|failure| self.failure_from_install(WslWorkerUpdateStage::Install, failure))?;

        let mut supervisor = self.supervisor.lock().map_err(|_| {
            self.failure(
                WslWorkerUpdateStage::ObserveInstalledWorker,
                "supervisor_lock_poisoned".into(),
            )
        })?;
        supervisor.set_maintenance(false);
        let observed = match supervisor.start(request.distro.clone()) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                supervisor.set_maintenance(true);
                return Err(failure_with_snapshot(
                    WslWorkerUpdateStage::ObserveInstalledWorker,
                    format_control_error(error),
                    supervisor.snapshot(),
                ));
            }
        };
        if !matches!(observed.status, WslWorkerStatus::AwaitingHandshake { .. }) {
            supervisor.set_maintenance(true);
            return Err(failure_with_snapshot(
                WslWorkerUpdateStage::ObserveInstalledWorker,
                status_failure_reason(&observed.status),
                supervisor.snapshot(),
            ));
        }

        let ready = match supervisor.accept_handshake(
            observed.generation,
            WslWorkerHandshake {
                worker_id: installation.worker_id,
                worker_incarnation: installation.worker_incarnation,
                protocol_version: PROTOCOL_VERSION,
            },
        ) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                supervisor.set_maintenance(true);
                return Err(failure_with_snapshot(
                    WslWorkerUpdateStage::Handshake,
                    format_control_error(error),
                    supervisor.snapshot(),
                ));
            }
        };
        if !matches!(ready.status, WslWorkerStatus::Ready { .. }) {
            supervisor.set_maintenance(true);
            return Err(failure_with_snapshot(
                WslWorkerUpdateStage::Handshake,
                status_failure_reason(&ready.status),
                supervisor.snapshot(),
            ));
        }
        Ok(ready)
    }

    fn failure_from_install(
        &self,
        stage: WslWorkerUpdateStage,
        failure: WslWorkerInstallFailure,
    ) -> WslWorkerUpdateFailure {
        self.failure(stage, format!("{:?}:{}", failure.stage, failure.reason))
    }

    fn failure(&self, stage: WslWorkerUpdateStage, reason: String) -> WslWorkerUpdateFailure {
        let snapshot = self
            .supervisor
            .lock()
            .map(|supervisor| supervisor.snapshot())
            .ok();
        WslWorkerUpdateFailure {
            stage,
            reason,
            snapshot,
        }
    }
}

fn failure_with_snapshot(
    stage: WslWorkerUpdateStage,
    reason: String,
    snapshot: WslWorkerSnapshot,
) -> WslWorkerUpdateFailure {
    WslWorkerUpdateFailure {
        stage,
        reason,
        snapshot: Some(snapshot),
    }
}

fn format_control_error(error: WslWorkerControlError) -> String {
    format!("{error:?}")
}

fn status_failure_reason(status: &WslWorkerStatus) -> String {
    match status {
        WslWorkerStatus::Failed { reason, .. } => reason.clone(),
        other => format!("unexpected_worker_status:{other:?}"),
    }
}
