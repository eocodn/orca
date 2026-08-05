use ade_terminal::pty::{PtySession, PtySpec};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, PartialEq, Eq)]
struct PtyProbeOptions {
    json: bool,
    terminal_id: String,
    program: String,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
    input: Option<String>,
    cols: u16,
    rows: u16,
    resize: Option<(u16, u16)>,
    timeout: Duration,
}

#[derive(Debug, PartialEq, Eq)]
enum PtyProbeError {
    MissingValue(String),
    InvalidValue(String),
    UnexpectedArgument(String),
    MissingProgram,
    Runtime(String),
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let json = cli_requests_json(&args);
    match run(args) {
        Ok(result) => {
            println!("{}", render_result(&result, json));
            if result.exit_status != 0 {
                std::process::exit(result.exit_status);
            }
        }
        Err(error) => {
            if json {
                println!(
                    "{{\"service\":\"ade-pty\",\"status\":\"error\",\"exit_status\":2,\"error\":{}}}",
                    json_string(&format!("{error:?}"))
                );
            } else {
                eprintln!("{error:?}");
            }
            std::process::exit(2);
        }
    }
}

fn cli_requests_json(args: &[String]) -> bool {
    let mut values_left = 0;
    for argument in args {
        if values_left > 0 {
            values_left -= 1;
            continue;
        }
        match argument.as_str() {
            "--json" => return true,
            "--terminal-id" | "--run" | "--arg" | "--current-dir" | "--input" | "--cols"
            | "--rows" | "--timeout-ms" => values_left = 1,
            "--resize" => values_left = 2,
            _ => {}
        }
    }
    false
}

#[derive(Debug, PartialEq, Eq)]
struct PtyProbeResult {
    terminal_id: String,
    session_generation: u64,
    status: String,
    exit_code: Option<i32>,
    output_sequence: u64,
    tail: String,
    failure_reason: Option<String>,
    exit_status: i32,
}

fn parse_args<I, S>(args: I) -> Result<PtyProbeOptions, PtyProbeError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut options = PtyProbeOptions {
        json: false,
        terminal_id: String::from("pty-probe"),
        program: String::new(),
        args: Vec::new(),
        current_dir: None,
        input: None,
        cols: 80,
        rows: 24,
        resize: None,
        timeout: Duration::from_millis(DEFAULT_TIMEOUT_MS),
    };
    let mut values = args.into_iter().map(Into::into);
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--json" => options.json = true,
            "--terminal-id" => options.terminal_id = next_value(&mut values, &argument)?,
            "--run" => {
                if !options.program.is_empty() {
                    return Err(PtyProbeError::UnexpectedArgument(argument));
                }
                options.program = next_value(&mut values, &argument)?;
            }
            "--arg" => options.args.push(next_value(&mut values, &argument)?),
            "--current-dir" => {
                if options.current_dir.is_some() {
                    return Err(PtyProbeError::UnexpectedArgument(argument));
                }
                options.current_dir = Some(PathBuf::from(next_value(&mut values, &argument)?));
            }
            "--input" => options.input = Some(next_value(&mut values, &argument)?),
            "--cols" => options.cols = parse_u16(next_value(&mut values, &argument)?, &argument)?,
            "--rows" => options.rows = parse_u16(next_value(&mut values, &argument)?, &argument)?,
            "--resize" => {
                let cols = parse_u16(next_value(&mut values, &argument)?, &argument)?;
                let rows = parse_u16(next_value(&mut values, &argument)?, &argument)?;
                options.resize = Some((cols, rows));
            }
            "--timeout-ms" => {
                let timeout = next_value(&mut values, &argument)?
                    .parse::<u64>()
                    .map_err(|_| PtyProbeError::InvalidValue(argument.clone()))?;
                options.timeout = Duration::from_millis(timeout);
            }
            _ => return Err(PtyProbeError::UnexpectedArgument(argument)),
        }
    }
    if options.program.trim().is_empty() {
        return Err(PtyProbeError::MissingProgram);
    }
    if options.cols == 0 || options.rows == 0 {
        return Err(PtyProbeError::InvalidValue(String::from("pty size")));
    }
    if options
        .resize
        .is_some_and(|(cols, rows)| cols == 0 || rows == 0)
    {
        return Err(PtyProbeError::InvalidValue(String::from("resize size")));
    }
    Ok(options)
}

fn next_value<I>(values: &mut I, argument: &str) -> Result<String, PtyProbeError>
where
    I: Iterator<Item = String>,
{
    values
        .next()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PtyProbeError::MissingValue(argument.to_string()))
}

fn parse_u16(value: String, argument: &str) -> Result<u16, PtyProbeError> {
    value
        .parse::<u16>()
        .map_err(|_| PtyProbeError::InvalidValue(argument.to_string()))
}

fn run<I, S>(args: I) -> Result<PtyProbeResult, PtyProbeError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_args(args)?;
    let mut session = PtySession::spawn(
        options.terminal_id.clone(),
        PtySpec {
            program: options.program,
            args: options.args,
            current_dir: options.current_dir,
            environment: BTreeMap::new(),
            cols: options.cols,
            rows: options.rows,
        },
    )
    .map_err(|error| PtyProbeError::Runtime(format!("{error:?}")))?;
    if let Some(input) = options.input {
        session
            .write(input.as_bytes())
            .map_err(|error| PtyProbeError::Runtime(format!("{error:?}")))?;
    }
    if let Some((cols, rows)) = options.resize {
        session
            .resize(cols, rows)
            .map_err(|error| PtyProbeError::Runtime(format!("{error:?}")))?;
    }
    let snapshot = session
        .wait(options.timeout)
        .map_err(|error| PtyProbeError::Runtime(format!("{error:?}")))?;
    let (status, exit_code, exit_status) = match snapshot.status {
        ade_host_core::terminal::TerminalStatus::Exited { code } => ("exited", Some(code), code),
        ade_host_core::terminal::TerminalStatus::Failed { .. } => ("failed", None, 1),
        _ => ("running", None, 1),
    };
    Ok(PtyProbeResult {
        terminal_id: snapshot.terminal_id,
        session_generation: 1,
        status: status.to_string(),
        exit_code,
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail,
        failure_reason: snapshot.failure_reason,
        exit_status,
    })
}

fn render_result(result: &PtyProbeResult, json: bool) -> String {
    if json {
        return format!(
            "{{\"service\":\"ade-pty\",\"terminal_id\":{},\"session_generation\":{},\"status\":\"{}\",\"exit_code\":{},\"output_sequence\":{},\"tail\":{},\"failure_reason\":{}}}",
            json_string(&result.terminal_id),
            result.session_generation,
            result.status,
            result
                .exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| String::from("null")),
            result.output_sequence,
            json_string(&result.tail),
            result
                .failure_reason
                .as_deref()
                .map(json_string)
                .unwrap_or_else(|| String::from("null")),
        );
    }
    format!(
        "ade-pty id={} session_generation={} status={} exit_code={} output_sequence={} tail={}",
        result.terminal_id,
        result.session_generation,
        result.status,
        result
            .exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| String::from("null")),
        result.output_sequence,
        result.tail,
    )
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

#[cfg(test)]
mod tests {
    use super::{cli_requests_json, parse_args, render_result, run, PtyProbeOptions};
    use std::time::Duration;

    #[test]
    fn parses_a_strict_pty_probe_request() {
        assert_eq!(
            parse_args([
                "--json",
                "--terminal-id",
                "pty-1",
                "--run",
                "printf",
                "--arg",
                "ready",
                "--cols",
                "80",
                "--rows",
                "24",
                "--resize",
                "100",
                "40",
                "--timeout-ms",
                "2000",
            ]),
            Ok(PtyProbeOptions {
                json: true,
                terminal_id: String::from("pty-1"),
                program: String::from("printf"),
                args: vec![String::from("ready")],
                current_dir: None,
                input: None,
                cols: 80,
                rows: 24,
                resize: Some((100, 40)),
                timeout: Duration::from_millis(2000),
            })
        );
    }

    #[test]
    fn rejects_unknown_pty_probe_options() {
        assert!(parse_args(["--run", "printf", "--legacy-mode"]).is_err());
    }

    #[test]
    fn ignores_json_values_consumed_by_probe_options() {
        assert!(!cli_requests_json(&[
            String::from("--arg"),
            String::from("--json"),
        ]));
        assert!(cli_requests_json(&[String::from("--json")]));
    }

    #[cfg(unix)]
    #[test]
    fn executes_a_real_pty_and_renders_authoritative_json() {
        let result = run(["--run", "printf", "--arg", "ready", "--resize", "100", "40"]).unwrap();
        assert_eq!(result.status, "exited");
        assert_eq!(result.exit_code, Some(0));
        assert!(render_result(&result, true).contains(r#""service":"ade-pty"#));
        assert!(render_result(&result, true).contains(r#""tail":"ready"#));
    }
}
