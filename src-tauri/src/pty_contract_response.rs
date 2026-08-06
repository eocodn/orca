use super::pty_contract_types::{PtyOperation, PtyRequest};
use ade_host_core::protocol::{Capability, ProtocolEnvelope, PtyResponse, PtyStatus};

pub(super) fn render_result(
    request: &PtyRequest,
    snapshot: ade_host_core::terminal::TerminalSnapshot,
    session_generation: u64,
) -> Result<String, String> {
    serde_json::to_string(&PtyResponse {
        envelope: ProtocolEnvelope::new(request.request_id.clone(), Capability::Pty, 1),
        workspace_id: request.workspace_id.clone(),
        worker_id: request.worker_id.clone(),
        session_id: request.session_id.clone(),
        session_generation,
        generation: snapshot.generation,
        operation: operation_name(&request.operation).to_string(),
        status: response_status(&snapshot.status),
        exit_code: snapshot.exit_code,
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail,
        failure_reason: snapshot.failure_reason,
    })
    .map_err(|error| error.to_string())
}

fn operation_name(operation: &PtyOperation) -> &'static str {
    match operation {
        PtyOperation::Start => "start",
        PtyOperation::Write => "write",
        PtyOperation::Resize => "resize",
        PtyOperation::Poll => "poll",
        PtyOperation::Wait => "wait",
        PtyOperation::Terminate => "terminate",
    }
}

fn response_status(status: &ade_host_core::terminal::TerminalStatus) -> PtyStatus {
    match status {
        ade_host_core::terminal::TerminalStatus::Created => PtyStatus::Created,
        ade_host_core::terminal::TerminalStatus::Running => PtyStatus::Running,
        ade_host_core::terminal::TerminalStatus::Exited { .. } => PtyStatus::Exited,
        ade_host_core::terminal::TerminalStatus::Failed { .. } => PtyStatus::Failed,
        ade_host_core::terminal::TerminalStatus::Closed => PtyStatus::Closed,
    }
}
