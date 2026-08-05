pub mod protocol;
pub mod state;

#[cfg(test)]
mod contract_tests {
    use super::protocol::{Capability, ProtocolEnvelope, ProtocolError, PROTOCOL_VERSION};
    use super::state::{HostCommand, HostError, HostState, WorkspaceId, WorkspaceStatus};

    #[test]
    fn protocol_rejects_unsupported_versions_and_missing_capabilities() {
        let envelope = ProtocolEnvelope::new(
            "request-1",
            Capability::WorkspaceWrite,
            PROTOCOL_VERSION + 1,
        );

        assert_eq!(
            envelope.validate(),
            Err(ProtocolError::UnsupportedVersion(2))
        );
        assert_eq!(
            envelope.authorize(&[Capability::WorkspaceRead]),
            Err(ProtocolError::CapabilityDenied(Capability::WorkspaceWrite))
        );
    }

    #[test]
    fn workspace_registration_is_idempotent_but_conflicting_paths_are_rejected() {
        let id = WorkspaceId::new("workspace-1").unwrap();
        let mut state = HostState::default();

        assert!(
            state
                .apply(HostCommand::Register {
                    id: id.clone(),
                    path: String::from(r"C:\workspaces\one"),
                })
                .unwrap()
                .changed
        );
        assert!(
            !state
                .apply(HostCommand::Register {
                    id: id.clone(),
                    path: String::from(r"C:\workspaces\one"),
                })
                .unwrap()
                .changed
        );
        assert_eq!(
            state.apply(HostCommand::Register {
                id,
                path: String::from(r"C:\workspaces\other"),
            }),
            Err(HostError::WorkspacePathConflict)
        );
    }

    #[test]
    fn workspace_lifecycle_requires_authoritative_generation_and_valid_transitions() {
        let id = WorkspaceId::new("workspace-1").unwrap();
        let mut state = HostState::default();
        state
            .apply(HostCommand::Register {
                id: id.clone(),
                path: String::from(r"C:\workspaces\one"),
            })
            .unwrap();

        let generation = state.generation();
        assert_eq!(
            state.apply_if_generation(generation - 1, HostCommand::Start { id: id.clone() }),
            Err(HostError::StaleGeneration {
                expected: generation - 1,
                actual: generation
            })
        );
        state
            .apply_if_generation(generation, HostCommand::Start { id: id.clone() })
            .unwrap();
        assert_eq!(
            state.workspace(&id).unwrap().status,
            WorkspaceStatus::Starting
        );
        state.apply(HostCommand::Ready { id: id.clone() }).unwrap();
        assert_eq!(state.workspace(&id).unwrap().status, WorkspaceStatus::Ready);
        assert_eq!(
            state.apply(HostCommand::Start { id }),
            Err(HostError::InvalidTransition)
        );
    }
}
