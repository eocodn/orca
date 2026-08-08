pub mod process;
pub mod pty;
mod pty_backend;
mod pty_contract;

use ade_host_core::terminal::{TerminalCommand, TerminalSnapshot, TerminalStatus};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub struct TerminalCliOptions {
    pub json: bool,
    pub terminal_id: String,
    pub commands: Vec<TerminalCommand>,
    pub process: Option<ProcessCliOptions>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ProcessCliOptions {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
    pub timeout: Option<Duration>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct TerminalCliResult {
    pub output: String,
    pub exit_status: i32,
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
    MissingProcessProgram,
    MissingProcessArgument,
    MissingProcessWorkingDirectory,
    InvalidProcessTimeout(String),
    UnexpectedArgument(String),
    Runtime(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<TerminalCliOptions, TerminalCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut json_seen = false;
    let mut terminal_id = String::from("local");
    let mut terminal_id_seen = false;
    let mut commands = Vec::new();
    let mut process_program = None;
    let mut process_args = Vec::new();
    let mut process_current_dir = None;
    let mut process_timeout = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => {
                if json_seen {
                    return Err(TerminalCliError::UnexpectedArgument(String::from(
                        "duplicate --json",
                    )));
                }
                json_seen = true;
                json = true;
            }
            "--terminal-id" => {
                if terminal_id_seen {
                    return Err(TerminalCliError::UnexpectedArgument(String::from(
                        "duplicate --terminal-id",
                    )));
                }
                terminal_id_seen = true;
                terminal_id = args.next().ok_or(TerminalCliError::MissingTerminalId)?;
                if terminal_id.trim().is_empty() {
                    return Err(TerminalCliError::MissingTerminalId);
                }
            }
            "--run" => {
                if process_program.is_some() {
                    return Err(TerminalCliError::UnexpectedArgument(String::from(
                        "duplicate --run",
                    )));
                }
                let program = args.next().ok_or(TerminalCliError::MissingProcessProgram)?;
                if program.trim().is_empty() {
                    return Err(TerminalCliError::MissingProcessProgram);
                }
                process_program = Some(program);
            }
            "--arg" => process_args.push(
                args.next()
                    .ok_or(TerminalCliError::MissingProcessArgument)?,
            ),
            "--current-dir" => {
                if process_current_dir.is_some() {
                    return Err(TerminalCliError::UnexpectedArgument(String::from(
                        "duplicate --current-dir",
                    )));
                }
                let path = args
                    .next()
                    .ok_or(TerminalCliError::MissingProcessWorkingDirectory)?;
                process_current_dir = Some(PathBuf::from(path));
            }
            "--timeout-ms" => {
                if process_timeout.is_some() {
                    return Err(TerminalCliError::UnexpectedArgument(String::from(
                        "duplicate --timeout-ms",
                    )));
                }
                let timeout = args
                    .next()
                    .ok_or_else(|| TerminalCliError::InvalidProcessTimeout(String::new()))?;
                let timeout = timeout
                    .parse::<u64>()
                    .map_err(|_| TerminalCliError::InvalidProcessTimeout(timeout))?;
                process_timeout = Some(Duration::from_millis(timeout));
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
    if process_program.is_some() && !commands.is_empty() {
        return Err(TerminalCliError::UnexpectedArgument(String::from(
            "--run cannot be combined with lifecycle commands",
        )));
    }
    if process_program.is_none()
        && (!process_args.is_empty() || process_current_dir.is_some() || process_timeout.is_some())
    {
        return Err(TerminalCliError::UnexpectedArgument(String::from(
            "process options require --run",
        )));
    }
    Ok(TerminalCliOptions {
        json,
        terminal_id,
        commands,
        process: process_program.map(|program| ProcessCliOptions {
            program,
            args: process_args,
            current_dir: process_current_dir,
            timeout: process_timeout,
        }),
    })
}

pub fn run_cli<I, S>(args: I) -> Result<String, TerminalCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    Ok(run_cli_with_status(args)?.output)
}

pub fn run_cli_with_status<I, S>(args: I) -> Result<TerminalCliResult, TerminalCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_cli_args(args)?;
    let process_mode = options.process.is_some();
    let terminal = ade_host_core::terminal::TerminalRuntime::new(options.terminal_id)
        .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
    let snapshot = if let Some(process) = options.process {
        process::run_process(
            &terminal,
            &process::ProcessSpec {
                program: process.program,
                args: process.args,
                current_dir: process.current_dir,
                timeout: process.timeout,
                cancellation: None,
            },
        )
        .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?
        .snapshot
    } else {
        let mut snapshot = terminal
            .snapshot()
            .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
        for command in options.commands {
            snapshot = terminal
                .apply(snapshot.generation, command)
                .map_err(|error| TerminalCliError::Runtime(format!("{error:?}")))?;
        }
        snapshot
    };
    let output = if options.json {
        if process_mode {
            render_process_snapshot_json(&snapshot)
        } else {
            render_snapshot_json(&snapshot)
        }
    } else if process_mode {
        render_process_snapshot_text(&snapshot)
    } else {
        render_snapshot_text(&snapshot)
    };
    let exit_status = if process_mode {
        match snapshot.status {
            TerminalStatus::Exited { code } => code,
            TerminalStatus::Failed { .. } => 1,
            _ => 1,
        }
    } else if matches!(snapshot.status, TerminalStatus::Failed { .. }) {
        1
    } else {
        0
    };
    Ok(TerminalCliResult {
        output,
        exit_status,
    })
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

fn render_process_snapshot_json(snapshot: &TerminalSnapshot) -> String {
    let status = terminal_status_name(&snapshot.status);
    let exit_code = terminal_exit_code(&snapshot.status);
    let failure_reason = snapshot.failure_reason.as_deref();
    format!(
        "{{\"service\":\"ade-terminal\",\"terminal_id\":{},\"generation\":{},\"status\":\"{}\",\"exit_code\":{},\"failure_reason\":{},\"output_sequence\":{},\"tail\":{}}}",
        json_string(&snapshot.terminal_id),
        snapshot.generation,
        status,
        json_optional_exit_code(exit_code),
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

fn render_process_snapshot_text(snapshot: &TerminalSnapshot) -> String {
    let reason = snapshot.failure_reason.as_deref().unwrap_or("");
    let exit_code = terminal_exit_code(&snapshot.status)
        .map(|code| code.to_string())
        .unwrap_or_else(|| String::from("null"));
    format!(
        "ade-terminal id={} status={} generation={} exit_code={} output={} reason={} tail={}",
        snapshot.terminal_id,
        terminal_status_name(&snapshot.status),
        snapshot.generation,
        exit_code,
        snapshot.output_sequence,
        reason,
        snapshot.tail,
    )
}

pub fn render_cli_error_json(error: &TerminalCliError) -> String {
    format!(
        "{{\"service\":\"ade-terminal\",\"status\":\"error\",\"exit_code\":2,\"error\":{}}}",
        json_string(&format!("{error:?}")),
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

fn terminal_exit_code(status: &TerminalStatus) -> Option<i32> {
    match status {
        TerminalStatus::Exited { code } => Some(*code),
        _ => None,
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

fn json_optional_exit_code(value: Option<i32>) -> String {
    value
        .map(|code| code.to_string())
        .unwrap_or_else(|| String::from("null"))
}

#[cfg(test)]
mod contract_tests {
    use super::{
        parse_cli_args, render_cli_error_json, render_snapshot_json, run_cli, run_cli_with_status,
        TerminalCliError, TerminalCliOptions,
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
                process: None,
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

    #[test]
    fn runs_process_backend_through_machine_observable_cli() {
        let output = if cfg!(windows) {
            run_cli([
                "--json",
                "--terminal-id",
                "terminal-process",
                "--run",
                "cmd",
                "--arg",
                "/C",
                "--arg",
                "echo ready",
            ])
            .unwrap()
        } else {
            run_cli([
                "--json",
                "--terminal-id",
                "terminal-process",
                "--run",
                "printf",
                "--arg",
                "ready",
            ])
            .unwrap()
        };
        assert!(output.contains(r#""status":"exited"#));
        assert!(output.contains(r#""output_sequence":1"#));
        assert!(output.contains(r#""tail":"ready"#));
    }

    #[test]
    fn propagates_process_exit_status_to_the_machine_cli_result() {
        let result = if cfg!(windows) {
            run_cli_with_status([
                "--json",
                "--run",
                "cmd",
                "--arg",
                "/C",
                "--arg",
                "exit /B 7",
            ])
            .unwrap()
        } else {
            run_cli_with_status(["--json", "--run", "sh", "--arg", "-c", "--arg", "exit 7"])
                .unwrap()
        };
        assert_eq!(result.exit_status, 7);
        assert!(result.output.contains(r#""exit_code":7"#));
    }

    #[test]
    fn rejects_duplicate_singleton_process_options() {
        assert_eq!(
            parse_cli_args(["--run", "printf", "--run", "echo"]),
            Err(TerminalCliError::UnexpectedArgument(String::from(
                "duplicate --run",
            )))
        );
    }

    #[test]
    fn lifecycle_failure_returns_a_nonzero_cli_status() {
        let result = run_cli_with_status(["--start", "--fail", "spawn failed"]).unwrap();

        assert_eq!(result.exit_status, 1);
    }

    #[test]
    fn text_process_output_includes_the_authoritative_exit_code() {
        let result = if cfg!(windows) {
            run_cli_with_status(["--run", "cmd", "--arg", "/C", "exit /B 7"])
        } else {
            run_cli_with_status(["--run", "sh", "--arg", "-c", "--arg", "exit 7"])
        }
        .unwrap();

        assert!(result.output.contains("exit_code=7"));
    }

    #[test]
    fn renders_machine_observable_cli_errors_as_json() {
        assert_eq!(
            render_cli_error_json(&TerminalCliError::Runtime(String::from(
                "invalid directory"
            ))),
            r#"{"service":"ade-terminal","status":"error","exit_code":2,"error":"Runtime(\"invalid directory\")"}"#
        );
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
