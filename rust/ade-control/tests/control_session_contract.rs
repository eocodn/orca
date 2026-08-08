use ade_control::{
    parse_cli_args, AgentControlSession, ControlCliError, ControlCliMode, ControlCliOptions,
};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn state_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ade-control-{name}-{}-{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn request(request_id: &str, command: &str) -> String {
    format!(r#"{{"protocol_version":1,"request_id":"{request_id}","command":"{command}"}}"#)
}

fn response(line: &str) -> serde_json::Value {
    serde_json::from_str(line).unwrap_or_else(|error| panic!("invalid response {line:?}: {error}"))
}

#[test]
fn cli_requires_explicit_json_jsonl_and_state_database() {
    assert_eq!(
        parse_cli_args(["--json", "--jsonl", "--state-db", "state.db"]),
        Ok(ControlCliOptions {
            json: true,
            mode: ControlCliMode::Direct {
                state_db: PathBuf::from("state.db"),
            },
        })
    );
    assert_eq!(
        parse_cli_args(["--jsonl", "--state-db", "state.db"]),
        Err(ControlCliError::MissingJsonMode)
    );
    assert_eq!(
        parse_cli_args(["--json", "--jsonl", "--state-db", "state.db", "--legacy"]),
        Err(ControlCliError::UnexpectedArgument("--legacy".into()))
    );
    assert_eq!(
        parse_cli_args([
            "--json",
            "--serve",
            "--state-db",
            "state.db",
            "--endpoint-file",
            "control.json",
        ]),
        Ok(ControlCliOptions {
            json: true,
            mode: ControlCliMode::Serve {
                state_db: PathBuf::from("state.db"),
                endpoint_file: PathBuf::from("control.json"),
            },
        })
    );
    assert_eq!(
        parse_cli_args(["--json", "--jsonl", "--connect", "control.json"]),
        Ok(ControlCliOptions {
            json: true,
            mode: ControlCliMode::Connect {
                endpoint_file: PathBuf::from("control.json"),
            },
        })
    );
}

#[test]
fn strict_request_wire_rejects_unknown_fields_version_and_empty_request_id() {
    let path = state_path("strict");
    let session = AgentControlSession::open(&path).unwrap();

    let unknown = response(&session.handle_line(
        r#"{"protocol_version":1,"request_id":"strict-1","command":"host_status","extra":true}"#,
    ));
    assert_eq!(unknown["ok"], false);
    assert_eq!(unknown["request_id"], "strict-1");
    assert_eq!(unknown["error"]["code"], "invalid_request");

    let version =
        response(&session.handle_line(
            r#"{"protocol_version":2,"request_id":"strict-2","command":"host_status"}"#,
        ));
    assert_eq!(version["error"]["code"], "unsupported_protocol_version");

    let empty = response(
        &session.handle_line(r#"{"protocol_version":1,"request_id":" ","command":"host_status"}"#),
    );
    assert_eq!(empty["error"]["code"], "empty_request_id");
    let _ = std::fs::remove_file(path);
}

#[test]
fn host_status_uses_the_same_authoritative_sqlite_state_as_ade_host() {
    let path = state_path("host-status");
    ade_host::run_cli([
        "--state-db".into(),
        path.to_string_lossy().into_owned(),
        "--register-workspace".into(),
        "workspace-1".into(),
        "--workspace-path".into(),
        "/workspace/one".into(),
        "--request-id".into(),
        "register-1".into(),
    ])
    .unwrap();
    let session = AgentControlSession::open(&path).unwrap();

    let value = response(&session.handle_line(&request("host-1", "host_status")));

    assert_eq!(value["ok"], true);
    assert_eq!(value["result"]["type"], "host_status");
    assert_eq!(value["result"]["workspace_count"], 1);
    assert_eq!(value["result"]["source"], "sqlite-snapshot");
    let _ = std::fs::remove_file(path);
}

#[test]
fn worker_maintenance_and_status_share_one_runtime_and_request_receipts_are_idempotent() {
    let path = state_path("maintenance");
    let session = AgentControlSession::open(&path).unwrap();
    let enable = r#"{"protocol_version":1,"request_id":"maint-1","command":"worker_maintenance","args":{"enabled":true}}"#;

    let first = session.handle_line(enable);
    let replay = session.handle_line(enable);
    assert_eq!(first, replay);
    assert_eq!(response(&first)["result"]["maintenance"], true);

    let conflict = response(&session.handle_line(
        r#"{"protocol_version":1,"request_id":"maint-1","command":"worker_maintenance","args":{"enabled":false}}"#,
    ));
    assert_eq!(conflict["error"]["code"], "request_id_conflict");

    let status = response(&session.handle_line(&request("status-1", "worker_status")));
    assert_eq!(status["result"]["maintenance"], true);
    assert_eq!(status["result"]["state"], "stopped");
    let _ = std::fs::remove_file(path);
}

#[test]
fn missing_worker_binary_fails_before_runtime_update_or_maintenance() {
    let path = state_path("missing-binary");
    let session = AgentControlSession::open(&path).unwrap();
    let missing = std::env::temp_dir().join("ade-definitely-missing-worker-binary");
    let _ = std::fs::remove_file(&missing);
    let update = format!(
        r#"{{"protocol_version":1,"request_id":"update-1","command":"worker_update","args":{{"distro":"Ubuntu-24.04","service_user":"alice","worker_id":"worker","worker_incarnation":7,"worker_version":"0.1.0","expected_sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","binary_path":{}}}}}"#,
        serde_json::to_string(&missing.to_string_lossy()).unwrap()
    );

    let failed = response(&session.handle_line(&update));
    assert_eq!(failed["error"]["code"], "worker_binary_read");
    let status = response(&session.handle_line(&request("status-2", "worker_status")));
    assert_eq!(status["result"]["maintenance"], false);
    assert_eq!(status["result"]["state"], "stopped");
    let _ = std::fs::remove_file(path);
}

#[test]
fn real_jsonl_child_preserves_host_and_worker_state_across_requests() {
    let path = state_path("child");
    ade_host::run_cli([
        "--state-db".into(),
        path.to_string_lossy().into_owned(),
        "--register-workspace".into(),
        "workspace-1".into(),
        "--workspace-path".into(),
        "/workspace/one".into(),
        "--request-id".into(),
        "register-1".into(),
    ])
    .unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_ade-control"))
        .args(["--json", "--jsonl", "--state-db"])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{}", request("host-child", "host_status")).unwrap();
    writeln!(stdin, "{{\"protocol_version\":1,\"request_id\":\"maint-child\",\"command\":\"worker_maintenance\",\"args\":{{\"enabled\":true}}}}").unwrap();
    writeln!(stdin, "{}", request("status-child", "worker_status")).unwrap();
    drop(stdin);
    let stdout = child.stdout.take().unwrap();
    let lines = BufReader::new(stdout)
        .lines()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(child.wait().unwrap().success());
    assert_eq!(lines.len(), 3);
    assert_eq!(response(&lines[0])["result"]["workspace_count"], 1);
    assert_eq!(response(&lines[1])["result"]["maintenance"], true);
    assert_eq!(response(&lines[2])["result"]["maintenance"], true);
    let _ = std::fs::remove_file(path);
}

#[test]
fn real_child_rejects_unknown_cli_arguments_with_nonzero_exit() {
    let path = state_path("bad-cli");
    let status = Command::new(env!("CARGO_BIN_EXE_ade-control"))
        .args(["--json", "--jsonl", "--state-db"])
        .arg(&path)
        .arg("--legacy")
        .status()
        .unwrap();

    assert!(!status.success());
    let _ = std::fs::remove_file(path);
}
