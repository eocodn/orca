pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    WorkspaceRead,
    WorkspaceWrite,
    Terminal,
    Git,
}

#[derive(Debug, Clone, PartialEq, Eq)]
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
