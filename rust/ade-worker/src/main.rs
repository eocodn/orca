fn main() {
    match ade_worker::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-worker error: {error:?}");
            std::process::exit(2);
        }
    }
}
