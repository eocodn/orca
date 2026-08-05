fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = cli_requests_json(&args);
    match ade_terminal::run_cli_with_status(args) {
        Ok(result) => {
            println!("{}", result.output);
            if result.exit_status != 0 {
                std::process::exit(result.exit_status);
            }
        }
        Err(error) => {
            if json {
                println!("{}", ade_terminal::render_cli_error_json(&error));
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
            "--terminal-id" | "--run" | "--arg" | "--current-dir" | "--timeout-ms" | "--exit"
            | "--fail" => values_left = 1,
            "--output" => values_left = 2,
            _ => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::cli_requests_json;

    #[test]
    fn ignores_json_values_consumed_by_other_options() {
        assert!(!cli_requests_json(&[
            String::from("--current-dir"),
            String::from("--json"),
        ]));
    }

    #[test]
    fn detects_a_real_json_flag() {
        assert!(cli_requests_json(&[
            String::from("--run"),
            String::from("printf"),
            String::from("--json")
        ]));
    }
}
