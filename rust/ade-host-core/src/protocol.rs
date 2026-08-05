use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

pub const HOST_CAPABILITIES: [Capability; 4] = [
    Capability::WorkspaceRead,
    Capability::WorkspaceWrite,
    Capability::Terminal,
    Capability::Git,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "workspace.read")]
    WorkspaceRead,
    #[serde(rename = "workspace.write")]
    WorkspaceWrite,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "git")]
    Git,
}

impl Capability {
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::WorkspaceRead => "workspace.read",
            Self::WorkspaceWrite => "workspace.write",
            Self::Terminal => "terminal",
            Self::Git => "git",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolEnvelope {
    pub request_id: String,
    pub capability: Capability,
    pub protocol_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    UnsupportedVersion(u16),
    CapabilityDenied(Capability),
    EmptyRequestId,
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
