fn main() {
    let mut args = std::env::args().skip(1);
    let json_requested = args.by_ref().any(|arg| arg == "--json");
    let snapshot = ade_host_core::host_runtime::HostRuntime::new()
        .snapshot()
        .expect("new host state must be readable");
    if json_requested {
        println!("{}", ade_host::render_status_json(&snapshot));
    } else {
        println!("ade-host ready generation={}", snapshot.generation);
    }
}
