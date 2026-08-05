pub mod host_runtime;
pub mod protocol;
pub mod state;
pub mod terminal;
pub mod worker;

#[cfg(test)]
mod contract_tests {
    use super::host_runtime::HostRuntime;
    use super::protocol::{
        Capability, GitOperation, GitRequest, ProtocolEnvelope, ProtocolError, HOST_CAPABILITIES,
        PROTOCOL_VERSION,
    };
    use super::state::{HostCommand, HostError, HostState, WorkspaceId, WorkspaceStatus};
    use super::worker::{WorkerCommand, WorkerRuntime, WorkerStatus};
    use std::sync::Arc;
    use std::thread;

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
    fn protocol_capabilities_have_stable_wire_names() {
        assert_eq!(
            HOST_CAPABILITIES
                .iter()
                .map(|capability| capability.wire_name())
                .collect::<Vec<_>>(),
            vec!["workspace.read", "workspace.write", "terminal", "git"]
        );
    }

    #[test]
    fn protocol_envelope_serializes_with_stable_wire_fields() {
        let envelope = ProtocolEnvelope::new("request-1", Capability::WorkspaceWrite, 1);
        assert_eq!(
            serde_json::to_string(&envelope).expect("protocol envelope should serialize"),
            r#"{"request_id":"request-1","capability":"workspace.write","protocol_version":1}"#
        );
    }

    #[test]
    fn git_request_serializes_as_a_versioned_host_operation() {
        let request = GitRequest::worktree_list("request-7", r"C:\workspaces\repo");

        assert_eq!(request.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&request).expect("git request should serialize"),
            r#"{"envelope":{"request_id":"request-7","capability":"git","protocol_version":1},"operation":{"type":"worktree_list","repository_path":"C:\\workspaces\\repo"}}"#
        );
    }

    #[test]
    fn git_request_rejects_empty_paths_without_normalizing_them() {
        let request = GitRequest::new(
            "request-8",
            GitOperation::RepositoryGitDir {
                path: String::from("  "),
            },
            PROTOCOL_VERSION,
        );

        assert_eq!(request.validate(), Err(ProtocolError::EmptyGitPath));
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

    #[test]
    fn concurrent_host_mutations_have_one_authoritative_winner() {
        let runtime = Arc::new(HostRuntime::new());
        let id = WorkspaceId::new("workspace-1").unwrap();
        runtime
            .apply(
                0,
                HostCommand::Register {
                    id: id.clone(),
                    path: String::from(r"C:\workspaces\one"),
                },
            )
            .unwrap();
        let generation = runtime.snapshot().unwrap().generation;

        let handles = (0..8)
            .map(|_| {
                let runtime = Arc::clone(&runtime);
                let id = id.clone();
                thread::spawn(move || runtime.apply(generation, HostCommand::Start { id }))
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| result
                    == &&Err(HostError::StaleGeneration {
                        expected: generation,
                        actual: generation + 1,
                    }))
                .count(),
            7
        );
        assert_eq!(runtime.snapshot().unwrap().ready_workspaces, 0);
    }

    #[test]
    fn worker_heartbeat_is_monotonic_and_observable() {
        let worker = WorkerRuntime::new("wsl-ubuntu").unwrap();
        worker.apply(0, WorkerCommand::Start).unwrap();
        worker.apply(1, WorkerCommand::Ready).unwrap();
        worker
            .apply(2, WorkerCommand::Heartbeat { sequence: 1 })
            .unwrap();
        assert_eq!(worker.snapshot().unwrap().status, WorkerStatus::Ready);
        assert_eq!(worker.snapshot().unwrap().heartbeat_sequence, 1);
        assert_eq!(
            worker.apply(3, WorkerCommand::Heartbeat { sequence: 1 }),
            Err(super::worker::WorkerError::StaleHeartbeat {
                received: 1,
                actual: 1
            })
        );
    }
}
