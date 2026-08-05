use ade_terminal::pty::PtySpec;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PtyExecutionTarget {
    #[serde(rename = "windows-native", alias = "windows_native")]
    WindowsNative,
    Wsl2 {
        distro: String,
    },
    Ssh {
        host: String,
        shell: PtySshShell,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PtySshShell {
    Posix,
}

pub(crate) fn build_pty_spec(request: &crate::pty_contract::PtyRequest) -> Result<PtySpec, String> {
    let program = request
        .program
        .clone()
        .ok_or_else(|| String::from("empty_program"))?;
    let target = request
        .execution_target
        .as_ref()
        .unwrap_or(&PtyExecutionTarget::WindowsNative);
    let (program, args, current_dir) = match target {
        PtyExecutionTarget::WindowsNative => (
            program,
            request.args.clone(),
            request.current_dir.clone().map(PathBuf::from),
        ),
        PtyExecutionTarget::Wsl2 { distro } => {
            if distro.trim().is_empty() {
                return Err(String::from("empty_wsl_distro"));
            }
            let mut args = vec![String::from("--distribution"), distro.clone()];
            if let Some(current_dir) = &request.current_dir {
                args.extend([String::from("--cd"), wsl_current_dir(current_dir, distro)?]);
            }
            args.push(String::from("--"));
            args.push(program);
            args.extend(request.args.clone());
            (String::from("wsl.exe"), args, None)
        }
        PtyExecutionTarget::Ssh {
            host,
            shell: PtySshShell::Posix,
        } => {
            if host.trim().is_empty() {
                return Err(String::from("empty_ssh_host"));
            }
            let mut command = vec![shell_quote(&program)];
            command.extend(request.args.iter().map(|arg| shell_quote(arg)));
            let script = match &request.current_dir {
                Some(current_dir) => format!(
                    "cd -- {} && exec {}",
                    shell_quote(current_dir),
                    command.join(" ")
                ),
                None => format!("exec {}", command.join(" ")),
            };
            // OpenSSH concatenates remote arguments, so quote the complete script boundary.
            (
                String::from("ssh"),
                vec![
                    String::from("-tt"),
                    String::from("--"),
                    host.clone(),
                    format!("sh -lc {}", shell_quote(&script)),
                ],
                None,
            )
        }
    };
    Ok(PtySpec {
        program,
        args,
        current_dir,
        environment: Default::default(),
        cols: request.cols.unwrap_or(0),
        rows: request.rows.unwrap_or(0),
    })
}

fn wsl_current_dir(value: &str, distro: &str) -> Result<String, String> {
    if value.is_empty() {
        return Err(String::from("invalid_wsl_working_directory"));
    }
    let normalized = value.replace('\\', "/");
    for prefix in ["//wsl.localhost/", "//wsl$/"] {
        if normalized
            .get(..prefix.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
        {
            let remainder = &normalized[prefix.len()..];
            let (path_distro, path) = remainder
                .split_once('/')
                .map_or((remainder, ""), |(path_distro, path)| (path_distro, path));
            if path_distro.is_empty() || !path_distro.eq_ignore_ascii_case(distro) {
                return Err(String::from("wsl_distro_mismatch"));
            }
            return Ok(if path.is_empty() {
                String::from("/")
            } else {
                format!("/{path}")
            });
        }
    }

    if normalized.starts_with('/') {
        return Ok(normalized);
    }

    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let rest = normalized[2..].trim_start_matches('/');
        return Ok(if rest.is_empty() {
            format!("/mnt/{}", (bytes[0] as char).to_ascii_lowercase())
        } else {
            format!("/mnt/{}/{}", (bytes[0] as char).to_ascii_lowercase(), rest)
        });
    }
    Err(String::from("invalid_wsl_working_directory"))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::{build_pty_spec, PtyExecutionTarget, PtySshShell};
    use crate::pty_contract::{PtyOperation, PtyRequest};

    fn request(request_id: &str, session_id: &str) -> PtyRequest {
        PtyRequest {
            request_id: request_id.to_string(),
            session_id: session_id.to_string(),
            operation: PtyOperation::Start,
            program: None,
            args: Vec::new(),
            current_dir: None,
            execution_target: None,
            input: None,
            cols: None,
            rows: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn builds_a_wsl2_pty_command_without_using_the_native_working_directory() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.args = vec![String::from("-lc"), String::from("printf ready")];
        start.current_dir = Some(String::from("/workspace/project"));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        let spec = build_pty_spec(&start).unwrap();
        assert_eq!(spec.program, "wsl.exe");
        assert_eq!(
            spec.args,
            vec![
                "--distribution",
                "Ubuntu-24.04",
                "--cd",
                "/workspace/project",
                "--",
                "bash",
                "-lc",
                "printf ready"
            ]
        );
        assert!(spec.current_dir.is_none());
    }

    #[test]
    fn converts_windows_wsl_workspace_paths_before_using_wsl_cd() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.current_dir = Some(String::from(r"C:\Users\Ada\project"));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        let spec = build_pty_spec(&start).unwrap();
        assert_eq!(spec.args[3], "/mnt/c/Users/Ada/project");
    }

    #[test]
    fn converts_a_matching_wsl_unc_workspace_path() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.current_dir = Some(String::from(
            r"\\wsl.localhost\Ubuntu-24.04\home\ada\project",
        ));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        let spec = build_pty_spec(&start).unwrap();
        assert_eq!(spec.args[3], "/home/ada/project");
    }

    #[test]
    fn converts_a_forward_slash_wsl_unc_workspace_path() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.current_dir = Some(String::from(
            "//wsl.localhost/Ubuntu-24.04/home/ada/project",
        ));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        let spec = build_pty_spec(&start).unwrap();
        assert_eq!(spec.args[3], "/home/ada/project");
    }

    #[test]
    fn rejects_a_forward_slash_wsl_unc_workspace_path_for_another_distro() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.current_dir = Some(String::from(
            "//wsl.localhost/Ubuntu-22.04/home/ada/project",
        ));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        assert_eq!(
            build_pty_spec(&start),
            Err(String::from("wsl_distro_mismatch"))
        );
    }

    #[test]
    fn rejects_an_unmapped_wsl_workspace_path() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("bash"));
        start.current_dir = Some(String::from("relative/project"));
        start.execution_target = Some(PtyExecutionTarget::Wsl2 {
            distro: String::from("Ubuntu-24.04"),
        });
        start.cols = Some(80);
        start.rows = Some(24);

        assert_eq!(
            build_pty_spec(&start),
            Err(String::from("invalid_wsl_working_directory"))
        );
    }

    #[test]
    fn quotes_ssh_working_directory_and_arguments_as_one_remote_command() {
        let mut start = request("start-1", "session-1");
        start.program = Some(String::from("printf"));
        start.args = vec![String::from("it's-ready")];
        start.current_dir = Some(String::from("/tmp/it's-project"));
        start.execution_target = Some(PtyExecutionTarget::Ssh {
            host: String::from("builder"),
            shell: PtySshShell::Posix,
        });
        start.cols = Some(80);
        start.rows = Some(24);

        let spec = build_pty_spec(&start).unwrap();
        assert_eq!(spec.program, "ssh");
        assert_eq!(spec.args[0], "-tt");
        assert_eq!(spec.args[1], "--");
        assert_eq!(spec.args[2], "builder");
        assert_eq!(
            spec.args[3],
            r#"sh -lc 'cd -- '\''/tmp/it'\''\'\'''\''s-project'\'' && exec '\''printf'\'' '\''it'\''\'\'''\''s-ready'\'''"#
        );
        assert!(spec.current_dir.is_none());
    }

    #[test]
    fn accepts_the_public_hyphenated_native_target_name() {
        let request: PtyRequest = serde_json::from_str(
            r#"{
                "request_id":"start-1",
                "session_id":"session-1",
                "operation":"start",
                "program":"bash",
                "args":[],
                "current_dir":null,
                "execution_target":{"kind":"windows-native"},
                "input":null,
                "cols":80,
                "rows":24,
                "timeout_ms":null
            }"#,
        )
        .unwrap();

        assert_eq!(
            request.execution_target,
            Some(PtyExecutionTarget::WindowsNative)
        );
    }
}
