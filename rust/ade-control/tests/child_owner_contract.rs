use ade_control::{AgentControlChild, AgentControlChildError, AgentControlClient};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_path(name: &str, suffix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ade-control-child-{name}-{}-{}.{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        suffix
    ))
}

fn json(line: &str) -> Value {
    serde_json::from_str(line).unwrap()
}

fn request(request_id: &str, command: &str) -> String {
    format!(r#"{{"protocol_version":1,"request_id":"{request_id}","command":"{command}"}}"#)
}

#[test]
fn real_child_startup_is_heartbeat_verified_and_shared_by_multiple_clients() {
    let state_db = temp_path("shared", "db");
    let endpoint = temp_path("shared", "json");
    let child =
        AgentControlChild::spawn(env!("CARGO_BIN_EXE_ade-control"), &state_db, &endpoint).unwrap();
    assert_eq!(child.endpoint_file(), endpoint.as_path());
    assert!(child.server_pid() > 0);

    let mut first = AgentControlClient::connect(child.endpoint_file()).unwrap();
    let maintenance = json(
        &first
            .request_line(
                r#"{"protocol_version":1,"request_id":"maintenance-1","command":"worker_maintenance","args":{"enabled":true}}"#,
            )
            .unwrap(),
    );
    assert_eq!(maintenance["result"]["maintenance"], true);

    let mut second = AgentControlClient::connect(child.endpoint_file()).unwrap();
    let status = json(
        &second
            .request_line(&request("status-1", "worker_status"))
            .unwrap(),
    );
    assert_eq!(status["result"]["maintenance"], true);
    drop(child);
    assert!(!endpoint.exists());
    let _ = fs::remove_file(state_db);
}

#[test]
fn preexisting_endpoint_causes_startup_failure_without_replacement() {
    let state_db = temp_path("existing", "db");
    let endpoint = temp_path("existing", "json");
    fs::write(&endpoint, b"sentinel").unwrap();

    let result = AgentControlChild::spawn(env!("CARGO_BIN_EXE_ade-control"), &state_db, &endpoint);

    assert!(matches!(
        result,
        Err(AgentControlChildError::StartupEof)
            | Err(AgentControlChildError::StartupRead(_))
            | Err(AgentControlChildError::StartupInvalid(_))
    ));
    assert_eq!(fs::read(&endpoint).unwrap(), b"sentinel");
    let _ = fs::remove_file(endpoint);
    let _ = fs::remove_file(state_db);
}

#[cfg(unix)]
#[test]
fn startup_pid_mismatch_is_terminal_and_fake_child_is_reaped() {
    use std::os::unix::fs::PermissionsExt;

    let state_db = temp_path("pid-mismatch", "db");
    let endpoint = temp_path("pid-mismatch", "json");
    let script = temp_path("pid-mismatch", "sh");
    fs::write(
        &script,
        format!(
            "#!/bin/sh\nprintf '%s\\n' '{{\"protocol_version\":1,\"type\":\"control_server\",\"ok\":true,\"address\":\"127.0.0.1:9\",\"server_pid\":0,\"endpoint_file\":{}}}'\nsleep 30\n",
            serde_json::to_string(&endpoint.to_string_lossy()).unwrap()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&script).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&script, permissions).unwrap();

    let result = AgentControlChild::spawn(&script, &state_db, &endpoint);
    if !matches!(&result, Err(AgentControlChildError::StartupPidMismatch { .. })) {
        let detail = match &result {
            Ok(_) => String::from("Ok(AgentControlChild)"),
            Err(error) => format!("Err({error:?})"),
        };
        panic!("unexpected fake-child startup result: {detail}");
    }
    let _ = fs::remove_file(script);
    let _ = fs::remove_file(state_db);
}
