use ade_host_core::protocol::{PtyExecutionTarget, PtyRequest, PtySshShell};
use ade_terminal::pty::PtySpec;
use std::path::PathBuf;

pub fn build_pty_spec(request: &PtyRequest) -> Result<PtySpec, String> {
    match request.operation.clone() {
        ade_host_core::protocol::PtyOperation::Start {
            program,
            args,
            current_dir,
            execution_target,
            cols,
            rows,
        } => {
            let target = execution_target.unwrap_or(PtyExecutionTarget::WindowsNative);
            let (program, args, current_dir) = match target {
                PtyExecutionTarget::WindowsNative => {
                    (program, args, current_dir.map(PathBuf::from))
                }
                PtyExecutionTarget::Wsl2 { distro } => {
                    if distro.trim().is_empty() {
                        return Err("empty_wsl_distro".into());
                    }
                    let command = std::iter::once(program.as_str())
                        .chain(args.iter().map(String::as_str))
                        .map(shell_quote)
                        .collect::<Vec<_>>()
                        .join(" ");
                    let script = match current_dir {
                        Some(path) => format!(
                            "cd -- {} && exec {command}",
                            shell_quote(&wsl_current_dir(&path, &distro)?)
                        ),
                        None => format!("exec {command}"),
                    };
                    (
                        "wsl.exe".into(),
                        vec![
                            "--distribution".into(),
                            distro,
                            "--".into(),
                            "sh".into(),
                            "-lc".into(),
                            script,
                        ],
                        None,
                    )
                }
                PtyExecutionTarget::Ssh {
                    host,
                    shell: PtySshShell::Posix,
                } => {
                    if host.trim().is_empty() {
                        return Err("empty_ssh_host".into());
                    }
                    let mut command = vec![shell_quote(&program)];
                    command.extend(args.iter().map(|arg| shell_quote(arg)));
                    let script = match current_dir {
                        Some(path) => {
                            format!("cd -- {} && exec {}", shell_quote(&path), command.join(" "))
                        }
                        None => format!("exec {}", command.join(" ")),
                    };
                    (
                        "ssh".into(),
                        vec![
                            "-tt".into(),
                            "-oServerAliveInterval=5".into(),
                            "-oServerAliveCountMax=3".into(),
                            "--".into(),
                            host,
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
                cols,
                rows,
            })
        }
        _ => Err("start_required".into()),
    }
}

fn wsl_current_dir(value: &str, distro: &str) -> Result<String, String> {
    if value.is_empty() {
        return Err("invalid_wsl_working_directory".into());
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
                .map_or((remainder, ""), |(d, p)| (d, p));
            if path_distro.is_empty() || !path_distro.eq_ignore_ascii_case(distro) {
                return Err("wsl_distro_mismatch".into());
            }
            return Ok(if path.is_empty() {
                "/".into()
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
    Err("invalid_wsl_working_directory".into())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
