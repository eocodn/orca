use crate::file_service::{FileError, FileService};
use crate::{build_command, CommandSpec, ExecutionTarget, PlatformError};
use std::io::Write;
use std::process::{Command, Stdio};

const REMOTE_ATOMIC_WRITE_SCRIPT: &str = r#"set -eu
path=$1
parent=$(dirname -- "$path")
name=$(basename -- "$path")
tmp="$parent/.$name.ade-$$.tmp"
cleanup() { rm -f -- "$tmp"; }
trap cleanup EXIT HUP INT TERM
cat > "$tmp"
if [ -f "$path" ] && cmp -s -- "$tmp" "$path"; then
  rm -f -- "$tmp"
  printf 'unchanged\n'
else
  mv -f -- "$tmp" "$path"
  printf 'changed\n'
fi
trap - EXIT
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileCommandOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub trait FileCommandExecutor: Send + Sync {
    fn execute(&self, command: &CommandSpec, stdin: &[u8]) -> std::io::Result<FileCommandOutput>;
}

#[derive(Debug, Default)]
pub struct ProcessFileCommandExecutor;

impl FileCommandExecutor for ProcessFileCommandExecutor {
    fn execute(&self, command: &CommandSpec, stdin: &[u8]) -> std::io::Result<FileCommandOutput> {
        let mut process = Command::new(&command.program);
        process
            .args(&command.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(working_directory) = &command.working_directory {
            process.current_dir(working_directory);
        }
        let mut child = process.spawn()?;
        if !stdin.is_empty() {
            child
                .stdin
                .as_mut()
                .expect("piped stdin must exist")
                .write_all(stdin)?;
        }
        drop(child.stdin.take());
        let output = child.wait_with_output()?;
        Ok(FileCommandOutput {
            success: output.status.success(),
            code: output.status.code(),
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileExecutionError {
    EmptyPath,
    Native(FileError),
    Platform(PlatformError),
    Spawn {
        operation: &'static str,
        detail: String,
    },
    CommandFailed {
        operation: &'static str,
        code: Option<i32>,
        stderr: String,
    },
    InvalidWriteMarker {
        output: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub struct TargetFileWriteResult {
    pub bytes_written: usize,
    pub changed: bool,
}

pub fn read_file(
    target: &ExecutionTarget,
    path: &str,
    executor: &dyn FileCommandExecutor,
) -> Result<Vec<u8>, FileExecutionError> {
    validate_path(path)?;
    if matches!(target, ExecutionTarget::WindowsNative) {
        return FileService::read(path)
            .map(|result| result.bytes)
            .map_err(FileExecutionError::Native);
    }
    let command =
        build_command(target, "cat", &["--", path], None).map_err(FileExecutionError::Platform)?;
    let output = executor
        .execute(&command, &[])
        .map_err(|error| FileExecutionError::Spawn {
            operation: "read",
            detail: error.to_string(),
        })?;
    require_success("read", output)
}

pub fn write_file(
    target: &ExecutionTarget,
    path: &str,
    bytes: &[u8],
    executor: &dyn FileCommandExecutor,
) -> Result<TargetFileWriteResult, FileExecutionError> {
    validate_path(path)?;
    if matches!(target, ExecutionTarget::WindowsNative) {
        return FileService::write_atomic(path, bytes)
            .map(|result| TargetFileWriteResult {
                bytes_written: result.bytes_written,
                changed: result.changed,
            })
            .map_err(FileExecutionError::Native);
    }
    let command = build_command(
        target,
        "sh",
        &["-lc", REMOTE_ATOMIC_WRITE_SCRIPT, "ade-file-write", path],
        None,
    )
    .map_err(FileExecutionError::Platform)?;
    let output = executor
        .execute(&command, bytes)
        .map_err(|error| FileExecutionError::Spawn {
            operation: "write",
            detail: error.to_string(),
        })?;
    let stdout = require_success("write", output)?;
    let marker = std::str::from_utf8(&stdout).unwrap_or_default().trim();
    let changed = match marker {
        "changed" => true,
        "unchanged" => false,
        _ => {
            return Err(FileExecutionError::InvalidWriteMarker {
                output: String::from_utf8_lossy(&stdout).into_owned(),
            })
        }
    };
    Ok(TargetFileWriteResult {
        bytes_written: bytes.len(),
        changed,
    })
}

fn validate_path(path: &str) -> Result<(), FileExecutionError> {
    if path.trim().is_empty() {
        Err(FileExecutionError::EmptyPath)
    } else {
        Ok(())
    }
}

fn require_success(
    operation: &'static str,
    output: FileCommandOutput,
) -> Result<Vec<u8>, FileExecutionError> {
    if output.success {
        Ok(output.stdout)
    } else {
        Err(FileExecutionError::CommandFailed {
            operation,
            code: output.code,
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        read_file, write_file, FileCommandExecutor, FileCommandOutput, FileExecutionError,
        ProcessFileCommandExecutor, REMOTE_ATOMIC_WRITE_SCRIPT,
    };
    use crate::{CommandSpec, ExecutionTarget};
    use std::collections::VecDeque;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingExecutor {
        calls: Mutex<Vec<(CommandSpec, Vec<u8>)>>,
        outputs: Mutex<VecDeque<FileCommandOutput>>,
    }

    impl RecordingExecutor {
        fn with_outputs(outputs: Vec<FileCommandOutput>) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                outputs: Mutex::new(outputs.into()),
            }
        }
    }

    impl FileCommandExecutor for RecordingExecutor {
        fn execute(
            &self,
            command: &CommandSpec,
            stdin: &[u8],
        ) -> std::io::Result<FileCommandOutput> {
            self.calls
                .lock()
                .unwrap()
                .push((command.clone(), stdin.to_vec()));
            Ok(self.outputs.lock().unwrap().pop_front().unwrap())
        }
    }

    fn success(stdout: &[u8]) -> FileCommandOutput {
        FileCommandOutput {
            success: true,
            code: Some(0),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn routes_wsl_reads_as_raw_cat_output() {
        let executor = RecordingExecutor::with_outputs(vec![success(&[0, 0xff, b'\n'])]);
        let bytes = read_file(
            &ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu-24.04"),
            },
            "/home/dev/blob.bin",
            &executor,
        )
        .unwrap();

        assert_eq!(bytes, vec![0, 0xff, b'\n']);
        let calls = executor.calls.lock().unwrap();
        assert_eq!(calls[0].0.program, "wsl.exe");
        assert_eq!(
            calls[0].0.args,
            vec![
                "--distribution",
                "Ubuntu-24.04",
                "--",
                "cat",
                "--",
                "/home/dev/blob.bin"
            ]
        );
        assert!(calls[0].1.is_empty());
    }

    #[test]
    fn sends_ssh_write_bytes_on_stdin_and_observes_changed_marker() {
        let executor = RecordingExecutor::with_outputs(vec![success(b"changed\n")]);
        let bytes = [0, b'a', 0xff, b'\n'];
        let result = write_file(
            &ExecutionTarget::Ssh {
                host: String::from("builder.example"),
            },
            "/srv/repo/blob.bin",
            &bytes,
            &executor,
        )
        .unwrap();

        assert_eq!(result.bytes_written, bytes.len());
        assert!(result.changed);
        let calls = executor.calls.lock().unwrap();
        assert_eq!(calls[0].0.program, "ssh");
        assert_eq!(calls[0].0.args[0..2], ["--", "builder.example"]);
        assert_eq!(calls[0].1, bytes);
    }

    #[test]
    fn preserves_idempotent_remote_write_result() {
        let executor = RecordingExecutor::with_outputs(vec![success(b"unchanged\n")]);
        let result = write_file(
            &ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu"),
            },
            "/repo/file",
            b"same",
            &executor,
        )
        .unwrap();

        assert_eq!(result.bytes_written, 4);
        assert!(!result.changed);
    }

    #[test]
    fn fails_closed_on_remote_command_errors_and_unknown_write_markers() {
        let failed = RecordingExecutor::with_outputs(vec![FileCommandOutput {
            success: false,
            code: Some(23),
            stdout: Vec::new(),
            stderr: b"permission denied".to_vec(),
        }]);
        assert_eq!(
            read_file(
                &ExecutionTarget::Ssh {
                    host: String::from("builder.example"),
                },
                "/srv/repo/file",
                &failed,
            ),
            Err(FileExecutionError::CommandFailed {
                operation: "read",
                code: Some(23),
                stderr: String::from("permission denied"),
            })
        );

        let malformed = RecordingExecutor::with_outputs(vec![success(b"maybe\n")]);
        assert_eq!(
            write_file(
                &ExecutionTarget::Wsl2 {
                    distro: String::from("Ubuntu"),
                },
                "/repo/file",
                b"x",
                &malformed,
            ),
            Err(FileExecutionError::InvalidWriteMarker {
                output: String::from("maybe\n"),
            })
        );
    }

    #[test]
    fn remote_atomic_write_script_preserves_binary_bytes_and_reports_idempotency() {
        let root = std::env::temp_dir().join(format!(
            "ade-target-file-script-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("blob.bin");
        let path_text = path.to_string_lossy().into_owned();
        let command = CommandSpec {
            program: String::from("sh"),
            args: vec![
                String::from("-lc"),
                String::from(REMOTE_ATOMIC_WRITE_SCRIPT),
                String::from("ade-file-write"),
                path_text,
            ],
            working_directory: None,
        };
        let executor = ProcessFileCommandExecutor;
        let bytes = [0, b'a', 0xff, b'\n'];

        let first = executor.execute(&command, &bytes).unwrap();
        let second = executor.execute(&command, &bytes).unwrap();

        assert!(first.success);
        assert_eq!(first.stdout, b"changed\n");
        assert!(second.success);
        assert_eq!(second.stdout, b"unchanged\n");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(root);
    }
}
