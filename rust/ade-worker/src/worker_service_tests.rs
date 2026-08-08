use super::worker_service::{
    parse_service_mode, WorkerServiceError, WorkerServiceIdentity, WorkerServiceMode,
    WorkerUnixServer,
};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn socket_path(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "ade-worker-{name}-{}-{nonce}.sock",
        std::process::id()
    ))
}

fn identity() -> WorkerServiceIdentity {
    WorkerServiceIdentity::new("wsl-worker", 7).unwrap()
}

#[test]
fn parses_strict_serve_and_connect_modes() {
    let path = socket_path("parse");
    assert_eq!(
        parse_service_mode([
            "--serve-unix",
            path.to_str().unwrap(),
            "--worker-id",
            "wsl-worker",
            "--worker-incarnation",
            "7",
        ]),
        Ok(Some(WorkerServiceMode::ServeUnix {
            socket_path: path.clone(),
            identity: identity(),
        }))
    );
    assert_eq!(
        parse_service_mode(["--connect-unix", path.to_str().unwrap()]),
        Ok(Some(WorkerServiceMode::ConnectUnix { socket_path: path }))
    );
    assert_eq!(
        parse_service_mode(["--serve-unix", "relative.sock", "--worker-id", "worker"]),
        Err(WorkerServiceError::InvalidSocketPath)
    );
    assert!(matches!(
        parse_service_mode([
            "--serve-unix",
            "/tmp/worker.sock",
            "--worker-id",
            "worker",
            "--worker-incarnation",
            "0",
        ]),
        Err(WorkerServiceError::InvalidWorkerIncarnation(_))
    ));
    assert!(matches!(
        parse_service_mode(["--connect-unix", "/tmp/worker.sock", "--unexpected"]),
        Err(WorkerServiceError::UnexpectedArgument(_))
    ));
}

#[test]
fn unix_socket_is_private_and_does_not_replace_an_active_listener() {
    let path = socket_path("private");
    let server = WorkerUnixServer::bind(&path, identity()).unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    drop(server);
    let _ = fs::remove_file(&path);

    let active_path = socket_path("active");
    let active = UnixListener::bind(&active_path).unwrap();
    assert!(matches!(
        WorkerUnixServer::bind(&active_path, identity()),
        Err(WorkerServiceError::SocketInUse(_))
    ));
    assert!(UnixStream::connect(&active_path).is_ok());
    drop(active);
    let _ = fs::remove_file(&active_path);
}
