#[cfg(test)]
mod contract_tests {
    use super::{resolve_repository_git_dir, GitRepositoryCommandError};
    use crate::git_capability::GitCapabilityCache;
    use crate::ExecutionTarget;
    use std::sync::{Arc, Mutex};

    #[test]
    fn preserves_authoritative_absolute_repository_metadata_path() {
        let cache = GitCapabilityCache::new();
        let path = resolve_repository_git_dir(
            &cache,
            &ExecutionTarget::Wsl2 {
                distro: String::from("Ubuntu"),
            },
            "/workspace/repo",
            |_| Ok(String::from("/workspace/repo/.git")),
            |_| panic!("fallback must not run for supported path format"),
        )
        .unwrap();

        assert_eq!(path, "/workspace/repo/.git");
    }

    #[test]
    fn falls_back_once_for_unsupported_path_format_and_caches_the_host_result() {
        let cache = GitCapabilityCache::new();
        let preferred_calls = Arc::new(Mutex::new(0));
        let fallback_calls = Arc::new(Mutex::new(0));
        let preferred_calls_for_run = Arc::clone(&preferred_calls);
        let fallback_calls_for_run = Arc::clone(&fallback_calls);

        let first = resolve_repository_git_dir(
            &cache,
            &ExecutionTarget::WindowsNative,
            r"C:\repo",
            move |_| {
                *preferred_calls_for_run.lock().unwrap() += 1;
                Err(GitRepositoryCommandError {
                    code: Some(129),
                    stderr: String::from("unknown option --path-format"),
                    stdout: String::new(),
                })
            },
            move |_| {
                *fallback_calls_for_run.lock().unwrap() += 1;
                Ok(String::from(".git"))
            },
        )
        .unwrap();
        let second = resolve_repository_git_dir(
            &cache,
            &ExecutionTarget::WindowsNative,
            r"C:\repo",
            |_| panic!("cached unsupported capability must skip preferred command"),
            |_| Ok(String::from(".git")),
        )
        .unwrap();

        assert_eq!(first, r"C:\repo\.git");
        assert_eq!(second, r"C:\repo\.git");
        assert_eq!(*preferred_calls.lock().unwrap(), 1);
        assert_eq!(*fallback_calls.lock().unwrap(), 1);
    }

    #[test]
    fn treats_a_legacy_relative_path_as_target_specific_without_rewriting_absolute_paths() {
        assert_eq!(
            super::resolve_legacy_git_dir(&ExecutionTarget::WindowsNative, r"C:\repo", ".git"),
            r"C:\repo\.git"
        );
        assert_eq!(
            super::resolve_legacy_git_dir(
                &ExecutionTarget::Ssh {
                    host: String::from("build.example")
                },
                "/srv/repo",
                "/srv/repo/.git",
            ),
            "/srv/repo/.git"
        );
    }
}

use crate::git_capability::{GitCapability, GitCapabilityCache, GitCapabilityRunError};
use crate::ExecutionTarget;

pub const REV_PARSE_PATH_FORMAT_ARGS: &[&str] =
    &["rev-parse", "--path-format=absolute", "--git-dir"];
pub const REV_PARSE_LEGACY_ARGS: &[&str] = &["rev-parse", "--git-dir"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRepositoryCommandError {
    pub code: Option<i32>,
    pub stderr: String,
    pub stdout: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRepositoryPathError {
    Command(GitCapabilityRunError<GitRepositoryCommandError>),
}

pub fn resolve_repository_git_dir<P, F>(
    cache: &GitCapabilityCache,
    target: &ExecutionTarget,
    repo_path: &str,
    run_preferred: P,
    run_fallback: F,
) -> Result<String, GitRepositoryPathError>
where
    P: Fn(&[&str]) -> Result<String, GitRepositoryCommandError>,
    F: Fn(&[&str]) -> Result<String, GitRepositoryCommandError>,
{
    let output = cache
        .run_with_fallback(
            GitCapability::RevParsePathFormat,
            || {
                let output = run_preferred(REV_PARSE_PATH_FORMAT_ARGS)?;
                if has_unsupported_path_format_echo(&output) {
                    return Err(GitRepositoryCommandError {
                        code: Some(129),
                        stderr: String::from("unsupported --path-format"),
                        stdout: output,
                    });
                }
                Ok(output)
            },
            || run_fallback(REV_PARSE_LEGACY_ARGS),
            is_unsupported_path_format_error,
        )
        .map_err(GitRepositoryPathError::Command)?;
    Ok(resolve_legacy_git_dir(target, repo_path, output.trim()))
}

pub fn resolve_legacy_git_dir(target: &ExecutionTarget, repo_path: &str, git_dir: &str) -> String {
    if is_absolute_target_path(target, git_dir) {
        return git_dir.to_string();
    }
    let separator = match target {
        ExecutionTarget::WindowsNative => '\\',
        ExecutionTarget::Wsl2 { .. } | ExecutionTarget::Ssh { .. } => '/',
    };
    let base = repo_path.trim_end_matches(['/', '\\']);
    let relative = git_dir.trim_start_matches(['/', '\\']);
    if base.is_empty() {
        return relative.to_string();
    }
    format!("{base}{separator}{relative}")
}

fn has_unsupported_path_format_echo(output: &str) -> bool {
    output
        .lines()
        .any(|line| line.trim_start().starts_with("--path-format"))
}

fn is_unsupported_path_format_error(error: &GitRepositoryCommandError) -> bool {
    if error.code == Some(129) {
        return true;
    }
    let stderr = error.stderr.to_ascii_lowercase();
    (stderr.contains("unknown option")
        || stderr.contains("invalid option")
        || stderr.contains("unrecognized option"))
        && stderr.contains("path-format")
}

fn is_absolute_target_path(target: &ExecutionTarget, path: &str) -> bool {
    match target {
        ExecutionTarget::WindowsNative => {
            path.starts_with(r"\\")
                || (path.as_bytes().get(1) == Some(&b':')
                    && path
                        .as_bytes()
                        .get(2)
                        .is_some_and(|byte| *byte == b'/' || *byte == b'\\'))
        }
        ExecutionTarget::Wsl2 { .. } | ExecutionTarget::Ssh { .. } => path.starts_with('/'),
    }
}
