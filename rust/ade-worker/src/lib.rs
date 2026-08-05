use ade_host_core::worker::{WorkerSnapshot, WorkerStatus};

pub fn render_heartbeat_json(snapshot: &WorkerSnapshot) -> String {
    let status = match snapshot.status {
        WorkerStatus::Stopped => "stopped",
        WorkerStatus::Starting => "starting",
        WorkerStatus::Ready => "ready",
        WorkerStatus::Failed => "failed",
    };
    format!(
        "{{\"service\":\"ade-worker\",\"worker_id\":\"{}\",\"generation\":{},\"status\":\"{}\",\"heartbeat_sequence\":{}}}",
        snapshot.worker_id, snapshot.generation, status, snapshot.heartbeat_sequence
    )
}

#[cfg(test)]
mod tests {
    use super::render_heartbeat_json;
    use ade_host_core::worker::{WorkerSnapshot, WorkerStatus};

    #[test]
    fn renders_machine_observable_worker_heartbeat() {
        let snapshot = WorkerSnapshot {
            worker_id: String::from("wsl-ubuntu"),
            generation: 4,
            status: WorkerStatus::Ready,
            heartbeat_sequence: 9,
        };
        assert_eq!(
            render_heartbeat_json(&snapshot),
            r#"{"service":"ade-worker","worker_id":"wsl-ubuntu","generation":4,"status":"ready","heartbeat_sequence":9}"#
        );
    }
}
