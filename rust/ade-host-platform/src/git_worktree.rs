#[cfg(test)]
mod contract_tests {
    use super::{run_worktree_list, GitWorktreeCommandError};
    use crate::git_capability::GitCapabilityCache;
    use std::sync::{Arc, Mutex};

    #[test]
    fn parses_line_delimited_worktree_porcelain_with_state_annotations() {
        let worktrees = super::parse_worktree_list(
            "worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/missing\nHEAD def\nlocked \"agent session\"\nprunable \"missing path\"\n",
            false,
        );

        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].path, "C:/repo");
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[0].branch.as_deref(), Some("refs/heads/main"));
        assert_eq!(worktrees[1].lock_reason.as_deref(), Some("agent session"));
        assert_eq!(
            worktrees[1].prunable_reason.as_deref(),
            Some("missing path")
        );
        assert!(!worktrees[1].is_main);
    }

    #[test]
    fn parses_nul_delimited_worktree_porcelain_without_splitting_path_newlines() {
        let worktrees = super::parse_worktree_list(
            "worktree /repo/with\nnewline\0HEAD abc\0branch refs/heads/feature\0\0",
            true,
        );

        assert_eq!(worktrees[0].path, "/repo/with\nnewline");
        assert_eq!(worktrees[0].head, "abc");
    }

    #[test]
    fn uses_cached_worktree_fallback_only_for_a_narrow_unsupported_error() {
        let cache = GitCapabilityCache::new();
        let preferred_calls = Arc::new(Mutex::new(0));
        let fallback_calls = Arc::new(Mutex::new(0));
        let preferred_calls_for_run = Arc::clone(&preferred_calls);
        let fallback_calls_for_run = Arc::clone(&fallback_calls);

        let first = run_worktree_list(
            &cache,
            move |_| {
                *preferred_calls_for_run.lock().unwrap() += 1;
                Err(GitWorktreeCommandError {
                    code: Some(129),
                    stderr: String::from("unknown option -z"),
                })
            },
            move |_| {
                *fallback_calls_for_run.lock().unwrap() += 1;
                Ok(String::from("worktree /repo\nHEAD abc\n\n"))
            },
        )
        .unwrap();
        let second = run_worktree_list(
            &cache,
            |_| panic!("cached unsupported capability must skip preferred command"),
            |_| Ok(String::from("worktree /repo\nHEAD abc\n\n")),
        )
        .unwrap();

        assert_eq!(first[0].path, "/repo");
        assert_eq!(second[0].path, "/repo");
        assert_eq!(*preferred_calls.lock().unwrap(), 1);
        assert_eq!(*fallback_calls.lock().unwrap(), 1);
    }
}

use crate::git_capability::{GitCapability, GitCapabilityCache, GitCapabilityRunError};
use serde::Serialize;

pub const WORKTREE_LIST_Z_ARGS: &[&str] = &["worktree", "list", "--porcelain", "-z"];
pub const WORKTREE_LIST_ARGS: &[&str] = &["worktree", "list", "--porcelain"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitWorktree {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub locked: bool,
    pub lock_reason: Option<String>,
    pub prunable: bool,
    pub prunable_reason: Option<String>,
    pub is_main: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitWorktreeCommandError {
    pub code: Option<i32>,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitWorktreeListError {
    Command(GitCapabilityRunError<GitWorktreeCommandError>),
}

pub fn run_worktree_list<P, F>(
    cache: &GitCapabilityCache,
    run_preferred: P,
    run_fallback: F,
) -> Result<Vec<GitWorktree>, GitWorktreeListError>
where
    P: Fn(&[&str]) -> Result<String, GitWorktreeCommandError>,
    F: Fn(&[&str]) -> Result<String, GitWorktreeCommandError>,
{
    let output = cache
        .run_with_fallback(
            GitCapability::WorktreeListZ,
            || run_preferred(WORKTREE_LIST_Z_ARGS),
            || run_fallback(WORKTREE_LIST_ARGS),
            is_unsupported_worktree_list_z_error,
        )
        .map_err(GitWorktreeListError::Command)?;
    Ok(parse_worktree_list(&output, output.contains('\0')))
}

pub fn parse_worktree_list(output: &str, nul_delimited: bool) -> Vec<GitWorktree> {
    let blocks = if nul_delimited && output.contains('\0') {
        split_nul_blocks(output)
    } else {
        split_line_blocks(output)
    };
    let mut worktrees = Vec::new();
    for fields in blocks {
        let mut path = None;
        let mut head = String::new();
        let mut branch = None;
        let mut is_bare = false;
        let mut locked = false;
        let mut lock_reason = None;
        let mut prunable = false;
        let mut prunable_reason = None;

        for field in fields {
            if let Some(value) = field.strip_prefix("worktree ") {
                path = Some(value.to_string());
            } else if let Some(value) = field.strip_prefix("HEAD ") {
                head = value.to_string();
            } else if let Some(value) = field.strip_prefix("branch ") {
                branch = Some(value.to_string());
            } else if field == "bare" {
                is_bare = true;
            } else if field == "locked" || field.starts_with("locked ") {
                locked = true;
                lock_reason = decode_annotation(field.strip_prefix("locked ").unwrap_or_default());
            } else if field == "prunable" || field.starts_with("prunable ") {
                prunable = true;
                prunable_reason =
                    decode_annotation(field.strip_prefix("prunable ").unwrap_or_default());
            }
        }

        if let Some(path) = path.filter(|value| !value.is_empty()) {
            worktrees.push(GitWorktree {
                path,
                head,
                branch,
                is_bare,
                locked,
                lock_reason,
                prunable,
                prunable_reason,
                is_main: worktrees.is_empty(),
            });
        }
    }
    worktrees
}

fn is_unsupported_worktree_list_z_error(error: &GitWorktreeCommandError) -> bool {
    if error.code == Some(129) {
        return true;
    }
    let stderr = error.stderr.to_ascii_lowercase();
    (stderr.contains("unknown option")
        || stderr.contains("invalid option")
        || stderr.contains("unrecognized option"))
        && (stderr.contains("-z") || stderr.contains(" z"))
}

fn split_line_blocks(output: &str) -> Vec<Vec<String>> {
    output
        .trim()
        .split("\n\n")
        .filter(|block| !block.trim().is_empty())
        .map(|block| {
            block
                .lines()
                .map(|line| line.trim_end_matches('\r').to_string())
                .collect()
        })
        .collect()
}

fn split_nul_blocks(output: &str) -> Vec<Vec<String>> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();
    for field in output.split('\0') {
        if field.is_empty() {
            if !current.is_empty() {
                blocks.push(std::mem::take(&mut current));
            }
        } else {
            current.push(field.to_string());
        }
    }
    if !current.is_empty() {
        blocks.push(current);
    }
    blocks
}

fn decode_annotation(value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    let value = value.strip_prefix('"').unwrap_or(value);
    let value = value.strip_suffix('"').unwrap_or(value);
    let mut decoded = Vec::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(character) = chars.next() {
        if character != '\\' {
            decoded.extend(character.to_string().as_bytes());
            continue;
        }
        let Some(escaped) = chars.next() else {
            decoded.push(b'\\');
            break;
        };
        match escaped {
            'n' => decoded.push(b'\n'),
            'r' => decoded.push(b'\r'),
            't' => decoded.push(b'\t'),
            '\\' => decoded.push(b'\\'),
            '"' => decoded.push(b'"'),
            digit if ('0'..='7').contains(&digit) => {
                let mut octal = String::from(digit);
                for _ in 0..2 {
                    let Some(next) = chars.clone().next() else {
                        break;
                    };
                    if !('0'..='7').contains(&next) {
                        break;
                    }
                    chars.next();
                    octal.push(next);
                }
                decoded.push(u8::from_str_radix(&octal, 8).unwrap_or(b'?'));
            }
            other => {
                decoded.push(b'\\');
                decoded.extend(other.to_string().as_bytes());
            }
        }
    }
    Some(String::from_utf8_lossy(&decoded).into_owned())
}
