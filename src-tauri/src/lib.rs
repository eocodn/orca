use ade_host_store::store::{HostStore, StoredWorkspace};
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TauriHostStatus {
    service: &'static str,
    workspace_count: usize,
    ready_workspaces: usize,
    source: &'static str,
}

pub fn render_host_status(snapshot: &[StoredWorkspace]) -> Result<String, serde_json::Error> {
    let status = TauriHostStatus {
        service: "ade-host",
        workspace_count: snapshot.len(),
        ready_workspaces: snapshot
            .iter()
            .filter(|workspace| workspace.status == "ready")
            .count(),
        source: "sqlite-snapshot",
    };
    serde_json::to_string(&status)
}

#[tauri::command]
fn host_status(state_db: String) -> Result<String, String> {
    let store = HostStore::open(state_db).map_err(|error| format!("{error:?}"))?;
    let snapshot = store.snapshot().map_err(|error| format!("{error:?}"))?;
    render_host_status(&snapshot).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_status])
        .run(tauri::generate_context!())
        .expect("error while running ADE Tauri application");
}

#[cfg(test)]
mod tests {
    use super::render_host_status;
    use ade_host_store::store::StoredWorkspace;

    #[test]
    fn renders_the_same_authoritative_host_status_as_other_clients() {
        let snapshot = vec![
            StoredWorkspace::new("workspace-1", r"C:\workspaces\one", "ready", 4),
            StoredWorkspace::new("workspace-2", r"C:\workspaces\two", "starting", 5),
        ];
        assert_eq!(
            render_host_status(&snapshot).expect("status must serialize"),
            r#"{"service":"ade-host","workspace_count":2,"ready_workspaces":1,"source":"sqlite-snapshot"}"#
        );
    }
}
