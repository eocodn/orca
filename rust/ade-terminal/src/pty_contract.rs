use std::collections::BTreeMap;
use std::path::PathBuf;

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
