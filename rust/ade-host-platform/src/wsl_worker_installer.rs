use crate::CommandSpec;
use ade_host_core::protocol::{WorkerHandshakeRequest, WorkerHandshakeResponse, PROTOCOL_VERSION};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const WSL_WORKER_SOCKET: &str = "/run/ade/worker.sock";
pub const WSL_WORKER_LINK: &str = "/usr/lib/ade/ade-worker";
pub const WSL_WORKER_UNIT: &str = "/etc/systemd/system/ade-worker.service";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerInstallRequest {
    pub distro: String,
    pub service_user: String,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub worker_version: String,
    pub expected_sha256: String,
    pub binary: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WslWorkerInstallStage {
    Validate,
    ProbeServiceUser,
    PrepareDirectories,
    UploadBinary,
    SetBinaryMode,
    VerifyChecksum,
    ActivateVersion,
    RemoveStaleLink,
    PrepareLink,
    ActivateLink,
    WriteUnit,
    SetUnitMode,
    DaemonReload,
    EnableService,
    RestartService,
    ObserveService,
    Handshake,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerInstallFailure {
    pub stage: WslWorkerInstallStage,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerInstallation {
    pub service_user: String,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub worker_version: String,
    pub binary_path: String,
    pub socket_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerInstallCommand {
    pub command: CommandSpec,
    pub stdin: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslWorkerInstallCommandOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

pub trait WslWorkerInstallCommandExecutor: Send + Sync {
    fn execute(
        &self,
        command: &WslWorkerInstallCommand,
    ) -> std::io::Result<WslWorkerInstallCommandOutput>;
}

#[derive(Debug, Default)]
pub struct ProcessWslWorkerInstallCommandExecutor;

impl WslWorkerInstallCommandExecutor for ProcessWslWorkerInstallCommandExecutor {
    fn execute(
        &self,
        invocation: &WslWorkerInstallCommand,
    ) -> std::io::Result<WslWorkerInstallCommandOutput> {
        let mut command = Command::new(&invocation.command.program);
        command.args(&invocation.command.args);
        if let Some(working_directory) = &invocation.command.working_directory {
            command.current_dir(working_directory);
        }
        command.stdin(if invocation.stdin.is_empty() {
            Stdio::null()
        } else {
            Stdio::piped()
        });
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = command.spawn()?;
        if !invocation.stdin.is_empty() {
            let mut stdin = child.stdin.take().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::BrokenPipe, "install stdin unavailable")
            })?;
            if let Err(error) = stdin.write_all(&invocation.stdin) {
                drop(stdin);
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
        let output = child.wait_with_output()?;
        Ok(WslWorkerInstallCommandOutput {
            success: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

pub struct WslWorkerInstaller {
    executor: Arc<dyn WslWorkerInstallCommandExecutor>,
    install_lock: Mutex<()>,
}

impl WslWorkerInstaller {
    pub fn new(executor: Arc<dyn WslWorkerInstallCommandExecutor>) -> Self {
        Self {
            executor,
            install_lock: Mutex::new(()),
        }
    }

    pub fn with_process_executor() -> Self {
        Self::new(Arc::new(ProcessWslWorkerInstallCommandExecutor))
    }

    pub fn install(
        &self,
        request: &WslWorkerInstallRequest,
    ) -> Result<WslWorkerInstallation, WslWorkerInstallFailure> {
        let _guard = self
            .install_lock
            .lock()
            .map_err(|_| WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Validate,
                reason: "installer_lock_poisoned".into(),
            })?;
        let validated = ValidatedInstall::new(request)?;
        self.install_validated(request, &validated)
    }

    fn install_validated(
        &self,
        request: &WslWorkerInstallRequest,
        validated: &ValidatedInstall,
    ) -> Result<WslWorkerInstallation, WslWorkerInstallFailure> {
        let uid = self.run(
            WslWorkerInstallStage::ProbeServiceUser,
            wsl_root(&request.distro, "id", &["-u", &request.service_user]),
            Vec::new(),
        )?;
        let uid = uid
            .stdout
            .trim()
            .parse::<u32>()
            .map_err(|_| WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::ProbeServiceUser,
                reason: format!("invalid_service_uid:{}", uid.stdout.trim()),
            })?;
        if uid == 0 {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::ProbeServiceUser,
                reason: "service_user_is_root".into(),
            });
        }

        self.run(
            WslWorkerInstallStage::PrepareDirectories,
            wsl_root(
                &request.distro,
                "install",
                &[
                    "-d",
                    "-o",
                    "root",
                    "-g",
                    "root",
                    "-m",
                    "0755",
                    "/usr/lib/ade",
                    "/usr/lib/ade/versions",
                ],
            ),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::UploadBinary,
            wsl_root(
                &request.distro,
                "dd",
                &[&format!("of={}", validated.temp_binary)],
            ),
            request.binary.clone(),
        )?;
        self.run(
            WslWorkerInstallStage::SetBinaryMode,
            wsl_root(
                &request.distro,
                "chmod",
                &["0755", "--", &validated.temp_binary],
            ),
            Vec::new(),
        )?;
        let checksum = self.run(
            WslWorkerInstallStage::VerifyChecksum,
            wsl_root(
                &request.distro,
                "sha256sum",
                &["--", &validated.temp_binary],
            ),
            Vec::new(),
        )?;
        let observed_checksum = checksum
            .stdout
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if observed_checksum != validated.expected_sha256 {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::VerifyChecksum,
                reason: format!(
                    "checksum_mismatch:expected={}:actual={observed_checksum}",
                    validated.expected_sha256
                ),
            });
        }

        self.run(
            WslWorkerInstallStage::ActivateVersion,
            wsl_root(
                &request.distro,
                "mv",
                &["--", &validated.temp_binary, &validated.final_binary],
            ),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::RemoveStaleLink,
            wsl_root(
                &request.distro,
                "rm",
                &["--force", "--", &validated.temp_link],
            ),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::PrepareLink,
            wsl_root(
                &request.distro,
                "ln",
                &[
                    "--symbolic",
                    "--",
                    &validated.final_binary,
                    &validated.temp_link,
                ],
            ),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::ActivateLink,
            wsl_root(
                &request.distro,
                "mv",
                &[
                    "--no-target-directory",
                    "--",
                    &validated.temp_link,
                    WSL_WORKER_LINK,
                ],
            ),
            Vec::new(),
        )?;

        let unit = render_unit(request);
        self.run(
            WslWorkerInstallStage::WriteUnit,
            wsl_root(&request.distro, "dd", &[&format!("of={WSL_WORKER_UNIT}")]),
            unit.into_bytes(),
        )?;
        self.run(
            WslWorkerInstallStage::SetUnitMode,
            wsl_root(&request.distro, "chmod", &["0644", "--", WSL_WORKER_UNIT]),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::DaemonReload,
            wsl_root(&request.distro, "systemctl", &["daemon-reload"]),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::EnableService,
            wsl_root(
                &request.distro,
                "systemctl",
                &["enable", "ade-worker.service"],
            ),
            Vec::new(),
        )?;
        self.run(
            WslWorkerInstallStage::RestartService,
            wsl_root(
                &request.distro,
                "systemctl",
                &["restart", "ade-worker.service"],
            ),
            Vec::new(),
        )?;
        let service = self.run(
            WslWorkerInstallStage::ObserveService,
            wsl_root(
                &request.distro,
                "systemctl",
                &["is-active", "ade-worker.service"],
            ),
            Vec::new(),
        )?;
        if service.stdout.trim() != "active" {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::ObserveService,
                reason: format!("service_not_active:{}", service.stdout.trim()),
            });
        }

        let handshake_request = WorkerHandshakeRequest::new(format!(
            "wsl-worker-install-{}",
            request.worker_incarnation
        ));
        let mut handshake_stdin =
            serde_json::to_vec(&handshake_request).map_err(|error| WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!("handshake_request_serialization:{error}"),
            })?;
        handshake_stdin.push(b'\n');
        let handshake = self.run(
            WslWorkerInstallStage::Handshake,
            wsl_user(
                &request.distro,
                &request.service_user,
                WSL_WORKER_LINK,
                &["--connect-unix", WSL_WORKER_SOCKET],
            ),
            handshake_stdin,
        )?;
        let mut lines = handshake
            .stdout
            .lines()
            .filter(|line| !line.trim().is_empty());
        let response_line = lines.next().ok_or_else(|| WslWorkerInstallFailure {
            stage: WslWorkerInstallStage::Handshake,
            reason: "handshake_response_empty".into(),
        })?;
        if lines.next().is_some() {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: "handshake_response_multiple_lines".into(),
            });
        }
        let response: WorkerHandshakeResponse =
            serde_json::from_str(response_line).map_err(|error| WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!("handshake_response_invalid:{error}"),
            })?;
        response
            .validate_for(&handshake_request)
            .map_err(|error| WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!("handshake_invalid:{error:?}"),
            })?;
        if response.protocol_version != PROTOCOL_VERSION {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!(
                    "protocol_version_mismatch:expected={PROTOCOL_VERSION}:actual={}",
                    response.protocol_version
                ),
            });
        }
        if response.worker_id != request.worker_id {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!(
                    "worker_id_mismatch:expected={}:actual={}",
                    request.worker_id, response.worker_id
                ),
            });
        }
        if response.worker_incarnation != request.worker_incarnation {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!(
                    "worker_incarnation_mismatch:expected={}:actual={}",
                    request.worker_incarnation, response.worker_incarnation
                ),
            });
        }
        if response.worker_version != request.worker_version {
            return Err(WslWorkerInstallFailure {
                stage: WslWorkerInstallStage::Handshake,
                reason: format!(
                    "worker_version_mismatch:expected={}:actual={}",
                    request.worker_version, response.worker_version
                ),
            });
        }

        Ok(WslWorkerInstallation {
            service_user: request.service_user.clone(),
            worker_id: request.worker_id.clone(),
            worker_incarnation: request.worker_incarnation,
            worker_version: request.worker_version.clone(),
            binary_path: validated.final_binary.clone(),
            socket_path: WSL_WORKER_SOCKET.into(),
        })
    }

    fn run(
        &self,
        stage: WslWorkerInstallStage,
        command: CommandSpec,
        stdin: Vec<u8>,
    ) -> Result<WslWorkerInstallCommandOutput, WslWorkerInstallFailure> {
        let invocation = WslWorkerInstallCommand { command, stdin };
        let output =
            self.executor
                .execute(&invocation)
                .map_err(|error| WslWorkerInstallFailure {
                    stage,
                    reason: format!("spawn_failed:{error}"),
                })?;
        if !output.success {
            let detail = if output.stderr.trim().is_empty() {
                output.stdout.trim()
            } else {
                output.stderr.trim()
            };
            return Err(WslWorkerInstallFailure {
                stage,
                reason: format!("command_failed:code={:?}:{detail}", output.code),
            });
        }
        Ok(output)
    }
}

impl Default for WslWorkerInstaller {
    fn default() -> Self {
        Self::with_process_executor()
    }
}

struct ValidatedInstall {
    expected_sha256: String,
    temp_binary: String,
    final_binary: String,
    temp_link: String,
}

impl ValidatedInstall {
    fn new(request: &WslWorkerInstallRequest) -> Result<Self, WslWorkerInstallFailure> {
        let invalid = |reason: &str| WslWorkerInstallFailure {
            stage: WslWorkerInstallStage::Validate,
            reason: reason.into(),
        };
        if request.distro.trim().is_empty() {
            return Err(invalid("empty_distro"));
        }
        if !is_safe_identifier(&request.service_user) {
            return Err(invalid("invalid_service_user"));
        }
        if !is_safe_identifier(&request.worker_id) {
            return Err(invalid("invalid_worker_id"));
        }
        if !is_safe_version(&request.worker_version) {
            return Err(invalid("invalid_worker_version"));
        }
        if request.worker_incarnation == 0 || request.worker_incarnation > MAX_SAFE_INTEGER {
            return Err(invalid("invalid_worker_incarnation"));
        }
        if request.binary.is_empty() {
            return Err(invalid("empty_worker_binary"));
        }
        if request.expected_sha256.len() != 64
            || !request
                .expected_sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid("invalid_expected_sha256"));
        }
        let expected_sha256 = request.expected_sha256.to_ascii_lowercase();
        let temp_binary = format!(
            "/usr/lib/ade/versions/.ade-worker-{}-{}.tmp",
            request.worker_version, request.worker_incarnation
        );
        let final_binary = format!(
            "/usr/lib/ade/versions/ade-worker-{}",
            request.worker_version
        );
        let temp_link = format!(
            "/usr/lib/ade/.ade-worker-{}.link.tmp",
            request.worker_incarnation
        );
        Ok(Self {
            expected_sha256,
            temp_binary,
            final_binary,
            temp_link,
        })
    }
}

fn is_safe_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    (first.is_ascii_alphanumeric() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn is_safe_version(value: &str) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'+'))
}

fn render_unit(request: &WslWorkerInstallRequest) -> String {
    format!(
        "[Unit]\nDescription=ADE WSL Worker\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser={}\nRuntimeDirectory=ade\nRuntimeDirectoryMode=0700\nUMask=0077\nNoNewPrivileges=true\nExecStart={} --serve-unix {} --worker-id {} --worker-incarnation {}\nRestart=always\nRestartSec=2\nKillMode=mixed\nTimeoutStopSec=30\n\n[Install]\nWantedBy=multi-user.target\n",
        request.service_user,
        WSL_WORKER_LINK,
        WSL_WORKER_SOCKET,
        request.worker_id,
        request.worker_incarnation,
    )
}

fn wsl_root(distro: &str, program: &str, args: &[&str]) -> CommandSpec {
    wsl_user(distro, "root", program, args)
}

fn wsl_user(distro: &str, user: &str, program: &str, args: &[&str]) -> CommandSpec {
    let mut command_args = vec![
        "--distribution".into(),
        distro.into(),
        "--user".into(),
        user.into(),
        "--exec".into(),
        program.into(),
    ];
    command_args.extend(args.iter().map(|arg| String::from(*arg)));
    CommandSpec {
        program: "wsl.exe".into(),
        args: command_args,
        working_directory: None,
    }
}
