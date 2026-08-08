use ade_control::{
    parse_cli_args, AgentControlClient, AgentControlServer, AgentControlSession, ControlCliMode,
};
use std::io::{self, BufReader, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

fn main() {
    let options = match parse_cli_args(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("ade-control arguments: {error:?}");
            std::process::exit(2);
        }
    };
    match options.mode {
        ControlCliMode::Direct { state_db } => run_direct(state_db),
        ControlCliMode::Serve {
            state_db,
            endpoint_file,
        } => run_server(state_db, endpoint_file),
        ControlCliMode::Connect { endpoint_file } => run_client(endpoint_file),
    }
}

fn run_direct(state_db: std::path::PathBuf) {
    let session = match AgentControlSession::open(&state_db) {
        Ok(session) => session,
        Err(error) => fail(&format!("ade-control session: {error:?}")),
    };
    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) = session.run_jsonl(BufReader::new(stdin.lock()), stdout.lock()) {
        fail(&format!("ade-control jsonl: {error}"));
    }
}

fn run_server(state_db: std::path::PathBuf, endpoint_file: std::path::PathBuf) {
    let server = match AgentControlServer::bind(&state_db, &endpoint_file) {
        Ok(server) => server,
        Err(error) => fail(&format!("ade-control server: {error:?}")),
    };
    let address = match server.address() {
        Ok(address) => address,
        Err(error) => fail(&format!("ade-control server address: {error:?}")),
    };
    let startup = serde_json::json!({
        "protocol_version": ade_control::CONTROL_PROTOCOL_VERSION,
        "type": "control_server",
        "ok": true,
        "address": address.to_string(),
        "server_pid": std::process::id(),
        "endpoint_file": endpoint_file.to_string_lossy(),
    });
    println!("{startup}");
    if let Err(error) = io::stdout().flush() {
        fail(&format!("ade-control server stdout: {error}"));
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stdin_stop = Arc::clone(&stop);
    thread::spawn(move || {
        let mut stdin = io::stdin().lock();
        let mut buffer = [0u8; 256];
        loop {
            match stdin.read(&mut buffer) {
                Ok(0) => {
                    stdin_stop.store(true, Ordering::SeqCst);
                    return;
                }
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    stdin_stop.store(true, Ordering::SeqCst);
                    return;
                }
            }
        }
    });
    if let Err(error) = server.run_until(stop) {
        fail(&format!("ade-control server: {error:?}"));
    }
}

fn run_client(endpoint_file: std::path::PathBuf) {
    let mut client = match AgentControlClient::connect(&endpoint_file) {
        Ok(client) => client,
        Err(error) => fail(&format!("ade-control client: {error:?}")),
    };
    let stdin = io::stdin();
    let stdout = io::stdout();
    if let Err(error) = client.run_jsonl(BufReader::new(stdin.lock()), stdout.lock()) {
        fail(&format!("ade-control client jsonl: {error:?}"));
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(2);
}
