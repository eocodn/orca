//! Strict File/Git worker execution and replay fencing.
use ade_host_core::protocol::{
    ExecutionTarget, FileWorkerRequest, FileWorkerResponse, GitWorkerOperation, GitWorkerRequest,
    GitWorkerResponse, GitWorktree, ProtocolError,
};
use ade_host_platform::git_capability::GitCapabilityRegistry;
use ade_host_platform::git_execution::{run_git_worktree_list, ProcessGitCommandExecutor};
use ade_host_platform::{
    file_service::FileService,
    git_repository::{resolve_repository_git_dir, GitRepositoryCommandError},
    ExecutionTarget as PlatformTarget,
};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct FileGitWorkerRegistry {
    state: Mutex<DispatchState>,
    git_capabilities: GitCapabilityRegistry,
}

#[derive(Default)]
struct DispatchState {
    authorities: HashMap<OwnerKey, Authority>,
    committed: HashMap<String, (DispatchRequest, Result<DispatchResponse, String>)>,
    in_flight: HashMap<String, DispatchRequest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct OwnerKey {
    workspace_id: String,
    worker_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Authority {
    incarnation: u64,
    lease_id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum DispatchRequest {
    File(FileWorkerRequest),
    Git(GitWorkerRequest),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchResponse {
    File(FileWorkerResponse),
    Git(GitWorkerResponse),
}

impl DispatchResponse {
    pub fn request_id(&self) -> &str {
        match self {
            Self::File(response) => &response.envelope.request_id,
            Self::Git(response) => &response.envelope.request_id,
        }
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        match self {
            Self::File(response) => serde_json::to_string(response),
            Self::Git(response) => serde_json::to_string(response),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DispatchError<'a> {
    pub ok: bool,
    pub request_id: Option<&'a str>,
    pub error: &'a str,
}

impl FileGitWorkerRegistry {
    pub fn execute_file(&self, request: &FileWorkerRequest) -> Result<FileWorkerResponse, String> {
        request.validate().map_err(format_protocol_error)?;
        if let Some(result) = self.begin(DispatchRequest::File(request.clone()))? {
            return match result {
                DispatchResponse::File(response) => Ok(response),
                DispatchResponse::Git(_) => Err("request_id_conflict".into()),
            };
        }
        let result = self.execute_file_operation(request);
        self.commit(
            DispatchRequest::File(request.clone()),
            result.clone().map(DispatchResponse::File),
        )?;
        result
    }

    pub fn execute_git(&self, request: &GitWorkerRequest) -> Result<GitWorkerResponse, String> {
        request.validate().map_err(format_protocol_error)?;
        if let Some(result) = self.begin(DispatchRequest::Git(request.clone()))? {
            return match result {
                DispatchResponse::Git(response) => Ok(response),
                DispatchResponse::File(_) => Err("request_id_conflict".into()),
            };
        }
        let result = self.execute_git_operation(request);
        self.commit(
            DispatchRequest::Git(request.clone()),
            result.clone().map(DispatchResponse::Git),
        )?;
        result
    }

    fn execute_file_operation(
        &self,
        request: &FileWorkerRequest,
    ) -> Result<FileWorkerResponse, String> {
        match &request.operation {
            ade_host_core::protocol::FileWorkerOperation::Read { path } => {
                let result =
                    FileService::read(path).map_err(|error| format!("file_read:{error:?}"))?;
                let response = FileWorkerResponse::from_read_request(request, result.bytes);
                response
                    .validate_for(request)
                    .map_err(format_protocol_error)?;
                Ok(response)
            }
            ade_host_core::protocol::FileWorkerOperation::Write { path, bytes } => {
                let result = FileService::write_atomic(path, bytes)
                    .map_err(|error| format!("file_write:{error:?}"))?;
                let response = FileWorkerResponse::from_write_request(
                    request,
                    result.bytes_written as u64,
                    result.changed,
                );
                response
                    .validate_for(request)
                    .map_err(format_protocol_error)?;
                Ok(response)
            }
        }
    }

    fn execute_git_operation(
        &self,
        request: &GitWorkerRequest,
    ) -> Result<GitWorkerResponse, String> {
        let target = platform_target(&request.execution_target);
        let executor = ProcessGitCommandExecutor;
        let response = match &request.operation {
            GitWorkerOperation::WorktreeList { repository_path } => {
                let worktrees = run_git_worktree_list(
                    &target,
                    repository_path,
                    &self.git_capabilities,
                    &executor,
                )
                .map_err(|error| format!("git_worktree_list:{error:?}"))?;
                GitWorkerResponse::from_worktree_list_request(
                    request,
                    worktrees.into_iter().map(convert_worktree).collect(),
                )
            }
            GitWorkerOperation::RepositoryGitDir { path } => {
                let cache = self
                    .git_capabilities
                    .cache_for(capability_host(&target))
                    .map_err(|error| format!("git_capability:{error:?}"))?;
                let preferred = |args: &[&str]| run_git_metadata(&target, path, args);
                let fallback = |args: &[&str]| run_git_metadata(&target, path, args);
                let git_dir =
                    resolve_repository_git_dir(&cache, &target, path, preferred, fallback)
                        .map_err(|error| format!("git_repository_dir:{error:?}"))?;
                GitWorkerResponse {
                    envelope: request.envelope.clone(),
                    workspace_id: request.workspace_id.clone(),
                    workspace_kind: request.workspace_kind,
                    worker_id: request.worker_id.clone(),
                    worker_incarnation: request.worker_incarnation,
                    ownership: request.ownership.clone(),
                    execution_target: request.execution_target.clone(),
                    remote_identity: request.remote_identity.clone(),
                    operation: ade_host_core::protocol::GitResponseOperation::RepositoryGitDir,
                    repository_path: path.clone(),
                    worktrees: vec![GitWorktree {
                        path: git_dir,
                        head: String::from("repository-git-dir"),
                        branch: None,
                        is_bare: false,
                        locked: false,
                        lock_reason: None,
                        prunable: false,
                        prunable_reason: None,
                        is_main: true,
                    }],
                }
            }
        };
        response
            .validate_for(request)
            .map_err(format_protocol_error)?;
        Ok(response)
    }

    fn begin(&self, request: DispatchRequest) -> Result<Option<DispatchResponse>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "worker_registry_unavailable")?;
        let (request_id, owner, incarnation, lease_id) = request_identity(&request);
        if let Some((committed, result)) = state.committed.get(&request_id) {
            if committed != &request {
                return Err("request_id_conflict".into());
            }
            if let Some(authority) = state.authorities.get(&owner) {
                if incarnation < authority.incarnation {
                    return Err("stale_worker_incarnation".into());
                }
                if incarnation == authority.incarnation && lease_id != authority.lease_id {
                    return Err("worker_lease_conflict".into());
                }
            }
            return result.clone().map(Some);
        }
        if let Some(in_flight) = state.in_flight.get(&request_id) {
            if in_flight == &request {
                return Err("request_in_flight".into());
            }
            return Err("request_id_conflict".into());
        }
        let authority = state.authorities.entry(owner.clone()).or_insert(Authority {
            incarnation,
            lease_id,
        });
        if incarnation < authority.incarnation {
            return Err("stale_worker_incarnation".into());
        }
        if incarnation == authority.incarnation && lease_id != authority.lease_id {
            return Err("worker_lease_conflict".into());
        }
        if incarnation > authority.incarnation {
            authority.incarnation = incarnation;
            authority.lease_id = lease_id;
            state.committed.retain(|_, (committed, _)| {
                let (_, committed_owner, committed_incarnation, _) = request_identity(committed);
                committed_owner != owner || committed_incarnation >= incarnation
            });
        }
        state.in_flight.insert(request_id, request);
        Ok(None)
    }

    fn commit(
        &self,
        request: DispatchRequest,
        result: Result<DispatchResponse, String>,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "worker_registry_unavailable")?;
        let request_id = request_id(&request);
        if state.in_flight.get(&request_id) != Some(&request) {
            return Ok(());
        }
        state.in_flight.remove(&request_id);
        state.committed.insert(request_id, (request, result));
        Ok(())
    }
}

fn request_identity(request: &DispatchRequest) -> (String, OwnerKey, u64, u64) {
    match request {
        DispatchRequest::File(request) => (
            request.envelope.request_id.clone(),
            OwnerKey {
                workspace_id: request.workspace_id.clone(),
                worker_id: request.worker_id.clone(),
            },
            request.worker_incarnation,
            request.ownership.lease_id,
        ),
        DispatchRequest::Git(request) => (
            request.envelope.request_id.clone(),
            OwnerKey {
                workspace_id: request.workspace_id.clone(),
                worker_id: request.worker_id.clone(),
            },
            request.worker_incarnation,
            request.ownership.lease_id,
        ),
    }
}

fn request_id(request: &DispatchRequest) -> String {
    request_identity(request).0
}

fn platform_target(target: &ExecutionTarget) -> PlatformTarget {
    match target {
        ExecutionTarget::WindowsNative => PlatformTarget::WindowsNative,
        ExecutionTarget::Wsl2 { distro } => PlatformTarget::Wsl2 {
            distro: distro.clone(),
        },
        ExecutionTarget::Ssh { host, .. } => PlatformTarget::Ssh { host: host.clone() },
    }
}

fn capability_host(
    target: &PlatformTarget,
) -> ade_host_platform::git_capability::GitCapabilityHost {
    match target {
        PlatformTarget::WindowsNative => {
            ade_host_platform::git_capability::GitCapabilityHost::Native
        }
        PlatformTarget::Wsl2 { distro } => {
            ade_host_platform::git_capability::GitCapabilityHost::Wsl2 {
                distro: distro.clone(),
            }
        }
        PlatformTarget::Ssh { host } => {
            ade_host_platform::git_capability::GitCapabilityHost::Ssh { host: host.clone() }
        }
    }
}

fn run_git_metadata(
    target: &PlatformTarget,
    path: &str,
    args: &[&str],
) -> Result<String, GitRepositoryCommandError> {
    let mut git_args = vec!["-C", path];
    git_args.extend_from_slice(args);
    let command =
        ade_host_platform::build_command(target, "git", &git_args, None).map_err(|error| {
            GitRepositoryCommandError {
                code: None,
                stderr: format!("platform command error: {error:?}"),
                stdout: String::new(),
            }
        })?;
    let output = std::process::Command::new(&command.program)
        .args(&command.args)
        .output()
        .map_err(|error| GitRepositoryCommandError {
            code: None,
            stderr: error.to_string(),
            stdout: String::new(),
        })?;
    if !output.status.success() {
        return Err(GitRepositoryCommandError {
            code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn convert_worktree(worktree: ade_host_platform::git_worktree::GitWorktree) -> GitWorktree {
    GitWorktree {
        path: worktree.path,
        head: worktree.head,
        branch: worktree.branch,
        is_bare: worktree.is_bare,
        locked: worktree.locked,
        lock_reason: worktree.lock_reason,
        prunable: worktree.prunable,
        prunable_reason: worktree.prunable_reason,
        is_main: worktree.is_main,
    }
}

pub fn format_protocol_error(error: ProtocolError) -> String {
    format!("protocol:{error:?}")
}
