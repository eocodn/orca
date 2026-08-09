use std::collections::BTreeMap;
use std::path::PathBuf;

pub const MAX_PTY_OUTPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PtySpec {
    pub program: String,
    pub args: Vec<String>,
    pub current_dir: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

impl PtySpec {
    pub(crate) fn validate(&self) -> Result<(), PtyError> {
        if self.program.trim().is_empty() {
            return Err(PtyError::EmptyProgram);
        }
        if self.cols == 0 || self.rows == 0 {
            return Err(PtyError::InvalidSize);
        }
        if let Some(path) = &self.current_dir {
            if !path.is_dir() {
                return Err(PtyError::InvalidWorkingDirectory(path.clone()));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PtyError {
    EmptyProgram,
    InvalidSize,
    InvalidWorkingDirectory(PathBuf),
    Spawn(String),
    Input(String),
    Resize(String),
    Output(String),
    Terminal(String),
    Timeout,
    Termination(String),
}

pub(crate) fn terminal_error(error: ade_host_core::terminal::TerminalError) -> PtyError {
    PtyError::Terminal(format!("{error:?}"))
}

pub(crate) fn validate_complete_output(pending_utf8: &[u8]) -> Result<(), PtyError> {
    if pending_utf8.is_empty() {
        Ok(())
    } else {
        Err(PtyError::Output(String::from(
            "pty output ended with incomplete UTF-8",
        )))
    }
}
