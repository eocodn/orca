use ade_host_core::host_runtime::HostSnapshot;

pub fn render_status_json(snapshot: &HostSnapshot) -> String {
    format!(
        "{{\"service\":\"ade-host\",\"generation\":{},\"workspace_count\":{},\"ready_workspaces\":{}}}",
        snapshot.generation, snapshot.workspace_count, snapshot.ready_workspaces
    )
}

#[cfg(test)]
mod tests {
    use super::render_status_json;
    use ade_host_core::host_runtime::HostSnapshot;

    #[test]
    fn renders_machine_observable_host_status() {
        let snapshot = HostSnapshot {
            generation: 3,
            workspace_count: 2,
            ready_workspaces: 1,
        };
        assert_eq!(
            render_status_json(&snapshot),
            r#"{"service":"ade-host","generation":3,"workspace_count":2,"ready_workspaces":1}"#
        );
    }
}
