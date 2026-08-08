mod child;
mod cli;
mod protocol;
mod receipts;
mod session;
mod transport;
mod transport_endpoint;

pub use child::{AgentControlChild, AgentControlChildError};
pub use cli::{parse_cli_args, ControlCliError, ControlCliMode, ControlCliOptions};
pub use protocol::{
    AgentControlCommand, AgentControlRequest, WorkerMaintenanceArgs, WorkerUpdateArgs,
    CONTROL_PROTOCOL_VERSION,
};
pub use session::AgentControlSession;
pub use transport::{AgentControlClient, AgentControlServer, ControlTransportError};
