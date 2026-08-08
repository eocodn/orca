use ade_control::{parse_cli_args, AgentControlSession};
use std::io::{self, BufReader};

fn main() {
    let options = match parse_cli_args(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("ade-control arguments: {error:?}");
            std::process::exit(2);
        }
    };
    let session = match AgentControlSession::open(&options.state_db) {
        Ok(session) => session,
        Err(error) => {
            eprintln!("ade-control session: {error:?}");
            std::process::exit(2);
        }
    };
    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) = session.run_jsonl(BufReader::new(stdin.lock()), stdout.lock()) {
        eprintln!("ade-control jsonl: {error}");
        std::process::exit(2);
    }
}
