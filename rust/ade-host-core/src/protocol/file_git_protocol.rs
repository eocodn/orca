use super::{Capability, ProtocolEnvelope, ProtocolError, PtySshShell, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};

/// Lease proof carried by every Host↔Worker filesystem or Git request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnershipContext {
    pub lease_id: u64,
}

impl OwnershipContext {
    pub fn new(lease_id: u64) -> Self {
        Self { lease_id }
    }
}

/// Execution identity is intentionally repeated on requests and responses so a
/// replay cannot be accepted for a replacement worker or a different target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionContext {
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub ownership: OwnershipContext,
    pub execution_target: ExecutionTarget,
    pub remote_identity: Option<String>,
}

impl ExecutionContext {
    pub fn new(
        workspace_id: impl Into<String>,
        workspace_kind: WorkspaceKind,
        worker_id: impl Into<String>,
        worker_incarnation: u64,
        ownership: OwnershipContext,
        execution_target: ExecutionTarget,
        remote_identity: Option<String>,
    ) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            workspace_kind,
            worker_id: worker_id.into(),
            worker_incarnation,
            ownership,
            execution_target,
            remote_identity,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.workspace_id.trim().is_empty() {
            return Err(ProtocolError::EmptyExecutionWorkspaceId);
        }
        if self.worker_id.trim().is_empty() {
            return Err(ProtocolError::EmptyExecutionWorkerId);
        }
        if self.worker_incarnation == 0 || self.worker_incarnation > super::MAX_SAFE_INTEGER {
            return Err(ProtocolError::InvalidWorkerIncarnation);
        }
        if self.ownership.lease_id == 0 || self.ownership.lease_id > super::MAX_SAFE_INTEGER {
            return Err(ProtocolError::InvalidOwnershipLease);
        }
        match (&self.execution_target, &self.remote_identity) {
            (ExecutionTarget::WindowsNative, None) => Ok(()),
            (ExecutionTarget::WindowsNative, Some(_)) => {
                Err(ProtocolError::ExecutionTargetRemoteIdentityMismatch)
            }
            (ExecutionTarget::Wsl2 { distro }, Some(identity))
                if !distro.trim().is_empty() && identity == distro =>
            {
                Ok(())
            }
            (ExecutionTarget::Ssh { host, .. }, Some(identity))
                if !host.trim().is_empty() && identity == host =>
            {
                Ok(())
            }
            _ => Err(ProtocolError::ExecutionTargetRemoteIdentityMismatch),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceKind {
    Folder,
    GitWorktree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExecutionTarget {
    #[serde(rename = "windows-native")]
    WindowsNative,
    Wsl2 {
        distro: String,
    },
    Ssh {
        host: String,
        shell: PtySshShell,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum FileWorkerOperation {
    #[serde(rename = "read")]
    Read { path: String },
    #[serde(rename = "write")]
    Write { path: String, bytes: Vec<u8> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum GitWorkerOperation {
    #[serde(rename = "worktree_list")]
    WorktreeList { repository_path: String },
    #[serde(rename = "repository_git_dir")]
    RepositoryGitDir { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileResponseOperation {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitResponseOperation {
    #[serde(rename = "worktree-list")]
    WorktreeList,
    #[serde(rename = "repository-git-dir")]
    RepositoryGitDir,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileWorkerRequest {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub ownership: OwnershipContext,
    pub execution_target: ExecutionTarget,
    pub remote_identity: Option<String>,
    pub operation: FileWorkerOperation,
}

impl FileWorkerRequest {
    pub fn read(
        request_id: impl Into<String>,
        context: ExecutionContext,
        path: impl Into<String>,
    ) -> Self {
        Self::new(
            request_id,
            context,
            FileWorkerOperation::Read { path: path.into() },
        )
    }

    pub fn write(
        request_id: impl Into<String>,
        context: ExecutionContext,
        path: impl Into<String>,
        bytes: Vec<u8>,
    ) -> Self {
        Self::new(
            request_id,
            context,
            FileWorkerOperation::Write {
                path: path.into(),
                bytes,
            },
        )
    }

    pub fn new(
        request_id: impl Into<String>,
        context: ExecutionContext,
        operation: FileWorkerOperation,
    ) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::File, PROTOCOL_VERSION),
            workspace_id: context.workspace_id,
            workspace_kind: context.workspace_kind,
            worker_id: context.worker_id,
            worker_incarnation: context.worker_incarnation,
            ownership: context.ownership,
            execution_target: context.execution_target,
            remote_identity: context.remote_identity,
            operation,
        }
    }

    pub fn context(&self) -> ExecutionContext {
        ExecutionContext {
            workspace_id: self.workspace_id.clone(),
            workspace_kind: self.workspace_kind,
            worker_id: self.worker_id.clone(),
            worker_incarnation: self.worker_incarnation,
            ownership: self.ownership.clone(),
            execution_target: self.execution_target.clone(),
            remote_identity: self.remote_identity.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::File {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }
        self.context().validate()?;
        let path = match &self.operation {
            FileWorkerOperation::Read { path } | FileWorkerOperation::Write { path, .. } => path,
        };
        if path.trim().is_empty() {
            return Err(ProtocolError::EmptyFilePath);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitWorkerRequest {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub ownership: OwnershipContext,
    pub execution_target: ExecutionTarget,
    pub remote_identity: Option<String>,
    pub operation: GitWorkerOperation,
}

impl GitWorkerRequest {
    pub fn worktree_list(
        request_id: impl Into<String>,
        context: ExecutionContext,
        repository_path: impl Into<String>,
    ) -> Self {
        Self::new(
            request_id,
            context,
            GitWorkerOperation::WorktreeList {
                repository_path: repository_path.into(),
            },
        )
    }

    pub fn repository_git_dir(
        request_id: impl Into<String>,
        context: ExecutionContext,
        path: impl Into<String>,
    ) -> Self {
        Self::new(
            request_id,
            context,
            GitWorkerOperation::RepositoryGitDir { path: path.into() },
        )
    }

    pub fn new(
        request_id: impl Into<String>,
        context: ExecutionContext,
        operation: GitWorkerOperation,
    ) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::Git, PROTOCOL_VERSION),
            workspace_id: context.workspace_id,
            workspace_kind: context.workspace_kind,
            worker_id: context.worker_id,
            worker_incarnation: context.worker_incarnation,
            ownership: context.ownership,
            execution_target: context.execution_target,
            remote_identity: context.remote_identity,
            operation,
        }
    }

    pub fn context(&self) -> ExecutionContext {
        ExecutionContext {
            workspace_id: self.workspace_id.clone(),
            workspace_kind: self.workspace_kind,
            worker_id: self.worker_id.clone(),
            worker_incarnation: self.worker_incarnation,
            ownership: self.ownership.clone(),
            execution_target: self.execution_target.clone(),
            remote_identity: self.remote_identity.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::Git {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }
        self.context().validate()?;
        let path = match &self.operation {
            GitWorkerOperation::WorktreeList { repository_path }
            | GitWorkerOperation::RepositoryGitDir {
                path: repository_path,
            } => repository_path,
        };
        if path.trim().is_empty() {
            return Err(ProtocolError::EmptyGitPath);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileWorkerResponse {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub ownership: OwnershipContext,
    pub execution_target: ExecutionTarget,
    pub remote_identity: Option<String>,
    pub operation: FileResponseOperation,
    pub path: String,
    pub bytes: Vec<u8>,
    pub bytes_written: u64,
    pub changed: bool,
}

impl FileWorkerResponse {
    pub fn from_read_request(request: &FileWorkerRequest, bytes: Vec<u8>) -> Self {
        Self::from_request(request, FileResponseOperation::Read, bytes, 0, false)
    }

    pub fn from_write_request(
        request: &FileWorkerRequest,
        bytes_written: u64,
        changed: bool,
    ) -> Self {
        Self::from_request(
            request,
            FileResponseOperation::Write,
            Vec::new(),
            bytes_written,
            changed,
        )
    }

    fn from_request(
        request: &FileWorkerRequest,
        operation: FileResponseOperation,
        bytes: Vec<u8>,
        bytes_written: u64,
        changed: bool,
    ) -> Self {
        let path = match &request.operation {
            FileWorkerOperation::Read { path } | FileWorkerOperation::Write { path, .. } => path,
        };
        Self {
            envelope: request.envelope.clone(),
            workspace_id: request.workspace_id.clone(),
            workspace_kind: request.workspace_kind,
            worker_id: request.worker_id.clone(),
            worker_incarnation: request.worker_incarnation,
            ownership: request.ownership.clone(),
            execution_target: request.execution_target.clone(),
            remote_identity: request.remote_identity.clone(),
            operation,
            path: path.clone(),
            bytes,
            bytes_written,
            changed,
        }
    }

    pub fn validate_for(&self, request: &FileWorkerRequest) -> Result<(), ProtocolError> {
        request.validate()?;
        self.envelope.validate()?;
        if self.envelope != request.envelope
            || self.workspace_id != request.workspace_id
            || self.workspace_kind != request.workspace_kind
            || self.worker_id != request.worker_id
            || self.worker_incarnation != request.worker_incarnation
            || self.ownership != request.ownership
            || self.execution_target != request.execution_target
            || self.remote_identity != request.remote_identity
        {
            return Err(ProtocolError::ResponseMismatch("context"));
        }
        let (expected_operation, expected_path) = match &request.operation {
            FileWorkerOperation::Read { path } => (FileResponseOperation::Read, path),
            FileWorkerOperation::Write { path, .. } => (FileResponseOperation::Write, path),
        };
        if self.operation != expected_operation || &self.path != expected_path {
            return Err(ProtocolError::ResponseMismatch("operation"));
        }
        if self.bytes_written > super::MAX_SAFE_INTEGER {
            return Err(ProtocolError::InvalidFileBytesWritten);
        }
        match self.operation {
            FileResponseOperation::Read if self.bytes_written == 0 && !self.changed => Ok(()),
            FileResponseOperation::Write if self.bytes.is_empty() => Ok(()),
            _ => Err(ProtocolError::ResponseMismatch("result")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prunable_reason: Option<String>,
    pub is_main: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GitWorkerResponse {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub ownership: OwnershipContext,
    pub execution_target: ExecutionTarget,
    pub remote_identity: Option<String>,
    pub operation: GitResponseOperation,
    pub repository_path: String,
    pub worktrees: Vec<GitWorktree>,
}

impl GitWorkerResponse {
    pub fn from_worktree_list_request(
        request: &GitWorkerRequest,
        worktrees: Vec<GitWorktree>,
    ) -> Self {
        Self {
            envelope: request.envelope.clone(),
            workspace_id: request.workspace_id.clone(),
            workspace_kind: request.workspace_kind,
            worker_id: request.worker_id.clone(),
            worker_incarnation: request.worker_incarnation,
            ownership: request.ownership.clone(),
            execution_target: request.execution_target.clone(),
            remote_identity: request.remote_identity.clone(),
            operation: GitResponseOperation::WorktreeList,
            repository_path: match &request.operation {
                GitWorkerOperation::WorktreeList { repository_path }
                | GitWorkerOperation::RepositoryGitDir {
                    path: repository_path,
                } => repository_path.clone(),
            },
            worktrees,
        }
    }

    pub fn validate_for(&self, request: &GitWorkerRequest) -> Result<(), ProtocolError> {
        request.validate()?;
        self.envelope.validate()?;
        if self.envelope != request.envelope
            || self.workspace_id != request.workspace_id
            || self.workspace_kind != request.workspace_kind
            || self.worker_id != request.worker_id
            || self.worker_incarnation != request.worker_incarnation
            || self.ownership != request.ownership
            || self.execution_target != request.execution_target
            || self.remote_identity != request.remote_identity
        {
            return Err(ProtocolError::ResponseMismatch("context"));
        }
        let expected_operation = match request.operation {
            GitWorkerOperation::WorktreeList { .. } => GitResponseOperation::WorktreeList,
            GitWorkerOperation::RepositoryGitDir { .. } => GitResponseOperation::RepositoryGitDir,
        };
        if self.operation != expected_operation {
            return Err(ProtocolError::ResponseMismatch("operation"));
        }
        let expected_repository_path = match &request.operation {
            GitWorkerOperation::WorktreeList { repository_path }
            | GitWorkerOperation::RepositoryGitDir {
                path: repository_path,
            } => repository_path,
        };
        if &self.repository_path != expected_repository_path {
            return Err(ProtocolError::ResponseMismatch("repository_path"));
        }
        if self
            .worktrees
            .iter()
            .any(|worktree| worktree.path.trim().is_empty() || worktree.head.trim().is_empty())
        {
            return Err(ProtocolError::EmptyGitPath);
        }
        Ok(())
    }
}
