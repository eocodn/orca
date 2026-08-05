use super::{
    commit_request_result, execute_pty_request, PtyExecutionState, PtyOperation, PtyRequest,
    PtySessionEntry,
};
use ade_host_core::protocol::{
    PtyExecutionTarget, PtyOperation as HostPtyOperation, PtyRequest as HostPtyRequest, PtyResponse,
};
use ade_terminal::pty::PtySession;
#[cfg(unix)]
use std::sync::Arc;

fn request(request_id: &str, session_id: &str, operation: PtyOperation) -> PtyRequest {
    PtyRequest {
        request_id: request_id.to_string(),
        workspace_id: String::from("workspace-1"),
        worker_id: String::from("worker-1"),
        session_id: session_id.to_string(),
        session_generation: (operation != PtyOperation::Start).then_some(1),
        operation,
        program: None,
        args: Vec::new(),
        current_dir: None,
        execution_target: None,
        input: None,
        cols: None,
        rows: None,
        timeout_ms: None,
    }
}

#[cfg(unix)]
#[test]
fn starts_writes_waits_and_replays_one_authoritative_session() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    let started = execute_pty_request(&start, &state).unwrap();
    assert!(started.contains(r#""status":"running""#));
    let response = serde_json::from_str::<PtyResponse>(&started)
        .expect("PTY responses must use the shared Host wire schema");
    assert_eq!(response.workspace_id, "workspace-1");
    assert_eq!(response.worker_id, "worker-1");

    let mut write = request("write-1", "session-1", PtyOperation::Write);
    write.input = Some(String::from("ready\n"));
    let write_response = execute_pty_request(&write, &state).unwrap();
    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    let terminated = execute_pty_request(&terminate, &state).unwrap();
    assert!(terminated.contains(r#""status":"failed""#));

    assert_eq!(execute_pty_request(&write, &state), Ok(write_response));
}

#[test]
fn rejects_unknown_fields_during_deserialization() {
    let error = serde_json::from_str::<PtyRequest>(
        r#"{"request_id":"r","session_id":"s","operation":"poll","unknown":true}"#,
    )
    .unwrap_err();
    assert!(error.to_string().contains("unknown field"));
}

#[test]
fn executes_a_shared_wire_request_through_the_authoritative_registry() {
    #[cfg(unix)]
    let (program, args) = (String::from("printf"), vec![String::from("ready")]);
    #[cfg(windows)]
    let (program, args) = (
        String::from("cmd.exe"),
        vec![String::from("/C"), String::from("exit"), String::from("0")],
    );
    let state = PtyExecutionState::default();
    let request = HostPtyRequest::new(
        "shared-start-1",
        "workspace-1",
        "worker-1",
        "session-1",
        None,
        HostPtyOperation::Start {
            program,
            args,
            current_dir: None,
            execution_target: Some(PtyExecutionTarget::WindowsNative),
            cols: 80,
            rows: 24,
        },
    );
    let response = super::execute_shared_pty_request(&request, &state).unwrap();
    let response = serde_json::from_str::<PtyResponse>(&response)
        .expect("shared requests must return shared responses");
    assert_eq!(response.operation, "start");
    assert_eq!(response.session_id, "session-1");
}

#[test]
fn rejects_an_execution_target_on_non_start_operations() {
    let mut write = request("write-1", "session-1", PtyOperation::Write);
    write.input = Some(String::from("input"));
    write.execution_target = Some(PtyExecutionTarget::Wsl2 {
        distro: String::from("Ubuntu-24.04"),
    });

    assert_eq!(
        execute_pty_request(&write, &PtyExecutionState::default()),
        Err(String::from("execution_target_only_on_start"))
    );
}

#[cfg(unix)]
#[test]
fn rejects_a_non_owner_operation_and_replays_the_conflict() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut write = request("write-1", "session-1", PtyOperation::Write);
    write.input = Some(String::from("blocked\n"));
    write.workspace_id = String::from("workspace-2");

    let first = execute_pty_request(&write, &state);
    assert_eq!(first, Err(String::from("session_owner_conflict")));
    assert_eq!(execute_pty_request(&write, &state), first);

    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    execute_pty_request(&terminate, &state).unwrap();
}

#[test]
fn accepts_the_public_hyphenated_native_target_name() {
    let request: PtyRequest = serde_json::from_str(
        r#"{
                "request_id":"start-1",
                "workspace_id":"workspace-1",
                "worker_id":"worker-1",
                "session_id":"session-1",
                "operation":"start",
                "program":"bash",
                "args":[],
                "current_dir":null,
                "execution_target":{"kind":"windows-native"},
                "input":null,
                "cols":80,
                "rows":24,
                "timeout_ms":null
            }"#,
    )
    .unwrap();

    assert_eq!(
        request.execution_target,
        Some(PtyExecutionTarget::WindowsNative)
    );
}

#[test]
fn replays_committed_errors_without_repeating_the_operation() {
    let state = PtyExecutionState::default();
    let mut write = request("write-1", "missing-session", PtyOperation::Write);
    write.input = Some(String::from("input"));

    let first = execute_pty_request(&write, &state);
    assert_eq!(first, Err(String::from("session_not_found")));

    let mut start = request("start-1", "missing-session", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();
    assert!(execute_pty_request(&write, &state).is_ok());

    let mut missing = request("missing-1", "missing-session-2", PtyOperation::Write);
    missing.input = Some(String::from("input"));
    let second = execute_pty_request(&missing, &state);
    assert_eq!(second, Err(String::from("session_not_found")));
    assert_eq!(execute_pty_request(&missing, &state), second);
}

#[test]
fn requires_a_bounded_wait_timeout() {
    let state = PtyExecutionState::default();
    let wait = request("wait-1", "session-1", PtyOperation::Wait);

    assert_eq!(
        execute_pty_request(&wait, &state),
        Err(String::from("missing_timeout"))
    );
}

#[test]
fn commits_spawn_failures_and_releases_the_session_reservation() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("ade-program-that-does-not-exist"));
    start.cols = Some(80);
    start.rows = Some(24);

    let first = execute_pty_request(&start, &state);
    assert_eq!(first, Err(String::from("pty_spawn_failed")));
    assert_eq!(execute_pty_request(&start, &state), first);

    let mut valid = request("start-2", "session-1", PtyOperation::Start);
    valid.program = Some(String::from("cat"));
    valid.cols = Some(80);
    valid.rows = Some(24);
    assert!(execute_pty_request(&valid, &state).is_ok());
}

#[cfg(unix)]
#[test]
fn waits_through_the_contract_and_observes_authoritative_exit() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("printf"));
    start.args = vec![String::from("ready")];
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut wait = request("wait-1", "session-1", PtyOperation::Wait);
    wait.timeout_ms = Some(2_000);
    let response = execute_pty_request(&wait, &state).unwrap();
    assert!(response.contains(r#""status":"exited""#));
    assert!(response.contains(r#""exit_code":0"#));
}

#[cfg(unix)]
#[test]
fn reserves_a_session_before_concurrent_starts_spawn() {
    use std::sync::Barrier;
    use std::thread;

    let state = Arc::new(PtyExecutionState::default());
    let barrier = Arc::new(Barrier::new(2));
    let mut handles = Vec::new();
    for request_id in ["start-a", "start-b"] {
        let state = Arc::clone(&state);
        let barrier = Arc::clone(&barrier);
        let mut start = request(request_id, "session-1", PtyOperation::Start);
        start.program = Some(String::from("sleep"));
        start.args = vec![String::from("1")];
        start.cols = Some(80);
        start.rows = Some(24);
        handles.push(thread::spawn(move || {
            barrier.wait();
            execute_pty_request(&start, &state)
        }));
    }

    let results = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(results.iter().all(|result| {
            result.is_ok()
                || matches!(result.as_ref(), Err(error) if matches!(error.as_str(), "session_id_starting" | "session_id_conflict"))
        }));
}

#[cfg(unix)]
#[test]
fn stale_terminate_cannot_remove_a_replacement_session() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let old_session = {
        let registry = state.registry.lock().unwrap();
        std::sync::Arc::clone(&registry.sessions.get("session-1").unwrap().session)
    };
    let replacement = std::sync::Arc::new(std::sync::Mutex::new(
        PtySession::spawn(
            String::from("session-1"),
            super::build_pty_spec(&start).unwrap(),
        )
        .unwrap(),
    ));
    {
        let mut registry = state.registry.lock().unwrap();
        registry.sessions.insert(
            String::from("session-1"),
            PtySessionEntry {
                owner: super::owner_for_request(&start),
                session_generation: 1,
                session: std::sync::Arc::clone(&replacement),
            },
        );
    }

    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    {
        let mut registry = state.registry.lock().unwrap();
        registry
            .in_flight_requests
            .insert(terminate.request_id.clone(), terminate.clone());
    }
    commit_request_result(
        &terminate,
        &state,
        Ok(String::from("terminated")),
        Some(&old_session),
        false,
    )
    .unwrap();

    let registry = state.registry.lock().unwrap();
    assert!(std::sync::Arc::ptr_eq(
        &registry.sessions.get("session-1").unwrap().session,
        &replacement
    ));
}

#[cfg(unix)]
#[test]
fn rejects_a_request_from_a_previous_session_incarnation() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    let started = execute_pty_request(&start, &state).unwrap();
    assert!(started.contains(r#""session_generation":1"#));

    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    execute_pty_request(&terminate, &state).unwrap();

    let mut replacement = request("start-2", "session-1", PtyOperation::Start);
    replacement.program = Some(String::from("cat"));
    replacement.cols = Some(80);
    replacement.rows = Some(24);
    let started = execute_pty_request(&replacement, &state).unwrap();
    assert!(started.contains(r#""session_generation":2"#));

    let mut stale_write = request("write-stale", "session-1", PtyOperation::Write);
    stale_write.session_generation = Some(1);
    stale_write.input = Some(String::from("must-not-reach-replacement"));
    assert_eq!(
        execute_pty_request(&stale_write, &state),
        Err(String::from("stale_session_generation"))
    );
    stale_write.session_generation = Some(2);
    assert!(execute_pty_request(&stale_write, &state).is_ok());

    let terminate = request("terminate-2", "session-1", PtyOperation::Terminate);
    // The replacement owns a fresh incarnation; stale requests must not clean it up.
    assert_eq!(terminate.session_generation, Some(1));
    let mut terminate = terminate;
    terminate.session_generation = Some(2);
    execute_pty_request(&terminate, &state).unwrap();
}

#[cfg(unix)]
#[test]
fn removes_a_session_after_a_successful_wait_timeout() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("sleep"));
    start.args = vec![String::from("2")];
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut wait = request("wait-1", "session-1", PtyOperation::Wait);
    wait.timeout_ms = Some(20);
    let response = execute_pty_request(&wait, &state).unwrap();
    assert!(response.contains(r#""status":"failed""#));
    assert!(response.contains(r#""failure_reason":"pty timed out""#));

    let mut replacement = request("start-2", "session-1", PtyOperation::Start);
    replacement.program = Some(String::from("printf"));
    replacement.args = vec![String::from("reused")];
    replacement.cols = Some(80);
    replacement.rows = Some(24);
    assert!(execute_pty_request(&replacement, &state).is_ok());
}

#[cfg(unix)]
#[test]
fn validation_abort_allows_a_corrected_retry_with_the_same_request_id() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut write = request("write-1", "session-1", PtyOperation::Write);
    write.input = Some(String::from("retry\n"));
    write.session_generation = Some(super::MAX_SESSION_GENERATION + 1);
    assert_eq!(
        execute_pty_request(&write, &state),
        Err(String::from("invalid_session_generation"))
    );

    write.session_generation = Some(1);
    assert!(execute_pty_request(&write, &state).is_ok());

    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    execute_pty_request(&terminate, &state).unwrap();
}

#[cfg(unix)]
#[test]
fn session_generation_overflow_does_not_leave_a_reservation() {
    let state = PtyExecutionState::default();
    {
        let mut registry = state.registry.lock().unwrap();
        registry.next_session_generation = super::MAX_SESSION_GENERATION;
    }

    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    assert_eq!(
        execute_pty_request(&start, &state),
        Err(String::from("session_generation_overflow"))
    );

    let registry = state.registry.lock().unwrap();
    assert!(registry.in_flight_requests.is_empty());
    assert!(registry.session_reservations.is_empty());
    assert!(registry.sessions.is_empty());
    assert!(registry.committed_requests.is_empty());
}

#[test]
fn owner_conflict_does_not_consume_a_competing_request_id() {
    let state = PtyExecutionState::default();
    let conflict = request("shared-request", "session-1", PtyOperation::Write);
    let mut competing = conflict.clone();
    competing.session_id = String::from("session-2");
    {
        let mut registry = state.registry.lock().unwrap();
        registry
            .in_flight_requests
            .insert(conflict.request_id.clone(), competing.clone());
    }

    commit_request_result(
        &conflict,
        &state,
        Err(String::from("session_owner_conflict")),
        None,
        false,
    )
    .unwrap();

    let registry = state.registry.lock().unwrap();
    assert_eq!(
        registry.in_flight_requests.get("shared-request"),
        Some(&competing)
    );
    assert!(!registry.committed_requests.contains_key("shared-request"));
}

#[cfg(unix)]
#[test]
fn completed_process_releases_its_session_registry_entry() {
    let state = PtyExecutionState::default();
    let mut start = request("start-1", "session-1", PtyOperation::Start);
    start.program = Some(String::from("printf"));
    start.args = vec![String::from("ready")];
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut wait = request("wait-1", "session-1", PtyOperation::Wait);
    wait.timeout_ms = Some(2_000);
    execute_pty_request(&wait, &state).unwrap();

    let registry = state.registry.lock().unwrap();
    assert!(!registry.sessions.contains_key("session-1"));
}

#[cfg(unix)]
#[test]
fn committed_request_id_conflicts_before_validation() {
    let state = PtyExecutionState::default();
    let mut start = request("shared-request", "session-1", PtyOperation::Start);
    start.program = Some(String::from("cat"));
    start.cols = Some(80);
    start.rows = Some(24);
    execute_pty_request(&start, &state).unwrap();

    let mut invalid_retry = start.clone();
    invalid_retry.program = None;
    assert_eq!(
        execute_pty_request(&invalid_retry, &state),
        Err(String::from("request_id_conflict"))
    );

    let terminate = request("terminate-1", "session-1", PtyOperation::Terminate);
    execute_pty_request(&terminate, &state).unwrap();
}
