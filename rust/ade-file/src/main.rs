fn main() {
    match ade_file::run_cli(std::env::args().skip(1)) {
        Ok(output) => println!("{output}"),
        Err(error) => {
            eprintln!("ade-file error: {error:?}");
            std::process::exit(2);
        }
    }
}
