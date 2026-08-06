fn main() {
    if std::env::args().nth(1).as_deref() == Some("--jsonl") {
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
    match ade_worker::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-worker error: {error:?}");
            std::process::exit(2);
        }
    }
}
