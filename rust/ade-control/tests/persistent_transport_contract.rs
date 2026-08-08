use ade_control::{AgentControlClient, AgentControlServer, ControlTransportError};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn temp_path(name: &str, suffix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ade-control-{name}-{}-{}.{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        suffix
    ))
}

fn request(request_id: &str, command: &str) -> String {
    format!(r#"{{"protocol_version":1,"request_id":"{request_id}","command":"{command}"}}"#)
}

fn maintenance(request_id: &str, enabled: bool) -> String {
    format!(
        r#"{{"protocol_version":1,"request_id":"{request_id}","command":"worker_maintenance","args":{{"enabled":{enabled}}}}}"#
    )
}

fn json(line: &str) -> serde_json::Value {
    serde_json::from_str(line).unwrap_or_else(|error| panic!("invalid JSON {line:?}: {error}"))
}

struct RunningServer {
    state_db: PathBuf,
    endpoint_file: PathBuf,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<Result<(), ControlTransportError>>>,
}

impl RunningServer {
    fn start(name: &str) -> Self {
        let state_db = temp_path(name, "db");
        let endpoint_file = temp_path(name, "json");
        let server = AgentControlServer::bind(&state_db, &endpoint_file).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let server_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || server.run_until(server_stop));
        Self {
            state_db,
            endpoint_file,
            stop,
            handle: Some(handle),
        }
    }

    fn client(&self) -> AgentControlClient {
        AgentControlClient::connect(&self.endpoint_file).unwrap()
    }

    fn stop(mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.handle.take().unwrap().join().unwrap().unwrap();
        assert!(!self.endpoint_file.exists());
        let _ = fs::remove_file(&self.state_db);
    }
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            self.stop.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }
        let _ = fs::remove_file(&self.endpoint_file);
        let _ = fs::remove_file(&self.state_db);
    }
}

#[test]
fn existing_endpoint_file_is_never_replaced() {
    let state_db = temp_path("existing-endpoint", "db");
    let endpoint_file = temp_path("existing-endpoint", "json");
    fs::write(&endpoint_file, b"do-not-replace").unwrap();

    assert!(matches!(
        AgentControlServer::bind(&state_db, &endpoint_file),
        Err(ControlTransportError::EndpointFileExists(ref path)) if path == &endpoint_file
    ));
    assert_eq!(fs::read(&endpoint_file).unwrap(), b"do-not-replace");
    let _ = fs::remove_file(endpoint_file);
    let _ = fs::remove_file(state_db);
}

#[cfg(unix)]
#[test]
fn endpoint_file_is_private_on_unix() {
    use std::os::unix::fs::PermissionsExt;

    let server = RunningServer::start("private-endpoint");
    let mode = fs::metadata(&server.endpoint_file)
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600);
    server.stop();
}

#[test]
fn wrong_token_is_rejected_before_session_side_effect() {
    let server = RunningServer::start("wrong-token");
    let wrong_endpoint = temp_path("wrong-token-copy", "json");
    let mut endpoint: serde_json::Value =
        serde_json::from_slice(&fs::read(&server.endpoint_file).unwrap()).unwrap();
    endpoint["token"] = serde_json::Value::String("00".repeat(32));
    fs::write(&wrong_endpoint, serde_json::to_vec(&endpoint).unwrap()).unwrap();

    assert!(matches!(
        AgentControlClient::connect(&wrong_endpoint),
        Err(ControlTransportError::Unauthorized)
    ));
    let mut client = server.client();
    let status = json(
        &client
            .request_line(&request("status-1", "worker_status"))
            .unwrap(),
    );
    assert_eq!(status["result"]["maintenance"], false);
    let _ = fs::remove_file(wrong_endpoint);
    server.stop();
}

#[test]
fn two_clients_share_runtime_receipts_and_control_heartbeat() {
    let server = RunningServer::start("shared-runtime");
    let mut first = server.client();
    let mut second = server.client();

    let first_response = first.request_line(&maintenance("shared-1", true)).unwrap();
    assert_eq!(json(&first_response)["result"]["maintenance"], true);
    let replay = second.request_line(&maintenance("shared-1", true)).unwrap();
    assert_eq!(replay, first_response);
    let conflict = json(
        &second
            .request_line(&maintenance("shared-1", false))
            .unwrap(),
    );
    assert_eq!(conflict["error"]["code"], "request_id_conflict");
    let status = json(
        &second
            .request_line(&request("status-2", "worker_status"))
            .unwrap(),
    );
    assert_eq!(status["result"]["maintenance"], true);

    let heartbeat = json(
        &first
            .request_line(&request("control-1", "control_status"))
            .unwrap(),
    );
    assert_eq!(heartbeat["result"]["type"], "control_status");
    assert_eq!(heartbeat["result"]["server_pid"], std::process::id());
    assert!(heartbeat["result"]["started_at_unix_ms"].as_u64().unwrap() > 0);
    assert!(heartbeat["result"]["receipt_count"].as_u64().unwrap() >= 3);
    server.stop();
}

#[test]
fn oversized_request_closes_only_that_connection_and_server_stays_healthy() {
    let server = RunningServer::start("oversized");
    let endpoint: serde_json::Value =
        serde_json::from_slice(&fs::read(&server.endpoint_file).unwrap()).unwrap();
    let address = endpoint["address"].as_str().unwrap();
    let token = endpoint["token"].as_str().unwrap();
    let mut stream = std::net::TcpStream::connect(address).unwrap();
    writeln!(
        stream,
        "{{\"type\":\"agent_control_auth\",\"protocol_version\":1,\"token\":{}}}",
        serde_json::to_string(token).unwrap()
    )
    .unwrap();
    stream.flush().unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut ack = String::new();
    reader.read_line(&mut ack).unwrap();
    assert_eq!(json(&ack)["ok"], true);
    let oversized = format!("{}\n", "x".repeat(70 * 1024));
    let _ = stream.write_all(oversized.as_bytes());
    let _ = stream.flush();
    let mut error = String::new();
    reader.read_line(&mut error).unwrap();
    assert_eq!(json(&error)["error"]["code"], "request_too_large");

    let mut healthy = server.client();
    let status = json(
        &healthy
            .request_line(&request("healthy-1", "control_status"))
            .unwrap(),
    );
    assert_eq!(status["ok"], true);
    server.stop();
}

#[test]
fn real_server_and_client_processes_share_state_and_cleanup_endpoint_on_eof() {
    let state_db = temp_path("real-process", "db");
    let endpoint_file = temp_path("real-process", "json");
    let mut server = Command::new(env!("CARGO_BIN_EXE_ade-control"))
        .args(["--json", "--serve", "--state-db"])
        .arg(&state_db)
        .arg("--endpoint-file")
        .arg(&endpoint_file)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    for _ in 0..200 {
        if endpoint_file.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(endpoint_file.exists(), "server endpoint file should appear");

    let mut client = Command::new(env!("CARGO_BIN_EXE_ade-control"))
        .args(["--json", "--jsonl", "--connect"])
        .arg(&endpoint_file)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut client_stdin = client.stdin.take().unwrap();
    writeln!(client_stdin, "{}", maintenance("process-1", true)).unwrap();
    writeln!(client_stdin, "{}", request("process-2", "worker_status")).unwrap();
    drop(client_stdin);
    let lines = BufReader::new(client.stdout.take().unwrap())
        .lines()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(client.wait().unwrap().success());
    assert_eq!(lines.len(), 2);
    assert_eq!(json(&lines[0])["result"]["maintenance"], true);
    assert_eq!(json(&lines[1])["result"]["maintenance"], true);

    drop(server.stdin.take());
    assert!(server.wait().unwrap().success());
    assert!(!endpoint_file.exists());
    let _ = fs::remove_file(state_db);
}
