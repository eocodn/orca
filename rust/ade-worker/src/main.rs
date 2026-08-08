fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match ade_worker::worker_service::parse_service_mode(args.clone()) {
        Ok(Some(mode)) => {
            if let Err(error) = ade_worker::worker_service::run_service_mode(mode) {
                eprintln!("ade-worker service error: {error:?}");
                std::process::exit(2);
            }
            return;
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("ade-worker service error: {error:?}");
            std::process::exit(2);
        }
    }
    if args.first().map(String::as_str) == Some("--jsonl") {
        if args.len() != 1 {
            eprintln!("ade-worker jsonl error: unexpected arguments");
            std::process::exit(2);
        }
        let pty_registry = ade_worker::pty_registry::PtyWorkerRegistry::default();
        let file_git_registry = ade_worker::worker_dispatch::FileGitWorkerRegistry::default();
        if let Err(error) = ade_worker::jsonl_transport::serve_mixed_jsonl(
            std::io::BufReader::new(std::io::stdin()),
            std::io::stdout(),
            &pty_registry,
            &file_git_registry,
        ) {
            eprintln!("ade-worker jsonl error: {error}");
            std::process::exit(2);
        }
        return;
    }
    match ade_worker::run_cli(args) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-worker error: {error:?}");
            std::process::exit(2);
        }
    }
}
