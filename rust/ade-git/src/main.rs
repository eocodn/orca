fn main() {
    match ade_git::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-git error: {error:?}");
            std::process::exit(2);
        }
    }
}
