fn main() {
    let _json_requested = std::env::args().skip(1).any(|arg| arg == "--json");
    let snapshot = ade_host_core::host_runtime::HostRuntime::new()
        .snapshot()
        .expect("new host state must be readable");
    println!("{}", ade_host::render_status_json(&snapshot));
}
