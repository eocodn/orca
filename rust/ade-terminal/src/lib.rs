use ade_host_core::terminal::{TerminalCommand, TerminalSnapshot, TerminalStatus};

#[derive(Debug, PartialEq, Eq)]
pub struct TerminalCliOptions {
    pub json: bool,
    pub terminal_id: String,
    pub commands: Vec<TerminalCommand>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum TerminalCliError {
    MissingTerminalId,
    MissingOutputSequence,
    InvalidOutputSequence(String),
    MissingOutputData,
    MissingExitCode,
    InvalidExitCode(String),
    MissingFailureReason,
    UnexpectedArgument(String),
    Runtime(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<TerminalCliOptions, TerminalCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut terminal_id = String::from("local");
    let mut commands = Vec::new();
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => json = true,
            "--terminal-id" => {
                terminal_id = args.next().ok_or(TerminalCliError::MissingTerminalId)?;
                if terminal_id.trim().is_empty() {
                    return Err(TerminalCliError::MissingTerminalId);
                }
            }
            "--start" => commands.push(TerminalCommand::Start),
            "--output" => {
                let sequence = args.next().ok_or(TerminalCliError::MissingOutputSequence)?;
                let sequence = sequence
                    .parse::<u64>()
                    .map_err(|_| TerminalCliError::InvalidOutputSequence(sequence))?;
                let data = args.next().ok_or(TerminalCliError::MissingOutputData)?;
                commands.push(TerminalCommand::Output { sequence, data });
            }
            "--exit" => {
                let code = args.next().ok_or(TerminalCliError::MissingExitCode)?;
                let code = code
                    .parse::<i32>()
                    .map_err(|_| TerminalCliError::InvalidExitCode(code))?;
                commands.push(TerminalCommand::Exit { code });
            }
            "--fail" => {
                let reason = args.next().ok_or(TerminalCliError::MissingFailureReason)?;
                if reason.trim().is_empty() {
                    return Err(TerminalCliError::MissingFailureReason);
                }
                commands.push(TerminalCommand::Fail { reason });
            }
            "--close" => commands.push(TerminalCommand::Close),
            _ => return Err(TerminalCliError::UnexpectedArgument(argument)),
        }
    }
    Ok(TerminalCliOptions {
        json,
        terminal_id,
        commands,
    })
}

pub fn run_cli<I, S>(args: I) -> Result<String, TerminalCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_cli_args(args)?;
    let terminal = ade_host_core::terminal::TerminalRuntime::new(options.terminal_id)
        .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
    let mut snapshot = terminal
        .snapshot()
        .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
    for command in options.commands {
        snapshot = terminal
            .apply(snapshot.generation, command)
            .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
    }
    if options.json {
        Ok(render_snapshot_json(&snapshot))
    } else {
        Ok(render_snapshot_text(&snapshot))
    }
}

pub fn render_snapshot_json(snapshot: &TerminalSnapshot) -> String {
    let status = terminal_status_name(&snapshot.status);
    let failure_reason = snapshot.failure_reason.as_deref();
    format!(
        "{{\"service\":\"ade-terminal\",\"terminal_id\":{},\"generation\":{},\"status\":\"{}\",\"failure_reason\":{},\"output_sequence\":{},\"tail\":{}}}",
        json_string(&snapshot.terminal_id),
        snapshot.generation,
        status,
        json_optional_string(failure_reason),
        snapshot.output_sequence,
        json_string(&snapshot.tail),
    )
}

pub fn render_snapshot_text(snapshot: &TerminalSnapshot) -> String {
    let reason = snapshot.failure_reason.as_deref().unwrap_or("");
    format!(
        "ade-terminal id={} status={} generation={} output={} reason={} tail={}",
        snapshot.terminal_id,
        terminal_status_name(&snapshot.status),
        snapshot.generation,
        snapshot.output_sequence,
        reason,
        snapshot.tail,
    )
}

fn terminal_status_name(status: &TerminalStatus) -> &'static str {
    match status {
        TerminalStatus::Created => "created",
        TerminalStatus::Running => "running",
        TerminalStatus::Exited { .. } => "exited",
        TerminalStatus::Failed { .. } => "failed",
        TerminalStatus::Closed => "closed",
    }
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

fn json_optional_string(value: Option<&str>) -> String {
    value
        .map(json_string)
        .unwrap_or_else(|| String::from("null"))
}

#[cfg(test)]
mod contract_tests {
    use super::{
        parse_cli_args, render_snapshot_json, run_cli, TerminalCliError, TerminalCliOptions,
    };
    use ade_host_core::terminal::{TerminalCommand, TerminalStatus};

    #[test]
    fn parses_terminal_commands_without_ignoring_unknown_arguments() {
        assert_eq!(
            parse_cli_args([
                "--json",
                "--terminal-id",
                "terminal-1",
                "--start",
                "--output",
                "1",
                "ready",
                "--exit",
                "0",
                "--close",
            ]),
            Ok(TerminalCliOptions {
                json: true,
                terminal_id: String::from("terminal-1"),
                commands: vec![
                    TerminalCommand::Start,
                    TerminalCommand::Output {
                        sequence: 1,
                        data: String::from("ready"),
                    },
                    TerminalCommand::Exit { code: 0 },
                    TerminalCommand::Close,
                ],
            })
        );
        assert_eq!(
            parse_cli_args(["--legacy-mode"]),
            Err(TerminalCliError::UnexpectedArgument(String::from(
                "--legacy-mode"
            )))
        );
    }

    #[test]
    fn renders_terminal_state_from_the_authoritative_core_snapshot() {
        let terminal = ade_host_core::terminal::TerminalRuntime::new("terminal-1").unwrap();
        let snapshot = terminal.apply(0, TerminalCommand::Start).unwrap();
        assert_eq!(
            render_snapshot_json(&snapshot),
            r#"{"service":"ade-terminal","terminal_id":"terminal-1","generation":1,"status":"running","failure_reason":null,"output_sequence":0,"tail":""}"#
        );
    }

    #[test]
    fn runs_a_strict_terminal_sequence_and_observes_final_state() {
        let output = run_cli([
            "--json",
            "--terminal-id",
            "terminal-1",
            "--start",
            "--output",
            "1",
            "ready",
            "--exit",
            "0",
            "--close",
        ])
        .expect("terminal command sequence should succeed");
        assert_eq!(
            output,
            r#"{"service":"ade-terminal","terminal_id":"terminal-1","generation":4,"status":"closed","failure_reason":null,"output_sequence":1,"tail":"ready"}"#
        );
    }

    #[test]
    fn exposes_failure_reason_after_terminal_close() {
        let output = run_cli([
            "--json",
            "--terminal-id",
            "terminal-1",
            "--start",
            "--fail",
            "spawn failed",
            "--close",
        ])
        .expect("failed terminal sequence should still close");
        assert_eq!(
            output,
            r#"{"service":"ade-terminal","terminal_id":"terminal-1","generation":3,"status":"closed","failure_reason":"spawn failed","output_sequence":0,"tail":""}"#
        );
    }

    #[test]
    fn exposes_text_and_json_views_of_the_same_state() {
        let json = run_cli(["--json", "--terminal-id", "terminal-1"]).unwrap();
        let text = run_cli(["--terminal-id", "terminal-1"]).unwrap();
        assert!(json.contains(r#""status":"created""#));
        assert_eq!(
            text,
            "ade-terminal id=terminal-1 status=created generation=0 output=0 reason= tail="
        );
        let status = TerminalStatus::Created;
        assert_eq!(format_terminal_status(&status), "created");
    }

    fn format_terminal_status(status: &TerminalStatus) -> &str {
        match status {
            TerminalStatus::Created => "created",
            TerminalStatus::Running => "running",
            TerminalStatus::Exited { .. } => "exited",
            TerminalStatus::Failed { .. } => "failed",
            TerminalStatus::Closed => "closed",
        }
    }
}
