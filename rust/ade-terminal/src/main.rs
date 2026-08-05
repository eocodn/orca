fn main() {
    match ade_terminal::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("{error:?}");
            std::process::exit(2);
        }
    }
}
