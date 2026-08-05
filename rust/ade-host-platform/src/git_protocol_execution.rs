#[cfg(test)]
mod tests {
    use super::{execute_git_request, GitRequestExecutionError};
    use crate::git_capability::GitCapabilityRegistry;
    use crate::git_execution::{GitCommandExecutionError, GitCommandExecutor, GitCommandOutput};
    use crate::{CommandSpec, ExecutionTarget};
    use ade_host_core::protocol::{GitOperation, GitRequest};
    use std::sync::{Arc, Mutex};

    #[derive(Clone)]
    struct RecordingExecutor {
        result: Arc<Mutex<Option<Result<GitCommandOutput, GitCommandExecutionError>>>>,
    }

    impl GitCommandExecutor for RecordingExecutor {
        fn execute(
            &self,
            _command: &CommandSpec,
        ) -> Result<GitCommandOutput, GitCommandExecutionError> {
            self.result.lock().unwrap().take().unwrap()
        }
    }

    #[test]
    fn executes_a_valid_git_request_through_the_target_specific_runner() {
        let executor = RecordingExecutor {
            result: Arc::new(Mutex::new(Some(Ok(GitCommandOutput {
                exit_code: Some(0),
                stdout: String::from("worktree /repo\nHEAD abc\n\n"),
                stderr: String::new(),
            })))),
        };

        let worktrees = execute_git_request(
            &GitRequest::worktree_list("request-1", "/repo"),
            &ExecutionTarget::WindowsNative,
            &GitCapabilityRegistry::new(),
            &executor,
        )
        .expect("valid request should execute");

        assert_eq!(worktrees[0].head, "abc");
    }

    #[test]
    fn rejects_unsupported_git_operations_without_running_a_process() {
        let executor = RecordingExecutor {
            result: Arc::new(Mutex::new(None)),
        };
        let request = GitRequest::new(
            "request-1",
            GitOperation::RepositoryGitDir {
                path: String::from("/repo"),
            },
            1,
        );

        assert_eq!(
            execute_git_request(
                &request,
                &ExecutionTarget::WindowsNative,
                &GitCapabilityRegistry::new(),
                &executor,
            ),
            Err(GitRequestExecutionError::UnsupportedOperation)
        );
    }

    #[test]
    fn preserves_authoritative_git_failures() {
        let executor = RecordingExecutor {
            result: Arc::new(Mutex::new(Some(Err(GitCommandExecutionError {
                exit_code: Some(1),
                stderr: String::from("fatal: not a repository"),
            })))),
        };

        assert!(matches!(
            execute_git_request(
                &GitRequest::worktree_list("request-1", "/repo"),
                &ExecutionTarget::WindowsNative,
                &GitCapabilityRegistry::new(),
                &executor,
            ),
            Err(GitRequestExecutionError::Execution(_))
        ));
    }
}

use crate::git_capability::GitCapabilityRegistry;
use crate::git_execution::{run_git_worktree_list, GitCommandExecutor, GitExecutionError};
use crate::git_worktree::GitWorktree;
use crate::ExecutionTarget;
use ade_host_core::protocol::{GitOperation, GitRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRequestExecutionError {
    InvalidRequest(String),
    UnsupportedOperation,
    Execution(GitExecutionError),
}

pub fn execute_git_request<E: GitCommandExecutor>(
    request: &GitRequest,
    target: &ExecutionTarget,
    registry: &GitCapabilityRegistry,
    executor: &E,
) -> Result<Vec<GitWorktree>, GitRequestExecutionError> {
    request
        .validate()
        .map_err(|error| GitRequestExecutionError::InvalidRequest(format!("{error:?}")))?;
    match &request.operation {
        GitOperation::WorktreeList { repository_path } => {
            run_git_worktree_list(target, repository_path, registry, executor)
                .map_err(GitRequestExecutionError::Execution)
        }
        GitOperation::RepositoryGitDir { .. } => {
            Err(GitRequestExecutionError::UnsupportedOperation)
        }
    }
}
