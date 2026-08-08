#![cfg(unix)]

use ade_host_core::protocol::{
    ExecutionContext, ExecutionTarget, FileWorkerRequest, FileWorkerResponse, OwnershipContext,
    PtyExecutionTarget, PtyOperation, PtyRequest, PtyResponse, WorkerHandshakeRequest,
    WorkerHandshakeResponse, WorkspaceKind,
};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn socket_path() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "ade-worker-service-{}-{nonce}.sock",
        std::process::id()
    ))
}

struct ChildIo {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl ChildIo {
    fn connect(socket: &PathBuf) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ade-worker"))
            .arg("--connect-unix")
            .arg(socket)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("worker relay should start");
        Self {
            stdin: BufWriter::new(child.stdin.take().unwrap()),
            stdout: BufReader::new(child.stdout.take().unwrap()),
            child,
        }
    }

    fn request<Q: serde::Serialize, R: serde::de::DeserializeOwned>(&mut self, request: &Q) -> R {
        serde_json::to_writer(&mut self.stdin, request).unwrap();
        self.stdin.write_all(b"\n").unwrap();
        self.stdin.flush().unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        assert!(!line.is_empty(), "relay must return one JSONL response");
        serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("invalid relay response {line:?}: {error}"))
    }

    fn close(mut self) {
        drop(self.stdin);
        assert!(self.child.wait().unwrap().success());
    }
}

#[test]
fn daemon_handshake_and_pty_survive_relay_disconnect() {
    let socket = socket_path();
    let mut daemon = Command::new(env!("CARGO_BIN_EXE_ade-worker"))
        .arg("--serve-unix")
        .arg(&socket)
        .arg("--worker-id")
        .arg("wsl-worker")
        .arg("--worker-incarnation")
        .arg("7")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("worker daemon should start");

    for _ in 0..100 {
        if socket.exists() {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(socket.exists(), "worker daemon socket should appear");

    let mut first = ChildIo::connect(&socket);
    let handshake: WorkerHandshakeResponse =
        first.request(&WorkerHandshakeRequest::new("handshake-1"));
    assert_eq!(handshake.worker_id, "wsl-worker");
    assert_eq!(handshake.worker_incarnation, 7);
    assert_eq!(handshake.worker_version, env!("CARGO_PKG_VERSION"));
    handshake
        .validate_for(&WorkerHandshakeRequest::new("handshake-1"))
        .unwrap();

    let wrong_worker_request = PtyRequest::new(
        "pty-wrong-worker",
        "workspace-1",
        "wrong-worker",
        "wrong-session",
        None,
        PtyOperation::Start {
            program: "sh".into(),
            args: vec!["-lc".into(), "printf should-not-run".into()],
            current_dir: None,
            execution_target: Some(PtyExecutionTarget::WindowsNative),
            cols: 80,
            rows: 24,
        },
    );
    let wrong_worker: serde_json::Value = first.request(&wrong_worker_request);
    assert_eq!(
        wrong_worker
            .get("error")
            .and_then(serde_json::Value::as_str),
        Some("worker_identity_mismatch")
    );

    let start_request = PtyRequest::new(
        "pty-start",
        "workspace-1",
        "wsl-worker",
        "session-1",
        None,
        PtyOperation::Start {
            program: "sh".into(),
            args: vec!["-lc".into(), "sleep 0.05; printf relay-persisted".into()],
            current_dir: None,
            execution_target: Some(PtyExecutionTarget::WindowsNative),
            cols: 80,
            rows: 24,
        },
    );
    let start: PtyResponse = first.request(&start_request);
    let generation = start.session_generation;
    first.close();

    let mut second = ChildIo::connect(&socket);
    let wait_request = PtyRequest::new(
        "pty-wait",
        "workspace-1",
        "wsl-worker",
        "session-1",
        Some(generation),
        PtyOperation::Wait { timeout_ms: 2_000 },
    );
    let waited: PtyResponse = second.request(&wait_request);
    assert_eq!(waited.exit_code, Some(0));
    assert!(waited.tail.contains("relay-persisted"));

    let marker = socket.with_extension("marker");
    fs::write(&marker, b"socket-file").unwrap();
    let file_request = FileWorkerRequest::read(
        "file-read",
        ExecutionContext::new(
            "workspace-1",
            WorkspaceKind::Folder,
            "wsl-worker",
            7,
            OwnershipContext::new(1),
            ExecutionTarget::WindowsNative,
            None,
        ),
        marker.to_str().unwrap(),
    );
    let file_response: FileWorkerResponse = second.request(&file_request);
    file_response.validate_for(&file_request).unwrap();
    assert_eq!(file_response.bytes, b"socket-file");
    second.close();

    let _ = daemon.kill();
    let _ = daemon.wait();
    let _ = fs::remove_file(&socket);
    let _ = fs::remove_file(marker);
}
