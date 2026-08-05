#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionTarget {
    WindowsNative,
    Wsl2 { distro: String },
    Ssh { host: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    EmptyCommand,
    EmptyWslDistro,
    EmptySshHost,
    InvalidTransition,
    StaleGeneration { expected: u64, actual: u64 },
    EmptyFailureReason,
    GenerationOverflow,
}

pub fn build_command(
    target: &ExecutionTarget,
    command: &str,
    args: &[&str],
    working_directory: Option<&str>,
) -> Result<CommandSpec, PlatformError> {
    if command.is_empty() {
        return Err(PlatformError::EmptyCommand);
    }
    let mut command_args = args
        .iter()
        .map(|arg| String::from(*arg))
        .collect::<Vec<_>>();
    let (program, prefix) = match target {
        ExecutionTarget::WindowsNative => (String::from(command), Vec::new()),
        ExecutionTarget::Wsl2 { distro } => {
            if distro.is_empty() {
                return Err(PlatformError::EmptyWslDistro);
            }
            (
                String::from("wsl.exe"),
                vec![
                    String::from("--distribution"),
                    distro.clone(),
                    String::from("--"),
                    String::from(command),
                ],
            )
        }
        ExecutionTarget::Ssh { host } => {
            if host.is_empty() {
                return Err(PlatformError::EmptySshHost);
            }
            (
                String::from("ssh"),
                vec![host.clone(), String::from("--"), String::from(command)],
            )
        }
    };
    let mut full_args = prefix;
    full_args.append(&mut command_args);
    Ok(CommandSpec {
        program,
        args: full_args,
        working_directory: working_directory.map(String::from),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wsl2Status {
    Stopped,
    Starting { distro: String },
    Ready { distro: String },
    Failed { distro: String, reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wsl2Snapshot {
    pub generation: u64,
    pub status: Wsl2Status,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wsl2Lifecycle {
    generation: u64,
    status: Wsl2Status,
}

impl Wsl2Lifecycle {
    pub fn new() -> Self {
        Self {
            generation: 0,
            status: Wsl2Status::Stopped,
        }
    }

    pub fn start(&mut self, distro: impl Into<String>) -> Result<Wsl2Snapshot, PlatformError> {
        let distro = distro.into();
        if distro.is_empty() {
            return Err(PlatformError::EmptyWslDistro);
        }
        if !matches!(self.status, Wsl2Status::Stopped) {
            return Err(PlatformError::InvalidTransition);
        }
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(PlatformError::GenerationOverflow)?;
        self.status = Wsl2Status::Starting { distro };
        Ok(self.snapshot())
    }

    pub fn ready(&mut self, generation: u64) -> Result<Wsl2Snapshot, PlatformError> {
        self.ensure_generation(generation)?;
        let Wsl2Status::Starting { distro } = &self.status else {
            return Err(PlatformError::InvalidTransition);
        };
        self.status = Wsl2Status::Ready {
            distro: distro.clone(),
        };
        Ok(self.snapshot())
    }

    pub fn fail(
        &mut self,
        generation: u64,
        reason: impl Into<String>,
    ) -> Result<Wsl2Snapshot, PlatformError> {
        self.ensure_generation(generation)?;
        let reason = reason.into();
        if reason.is_empty() {
            return Err(PlatformError::EmptyFailureReason);
        }
        let Wsl2Status::Starting { distro } = &self.status else {
            return Err(PlatformError::InvalidTransition);
        };
        self.status = Wsl2Status::Failed {
            distro: distro.clone(),
            reason,
        };
        Ok(self.snapshot())
    }

    pub fn stop(&mut self, generation: u64) -> Result<Wsl2Snapshot, PlatformError> {
        self.ensure_generation(generation)?;
        if matches!(self.status, Wsl2Status::Stopped) {
            return Err(PlatformError::InvalidTransition);
        }
        self.status = Wsl2Status::Stopped;
        Ok(self.snapshot())
    }

    pub fn snapshot(&self) -> Wsl2Snapshot {
        Wsl2Snapshot {
            generation: self.generation,
            status: self.status.clone(),
        }
    }

    fn ensure_generation(&self, actual: u64) -> Result<(), PlatformError> {
        if self.generation != actual {
            return Err(PlatformError::StaleGeneration {
                expected: self.generation,
                actual,
            });
        }
        Ok(())
    }
}

impl Default for Wsl2Lifecycle {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod contract_tests {
    use super::{
        build_command, CommandSpec, ExecutionTarget, PlatformError, Wsl2Lifecycle, Wsl2Status,
    };

    #[test]
    fn renders_native_wsl_and_ssh_commands_without_path_assumptions() {
        assert_eq!(
            build_command(
                &ExecutionTarget::WindowsNative,
                "git",
                &["status"],
                Some(r"C:\workspaces\repo"),
            ),
            Ok(CommandSpec {
                program: String::from("git"),
                args: vec![String::from("status")],
                working_directory: Some(String::from(r"C:\workspaces\repo")),
            })
        );
        assert_eq!(
            build_command(
                &ExecutionTarget::Wsl2 {
                    distro: String::from("Ubuntu-22.04"),
                },
                "git",
                &["status"],
                Some("/workspaces/repo"),
            ),
            Ok(CommandSpec {
                program: String::from("wsl.exe"),
                args: vec![
                    String::from("--distribution"),
                    String::from("Ubuntu-22.04"),
                    String::from("--"),
                    String::from("git"),
                    String::from("status"),
                ],
                working_directory: Some(String::from("/workspaces/repo")),
            })
        );
        assert_eq!(
            build_command(
                &ExecutionTarget::Ssh {
                    host: String::from("dev.example"),
                },
                "git",
                &["status"],
                None,
            ),
            Ok(CommandSpec {
                program: String::from("ssh"),
                args: vec![
                    String::from("dev.example"),
                    String::from("--"),
                    String::from("git"),
                    String::from("status"),
                ],
                working_directory: None,
            })
        );
    }

    #[test]
    fn rejects_empty_remote_identity_and_command() {
        assert_eq!(
            build_command(
                &ExecutionTarget::Wsl2 {
                    distro: String::new()
                },
                "git",
                &[],
                None
            ),
            Err(PlatformError::EmptyWslDistro)
        );
        assert_eq!(
            build_command(
                &ExecutionTarget::Ssh {
                    host: String::new(),
                },
                "git",
                &[],
                None,
            ),
            Err(PlatformError::EmptySshHost)
        );
        assert_eq!(
            build_command(&ExecutionTarget::WindowsNative, "", &[], None),
            Err(PlatformError::EmptyCommand)
        );
    }

    #[test]
    fn requires_authoritative_wsl_generation_for_lifecycle_changes() {
        let mut lifecycle = Wsl2Lifecycle::new();
        let starting = lifecycle
            .start("Ubuntu-22.04")
            .expect("start should succeed");
        assert_eq!(starting.generation, 1);
        assert_eq!(
            lifecycle.ready(0),
            Err(PlatformError::StaleGeneration {
                expected: 1,
                actual: 0,
            })
        );
        assert_eq!(
            lifecycle.ready(1).expect("ready should succeed").status,
            Wsl2Status::Ready {
                distro: String::from("Ubuntu-22.04")
            }
        );
        assert_eq!(
            lifecycle.stop(1).expect("stop should succeed").status,
            Wsl2Status::Stopped
        );
    }

    #[test]
    fn records_authoritative_wsl_failure_and_rejects_invalid_recovery() {
        let mut lifecycle = Wsl2Lifecycle::new();
        let starting = lifecycle.start("Ubuntu").expect("start should succeed");
        assert_eq!(
            lifecycle
                .fail(starting.generation, "distro unavailable")
                .expect("failure should be observable")
                .status,
            Wsl2Status::Failed {
                distro: String::from("Ubuntu"),
                reason: String::from("distro unavailable")
            }
        );
        assert_eq!(
            lifecycle.ready(starting.generation),
            Err(PlatformError::InvalidTransition)
        );
        assert_eq!(lifecycle.start(""), Err(PlatformError::EmptyWslDistro));
    }
}
