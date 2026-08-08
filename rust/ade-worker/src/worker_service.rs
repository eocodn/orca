use std::path::{Path, PathBuf};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerServiceIdentity {
    pub worker_id: String,
    pub worker_incarnation: u64,
    pub worker_version: String,
}

impl WorkerServiceIdentity {
    pub fn new(
        worker_id: impl Into<String>,
        worker_incarnation: u64,
    ) -> Result<Self, WorkerServiceError> {
        let worker_id = worker_id.into();
        if worker_id.trim().is_empty() {
            return Err(WorkerServiceError::MissingWorkerId);
        }
        if worker_incarnation == 0 || worker_incarnation > MAX_SAFE_INTEGER {
            return Err(WorkerServiceError::InvalidWorkerIncarnation(
                worker_incarnation.to_string(),
            ));
        }
        Ok(Self {
            worker_id,
            worker_incarnation,
            worker_version: env!("CARGO_PKG_VERSION").into(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerServiceMode {
    ServeUnix {
        socket_path: PathBuf,
        identity: WorkerServiceIdentity,
    },
    ConnectUnix {
        socket_path: PathBuf,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerServiceError {
    InvalidSocketPath,
    MissingWorkerId,
    MissingWorkerIncarnation,
    InvalidWorkerIncarnation(String),
    UnexpectedArgument(String),
    SocketInUse(PathBuf),
    SocketPathOccupied(PathBuf),
    Io(String),
    UnsupportedPlatform,
}

pub fn parse_service_mode<I, S>(args: I) -> Result<Option<WorkerServiceMode>, WorkerServiceError>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let args = args.into_iter().map(Into::into).collect::<Vec<String>>();
    let Some(first) = args.first().map(String::as_str) else {
        return Ok(None);
    };
    match first {
        "--serve-unix" => parse_serve_unix(&args).map(Some),
        "--connect-unix" => parse_connect_unix(&args).map(Some),
        _ => Ok(None),
    }
}

fn parse_serve_unix(args: &[String]) -> Result<WorkerServiceMode, WorkerServiceError> {
    let socket_path = args
        .get(1)
        .map(PathBuf::from)
        .ok_or(WorkerServiceError::InvalidSocketPath)?;
    validate_socket_path(&socket_path)?;

    let mut worker_id = None;
    let mut worker_incarnation = None;
    let mut index = 2;
    while index < args.len() {
        match args[index].as_str() {
            "--worker-id" if worker_id.is_none() => {
                worker_id = args.get(index + 1).cloned();
                if worker_id.is_none() {
                    return Err(WorkerServiceError::MissingWorkerId);
                }
                index += 2;
            }
            "--worker-incarnation" if worker_incarnation.is_none() => {
                let value = args
                    .get(index + 1)
                    .cloned()
                    .ok_or(WorkerServiceError::MissingWorkerIncarnation)?;
                let parsed = value
                    .parse::<u64>()
                    .map_err(|_| WorkerServiceError::InvalidWorkerIncarnation(value.clone()))?;
                worker_incarnation = Some(parsed);
                index += 2;
            }
            argument => return Err(WorkerServiceError::UnexpectedArgument(argument.into())),
        }
    }
    let worker_id = worker_id.ok_or(WorkerServiceError::MissingWorkerId)?;
    let worker_incarnation =
        worker_incarnation.ok_or(WorkerServiceError::MissingWorkerIncarnation)?;
    let identity = WorkerServiceIdentity::new(worker_id, worker_incarnation)?;
    Ok(WorkerServiceMode::ServeUnix {
        socket_path,
        identity,
    })
}

fn parse_connect_unix(args: &[String]) -> Result<WorkerServiceMode, WorkerServiceError> {
    let socket_path = args
        .get(1)
        .map(PathBuf::from)
        .ok_or(WorkerServiceError::InvalidSocketPath)?;
    validate_socket_path(&socket_path)?;
    if let Some(argument) = args.get(2) {
        return Err(WorkerServiceError::UnexpectedArgument(argument.clone()));
    }
    Ok(WorkerServiceMode::ConnectUnix { socket_path })
}

fn validate_socket_path(path: &Path) -> Result<(), WorkerServiceError> {
    if !path.is_absolute() || path.as_os_str().is_empty() {
        return Err(WorkerServiceError::InvalidSocketPath);
    }
    Ok(())
}

#[cfg(unix)]
mod unix {
    use super::{
        validate_socket_path, WorkerServiceError, WorkerServiceIdentity, WorkerServiceMode,
    };
    use crate::jsonl_transport::serve_bound_mixed_jsonl;
    use crate::pty_registry::PtyWorkerRegistry;
    use crate::worker_dispatch::FileGitWorkerRegistry;
    use std::fs;
    use std::io::{self, BufRead, BufReader, Write};
    use std::net::Shutdown;
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::thread;

    pub struct WorkerUnixServer {
        listener: UnixListener,
        socket_path: PathBuf,
        identity: WorkerServiceIdentity,
        pty_registry: Arc<PtyWorkerRegistry>,
        file_git_registry: Arc<FileGitWorkerRegistry>,
    }

    impl WorkerUnixServer {
        pub fn bind(
            path: impl AsRef<Path>,
            identity: WorkerServiceIdentity,
        ) -> Result<Self, WorkerServiceError> {
            let path = path.as_ref();
            validate_socket_path(path)?;
            recover_stale_socket(path)?;
            let listener = UnixListener::bind(path).map_err(io_error)?;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(io_error)?;
            Ok(Self {
                listener,
                socket_path: path.to_path_buf(),
                identity,
                pty_registry: Arc::new(PtyWorkerRegistry::default()),
                file_git_registry: Arc::new(FileGitWorkerRegistry::default()),
            })
        }

        pub fn run(self) -> Result<(), WorkerServiceError> {
            for stream in self.listener.incoming() {
                let stream = stream.map_err(io_error)?;
                let reader_stream = stream.try_clone().map_err(io_error)?;
                let pty_registry = Arc::clone(&self.pty_registry);
                let file_git_registry = Arc::clone(&self.file_git_registry);
                let identity = self.identity.clone();
                thread::spawn(move || {
                    if let Err(error) = serve_bound_mixed_jsonl(
                        BufReader::new(reader_stream),
                        stream,
                        &pty_registry,
                        &file_git_registry,
                        &identity,
                    ) {
                        eprintln!("ade-worker unix connection error: {error}");
                    }
                });
            }
            Ok(())
        }
    }

    impl Drop for WorkerUnixServer {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.socket_path);
        }
    }

    fn recover_stale_socket(path: &Path) -> Result<(), WorkerServiceError> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(io_error(error)),
        };
        if !metadata.file_type().is_socket() {
            return Err(WorkerServiceError::SocketPathOccupied(path.to_path_buf()));
        }
        match UnixStream::connect(path) {
            Ok(_) => Err(WorkerServiceError::SocketInUse(path.to_path_buf())),
            Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {
                // Only remove a socket after an authoritative failed connect probe.
                fs::remove_file(path).map_err(io_error)
            }
            Err(error) => Err(io_error(error)),
        }
    }

    fn connect_unix_stdio(path: &Path) -> Result<(), WorkerServiceError> {
        validate_socket_path(path)?;
        let stream = UnixStream::connect(path).map_err(io_error)?;
        let mut writer = stream.try_clone().map_err(io_error)?;
        thread::spawn(move || {
            let mut stdin = io::stdin().lock();
            let _ = io::copy(&mut stdin, &mut writer);
            let _ = writer.shutdown(Shutdown::Write);
        });
        let mut stdout = io::stdout().lock();
        let mut reader = BufReader::new(stream);
        let mut response = Vec::new();
        loop {
            response.clear();
            let bytes = reader.read_until(b'\n', &mut response).map_err(io_error)?;
            if bytes == 0 {
                break;
            }
            stdout.write_all(&response).map_err(io_error)?;
            stdout.flush().map_err(io_error)?;
        }
        Ok(())
    }

    pub fn run_service_mode(mode: WorkerServiceMode) -> Result<(), WorkerServiceError> {
        match mode {
            WorkerServiceMode::ServeUnix {
                socket_path,
                identity,
            } => WorkerUnixServer::bind(socket_path, identity)?.run(),
            WorkerServiceMode::ConnectUnix { socket_path } => connect_unix_stdio(&socket_path),
        }
    }

    fn io_error(error: io::Error) -> WorkerServiceError {
        WorkerServiceError::Io(error.to_string())
    }
}

#[cfg(unix)]
pub use unix::{run_service_mode, WorkerUnixServer};

#[cfg(not(unix))]
pub fn run_service_mode(_mode: WorkerServiceMode) -> Result<(), WorkerServiceError> {
    Err(WorkerServiceError::UnsupportedPlatform)
}
