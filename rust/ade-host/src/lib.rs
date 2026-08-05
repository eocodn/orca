use ade_host_core::host_runtime::HostSnapshot;
use ade_host_store::store::StoredWorkspace;

pub fn render_status_json(snapshot: &HostSnapshot) -> String {
    format!(
        "{{\"service\":\"ade-host\",\"generation\":{},\"workspace_count\":{},\"ready_workspaces\":{}}}",
        snapshot.generation, snapshot.workspace_count, snapshot.ready_workspaces
    )
}

pub fn render_persisted_status_json(snapshot: &[StoredWorkspace]) -> String {
    let ready_workspaces = snapshot
        .iter()
        .filter(|workspace| workspace.status == "ready")
        .count();
    format!(
        "{{\"service\":\"ade-host\",\"workspace_count\":{},\"ready_workspaces\":{},\"source\":\"sqlite-snapshot\"}}",
        snapshot.len(), ready_workspaces
    )
}

#[cfg(test)]
mod tests {
    use super::{render_persisted_status_json, render_status_json};
    use ade_host_core::host_runtime::HostSnapshot;
    use ade_host_store::store::StoredWorkspace;

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

    #[test]
    fn renders_authoritative_persisted_workspace_status() {
        let snapshot = vec![
            StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
            StoredWorkspace::new("workspace-2", r"C:\workspaces\two", "starting", 5),
        ];
        assert_eq!(
            render_persisted_status_json(&snapshot),
            r#"{"service":"ade-host","workspace_count":2,"ready_workspaces":1,"source":"sqlite-snapshot"}"#
        );
    }
}
