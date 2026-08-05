#[cfg(windows)]
use std::process::Stdio;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use super::PROCESS_TERMINATION_TIMEOUT;

pub(super) struct TerminationResult {
    pub(super) reason: String,
    pub(super) cleanup_failed: bool,
}

pub(super) fn configure_child(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // A private process group lets timeout/cancel terminate descendants too.
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

pub(super) fn termination_reason(prefix: &str, child: &mut Child) -> TerminationResult {
    match terminate_child(child) {
        Ok(()) => TerminationResult {
            reason: String::from(prefix),
            cleanup_failed: false,
        },
        Err(error) => TerminationResult {
            reason: format!("{prefix}; process termination failed: {error}"),
            cleanup_failed: true,
        },
    }
}

pub(super) fn terminate_child(child: &mut Child) -> Result<(), String> {
    let mut last_error = None;
    let deadline = Instant::now() + PROCESS_TERMINATION_TIMEOUT;
    while Instant::now() < deadline {
        match terminate_process_tree(child) {
            Ok(()) => last_error = None,
            Err(error) => {
                last_error = Some(error);
            }
        }
        match child.try_wait() {
            Ok(Some(_)) if last_error.is_none() => return Ok(()),
            Ok(Some(_)) => return Err(last_error.unwrap()),
            Ok(None) => {
                if let Err(error) = child.kill() {
                    if last_error.is_none() {
                        last_error = Some(error.to_string());
                    }
                }
            }
            Err(error) => return Err(format!("process wait failed: {error}")),
        }
        thread::sleep(Duration::from_millis(10));
    }
    Err(last_error.unwrap_or_else(|| String::from("process did not exit after termination")))
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child) -> Result<(), String> {
    let process_group = i32::try_from(child.id())
        .map_err(|_| String::from("process id does not fit the Unix process-group type"))?;
    // The child was placed in its own group before spawn; kill the group, not only the leader.
    let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            match unsafe { libc::kill(-process_group, 0) } {
                0 => Err(String::from(
                    "process-group termination reported no leader but descendants remain",
                )),
                -1 if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) => Ok(()),
                -1 => Err(format!(
                    "process-group existence check failed: {}",
                    std::io::Error::last_os_error()
                )),
                _ => Err(String::from(
                    "process-group existence check returned an invalid result",
                )),
            }
        } else {
            Err(format!("process-group termination failed: {error}"))
        }
    }
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) -> Result<(), String> {
    let mut taskkill = Command::new("taskkill")
        .args([
            String::from("/PID"),
            child.id().to_string(),
            String::from("/T"),
            String::from("/F"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("process-tree termination failed: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match taskkill.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => match child.try_wait() {
                Ok(Some(_)) => {
                    return Err(format!(
                        "process-tree termination exited with {status} while the child was already gone"
                    ))
                }
                Ok(None) => return Err(format!("process-tree termination exited with {status}")),
                Err(error) => return Err(format!("process wait failed: {error}")),
            },
            Ok(None) if Instant::now() >= deadline => {
                let _ = taskkill.kill();
                let _ = taskkill.wait();
                return Err(String::from("process-tree termination timed out"));
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => return Err(format!("process-tree termination wait failed: {error}")),
        }
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child) -> Result<(), String> {
    child
        .kill()
        .map_err(|error| format!("process termination failed: {error}"))
}
