use ade_host_core::worker::{WorkerCommand, WorkerSnapshot, WorkerStatus};
use std::fmt::Write as _;

pub mod jsonl_transport;
pub mod pty_registry;
pub mod pty_target;

#[derive(Debug, PartialEq, Eq)]
pub struct WorkerCliOptions {
    pub json: bool,
    pub worker_id: String,
    pub commands: Vec<WorkerCommand>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerCliError {
    MissingWorkerId,
    MissingHeartbeatSequence,
    InvalidHeartbeatSequence(String),
    UnexpectedArgument(String),
    Runtime(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<WorkerCliOptions, WorkerCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut worker_id = String::from("local");
    let mut commands = Vec::new();
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => json = true,
            "--worker-id" => {
                worker_id = args.next().ok_or(WorkerCliError::MissingWorkerId)?;
                if worker_id.trim().is_empty() {
                    return Err(WorkerCliError::MissingWorkerId);
                }
            }
            "--start" => commands.push(WorkerCommand::Start),
            "--ready" => commands.push(WorkerCommand::Ready),
            "--heartbeat" => {
                let sequence = args
                    .next()
                    .ok_or(WorkerCliError::MissingHeartbeatSequence)?;
                let sequence = sequence
                    .parse::<u64>()
                    .map_err(|_| WorkerCliError::InvalidHeartbeatSequence(sequence))?;
                commands.push(WorkerCommand::Heartbeat { sequence });
            }
            "--fail" => commands.push(WorkerCommand::Fail),
            "--stop" => commands.push(WorkerCommand::Stop),
            _ => return Err(WorkerCliError::UnexpectedArgument(argument)),
        }
    }
    Ok(WorkerCliOptions {
        json,
        worker_id,
        commands,
    })
}

pub fn run_cli<I, S>(args: I) -> Result<String, WorkerCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_cli_args(args)?;
    let worker = ade_host_core::worker::WorkerRuntime::new(options.worker_id)
        .map_err(|error| WorkerCliError::Runtime(format!("{error:?}")))?;
    let mut snapshot = worker
        .snapshot()
        .map_err(|error| WorkerCliError::Runtime(format!("{error:?}")))?;
    for command in options.commands {
        snapshot = worker
            .apply(snapshot.generation, command)
            .map_err(|error| WorkerCliError::Runtime(format!("{error:?}")))?;
    }
    if options.json {
        Ok(render_heartbeat_json(&snapshot))
    } else {
        Ok(render_heartbeat_text(&snapshot))
    }
}

pub fn render_heartbeat_json(snapshot: &WorkerSnapshot) -> String {
    let status = match snapshot.status {
        WorkerStatus::Stopped => "stopped",
        WorkerStatus::Starting => "starting",
        WorkerStatus::Ready => "ready",
        WorkerStatus::Failed => "failed",
    };
    format!(
        "{{\"service\":\"ade-worker\",\"worker_id\":\"{}\",\"generation\":{},\"status\":\"{}\",\"heartbeat_sequence\":{}}}",
        escape_json_string(&snapshot.worker_id),
        snapshot.generation,
        status,
        snapshot.heartbeat_sequence
    )
}

fn escape_json_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\u{08}' => escaped.push_str("\\b"),
            '\u{0C}' => escaped.push_str("\\f"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character <= '\u{1F}' => {
                write!(&mut escaped, "\\u{:04x}", character as u32).unwrap();
            }
            character => escaped.push(character),
        }
    }
    escaped
}

pub fn render_heartbeat_text(snapshot: &WorkerSnapshot) -> String {
    let status = match snapshot.status {
        WorkerStatus::Stopped => "stopped",
        WorkerStatus::Starting => "starting",
        WorkerStatus::Ready => "ready",
        WorkerStatus::Failed => "failed",
    };
    format!(
        "ade-worker id={} status={} generation={} heartbeat={}",
        snapshot.worker_id, status, snapshot.generation, snapshot.heartbeat_sequence
    )
}

#[cfg(test)]
mod tests {
    use super::{
        parse_cli_args, render_heartbeat_json, render_heartbeat_text, run_cli, WorkerCliError,
        WorkerCliOptions,
    };
    use ade_host_core::worker::{WorkerSnapshot, WorkerStatus};

    #[test]
    fn renders_machine_observable_worker_heartbeat() {
        let snapshot = WorkerSnapshot {
            worker_id: String::from("wsl-ubuntu"),
            generation: 4,
            status: WorkerStatus::Ready,
            heartbeat_sequence: 9,
        };
        assert_eq!(
            render_heartbeat_json(&snapshot),
            r#"{"service":"ade-worker","worker_id":"wsl-ubuntu","generation":4,"status":"ready","heartbeat_sequence":9}"#
        );
    }

    #[test]
    fn escapes_worker_ids_in_machine_observable_json() {
        let snapshot = WorkerSnapshot {
            worker_id: String::from("worker\"quoted\\path"),
            generation: 1,
            status: WorkerStatus::Stopped,
            heartbeat_sequence: 0,
        };

        assert_eq!(
            render_heartbeat_json(&snapshot),
            r#"{"service":"ade-worker","worker_id":"worker\"quoted\\path","generation":1,"status":"stopped","heartbeat_sequence":0}"#
        );
    }

    #[test]
    fn parses_worker_identity_and_json_mode_without_ignoring_unknown_arguments() {
        assert_eq!(
            parse_cli_args(["--json", "--worker-id", "wsl-ubuntu"]),
            Ok(WorkerCliOptions {
                json: true,
                worker_id: String::from("wsl-ubuntu"),
                commands: Vec::new(),
            })
        );
        assert_eq!(
            parse_cli_args(["--legacy-mode"]),
            Err(WorkerCliError::UnexpectedArgument(String::from(
                "--legacy-mode"
            )))
        );
    }

    #[test]
    fn applies_a_strict_worker_command_sequence_before_rendering_state() {
        let output = run_cli([
            "--json",
            "--worker-id",
            "wsl-ubuntu",
            "--start",
            "--ready",
            "--heartbeat",
            "1",
            "--fail",
            "--stop",
        ])
        .expect("worker command sequence should succeed");
        assert_eq!(
            output,
            r#"{"service":"ade-worker","worker_id":"wsl-ubuntu","generation":5,"status":"stopped","heartbeat_sequence":1}"#
        );
    }

    #[test]
    fn renders_json_and_text_from_the_same_authoritative_snapshot() {
        let json = run_cli(["--json", "--worker-id", "wsl-ubuntu"]).expect("json output");
        let text = run_cli(["--worker-id", "wsl-ubuntu"]).expect("text output");
        assert!(json.contains(r#""worker_id":"wsl-ubuntu""#));
        assert_eq!(
            text,
            "ade-worker id=wsl-ubuntu status=stopped generation=0 heartbeat=0"
        );
        let snapshot = WorkerSnapshot {
            worker_id: String::from("wsl-ubuntu"),
            generation: 0,
            status: WorkerStatus::Stopped,
            heartbeat_sequence: 0,
        };
        assert_eq!(render_heartbeat_text(&snapshot), text);
    }
}
