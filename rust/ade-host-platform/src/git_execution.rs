#[cfg(test)]
mod contract_tests {
    use super::{
        run_git_worktree_list, GitCommandExecutionError, GitCommandExecutor, GitCommandOutput,
    };
    use crate::{CommandSpec, ExecutionTarget};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct RecordingExecutor {
        commands: Arc<Mutex<Vec<CommandSpec>>>,
        results: Arc<Mutex<VecDeque<Result<GitCommandOutput, GitCommandExecutionError>>>>,
    }

    impl GitCommandExecutor for RecordingExecutor {
        fn execute(
            &self,
            command: &CommandSpec,
        ) -> Result<GitCommandOutput, GitCommandExecutionError> {
            self.commands.lock().unwrap().push(command.clone());
            self.results.lock().unwrap().pop_front().unwrap()
        }
    }

    #[test]
    fn executes_a_target_specific_git_command_and_parses_authoritative_output() {
        let executor = RecordingExecutor {
            commands: Arc::default(),
            results: Arc::new(Mutex::new(VecDeque::from([
                Ok(GitCommandOutput {
                    exit_code: Some(0),
                    stdout: String::from("worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n"),
                    stderr: String::new(),
                }),
                Ok(GitCommandOutput {
                    exit_code: Some(0),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            ]))),
        };

        let worktrees = run_git_worktree_list(
            &ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-22.04"),
            },
            "/repo",
            &crate::git_capability::GitCapabilityRegistry::new(),
            &executor,
        )
        .expect("successful git output should be parsed");

        assert_eq!(worktrees[0].path, "/repo");
        assert_eq!(
            executor.commands.lock().unwrap()[0].args,
            vec![
                "--distribution",
                "Ubuntu-22.04",
                "--",
                "git",
                "-C",
                "/repo",
                "worktree",
                "list",
                "--porcelain",
                "-z",
            ]
        );
    }

    #[test]
    fn falls_back_once_for_an_unsupported_git_option_and_reuses_the_host_cache() {
        let executor = RecordingExecutor {
            commands: Arc::default(),
            results: Arc::new(Mutex::new(VecDeque::from([
                Err(GitCommandExecutionError {
                    exit_code: Some(129),
                    stderr: String::from("unknown option -z"),
                }),
                Ok(GitCommandOutput {
                    exit_code: Some(0),
                    stdout: String::from("worktree /repo\nHEAD abc\n\n"),
                    stderr: String::new(),
                }),
                Ok(GitCommandOutput {
                    exit_code: Some(0),
                    stdout: String::from("worktree /repo\nHEAD def\n\n"),
                    stderr: String::new(),
                }),
            ]))),
        };
        let registry = crate::git_capability::GitCapabilityRegistry::new();
        let target = ExecutionTarget::WindowsNative;

        assert_eq!(
            run_git_worktree_list(&target, r"C:\repo", &registry, &executor).unwrap()[0].head,
            "abc"
        );
        assert_eq!(
            run_git_worktree_list(&target, r"C:\repo", &registry, &executor).unwrap()[0].head,
            "def"
        );

        let commands = executor.commands.lock().unwrap();
        assert_eq!(commands.len(), 3);
        assert!(commands[0].args.ends_with(&[String::from("-z")]));
        assert!(!commands[1].args.ends_with(&[String::from("-z")]));
        assert!(!commands[2].args.ends_with(&[String::from("-z")]));
    }

    #[test]
    fn does_not_fallback_for_an_authoritative_git_failure() {
        let executor = RecordingExecutor {
            commands: Arc::default(),
            results: Arc::new(Mutex::new(VecDeque::from([Err(
                GitCommandExecutionError {
                    exit_code: Some(1),
                    stderr: String::from("fatal: not a repository"),
                },
            )]))),
        };

        assert!(run_git_worktree_list(
            &ExecutionTarget::WindowsNative,
            r"C:\repo",
            &crate::git_capability::GitCapabilityRegistry::new(),
            &executor,
        )
        .is_err());
        assert_eq!(executor.commands.lock().unwrap().len(), 1);
    }

    #[test]
    fn rejects_an_empty_repository_path_before_spawning_a_process() {
        let executor = RecordingExecutor::default();

        assert_eq!(
            run_git_worktree_list(
                &ExecutionTarget::WindowsNative,
                "  ",
                &crate::git_capability::GitCapabilityRegistry::new(),
                &executor,
            ),
            Err(super::GitExecutionError::EmptyRepositoryPath)
        );
        assert!(executor.commands.lock().unwrap().is_empty());
    }

    #[test]
    fn probes_worktree_paths_on_the_execution_target_for_legacy_git() {
        let executor = RecordingExecutor {
            commands: Arc::default(),
            results: Arc::new(Mutex::new(VecDeque::from([
                Err(GitCommandExecutionError {
                    exit_code: Some(129),
                    stderr: String::from("unknown option -z"),
                }),
                Ok(GitCommandOutput {
                    exit_code: Some(0),
                    stdout: String::from(
                        "worktree /repo/main\nHEAD abc\n\nworktree /repo/missing\nHEAD def\n\n",
                    ),
                    stderr: String::new(),
                }),
                Ok(GitCommandOutput {
                    exit_code: Some(1),
                    stdout: String::new(),
                    stderr: String::new(),
                }),
            ]))),
        };
        let worktrees = run_git_worktree_list(
            &ExecutionTarget::Ssh {
                host: String::from("build.example"),
            },
            "/srv/repo",
            &crate::git_capability::GitCapabilityRegistry::new(),
            &executor,
        )
        .expect("legacy output plus target probe should be authoritative");

        assert!(worktrees[1].prunable);
        let commands = executor.commands.lock().unwrap();
        assert_eq!(commands.len(), 3);
        assert_eq!(commands[2].program, "ssh");
        assert!(commands[2].args.iter().any(|arg| arg.contains("test")));
        assert!(commands[2]
            .args
            .iter()
            .any(|arg| arg.contains("/repo/missing")));
    }
}

use crate::git_capability::{GitCapabilityHost, GitCapabilityRegistry};
use crate::git_worktree::{
    run_worktree_list_with_path_probe, GitWorktree, GitWorktreeCommandError, GitWorktreeListError,
};
use crate::{build_command, CommandSpec, ExecutionTarget};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommandExecutionError {
    pub exit_code: Option<i32>,
    pub stderr: String,
}

pub trait GitCommandExecutor {
    fn execute(&self, command: &CommandSpec) -> Result<GitCommandOutput, GitCommandExecutionError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessGitCommandExecutor;

impl GitCommandExecutor for ProcessGitCommandExecutor {
    fn execute(&self, command: &CommandSpec) -> Result<GitCommandOutput, GitCommandExecutionError> {
        let mut process = Command::new(&command.program);
        process.args(&command.args);
        if let Some(working_directory) = &command.working_directory {
            process.current_dir(working_directory);
        }
        let output = process.output().map_err(|error| GitCommandExecutionError {
            exit_code: None,
            stderr: error.to_string(),
        })?;
        Ok(GitCommandOutput {
            exit_code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitExecutionError {
    EmptyRepositoryPath,
    Worktree(GitWorktreeListError),
}

pub fn run_git_worktree_list<E: GitCommandExecutor>(
    target: &ExecutionTarget,
    repository_path: &str,
    registry: &GitCapabilityRegistry,
    executor: &E,
) -> Result<Vec<GitWorktree>, GitExecutionError> {
    if repository_path.trim().is_empty() {
        return Err(GitExecutionError::EmptyRepositoryPath);
    }
    let host = match target {
        ExecutionTarget::WindowsNative => GitCapabilityHost::Native,
        ExecutionTarget::Wsl2 { distro } => GitCapabilityHost::Wsl2 {
            distro: distro.clone(),
        },
        ExecutionTarget::Ssh { host } => GitCapabilityHost::Ssh { host: host.clone() },
    };
    let cache = registry.cache_for(host).map_err(|error| {
        GitExecutionError::Worktree(GitWorktreeListError::Command(
            crate::git_capability::GitCapabilityRunError::State(error),
        ))
    })?;
    let run = |args: &[&str]| {
        let mut git_args = vec!["-C", repository_path];
        git_args.extend_from_slice(args);
        let command = build_command(target, "git", &git_args, None).map_err(|error| {
            crate::git_worktree::GitWorktreeCommandError {
                code: None,
                stderr: format!("platform command error: {error:?}"),
            }
        })?;
        let output = executor.execute(&command).map_err(|error| {
            crate::git_worktree::GitWorktreeCommandError {
                code: error.exit_code,
                stderr: error.stderr,
            }
        })?;
        if output.exit_code == Some(0) {
            Ok(output.stdout)
        } else {
            Err(crate::git_worktree::GitWorktreeCommandError {
                code: output.exit_code,
                stderr: output.stderr,
            })
        }
    };

    let probe = |path: &str| probe_path_exists(target, path, executor);
    run_worktree_list_with_path_probe(&cache, run, run, probe).map_err(GitExecutionError::Worktree)
}

fn probe_path_exists<E: GitCommandExecutor>(
    target: &ExecutionTarget,
    path: &str,
    executor: &E,
) -> Result<bool, GitWorktreeCommandError> {
    if matches!(target, ExecutionTarget::WindowsNative) {
        return Path::new(path)
            .try_exists()
            .map_err(|error| GitWorktreeCommandError {
                code: None,
                stderr: format!("native path existence probe failed: {error}"),
            });
    }
    let command = build_command(target, "test", &["-e", path], None).map_err(|error| {
        GitWorktreeCommandError {
            code: None,
            stderr: format!("platform command error: {error:?}"),
        }
    })?;
    let output = executor
        .execute(&command)
        .map_err(|error| GitWorktreeCommandError {
            code: error.exit_code,
            stderr: error.stderr,
        })?;
    match output.exit_code {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        code => Err(GitWorktreeCommandError {
            code,
            stderr: if output.stderr.is_empty() {
                String::from("target path existence probe failed")
            } else {
                output.stderr
            },
        }),
    }
}

pub fn execute_git_command(
    command: &CommandSpec,
) -> Result<GitCommandOutput, GitCommandExecutionError> {
    ProcessGitCommandExecutor.execute(command)
}
