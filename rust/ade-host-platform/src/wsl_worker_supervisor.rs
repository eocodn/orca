use crate::CommandSpec;
use ade_host_core::protocol::PROTOCOL_VERSION;
use std::process::Command;
use std::sync::Arc;

pub const WSL_WORKER_SERVICE: &str = "ade-worker.service";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerCommandOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub trait WslWorkerCommandExecutor: Send + Sync {
    fn execute(&self, command: &CommandSpec) -> std::io::Result<WslWorkerCommandOutput>;
}

#[derive(Debug, Default)]
pub struct ProcessWslWorkerCommandExecutor;

impl WslWorkerCommandExecutor for ProcessWslWorkerCommandExecutor {
    fn execute(&self, command: &CommandSpec) -> std::io::Result<WslWorkerCommandOutput> {
        let mut process = Command::new(&command.program);
        process.args(&command.args);
        if let Some(working_directory) = &command.working_directory {
            process.current_dir(working_directory);
        }
        let output = process.output()?;
        Ok(WslWorkerCommandOutput {
            success: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerHandshake {
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub protocol_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WslWorkerStatus {
    Stopped,
    AwaitingHandshake {
        distro: String,
    },
    Ready {
        distro: String,
        worker_id: String,
        worker_incarnation: u64,
    },
    Failed {
        distro: String,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerSnapshot {
    pub generation: u64,
    pub maintenance: bool,
    pub status: WslWorkerStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WslWorkerControlError {
    EmptyDistro,
    MaintenanceMode,
    InvalidTransition,
    StaleGeneration { expected: u64, actual: u64 },
    EmptyFailureReason,
    GenerationOverflow,
}

pub struct WslWorkerSupervisor {
    executor: Arc<dyn WslWorkerCommandExecutor>,
    generation: u64,
    maintenance: bool,
    status: WslWorkerStatus,
}

impl WslWorkerSupervisor {
    pub fn new(executor: Arc<dyn WslWorkerCommandExecutor>) -> Self {
        Self {
            executor,
            generation: 0,
            maintenance: false,
            status: WslWorkerStatus::Stopped,
        }
    }

    pub fn with_process_executor() -> Self {
        Self::new(Arc::new(ProcessWslWorkerCommandExecutor))
    }

    pub fn set_maintenance(&mut self, maintenance: bool) -> WslWorkerSnapshot {
        self.maintenance = maintenance;
        self.snapshot()
    }

    pub fn start(
        &mut self,
        distro: impl Into<String>,
    ) -> Result<WslWorkerSnapshot, WslWorkerControlError> {
        let distro = distro.into();
        if distro.trim().is_empty() {
            return Err(WslWorkerControlError::EmptyDistro);
        }
        if self.maintenance {
            return Err(WslWorkerControlError::MaintenanceMode);
        }
        if !matches!(
            self.status,
            WslWorkerStatus::Stopped | WslWorkerStatus::Failed { .. }
        ) {
            return Err(WslWorkerControlError::InvalidTransition);
        }
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(WslWorkerControlError::GenerationOverflow)?;

        let boot = wsl_exec(&distro, &["/bin/true"]);
        let boot_output = match self.executor.execute(&boot) {
            Ok(output) => output,
            Err(error) => return Ok(self.fail(distro, format!("boot_spawn:{error}"))),
        };
        if !boot_output.success {
            return Ok(self.fail(distro, command_failure_reason("boot", &boot_output)));
        }

        let service = wsl_exec(&distro, &["systemctl", "is-active", WSL_WORKER_SERVICE]);
        let service_output = match self.executor.execute(&service) {
            Ok(output) => output,
            Err(error) => return Ok(self.fail(distro, format!("service_probe_spawn:{error}"))),
        };
        if !service_output.success {
            return Ok(self.fail(
                distro,
                command_failure_reason("service_probe", &service_output),
            ));
        }
        let service_state = service_output.stdout.trim();
        if service_state != "active" {
            return Ok(self.fail(distro, format!("service_not_active:{service_state}")));
        }

        self.status = WslWorkerStatus::AwaitingHandshake { distro };
        Ok(self.snapshot())
    }

    pub fn accept_handshake(
        &mut self,
        generation: u64,
        handshake: WslWorkerHandshake,
    ) -> Result<WslWorkerSnapshot, WslWorkerControlError> {
        self.ensure_generation(generation)?;
        let WslWorkerStatus::AwaitingHandshake { distro } = &self.status else {
            return Err(WslWorkerControlError::InvalidTransition);
        };
        let distro = distro.clone();
        if handshake.protocol_version != PROTOCOL_VERSION {
            return Ok(self.fail(
                distro,
                format!(
                    "protocol_mismatch:expected={PROTOCOL_VERSION}:actual={}",
                    handshake.protocol_version
                ),
            ));
        }
        if handshake.worker_id.trim().is_empty() {
            return Ok(self.fail(distro, "worker_id_empty".into()));
        }
        if handshake.worker_incarnation == 0 {
            return Ok(self.fail(
                distro,
                format!(
                    "worker_incarnation_invalid:{}",
                    handshake.worker_incarnation
                ),
            ));
        }
        self.status = WslWorkerStatus::Ready {
            distro,
            worker_id: handshake.worker_id,
            worker_incarnation: handshake.worker_incarnation,
        };
        Ok(self.snapshot())
    }

    pub fn service_lost(
        &mut self,
        generation: u64,
        reason: impl Into<String>,
    ) -> Result<WslWorkerSnapshot, WslWorkerControlError> {
        self.ensure_generation(generation)?;
        let reason = reason.into();
        if reason.trim().is_empty() {
            return Err(WslWorkerControlError::EmptyFailureReason);
        }
        let distro = match &self.status {
            WslWorkerStatus::AwaitingHandshake { distro }
            | WslWorkerStatus::Ready { distro, .. } => distro.clone(),
            _ => return Err(WslWorkerControlError::InvalidTransition),
        };
        Ok(self.fail(distro, reason))
    }

    pub fn snapshot(&self) -> WslWorkerSnapshot {
        WslWorkerSnapshot {
            generation: self.generation,
            maintenance: self.maintenance,
            status: self.status.clone(),
        }
    }

    fn ensure_generation(&self, actual: u64) -> Result<(), WslWorkerControlError> {
        if actual != self.generation {
            Err(WslWorkerControlError::StaleGeneration {
                expected: self.generation,
                actual,
            })
        } else {
            Ok(())
        }
    }

    fn fail(&mut self, distro: String, reason: String) -> WslWorkerSnapshot {
        self.status = WslWorkerStatus::Failed { distro, reason };
        self.snapshot()
    }
}

impl Default for WslWorkerSupervisor {
    fn default() -> Self {
        Self::with_process_executor()
    }
}

fn wsl_exec(distro: &str, command: &[&str]) -> CommandSpec {
    let mut args = vec![
        String::from("--distribution"),
        distro.to_string(),
        String::from("--exec"),
    ];
    args.extend(command.iter().map(|value| String::from(*value)));
    CommandSpec {
        program: String::from("wsl.exe"),
        args,
        working_directory: None,
    }
}

fn command_failure_reason(operation: &str, output: &WslWorkerCommandOutput) -> String {
    let detail = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    format!("{operation}_failed:code={:?}:{detail}", output.code)
}
