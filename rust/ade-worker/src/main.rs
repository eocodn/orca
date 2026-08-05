fn main() {
    let worker = ade_host_core::worker::WorkerRuntime::new("local").unwrap();
    let _json_requested = std::env::args().skip(1).any(|arg| arg == "--json");
    println!(
        "{}",
        ade_worker::render_heartbeat_json(&worker.snapshot().unwrap())
    );
}
