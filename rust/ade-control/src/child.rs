use crate::{
    AgentControlClient, AgentControlCommand, AgentControlRequest, CONTROL_PROTOCOL_VERSION,
};
use serde::Deserialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_POLL: Duration = Duration::from_millis(25);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentControlChildError {
    Spawn(String),
    MissingStdin,
    MissingStdout,
    StartupTimeout,
    StartupEof,
    StartupRead(String),
    StartupInvalid(String),
    ProtocolMismatch { expected: u16, actual: u16 },
    StartupPidMismatch { expected: u32, actual: u32 },
    StartupEndpointMismatch,
    Connect(String),
    Heartbeat(String),
    HeartbeatPidMismatch { expected: u32, actual: u32 },
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlServerStartup {
    protocol_version: u16,
    #[serde(rename = "type")]
    kind: String,
    ok: bool,
    address: String,
    server_pid: u32,
    endpoint_file: String,
}

pub struct AgentControlChild {
    child: Child,
    stdin: Option<ChildStdin>,
    endpoint_file: PathBuf,
    server_pid: u32,
}

impl AgentControlChild {
    pub fn spawn(
        binary: impl AsRef<Path>,
        state_db: impl AsRef<Path>,
        endpoint_file: impl AsRef<Path>,
    ) -> Result<Self, AgentControlChildError> {
        let endpoint_file = endpoint_file.as_ref().to_path_buf();
        let mut child = Command::new(binary.as_ref())
            .arg("--json")
            .arg("--serve")
            .arg("--state-db")
            .arg(state_db.as_ref())
            .arg("--endpoint-file")
            .arg(&endpoint_file)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| AgentControlChildError::Spawn(error.to_string()))?;
        let expected_pid = child.id();
        let stdin = match child.stdin.take() {
            Some(stdin) => stdin,
            None => {
                terminate_child(&mut child, None);
                return Err(AgentControlChildError::MissingStdin);
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::MissingStdout);
            }
        };
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout)
                .read_line(&mut line)
                .map(|count| (count, line));
            let _ = sender.send(result);
        });
        let startup_line = match receiver.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Ok((0, _))) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::StartupEof);
            }
            Ok(Ok((_, line))) => line,
            Ok(Err(error)) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::StartupRead(error.to_string()));
            }
            Err(RecvTimeoutError::Timeout) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::StartupTimeout);
            }
            Err(RecvTimeoutError::Disconnected) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::StartupEof);
            }
        };
        let startup: ControlServerStartup = match serde_json::from_str(startup_line.trim()) {
            Ok(startup) => startup,
            Err(error) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::StartupInvalid(error.to_string()));
            }
        };
        if startup.protocol_version != CONTROL_PROTOCOL_VERSION {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::ProtocolMismatch {
                expected: CONTROL_PROTOCOL_VERSION,
                actual: startup.protocol_version,
            });
        }
        if startup.kind != "control_server" || !startup.ok {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::StartupInvalid(
                "startup envelope is not a successful control_server".into(),
            ));
        }
        if startup.server_pid != expected_pid {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::StartupPidMismatch {
                expected: expected_pid,
                actual: startup.server_pid,
            });
        }
        if Path::new(&startup.endpoint_file) != endpoint_file {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::StartupEndpointMismatch);
        }
        if startup.address.trim().is_empty() {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::StartupInvalid(
                "startup address is empty".into(),
            ));
        }
        let mut client = match AgentControlClient::connect(&endpoint_file) {
            Ok(client) => client,
            Err(error) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::Connect(format!("{error:?}")));
            }
        };
        let heartbeat_request = AgentControlRequest {
            protocol_version: CONTROL_PROTOCOL_VERSION,
            request_id: child_heartbeat_request_id(expected_pid),
            command: AgentControlCommand::ControlStatus,
            args: None,
        };
        let heartbeat_line = match serde_json::to_string(&heartbeat_request)
            .map_err(|error| AgentControlChildError::Heartbeat(error.to_string()))
            .and_then(|line| {
                client
                    .request_line(&line)
                    .map_err(|error| AgentControlChildError::Heartbeat(format!("{error:?}")))
            }) {
            Ok(line) => line,
            Err(error) => {
                terminate_child(&mut child, Some(stdin));
                return Err(error);
            }
        };
        let heartbeat: Value = match serde_json::from_str(&heartbeat_line) {
            Ok(value) => value,
            Err(error) => {
                terminate_child(&mut child, Some(stdin));
                return Err(AgentControlChildError::Heartbeat(error.to_string()));
            }
        };
        if heartbeat.get("ok").and_then(Value::as_bool) != Some(true)
            || heartbeat.pointer("/result/type").and_then(Value::as_str) != Some("control_status")
        {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::Heartbeat(
                "control_status heartbeat was not successful".into(),
            ));
        }
        let actual_pid = heartbeat
            .pointer("/result/server_pid")
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .ok_or_else(|| {
                AgentControlChildError::Heartbeat("heartbeat server_pid is missing".into())
            });
        let actual_pid = match actual_pid {
            Ok(pid) => pid,
            Err(error) => {
                terminate_child(&mut child, Some(stdin));
                return Err(error);
            }
        };
        if actual_pid != expected_pid {
            terminate_child(&mut child, Some(stdin));
            return Err(AgentControlChildError::HeartbeatPidMismatch {
                expected: expected_pid,
                actual: actual_pid,
            });
        }
        Ok(Self {
            child,
            stdin: Some(stdin),
            endpoint_file,
            server_pid: expected_pid,
        })
    }

    pub fn endpoint_file(&self) -> &Path {
        &self.endpoint_file
    }

    pub fn server_pid(&self) -> u32 {
        self.server_pid
    }
}

impl Drop for AgentControlChild {
    fn drop(&mut self) {
        let stdin = self.stdin.take();
        terminate_child(&mut self.child, stdin);
    }
}

fn child_heartbeat_request_id(pid: u32) -> String {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("agent-control-child-start-{pid}-{suffix}")
}

fn terminate_child(child: &mut Child, stdin: Option<ChildStdin>) {
    drop(stdin);
    let deadline = std::time::Instant::now() + SHUTDOWN_TIMEOUT;
    while std::time::Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(SHUTDOWN_POLL),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}
