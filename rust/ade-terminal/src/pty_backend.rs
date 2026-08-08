use crate::pty::PtyError;
#[cfg(windows)]
use crate::pty::{POLL_INTERVAL, READER_CLOSE_TIMEOUT};
use portable_pty::{Child, ExitStatus};
#[cfg(unix)]
use std::io;
use std::io::Read;
#[cfg(windows)]
use std::os::windows::io::RawHandle;
#[cfg(windows)]
use std::process::Stdio;
use std::sync::mpsc::SyncSender;
use std::thread::{self, JoinHandle};
#[cfg(windows)]
use std::time::Instant;

const OUTPUT_CHUNK_BYTES: usize = 8192;

pub(crate) fn spawn_reader(
    mut reader: Box<dyn Read + Send>,
    output_tx: SyncSender<Result<Vec<u8>, String>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; OUTPUT_CHUNK_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => return,
                Ok(size) => {
                    if output_tx.send(Ok(buffer[..size].to_vec())).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let _ = output_tx.send(Err(error.to_string()));
                    return;
                }
            }
        }
    })
}
#[cfg(not(windows))]
pub(crate) fn try_wait_child(
    child: &mut Box<dyn Child + Send + Sync>,
) -> Result<Option<ExitStatus>, PtyError> {
    child
        .try_wait()
        .map_err(|error| PtyError::Termination(error.to_string()))
}

#[cfg(windows)]
pub(crate) fn try_wait_child(
    child: &mut Box<dyn Child + Send + Sync>,
    expected_identity: Option<WindowsProcessIdentity>,
) -> Result<Option<ExitStatus>, PtyError> {
    let handle = child.as_raw_handle().ok_or_else(|| {
        PtyError::Termination(String::from("Windows PTY child handle unavailable"))
    })?;
    if windows_child_handle_has_exited(handle, expected_identity)? {
        return child
            .wait()
            .map(Some)
            .map_err(|error| PtyError::Termination(error.to_string()));
    }
    Ok(None)
}

#[cfg(windows)]
pub(crate) fn windows_child_handle_has_exited(
    handle: RawHandle,
    expected_identity: Option<WindowsProcessIdentity>,
) -> Result<bool, PtyError> {
    use std::ffi::c_void;

    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_TIMEOUT: u32 = 258;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    unsafe extern "system" {
        #[link_name = "GetProcessTimes"]
        fn get_process_times(
            handle: *mut c_void,
            creation_time: *mut FileTime,
            exit_time: *mut FileTime,
            kernel_time: *mut FileTime,
            user_time: *mut FileTime,
        ) -> i32;
        #[link_name = "WaitForSingleObject"]
        fn wait_for_single_object(handle: *mut c_void, milliseconds: u32) -> u32;
    }

    let expected_identity = expected_identity.ok_or_else(|| {
        PtyError::Termination(String::from("Windows PTY process identity unavailable"))
    })?;
    if handle.is_null() {
        return Err(PtyError::Termination(String::from(
            "Windows PTY child handle unavailable",
        )));
    }
    let mut creation_time = FileTime::default();
    let mut exit_time = FileTime::default();
    let mut kernel_time = FileTime::default();
    let mut user_time = FileTime::default();
    let observed = unsafe {
        get_process_times(
            handle as *mut c_void,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    };
    if observed == 0 {
        return Err(PtyError::Termination(String::from(
            "could not observe Windows PTY child identity",
        )));
    }
    let identity = WindowsProcessIdentity {
        creation_time: (u64::from(creation_time.high) << 32) | u64::from(creation_time.low),
    };
    if identity != expected_identity {
        return Err(PtyError::Termination(String::from(
            "Windows PTY child identity changed while observing",
        )));
    }
    match unsafe { wait_for_single_object(handle as *mut c_void, 0) } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => Ok(false),
        _ => Err(PtyError::Termination(String::from(
            "could not observe Windows PTY child state",
        ))),
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WindowsProcessIdentity {
    pub(crate) creation_time: u64,
}

#[cfg(windows)]
pub(crate) fn capture_windows_process_identity(
    pid: u32,
) -> Result<WindowsProcessIdentity, PtyError> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    unsafe extern "system" {
        #[link_name = "OpenProcess"]
        fn open_process(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
        #[link_name = "GetProcessTimes"]
        fn get_process_times(
            handle: *mut c_void,
            creation_time: *mut FileTime,
            exit_time: *mut FileTime,
            kernel_time: *mut FileTime,
            user_time: *mut FileTime,
        ) -> i32;
        #[link_name = "CloseHandle"]
        fn close_handle(handle: *mut c_void) -> i32;
    }

    let handle = unsafe { open_process(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == null_mut() {
        return Err(PtyError::Termination(String::from(
            "could not inspect Windows PTY process identity",
        )));
    }
    let mut creation_time = FileTime::default();
    let mut exit_time = FileTime::default();
    let mut kernel_time = FileTime::default();
    let mut user_time = FileTime::default();
    let observed = unsafe {
        get_process_times(
            handle,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    };
    let close_result = unsafe { close_handle(handle) };
    if observed == 0 {
        return Err(PtyError::Termination(String::from(
            "could not observe Windows PTY process identity",
        )));
    }
    if close_result == 0 {
        return Err(PtyError::Termination(String::from(
            "could not close Windows PTY process identity handle",
        )));
    }
    Ok(WindowsProcessIdentity {
        creation_time: (u64::from(creation_time.high) << 32) | u64::from(creation_time.low),
    })
}

pub(crate) enum ProcessTermination {
    Signalled,
    AlreadyExited,
}

#[cfg(unix)]
pub(crate) fn terminate_process_tree(
    process_group: Option<i32>,
    pid: u32,
) -> Result<ProcessTermination, PtyError> {
    let process_group = process_group.unwrap_or(pid as i32) as libc::pid_t;
    let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
    if result == 0 {
        return Ok(ProcessTermination::Signalled);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(libc::ESRCH) {
        return Err(PtyError::Termination(error.to_string()));
    }
    if unsafe { libc::kill(-process_group, 0) } == 0 {
        return Err(PtyError::Termination(String::from(
            "pty process group remains after termination",
        )));
    }
    Ok(ProcessTermination::AlreadyExited)
}

#[cfg(windows)]
pub(crate) fn terminate_process_tree(
    _process_group: Option<i32>,
    pid: u32,
    expected_identity: Option<WindowsProcessIdentity>,
) -> Result<ProcessTermination, PtyError> {
    let expected_identity = expected_identity.ok_or_else(|| {
        PtyError::Termination(String::from("Windows PTY process identity unavailable"))
    })?;
    // The identity check fences stale PIDs, but taskkill resolves the PID again; this is not atomic.
    if capture_windows_process_identity(pid)? != expected_identity {
        return Err(PtyError::Termination(String::from(
            "Windows PTY process identity changed before termination",
        )));
    }
    let mut taskkill = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| PtyError::Termination(error.to_string()))?;
    let deadline = Instant::now() + READER_CLOSE_TIMEOUT;
    loop {
        match taskkill.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(ProcessTermination::Signalled),
            Ok(Some(status)) => {
                return Err(PtyError::Termination(format!(
                    "taskkill exited with {status}"
                )))
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = taskkill.kill();
                let _ = taskkill.wait();
                return Err(PtyError::Termination(String::from("taskkill timed out")));
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                return Err(PtyError::Termination(format!(
                    "taskkill wait failed: {error}"
                )))
            }
        }
    }
}
