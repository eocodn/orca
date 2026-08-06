use serde::{Deserialize, Serialize};

mod file_git_protocol;
pub use file_git_protocol::{
    ExecutionContext, ExecutionTarget, FileResponseOperation, FileWorkerOperation,
    FileWorkerRequest, FileWorkerResponse, GitResponseOperation, GitWorkerOperation,
    GitWorkerRequest, GitWorkerResponse, GitWorktree, OwnershipContext, WorkspaceKind,
};

pub const PROTOCOL_VERSION: u16 = 1;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const HOST_CAPABILITIES: [Capability; 6] = [
    Capability::WorkspaceRead,
    Capability::WorkspaceWrite,
    Capability::Terminal,
    Capability::Pty,
    Capability::Git,
    Capability::File,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "workspace.read")]
    WorkspaceRead,
    #[serde(rename = "workspace.write")]
    WorkspaceWrite,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "pty")]
    Pty,
    #[serde(rename = "git")]
    Git,
    #[serde(rename = "file")]
    File,
}

impl Capability {
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::WorkspaceRead => "workspace.read",
            Self::WorkspaceWrite => "workspace.write",
            Self::Terminal => "terminal",
            Self::Pty => "pty",
            Self::Git => "git",
            Self::File => "file",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtocolEnvelope {
    pub request_id: String,
    pub capability: Capability,
    pub protocol_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum GitOperation {
    #[serde(rename = "worktree_list")]
    WorktreeList { repository_path: String },
    #[serde(rename = "repository_git_dir")]
    RepositoryGitDir { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum FileOperation {
    #[serde(rename = "read")]
    Read { path: String },
    #[serde(rename = "write")]
    Write { path: String, bytes: Vec<u8> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum TerminalOperation {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "snapshot")]
    Snapshot,
    #[serde(rename = "output")]
    Output { sequence: u64, data: String },
    #[serde(rename = "exit")]
    Exit { code: i32 },
    #[serde(rename = "fail")]
    Fail { reason: String },
    #[serde(rename = "close")]
    Close,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum PtyOperation {
    #[serde(rename = "start")]
    Start {
        program: String,
        #[serde(default)]
        args: Vec<String>,
        current_dir: Option<String>,
        execution_target: Option<PtyExecutionTarget>,
        cols: u16,
        rows: u16,
    },
    #[serde(rename = "write")]
    Write { input: String },
    #[serde(rename = "resize")]
    Resize { cols: u16, rows: u16 },
    #[serde(rename = "poll")]
    Poll,
    #[serde(rename = "wait")]
    Wait { timeout_ms: u64 },
    #[serde(rename = "terminate")]
    Terminate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PtyExecutionTarget {
    #[serde(rename = "windows-native", alias = "windows_native")]
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
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum PtySshShell {
    Posix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PtyRequest {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub worker_id: String,
    pub session_id: String,
    pub session_generation: Option<u64>,
    pub operation: PtyOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PtyStatus {
    Created,
    Running,
    Exited,
    Failed,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PtyResponse {
    pub envelope: ProtocolEnvelope,
    pub workspace_id: String,
    pub worker_id: String,
    pub session_id: String,
    pub session_generation: u64,
    pub generation: u64,
    pub operation: String,
    pub status: PtyStatus,
    pub exit_code: Option<i32>,
    pub output_sequence: u64,
    pub tail: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalRequest {
    pub envelope: ProtocolEnvelope,
    pub terminal_id: String,
    pub expected_generation: u64,
    pub operation: TerminalOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileRequest {
    pub envelope: ProtocolEnvelope,
    pub operation: FileOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitRequest {
    pub envelope: ProtocolEnvelope,
    pub operation: GitOperation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    UnsupportedVersion(u16),
    CapabilityDenied(Capability),
    EmptyRequestId,
    EmptyGitPath,
    EmptyFilePath,
    EmptyTerminalId,
    EmptyTerminalFailureReason,
    InvalidTerminalGeneration,
    InvalidTerminalOutputSequence,
    EmptyPtyWorkspaceId,
    EmptyPtyWorkerId,
    EmptyPtySessionId,
    MissingPtySessionGeneration,
    InvalidPtySessionGeneration,
    EmptyPtyProgram,
    InvalidPtySize,
    InvalidPtyTimeout,
    EmptyPtyExecutionTarget,
    EmptyExecutionWorkspaceId,
    EmptyExecutionWorkerId,
    InvalidWorkerIncarnation,
    InvalidOwnershipLease,
    ExecutionTargetRemoteIdentityMismatch,
    ResponseMismatch(&'static str),
    InvalidFileBytesWritten,
}

impl ProtocolEnvelope {
    pub fn new(
        request_id: impl Into<String>,
        capability: Capability,
        protocol_version: u16,
    ) -> Self {
        Self {
            request_id: request_id.into(),
            capability,
            protocol_version,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.request_id.trim().is_empty() {
            return Err(ProtocolError::EmptyRequestId);
        }
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(self.protocol_version));
        }
        Ok(())
    }

    pub fn authorize(&self, granted: &[Capability]) -> Result<(), ProtocolError> {
        if granted.contains(&self.capability) {
            Ok(())
        } else {
            Err(ProtocolError::CapabilityDenied(self.capability))
        }
    }
}

impl GitRequest {
    pub fn new(
        request_id: impl Into<String>,
        operation: GitOperation,
        protocol_version: u16,
    ) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::Git, protocol_version),
            operation,
        }
    }

    pub fn worktree_list(
        request_id: impl Into<String>,
        repository_path: impl Into<String>,
    ) -> Self {
        Self::new(
            request_id,
            GitOperation::WorktreeList {
                repository_path: repository_path.into(),
            },
            PROTOCOL_VERSION,
        )
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::Git {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }

        let path = match &self.operation {
            GitOperation::WorktreeList { repository_path } => repository_path,
            GitOperation::RepositoryGitDir { path } => path,
        };
        if path.trim().is_empty() {
            return Err(ProtocolError::EmptyGitPath);
        }
        Ok(())
    }
}

impl FileRequest {
    pub fn read(request_id: impl Into<String>, path: impl Into<String>) -> Self {
        Self::new(request_id, FileOperation::Read { path: path.into() })
    }

    pub fn write(request_id: impl Into<String>, path: impl Into<String>, bytes: Vec<u8>) -> Self {
        Self::new(
            request_id,
            FileOperation::Write {
                path: path.into(),
                bytes,
            },
        )
    }

    pub fn new(request_id: impl Into<String>, operation: FileOperation) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::File, PROTOCOL_VERSION),
            operation,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::File {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }
        let path = match &self.operation {
            FileOperation::Read { path } | FileOperation::Write { path, .. } => path,
        };
        if path.trim().is_empty() {
            return Err(ProtocolError::EmptyFilePath);
        }
        Ok(())
    }
}

impl TerminalRequest {
    pub fn start(
        request_id: impl Into<String>,
        terminal_id: impl Into<String>,
        expected_generation: u64,
    ) -> Self {
        Self::new(
            request_id,
            terminal_id,
            expected_generation,
            TerminalOperation::Start,
        )
    }

    pub fn snapshot(
        request_id: impl Into<String>,
        terminal_id: impl Into<String>,
        expected_generation: u64,
    ) -> Self {
        Self::new(
            request_id,
            terminal_id,
            expected_generation,
            TerminalOperation::Snapshot,
        )
    }

    pub fn new(
        request_id: impl Into<String>,
        terminal_id: impl Into<String>,
        expected_generation: u64,
        operation: TerminalOperation,
    ) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::Terminal, PROTOCOL_VERSION),
            terminal_id: terminal_id.into(),
            expected_generation,
            operation,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::Terminal {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }
        if self.terminal_id.trim().is_empty() {
            return Err(ProtocolError::EmptyTerminalId);
        }
        if self.expected_generation > MAX_SAFE_INTEGER {
            return Err(ProtocolError::InvalidTerminalGeneration);
        }
        match &self.operation {
            TerminalOperation::Output { sequence, .. }
                if *sequence == 0 || *sequence > MAX_SAFE_INTEGER =>
            {
                Err(ProtocolError::InvalidTerminalOutputSequence)
            }
            TerminalOperation::Fail { reason } if reason.trim().is_empty() => {
                Err(ProtocolError::EmptyTerminalFailureReason)
            }
            _ => Ok(()),
        }
    }
}

impl PtyRequest {
    pub fn new(
        request_id: impl Into<String>,
        workspace_id: impl Into<String>,
        worker_id: impl Into<String>,
        session_id: impl Into<String>,
        session_generation: Option<u64>,
        operation: PtyOperation,
    ) -> Self {
        Self {
            envelope: ProtocolEnvelope::new(request_id, Capability::Pty, PROTOCOL_VERSION),
            workspace_id: workspace_id.into(),
            worker_id: worker_id.into(),
            session_id: session_id.into(),
            session_generation,
            operation,
        }
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        self.envelope.validate()?;
        if self.envelope.capability != Capability::Pty {
            return Err(ProtocolError::CapabilityDenied(self.envelope.capability));
        }
        if self.workspace_id.trim().is_empty() {
            return Err(ProtocolError::EmptyPtyWorkspaceId);
        }
        if self.worker_id.trim().is_empty() {
            return Err(ProtocolError::EmptyPtyWorkerId);
        }
        if self.session_id.trim().is_empty() {
            return Err(ProtocolError::EmptyPtySessionId);
        }
        if self
            .session_generation
            .is_some_and(|generation| generation > MAX_SAFE_INTEGER)
        {
            return Err(ProtocolError::InvalidPtySessionGeneration);
        }
        match &self.operation {
            PtyOperation::Start {
                program,
                execution_target,
                cols,
                rows,
                ..
            } => {
                if self.session_generation.is_some() {
                    return Err(ProtocolError::InvalidPtySessionGeneration);
                }
                if program.trim().is_empty() {
                    return Err(ProtocolError::EmptyPtyProgram);
                }
                if *cols == 0 || *rows == 0 {
                    return Err(ProtocolError::InvalidPtySize);
                }
                if execution_target
                    .as_ref()
                    .is_some_and(|target| match target {
                        PtyExecutionTarget::Wsl2 { distro } => distro.trim().is_empty(),
                        PtyExecutionTarget::Ssh { host, .. } => host.trim().is_empty(),
                        PtyExecutionTarget::WindowsNative => false,
                    })
                {
                    return Err(ProtocolError::EmptyPtyExecutionTarget);
                }
            }
            PtyOperation::Wait { timeout_ms } => {
                if self.session_generation.is_none() {
                    return Err(ProtocolError::MissingPtySessionGeneration);
                }
                if *timeout_ms == 0 || *timeout_ms > 30_000 {
                    return Err(ProtocolError::InvalidPtyTimeout);
                }
            }
            _ => {
                if self.session_generation.is_none() {
                    return Err(ProtocolError::MissingPtySessionGeneration);
                }
                if let PtyOperation::Resize { cols, rows } = &self.operation {
                    if *cols == 0 || *rows == 0 {
                        return Err(ProtocolError::InvalidPtySize);
                    }
                }
            }
        }
        Ok(())
    }
}
