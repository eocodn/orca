use super::{PtyError, PtySession, PtySpec};
use ade_host_core::terminal::TerminalStatus;
use std::collections::BTreeMap;
use std::time::Duration;

fn spec(program: &str, args: &[&str]) -> PtySpec {
    PtySpec {
        program: program.to_string(),
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        current_dir: None,
        environment: BTreeMap::new(),
        cols: 80,
        rows: 24,
    }
}

#[test]
fn rejects_empty_program_before_opening_a_pty() {
    assert!(matches!(
        PtySession::spawn("pty-1", spec(" ", &[])),
        Err(PtyError::EmptyProgram)
    ));
}

#[cfg(unix)]
#[test]
fn observes_pty_output_and_exit_from_authoritative_state() {
    let mut session = PtySession::spawn("pty-1", spec("printf", &["ready"])).unwrap();
    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
    assert!(snapshot.output_sequence >= 1);
    assert!(snapshot.tail.contains("ready"));
}

#[cfg(unix)]
#[test]
fn natural_exit_terminates_a_descendant_holding_the_pty_open() {
    let mut session = PtySession::spawn("pty-1", spec("sh", &["-c", "sleep 5 & exit 0"])).unwrap();
    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
}

#[cfg(unix)]
#[test]
fn writes_input_and_applies_resize_to_a_live_pty() {
    let mut session = PtySession::spawn(
        "pty-1",
        spec("sh", &["-c", "read line; printf 'got:%s' \"$line\""]),
    )
    .unwrap();
    session.resize(100, 40).unwrap();
    session.write(b"input\n").unwrap();
    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
    assert!(snapshot.tail.contains("got:input"));
}

#[cfg(unix)]
#[test]
fn timeout_publishes_failure_and_does_not_report_success() {
    let mut session = PtySession::spawn("pty-1", spec("sleep", &["2"])).unwrap();
    let snapshot = session.wait(Duration::from_millis(20)).unwrap();

    assert!(matches!(snapshot.status, TerminalStatus::Failed { .. }));
    assert_eq!(snapshot.exit_code, None);
    assert_eq!(snapshot.failure_reason.as_deref(), Some("pty timed out"));
}

#[cfg(unix)]
#[test]
fn terminate_observes_a_natural_exit_before_marking_failure() {
    let mut session =
        PtySession::spawn("pty-1", spec("sh", &["-c", "printf 'ready'; exit 7"])).unwrap();
    std::thread::sleep(Duration::from_millis(50));

    let snapshot = session.terminate().unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 7 });
    assert_eq!(snapshot.exit_code, Some(7));
    assert_eq!(snapshot.failure_reason, None);
    assert!(snapshot.tail.contains("ready"));
}

#[cfg(windows)]
#[test]
fn terminate_observes_a_natural_windows_exit_before_marking_failure() {
    let mut session = PtySession::spawn("pty-1", spec("cmd.exe", &["/C", "exit", "0"])).unwrap();
    std::thread::sleep(Duration::from_millis(100));

    let snapshot = session.terminate().unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
    assert_eq!(snapshot.exit_code, Some(0));
}

#[cfg(windows)]
#[test]
fn observes_short_lived_windows_output_and_exit() {
    let mut session = PtySession::spawn(
        "pty-1",
        spec("cmd.exe", &["/C", "echo", "ADE_WINDOWS_PTY_OK"]),
    )
    .unwrap();
    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 0 });
    assert_eq!(snapshot.exit_code, Some(0));
    assert!(snapshot.tail.contains("ADE_WINDOWS_PTY_OK"));
}

#[cfg(windows)]
#[test]
fn observes_windows_exit_code_259_as_a_natural_exit() {
    let mut session =
        PtySession::spawn("pty-1", spec("cmd.exe", &["/C", "exit", "/B", "259"])).unwrap();

    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 259 });
    assert_eq!(snapshot.exit_code, Some(259));
}

#[cfg(windows)]
#[test]
fn reobserves_the_spawned_windows_process_identity() {
    let session = PtySession::spawn(
        "pty-1",
        spec("cmd.exe", &["/C", "ping", "-n", "2", "127.0.0.1"]),
    )
    .unwrap();
    let pid = session.process_id.expect("Windows PTY should expose a pid");
    let expected = session
        .process_identity
        .expect("Windows PTY should capture process identity");

    assert_eq!(
        super::capture_windows_process_identity(pid).unwrap(),
        expected
    );
}

#[cfg(windows)]
#[test]
fn child_handle_identity_mismatch_fails_closed_before_exit_observation() {
    let session = PtySession::spawn(
        "pty-1",
        spec("cmd.exe", &["/C", "ping", "-n", "2", "127.0.0.1"]),
    )
    .unwrap();
    let expected = session
        .process_identity
        .expect("Windows PTY should capture process identity");
    let child = session.child.lock().unwrap();
    let handle = child
        .as_raw_handle()
        .expect("Windows PTY should expose its child handle");

    let result = super::windows_child_handle_has_exited(
        handle,
        Some(super::WindowsProcessIdentity {
            creation_time: expected.creation_time.wrapping_add(1),
        }),
    );

    assert!(matches!(
        result,
        Err(PtyError::Termination(reason))
            if reason.contains("identity changed")
    ));
}

#[cfg(windows)]
#[test]
fn child_handle_reconciles_exit_code_259() {
    let mut session =
        PtySession::spawn("pty-1", spec("cmd.exe", &["/C", "exit", "/B", "259"])).unwrap();
    let expected = session
        .process_identity
        .expect("Windows PTY should capture process identity");
    let child = session.child.lock().unwrap();
    let handle = child
        .as_raw_handle()
        .expect("Windows PTY should expose its child handle");
    drop(child);

    std::thread::sleep(Duration::from_millis(100));

    assert!(super::windows_child_handle_has_exited(handle, Some(expected)).unwrap());
    let snapshot = session.wait(Duration::from_secs(2)).unwrap();

    assert_eq!(snapshot.status, TerminalStatus::Exited { code: 259 });
    assert_eq!(snapshot.exit_code, Some(259));
}

#[cfg(unix)]
#[test]
fn rejects_non_utf8_output_without_replacing_the_bytes() {
    let mut session = PtySession::spawn("pty-1", spec("sh", &["-c", "printf '\\377'"])).unwrap();
    let result = session.wait(Duration::from_secs(2));

    assert!(matches!(result, Err(PtyError::Output(reason)) if reason.contains("not valid UTF-8")));
    assert!(matches!(
        session.snapshot().unwrap().status,
        TerminalStatus::Failed { .. }
    ));
}

#[cfg(unix)]
#[test]
fn preserves_a_utf8_codepoint_split_across_reader_chunks() {
    let mut session = PtySession::spawn("pty-1", spec("sleep", &["2"])).unwrap();

    session.record_output(vec![0xe2]).unwrap();
    session.record_output(vec![0x9c, 0x85]).unwrap();

    assert!(session.snapshot().unwrap().tail.contains('✅'));
}
