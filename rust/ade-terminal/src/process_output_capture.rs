use super::{ProcessError, MAX_CAPTURE_BYTES};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static OUTPUT_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) struct OutputCapture {
    stdout: PathBuf,
    stderr: PathBuf,
}

impl Drop for OutputCapture {
    fn drop(&mut self) {
        let _ = self.remove();
    }
}

pub(super) fn create() -> Result<(OutputCapture, File, File), ProcessError> {
    let directory = std::env::temp_dir();
    for _ in 0..100 {
        let id = OUTPUT_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let stdout = directory.join(format!(
            "ade-terminal-output-{}-{id}.stdout",
            std::process::id()
        ));
        let stderr = directory.join(format!(
            "ade-terminal-output-{}-{id}.stderr",
            std::process::id()
        ));
        let stdout_file = match OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&stdout)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(ProcessError::Output(format!(
                    "process output setup failed: {error}"
                )))
            }
        };
        let stderr_file = match OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&stderr)
        {
            Ok(file) => file,
            Err(error) => {
                let _ = fs::remove_file(&stdout);
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    continue;
                }
                return Err(ProcessError::Output(format!(
                    "process output setup failed: {error}"
                )));
            }
        };
        return Ok((OutputCapture { stdout, stderr }, stdout_file, stderr_file));
    }
    Err(ProcessError::Output(String::from(
        "process output setup exhausted unique paths",
    )))
}

impl OutputCapture {
    pub(super) fn exceeds_limit(&self) -> Result<bool, ProcessError> {
        let stdout = fs::metadata(&self.stdout).map_err(|error| {
            ProcessError::Output(format!("process stdout observation failed: {error}"))
        })?;
        let stderr = fs::metadata(&self.stderr).map_err(|error| {
            ProcessError::Output(format!("process stderr observation failed: {error}"))
        })?;
        Ok(stdout.len().saturating_add(stderr.len()) > MAX_CAPTURE_BYTES as u64)
    }

    pub(super) fn read(&self) -> Result<String, ProcessError> {
        let mut bytes = read_capture_file(&self.stdout)?;
        bytes.extend(read_capture_file(&self.stderr)?);
        if bytes.len() > MAX_CAPTURE_BYTES {
            return Err(ProcessError::Output(String::from(
                "process output exceeded capture limit",
            )));
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    pub(super) fn remove(&self) -> Result<(), ProcessError> {
        remove_capture_file(&self.stdout)?;
        remove_capture_file(&self.stderr)
    }
}

fn remove_capture_file(path: &PathBuf) -> Result<(), ProcessError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ProcessError::Output(String::from(
            "process output cleanup failed",
        ))),
    }
}

fn read_capture_file(path: &PathBuf) -> Result<Vec<u8>, ProcessError> {
    let file = File::open(path)
        .map_err(|error| ProcessError::Output(format!("process output open failed: {error}")))?;
    let mut bytes = Vec::new();
    file.take((MAX_CAPTURE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| ProcessError::Output(format!("process output read failed: {error}")))?;
    Ok(bytes)
}
