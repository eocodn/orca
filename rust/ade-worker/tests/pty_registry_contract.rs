use ade_host_core::protocol::{
    Capability, ProtocolEnvelope, PtyOperation, PtyRequest, PtyResponse, PROTOCOL_VERSION,
};
use ade_worker::jsonl_transport::serve_jsonl;
use ade_worker::pty_registry::PtyWorkerRegistry;
use std::io::Cursor;

fn start(request_id: &str, session_id: &str) -> PtyRequest {
    PtyRequest::new(
        request_id,
        "workspace-1",
        "worker-1",
        session_id,
        None,
        PtyOperation::Start {
            program: "sh".into(),
            args: vec!["-lc".into(), "printf ready".into()],
            current_dir: None,
            execution_target: None,
            cols: 80,
            rows: 24,
        },
    )
}

#[test]
fn starts_live_session_and_replays_identical_requests() {
    let registry = PtyWorkerRegistry::default();
    let request = start("start-1", "session-1");
    let response = registry.execute(&request).expect("start should execute");
    assert_eq!(response.session_generation, 1);
    assert_eq!(response.operation, "start");
    assert_eq!(registry.execute(&request), Ok(response));
}

#[test]
fn rejects_conflicting_request_id_and_stale_or_wrong_owner_non_start() {
    let registry = PtyWorkerRegistry::default();
    let request = start("start-1", "session-1");
    let response = registry.execute(&request).expect("start should execute");

    let mut conflicting = request.clone();
    conflicting.operation = PtyOperation::Start {
        program: "sh".into(),
        args: vec!["-lc".into(), "printf other".into()],
        current_dir: None,
        execution_target: None,
        cols: 80,
        rows: 24,
    };
    assert_eq!(
        registry.execute(&conflicting),
        Err("request_id_conflict".into())
    );

    let mut poll = PtyRequest::new(
        "poll-1",
        "workspace-1",
        "worker-1",
        "session-1",
        Some(response.session_generation + 1),
        PtyOperation::Poll,
    );
    assert_eq!(
        registry.execute(&poll),
        Err("stale_session_generation".into())
    );
    poll.envelope.request_id = "owner-1".into();
    poll.worker_id = "other-worker".into();
    poll.session_generation = Some(response.session_generation);
    assert_eq!(
        registry.execute(&poll),
        Err("session_owner_conflict".into())
    );
}

#[test]
fn executes_write_poll_wait_and_terminate_with_authoritative_responses() {
    let registry = PtyWorkerRegistry::default();
    let started = registry.execute(&start("start-1", "session-1")).unwrap();
    let write = PtyRequest::new(
        "write-1",
        "workspace-1",
        "worker-1",
        "session-1",
        Some(started.session_generation),
        PtyOperation::Write { input: "\n".into() },
    );
    assert_eq!(registry.execute(&write).unwrap().operation, "write");
    let poll = PtyRequest::new(
        "poll-1",
        "workspace-1",
        "worker-1",
        "session-1",
        Some(started.session_generation),
        PtyOperation::Poll,
    );
    assert_eq!(registry.execute(&poll).unwrap().operation, "poll");
    let terminate = PtyRequest::new(
        "terminate-1",
        "workspace-1",
        "worker-1",
        "session-1",
        Some(started.session_generation),
        PtyOperation::Terminate,
    );
    assert_eq!(registry.execute(&terminate).unwrap().operation, "terminate");
}

#[test]
fn response_wire_remains_strict_and_correlated() {
    let response = PtyResponse {
        envelope: ProtocolEnvelope::new("r", Capability::Pty, PROTOCOL_VERSION),
        workspace_id: "w".into(),
        worker_id: "worker".into(),
        session_id: "s".into(),
        session_generation: 1,
        generation: 0,
        operation: "poll".into(),
        status: ade_host_core::protocol::PtyStatus::Running,
        exit_code: None,
        output_sequence: 0,
        tail: String::new(),
        failure_reason: None,
    };
    let encoded = serde_json::to_string(&response).unwrap();
    assert!(serde_json::from_str::<PtyResponse>(&encoded).is_ok());
    assert!(
        serde_json::from_str::<PtyResponse>(&encoded.replace("}", ",\"unexpected\":true}"))
            .is_err()
    );
}

#[test]
fn jsonl_transport_exposes_result_and_parse_errors_without_success_fallback() {
    let registry = PtyWorkerRegistry::default();
    let input = format!(
        "{}\n{{\"unexpected\":true}}\n",
        serde_json::to_string(&start("start-1", "session-1")).unwrap()
    );
    let mut output = Vec::new();
    serve_jsonl(Cursor::new(input), &mut output, &registry).unwrap();
    let lines = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let response = serde_json::from_str::<PtyResponse>(&lines[0]).unwrap();
    assert_eq!(response.envelope.request_id, "start-1");
    let error: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
    assert_eq!(error["ok"], false);
    assert_eq!(error["error"], "invalid_request");
}
