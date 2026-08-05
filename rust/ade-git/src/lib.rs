#[cfg(test)]
mod contract_tests {
    use super::{parse_cli_args, GitCliError, GitCliOptions, GitCliTarget};

    #[test]
    fn parses_a_strict_json_worktree_request_for_wsl2() {
        assert_eq!(
            parse_cli_args([
                "--json",
                "--worktree-list",
                "--repo",
                "/workspaces/repo",
                "--target",
                "wsl2",
                "--wsl-distro",
                "Ubuntu-22.04",
            ]),
            Ok(GitCliOptions {
                json: true,
                worktree_list: true,
                repository_path: String::from("/workspaces/repo"),
                target: GitCliTarget::Wsl2 {
                    distro: String::from("Ubuntu-22.04"),
                },
            })
        );
    }

    #[test]
    fn rejects_unknown_or_incomplete_git_requests() {
        assert_eq!(
            parse_cli_args(["--worktree-list", "--repo", "/repo"]),
            Err(GitCliError::MissingTarget)
        );
        assert_eq!(
            parse_cli_args(["--worktree-list", "--repo", "/repo", "--target", "ssh"]),
            Err(GitCliError::MissingSshHost)
        );
        assert_eq!(
            parse_cli_args(["--legacy-mode"]),
            Err(GitCliError::UnexpectedArgument(String::from(
                "--legacy-mode"
            )))
        );
    }
}

use ade_host_platform::git_execution::{
    run_git_worktree_list, GitExecutionError, ProcessGitCommandExecutor,
};
use ade_host_platform::git_worktree::GitWorktree;
use ade_host_platform::ExecutionTarget;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCliTarget {
    WindowsNative,
    Wsl2 { distro: String },
    Ssh { host: String },
}

#[derive(Debug, PartialEq, Eq)]
pub struct GitCliOptions {
    pub json: bool,
    pub worktree_list: bool,
    pub repository_path: String,
    pub target: GitCliTarget,
}

#[derive(Debug, PartialEq, Eq)]
pub enum GitCliError {
    MissingOperation,
    MissingRepositoryPath,
    MissingTarget,
    InvalidTarget(String),
    MissingWslDistro,
    MissingSshHost,
    ConflictingTargetIdentity,
    UnexpectedArgument(String),
    Execution(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<GitCliOptions, GitCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut worktree_list = false;
    let mut repository_path = None;
    let mut target = None;
    let mut wsl_distro = None;
    let mut ssh_host = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => json = true,
            "--worktree-list" => worktree_list = true,
            "--repo" => {
                let path = args.next().ok_or(GitCliError::MissingRepositoryPath)?;
                if path.trim().is_empty() {
                    return Err(GitCliError::MissingRepositoryPath);
                }
                repository_path = Some(path);
            }
            "--target" => {
                let value = args.next().ok_or(GitCliError::MissingTarget)?;
                target = Some(value);
            }
            "--wsl-distro" => {
                let value = args.next().ok_or(GitCliError::MissingWslDistro)?;
                if value.trim().is_empty() {
                    return Err(GitCliError::MissingWslDistro);
                }
                wsl_distro = Some(value);
            }
            "--ssh-host" => {
                let value = args.next().ok_or(GitCliError::MissingSshHost)?;
                if value.trim().is_empty() {
                    return Err(GitCliError::MissingSshHost);
                }
                ssh_host = Some(value);
            }
            _ => return Err(GitCliError::UnexpectedArgument(argument)),
        }
    }

    let target = match target.ok_or(GitCliError::MissingTarget)?.as_str() {
        "windows-native" if wsl_distro.is_none() && ssh_host.is_none() => {
            GitCliTarget::WindowsNative
        }
        "wsl2" if ssh_host.is_none() => GitCliTarget::Wsl2 {
            distro: wsl_distro.ok_or(GitCliError::MissingWslDistro)?,
        },
        "ssh" if wsl_distro.is_none() => GitCliTarget::Ssh {
            host: ssh_host.ok_or(GitCliError::MissingSshHost)?,
        },
        "windows-native" | "wsl2" | "ssh" => return Err(GitCliError::ConflictingTargetIdentity),
        value => return Err(GitCliError::InvalidTarget(value.to_string())),
    };

    if !worktree_list {
        return Err(GitCliError::MissingOperation);
    }
    Ok(GitCliOptions {
        json,
        worktree_list,
        repository_path: repository_path.ok_or(GitCliError::MissingRepositoryPath)?,
        target,
    })
}

#[derive(Serialize)]
struct GitStatusJson<'a> {
    service: &'static str,
    operation: &'static str,
    target: &'a str,
    repository_path: &'a str,
    worktrees: &'a [GitWorktree],
}

pub fn run_cli<I, S>(args: I) -> Result<String, GitCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_cli_args(args)?;
    let target = execution_target(&options.target);
    let registry = ade_host_platform::git_capability::GitCapabilityRegistry::new();
    let worktrees = run_git_worktree_list(
        &target,
        &options.repository_path,
        &registry,
        &ProcessGitCommandExecutor,
    )
    .map_err(|error| GitCliError::Execution(format_execution_error(error)))?;
    if options.json {
        return serde_json::to_string(&GitStatusJson {
            service: "ade-git",
            operation: "worktree-list",
            target: target_name(&options.target),
            repository_path: &options.repository_path,
            worktrees: &worktrees,
        })
        .map_err(|error| GitCliError::Execution(error.to_string()));
    }
    Ok(format!(
        "ade-git worktree-list repository={} count={}",
        options.repository_path,
        worktrees.len()
    ))
}

fn execution_target(target: &GitCliTarget) -> ExecutionTarget {
    match target {
        GitCliTarget::WindowsNative => ExecutionTarget::WindowsNative,
        GitCliTarget::Wsl2 { distro } => ExecutionTarget::Wsl2 {
            distro: distro.clone(),
        },
        GitCliTarget::Ssh { host } => ExecutionTarget::Ssh { host: host.clone() },
    }
}

fn target_name(target: &GitCliTarget) -> &'static str {
    match target {
        GitCliTarget::WindowsNative => "windows-native",
        GitCliTarget::Wsl2 { .. } => "wsl2",
        GitCliTarget::Ssh { .. } => "ssh",
    }
}

fn format_execution_error(error: GitExecutionError) -> String {
    format!("{error:?}")
}
