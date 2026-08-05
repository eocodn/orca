use ade_host_platform::file_service::FileService;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileOperation {
    Read { path: String },
    Write { path: String, bytes: Vec<u8> },
}

#[derive(Debug, PartialEq, Eq)]
pub struct FileCliOptions {
    pub json: bool,
    pub operation: FileOperation,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FileCliError {
    MissingOperation,
    MissingPath,
    MissingBytes,
    InvalidHexBytes,
    BytesOnlyForWrite,
    MultipleOperations,
    UnexpectedArgument(String),
    Execution(String),
}

pub fn parse_cli_args<I, S>(args: I) -> Result<FileCliOptions, FileCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut json = false;
    let mut read_path = None;
    let mut write_path = None;
    let mut bytes_hex = None;
    let mut args = args.into_iter().map(Into::into);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--json" => json = true,
            "--read" => {
                let path = args.next().ok_or(FileCliError::MissingPath)?;
                if path.trim().is_empty() {
                    return Err(FileCliError::MissingPath);
                }
                if read_path.is_some() || write_path.is_some() {
                    return Err(FileCliError::MultipleOperations);
                }
                read_path = Some(path);
            }
            "--write" => {
                let path = args.next().ok_or(FileCliError::MissingPath)?;
                if path.trim().is_empty() {
                    return Err(FileCliError::MissingPath);
                }
                if read_path.is_some() || write_path.is_some() {
                    return Err(FileCliError::MultipleOperations);
                }
                write_path = Some(path);
            }
            "--bytes-hex" => {
                bytes_hex = Some(args.next().ok_or(FileCliError::MissingBytes)?);
            }
            _ => return Err(FileCliError::UnexpectedArgument(argument)),
        }
    }

    let operation = match (read_path, write_path) {
        (Some(path), None) => {
            if bytes_hex.is_some() {
                return Err(FileCliError::BytesOnlyForWrite);
            }
            FileOperation::Read { path }
        }
        (None, Some(path)) => FileOperation::Write {
            path,
            bytes: decode_hex_bytes(bytes_hex.ok_or(FileCliError::MissingBytes)?)?,
        },
        (None, None) => return Err(FileCliError::MissingOperation),
        (Some(_), Some(_)) => return Err(FileCliError::MultipleOperations),
    };
    Ok(FileCliOptions { json, operation })
}

#[derive(Debug, Serialize)]
struct FileResult {
    service: &'static str,
    operation: &'static str,
    path: String,
    bytes: Vec<u8>,
    bytes_written: usize,
    changed: bool,
}

pub fn run_cli<I, S>(args: I) -> Result<String, FileCliError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let options = parse_cli_args(args)?;
    let result = match options.operation {
        FileOperation::Read { path } => {
            let result = FileService::read(&path)
                .map_err(|error| FileCliError::Execution(format!("{error:?}")))?;
            FileResult {
                service: "ade-file",
                operation: "read",
                path: result.path.to_string_lossy().into_owned(),
                bytes: result.bytes,
                bytes_written: 0,
                changed: false,
            }
        }
        FileOperation::Write { path, bytes } => {
            let result = FileService::write_atomic(&path, &bytes)
                .map_err(|error| FileCliError::Execution(format!("{error:?}")))?;
            FileResult {
                service: "ade-file",
                operation: "write",
                path: result.path.to_string_lossy().into_owned(),
                bytes: Vec::new(),
                bytes_written: result.bytes_written,
                changed: result.changed,
            }
        }
    };
    if options.json {
        serde_json::to_string(&result).map_err(|error| FileCliError::Execution(error.to_string()))
    } else {
        Ok(format!(
            "ade-file {} path={} bytes_written={} changed={}",
            result.operation, result.path, result.bytes_written, result.changed
        ))
    }
}

fn decode_hex_bytes(value: String) -> Result<Vec<u8>, FileCliError> {
    if value.is_empty() || value.len() % 2 != 0 {
        return Err(FileCliError::InvalidHexBytes);
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = hex_digit(pair[0]).ok_or(FileCliError::InvalidHexBytes)?;
            let low = hex_digit(pair[1]).ok_or(FileCliError::InvalidHexBytes)?;
            Ok((high << 4) | low)
        })
        .collect()
}

fn hex_digit(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod contract_tests {
    use super::{parse_cli_args, run_cli, FileCliError, FileCliOptions, FileOperation};

    #[test]
    fn parses_strict_json_read_and_write_operations() {
        assert_eq!(
            parse_cli_args(["--json", "--read", r"C:\workspaces\note.txt"]),
            Ok(FileCliOptions {
                json: true,
                operation: FileOperation::Read {
                    path: String::from(r"C:\workspaces\note.txt"),
                },
            })
        );
        assert_eq!(
            parse_cli_args(["--write", "/workspace/note.txt", "--bytes-hex", "4142"]),
            Ok(FileCliOptions {
                json: false,
                operation: FileOperation::Write {
                    path: String::from("/workspace/note.txt"),
                    bytes: vec![0x41, 0x42],
                },
            })
        );
    }

    #[test]
    fn rejects_ambiguous_or_malformed_file_operations() {
        assert_eq!(
            parse_cli_args(["--read", "/note.txt", "--write", "/other.txt"]),
            Err(FileCliError::MultipleOperations)
        );
        assert_eq!(
            parse_cli_args(["--write", "/note.txt"]),
            Err(FileCliError::MissingBytes)
        );
        assert_eq!(
            parse_cli_args(["--write", "/note.txt", "--bytes-hex", "4g"]),
            Err(FileCliError::InvalidHexBytes)
        );
        assert_eq!(
            parse_cli_args(["--legacy-mode"]),
            Err(FileCliError::UnexpectedArgument(String::from(
                "--legacy-mode"
            )))
        );
    }

    #[test]
    fn renders_authoritative_read_and_idempotent_write_state() {
        let path = std::env::temp_dir().join(format!("ade-file-cli-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let path = path.to_string_lossy().into_owned();
        let write = run_cli(["--json", "--write", &path, "--bytes-hex", "4142"])
            .expect("file write should succeed");
        assert!(write.contains(r#""bytes_written":2"#));
        assert!(write.contains(r#""changed":true"#));
        let repeat = run_cli(["--json", "--write", &path, "--bytes-hex", "4142"])
            .expect("repeated file write should succeed");
        assert!(repeat.contains(r#""changed":false"#));
        let read = run_cli(["--json", "--read", &path]).expect("file read should succeed");
        assert!(read.contains(r#""bytes":[65,66]"#));
        let _ = std::fs::remove_file(path);
    }
}
