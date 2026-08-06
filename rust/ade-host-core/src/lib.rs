pub mod host_runtime;
pub mod ownership;
pub mod protocol;
pub mod state;
pub mod terminal;
pub mod worker;

#[cfg(test)]
mod contract_tests {
    use super::host_runtime::HostRuntime;
    use super::protocol::{
        Capability, FileRequest, GitOperation, GitRequest, ProtocolEnvelope, ProtocolError,
        PtyOperation, PtyRequest, PtyResponse, PtyStatus, TerminalOperation, TerminalRequest,
        HOST_CAPABILITIES, PROTOCOL_VERSION,
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
            vec![
                "workspace.read",
                "workspace.write",
                "terminal",
                "pty",
                "git",
                "file",
            ]
        );
    }

    #[test]
    fn file_request_serializes_and_rejects_empty_paths() {
        let request = FileRequest::write("request-file", r"C:\workspaces\file.txt", vec![1, 2]);
        assert_eq!(request.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&request).expect("file request should serialize"),
            r#"{"envelope":{"request_id":"request-file","capability":"file","protocol_version":1},"operation":{"type":"write","path":"C:\\workspaces\\file.txt","bytes":[1,2]}}"#
        );
        assert_eq!(
            FileRequest::read("request-file", "  ").validate(),
            Err(ProtocolError::EmptyFilePath)
        );
    }

    #[test]
    fn terminal_request_serializes_and_rejects_invalid_lifecycle_state() {
        let request = TerminalRequest::start("request-terminal", "terminal-1", 0);
        assert_eq!(request.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&request).expect("terminal request should serialize"),
            r#"{"envelope":{"request_id":"request-terminal","capability":"terminal","protocol_version":1},"terminal_id":"terminal-1","expected_generation":0,"operation":{"type":"start"}}"#
        );
        assert_eq!(
            TerminalRequest::snapshot("request-terminal", "  ", 0).validate(),
            Err(ProtocolError::EmptyTerminalId)
        );
        assert_eq!(
            TerminalRequest::new(
                "request-terminal",
                "terminal-1",
                1,
                TerminalOperation::Fail {
                    reason: String::from("  "),
                },
            )
            .validate(),
            Err(ProtocolError::EmptyTerminalFailureReason)
        );
        assert_eq!(
            TerminalRequest::snapshot("request-terminal", "terminal-1", 9_007_199_254_740_992,)
                .validate(),
            Err(ProtocolError::InvalidTerminalGeneration)
        );
        assert_eq!(
            TerminalRequest::new(
                "request-terminal",
                "terminal-1",
                1,
                TerminalOperation::Output {
                    sequence: 9_007_199_254_740_992,
                    data: String::from("overflow"),
                },
            )
            .validate(),
            Err(ProtocolError::InvalidTerminalOutputSequence)
        );
    }

    #[test]
    fn terminal_request_rejects_unknown_wire_fields() {
        assert!(serde_json::from_str::<TerminalRequest>(
            r#"{"envelope":{"request_id":"request-terminal","capability":"terminal","protocol_version":1,"unexpected":true},"terminal_id":"terminal-1","expected_generation":0,"operation":{"type":"start"}}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<TerminalRequest>(
            r#"{"envelope":{"request_id":"request-terminal","capability":"terminal","protocol_version":1},"terminal_id":"terminal-1","expected_generation":0,"operation":{"type":"start"},"unexpected":true}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<TerminalRequest>(
            r#"{"envelope":{"request_id":"request-terminal","capability":"terminal","protocol_version":1},"terminal_id":"terminal-1","expected_generation":0,"operation":{"type":"output","sequence":1,"data":"ready","unexpected":true}}"#,
        )
        .is_err());
    }

    #[test]
    fn pty_request_is_versioned_owned_and_strict() {
        let request = PtyRequest::new(
            "request-pty",
            "workspace-1",
            "worker-1",
            "session-1",
            None,
            PtyOperation::Start {
                program: String::from("bash"),
                args: vec![String::from("-lc"), String::from("printf ready")],
                current_dir: None,
                execution_target: Some(super::protocol::PtyExecutionTarget::WindowsNative),
                cols: 80,
                rows: 24,
            },
        );
        assert_eq!(request.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&request).expect("pty request should serialize"),
            r#"{"envelope":{"request_id":"request-pty","capability":"pty","protocol_version":1},"workspace_id":"workspace-1","worker_id":"worker-1","session_id":"session-1","session_generation":null,"operation":{"type":"start","program":"bash","args":["-lc","printf ready"],"current_dir":null,"execution_target":{"kind":"windows-native"},"cols":80,"rows":24}}"#
        );
        assert!(serde_json::from_str::<PtyRequest>(
            r#"{"envelope":{"request_id":"request-pty","capability":"pty","protocol_version":1},"workspace_id":"workspace-1","worker_id":"worker-1","session_id":"session-1","session_generation":null,"operation":{"type":"start","program":"bash","args":[],"current_dir":null,"execution_target":null,"cols":80,"rows":24,"unexpected":true}}"#
        )
        .is_err());
    }

    #[test]
    fn pty_request_rejects_stale_or_invalid_operation_boundaries() {
        let mut request = PtyRequest::new(
            "request-pty",
            "workspace-1",
            "worker-1",
            "session-1",
            Some(1),
            PtyOperation::Write {
                input: String::from("input"),
            },
        );
        assert_eq!(request.validate(), Ok(()));
        request.session_generation = None;
        assert_eq!(
            request.validate(),
            Err(ProtocolError::MissingPtySessionGeneration)
        );
        request.session_generation = Some(1);
        request.operation = PtyOperation::Wait { timeout_ms: 30_001 };
        assert_eq!(request.validate(), Err(ProtocolError::InvalidPtyTimeout));
    }

    #[test]
    fn pty_response_serializes_authoritative_terminal_outcome_and_rejects_unknown_fields() {
        let response = PtyResponse {
            envelope: ProtocolEnvelope::new("request-pty", Capability::Pty, PROTOCOL_VERSION),
            workspace_id: String::from("workspace-1"),
            worker_id: String::from("worker-1"),
            session_id: String::from("session-1"),
            session_generation: 7,
            generation: 2,
            operation: String::from("wait"),
            status: PtyStatus::Exited,
            exit_code: Some(7),
            output_sequence: 3,
            tail: String::from("ready"),
            failure_reason: None,
        };

        assert_eq!(
            serde_json::to_string(&response).expect("pty response should serialize"),
            r#"{"envelope":{"request_id":"request-pty","capability":"pty","protocol_version":1},"workspace_id":"workspace-1","worker_id":"worker-1","session_id":"session-1","session_generation":7,"generation":2,"operation":"wait","status":"exited","exit_code":7,"output_sequence":3,"tail":"ready","failure_reason":null}"#
        );
        assert!(serde_json::from_str::<PtyResponse>(
            r#"{"envelope":{"request_id":"request-pty","capability":"pty","protocol_version":1},"workspace_id":"workspace-1","worker_id":"worker-1","session_id":"session-1","session_generation":7,"generation":2,"operation":"wait","status":"exited","exit_code":7,"output_sequence":3,"tail":"ready","failure_reason":null,"unexpected":true}"#
        )
        .is_err());
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
    fn worker_file_and_git_requests_carry_strict_execution_context() {
        use super::protocol::{
            ExecutionContext, ExecutionTarget, FileWorkerRequest, GitWorkerRequest,
            OwnershipContext, WorkspaceKind,
        };

        let context = ExecutionContext::new(
            "workspace-1",
            WorkspaceKind::GitWorktree,
            "worker-1",
            7,
            OwnershipContext::new(11),
            ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-22.04"),
            },
            Some(String::from("Ubuntu-22.04")),
        );
        let file = FileWorkerRequest::read("request-file", context.clone(), "/repo/note.txt");
        let git = GitWorkerRequest::worktree_list("request-git", context, "/repo");

        assert_eq!(file.validate(), Ok(()));
        assert_eq!(git.validate(), Ok(()));
        assert_eq!(
            serde_json::to_string(&file).expect("file worker request should serialize"),
            r#"{"envelope":{"request_id":"request-file","capability":"file","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"wsl2","distro":"Ubuntu-22.04"},"remote_identity":"Ubuntu-22.04","operation":{"type":"read","path":"/repo/note.txt"}}"#
        );
        assert_eq!(
            serde_json::to_string(&git).expect("git worker request should serialize"),
            r#"{"envelope":{"request_id":"request-git","capability":"git","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"wsl2","distro":"Ubuntu-22.04"},"remote_identity":"Ubuntu-22.04","operation":{"type":"worktree_list","repository_path":"/repo"}}"#
        );
    }

    #[test]
    fn worker_file_and_git_wire_contracts_reject_unknown_fields_and_context_mismatch() {
        use super::protocol::{
            ExecutionContext, ExecutionTarget, FileWorkerRequest, OwnershipContext, WorkspaceKind,
        };

        let unknown = serde_json::from_str::<FileWorkerRequest>(
            r#"{"envelope":{"request_id":"request-file","capability":"file","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"windows-native"},"remote_identity":null,"operation":{"type":"read","path":"/note.txt","unexpected":true}}"#,
        );
        assert!(unknown.is_err());

        let context = ExecutionContext::new(
            "workspace-1",
            WorkspaceKind::GitWorktree,
            "worker-1",
            7,
            OwnershipContext::new(11),
            ExecutionTarget::WindowsNative,
            Some(String::from("unexpected")),
        );
        let request = FileWorkerRequest::read("request-file", context, "/note.txt");
        assert_eq!(
            request.validate(),
            Err(ProtocolError::ExecutionTargetRemoteIdentityMismatch)
        );
    }

    #[test]
    fn worker_context_matrix_covers_folder_worktree_native_wsl2_and_ssh() {
        use super::protocol::{
            ExecutionContext, ExecutionTarget, FileWorkerRequest, GitWorkerRequest,
            OwnershipContext, PtySshShell, WorkspaceKind,
        };

        let folder = ExecutionContext::new(
            "folder-1",
            WorkspaceKind::Folder,
            "worker-native",
            1,
            OwnershipContext::new(1),
            ExecutionTarget::WindowsNative,
            None,
        );
        assert_eq!(
            FileWorkerRequest::read("folder-read", folder, r"C:\\folder\\note.txt").validate(),
            Ok(())
        );

        let ssh = ExecutionContext::new(
            "worktree-1",
            WorkspaceKind::GitWorktree,
            "worker-ssh",
            2,
            OwnershipContext::new(2),
            ExecutionTarget::Ssh {
                host: String::from("builder"),
                shell: PtySshShell::Posix,
            },
            Some(String::from("builder")),
        );
        assert_eq!(
            GitWorkerRequest::worktree_list("ssh-list", ssh, "/srv/repo").validate(),
            Ok(())
        );
    }

    #[test]
    fn worker_responses_are_typed_and_correlate_to_replayable_requests() {
        use super::protocol::{
            ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse,
            GitWorkerRequest, GitWorkerResponse, GitWorktree, OwnershipContext, WorkspaceKind,
        };

        let context = ExecutionContext::new(
            "workspace-1",
            WorkspaceKind::GitWorktree,
            "worker-1",
            7,
            OwnershipContext::new(11),
            ExecutionTarget::WindowsNative,
            None,
        );
        let request = FileWorkerRequest::read("request-file", context, "/note.txt");
        let response = FileWorkerResponse::from_read_request(&request, vec![1, 2]);
        assert_eq!(response.validate_for(&request), Ok(()));
        assert_eq!(response.envelope.request_id, "request-file");
        let mut overflow = response.clone();
        overflow.bytes_written = 9_007_199_254_740_992;
        assert_eq!(
            overflow.validate_for(&request),
            Err(ProtocolError::InvalidFileBytesWritten)
        );
        assert!(serde_json::from_str::<FileWorkerResponse>(
            r#"{"envelope":{"request_id":"request-file","capability":"file","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"windows-native"},"remote_identity":null,"operation":"read","path":"/note.txt","bytes":[1,2],"bytes_written":0,"changed":false,"unexpected":true}"#,
        )
        .is_err());

        let git_request = GitWorkerRequest::worktree_list(
            "request-git",
            ExecutionContext::new(
                "workspace-1",
                WorkspaceKind::GitWorktree,
                "worker-1",
                7,
                OwnershipContext::new(11),
                ExecutionTarget::WindowsNative,
                None,
            ),
            r"C:\workspaces\repo",
        );
        let git_response = GitWorkerResponse::from_worktree_list_request(
            &git_request,
            vec![GitWorktree {
                path: String::from(r"C:\workspaces\repo"),
                head: String::from("abc123"),
                branch: None,
                is_bare: false,
                locked: false,
                lock_reason: None,
                prunable: false,
                prunable_reason: None,
                is_main: true,
            }],
        );
        assert_eq!(git_response.validate_for(&git_request), Ok(()));
        let encoded =
            serde_json::to_value(&git_response).expect("git worker response should serialize");
        assert_eq!(
            encoded["repository_path"],
            serde_json::Value::String(String::from(r"C:\workspaces\repo"))
        );

        let bare_request = GitWorkerRequest::worktree_list(
            "request-bare",
            git_request.context(),
            r"C:\workspaces\bare.git",
        );
        let bare_response = GitWorkerResponse::from_worktree_list_request(
            &bare_request,
            vec![GitWorktree {
                path: String::from(r"C:\workspaces\bare.git"),
                head: String::new(),
                branch: None,
                is_bare: true,
                locked: false,
                lock_reason: None,
                prunable: false,
                prunable_reason: None,
                is_main: true,
            }],
        );
        assert_eq!(bare_response.validate_for(&bare_request), Ok(()));
        let decoded_bare = serde_json::from_value::<GitWorkerResponse>(
            serde_json::to_value(&bare_response).expect("bare git response should serialize"),
        )
        .expect("bare git response should deserialize");
        assert_eq!(decoded_bare.validate_for(&bare_request), Ok(()));
        let mut non_bare_without_head = bare_response.clone();
        non_bare_without_head.worktrees[0].is_bare = false;
        assert_eq!(
            non_bare_without_head.validate_for(&bare_request),
            Err(ProtocolError::EmptyGitPath)
        );

        let mut mismatched_path = git_response.clone();
        mismatched_path.repository_path = String::from(r"C:\workspaces\other");
        assert_eq!(
            mismatched_path.validate_for(&git_request),
            Err(ProtocolError::ResponseMismatch("repository_path"))
        );
        assert!(serde_json::from_str::<GitWorkerResponse>(
            r#"{"envelope":{"request_id":"request-git","capability":"git","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"windows-native"},"remote_identity":null,"operation":"worktree-list","worktrees":[]}"#,
        )
        .is_err());
        assert!(serde_json::from_str::<GitWorkerResponse>(
            r#"{"envelope":{"request_id":"request-git","capability":"git","protocol_version":1},"workspace_id":"workspace-1","workspace_kind":"git-worktree","worker_id":"worker-1","worker_incarnation":7,"ownership":{"lease_id":11},"execution_target":{"kind":"windows-native"},"remote_identity":null,"operation":"worktree-list","repository_path":"/repo","worktrees":[],"unexpected":true}"#,
        )
        .is_err());
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
