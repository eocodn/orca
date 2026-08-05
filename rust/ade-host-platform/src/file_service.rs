#[cfg(test)]
mod contract_tests {
    use super::{FileError, FileService};
    use std::fs;

    fn test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ade-file-service-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be available")
                .as_nanos()
        ))
    }

    #[test]
    fn reads_existing_bytes_without_normalizing_the_path() {
        let path = test_path("read");
        fs::write(&path, b"hello").expect("fixture should be written");

        let result = FileService::read(&path).expect("file should be readable");

        assert_eq!(result.path, path);
        assert_eq!(result.bytes, b"hello");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn atomically_replaces_content_and_reports_authoritative_bytes() {
        let path = test_path("write");
        fs::write(&path, b"old").expect("fixture should be written");

        let result = FileService::write_atomic(&path, b"new").expect("write should succeed");

        assert!(result.changed);
        assert_eq!(result.bytes_written, 3);
        assert_eq!(fs::read(&path).expect("file should exist"), b"new");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn repeated_writes_of_authoritative_bytes_are_idempotent() {
        let path = test_path("idempotent");
        fs::write(&path, b"same").expect("fixture should be written");

        let result = FileService::write_atomic(&path, b"same").expect("write should succeed");

        assert!(!result.changed);
        assert_eq!(result.bytes_written, 4);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_empty_paths_before_touching_the_filesystem() {
        assert_eq!(
            FileService::read("").expect_err("empty path must fail"),
            FileError::EmptyPath
        );
    }

    #[test]
    fn does_not_leave_a_partial_destination_when_the_parent_is_missing() {
        let path = test_path("missing-parent").join("file.txt");

        let error = FileService::write_atomic(&path, b"new").expect_err("parent must be required");

        assert!(matches!(error, FileError::Io { .. }));
        assert!(!path.exists());
    }
}

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, PartialEq, Eq)]
pub enum FileError {
    EmptyPath,
    Io {
        operation: &'static str,
        path: PathBuf,
        detail: String,
    },
    PostconditionMismatch {
        path: PathBuf,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub struct FileReadResult {
    pub path: PathBuf,
    pub bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct FileWriteResult {
    pub path: PathBuf,
    pub bytes_written: usize,
    pub changed: bool,
}

pub struct FileService;

impl FileService {
    pub fn read(path: impl AsRef<Path>) -> Result<FileReadResult, FileError> {
        let path = validated_path(path)?;
        let bytes = fs::read(&path).map_err(|error| io_error("read", &path, error))?;
        Ok(FileReadResult { path, bytes })
    }

    pub fn write_atomic(
        path: impl AsRef<Path>,
        bytes: &[u8],
    ) -> Result<FileWriteResult, FileError> {
        let path = validated_path(path)?;
        match fs::read(&path) {
            Ok(authoritative) if authoritative == bytes => {
                return Ok(FileWriteResult {
                    path,
                    bytes_written: authoritative.len(),
                    changed: false,
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("read existing file", &path, error)),
        }
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let file_name = path
            .file_name()
            .ok_or(FileError::EmptyPath)?
            .to_string_lossy();
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary_path = parent.join(format!(".{file_name}.ade-{sequence}.tmp"));
        let mut temporary = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(|error| io_error("create temporary file", &temporary_path, error))?;
        let write_result = (|| {
            temporary
                .write_all(bytes)
                .map_err(|error| io_error("write temporary file", &temporary_path, error))?;
            temporary
                .sync_all()
                .map_err(|error| io_error("sync temporary file", &temporary_path, error))?;
            replace_destination(&temporary_path, &path)
        })();
        drop(temporary);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }

        let authoritative =
            fs::read(&path).map_err(|error| io_error("verify write", &path, error))?;
        if authoritative != bytes {
            return Err(FileError::PostconditionMismatch { path });
        }
        Ok(FileWriteResult {
            path,
            bytes_written: authoritative.len(),
            changed: true,
        })
    }
}

fn validated_path(path: impl AsRef<Path>) -> Result<PathBuf, FileError> {
    let path = path.as_ref();
    if path.as_os_str().is_empty() || path.to_string_lossy().trim().is_empty() {
        return Err(FileError::EmptyPath);
    }
    Ok(path.to_path_buf())
}

fn io_error(operation: &'static str, path: &Path, error: std::io::Error) -> FileError {
    FileError::Io {
        operation,
        path: path.to_path_buf(),
        detail: error.to_string(),
    }
}

#[cfg(not(windows))]
fn replace_destination(temporary_path: &Path, path: &Path) -> Result<(), FileError> {
    fs::rename(temporary_path, path).map_err(|error| io_error("replace destination", path, error))
}

#[cfg(windows)]
fn replace_destination(temporary_path: &Path, path: &Path) -> Result<(), FileError> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    let existing = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replacement = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let succeeded = unsafe {
        MoveFileExW(
            existing.as_ptr(),
            replacement.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } != 0;
    if succeeded {
        Ok(())
    } else {
        Err(io_error(
            "replace destination",
            path,
            std::io::Error::last_os_error(),
        ))
    }
}
