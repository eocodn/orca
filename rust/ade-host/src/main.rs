fn main() {
    match ade_host::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-host error: {error:?}");
            std::process::exit(2);
        }
    }
}
