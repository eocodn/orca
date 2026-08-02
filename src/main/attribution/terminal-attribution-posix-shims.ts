// Generated shell scripts are isolated so the runtime attribution module only owns environment setup.
const SHELL_DOLLAR = "$"

export const POSIX_COMMON = String.raw`#!/usr/bin/env bash
set -euo pipefail

clean_path() {
  local current_path="${SHELL_DOLLAR}{PATH:-}"
  local script_dir
  script_dir="$(cd -- "$(dirname "${SHELL_DOLLAR}{BASH_SOURCE[0]}")" && pwd)"
  local cleaned=()
  local entry
  IFS=':' read -r -a entries <<<"$current_path"
  for entry in "${SHELL_DOLLAR}{entries[@]}"; do
    case "$entry" in
      "$script_dir"|*/orca-terminal-attribution/posix|*/orca-terminal-attribution/win32|*\\orca-terminal-attribution\\posix|*\\orca-terminal-attribution\\win32)
        ;;
      *)
        cleaned+=("$entry")
        ;;
    esac
  done
  (IFS=':'; printf '%s' "${SHELL_DOLLAR}{cleaned[*]:-}")
}
`

export const POSIX_GIT_WRAPPER = `${POSIX_COMMON}
real_path="$(clean_path)"
real_git="$(PATH="$real_path" command -v git || true)"
if [[ -z "$real_git" ]]; then
  echo "Orca attribution wrapper could not locate git on PATH." >&2
  exit 127
fi

is_commit_command() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -c|--config|-C|--git-dir|--work-tree|--namespace)
        shift 2
        ;;
      --config=*|--git-dir=*|--work-tree=*|--namespace=*)
        shift
        ;;
      commit)
        return 0
        ;;
      -*)
        shift
        ;;
      *)
        return 1
        ;;
    esac
  done
  return 1
}

if [[ "\${ORCA_ENABLE_GIT_ATTRIBUTION:-0}" != "1" || "\${ORCA_ATTRIBUTION_BYPASS:-0}" == "1" ]] || ! is_commit_command "$@"; then
  PATH="$real_path" exec "$real_git" "$@"
fi

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      PATH="$real_path" exec "$real_git" "$@"
      ;;
  esac
done

trailer="\${ORCA_GIT_COMMIT_TRAILER:-Co-authored-by: Orca <help@stably.ai>}"

has_explicit_commit_message() {
  local arg
  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      -m|--message|-F|--file)
        return 0
        ;;
      --message=*|--file=*|-[!-]*m|-m?*|-F?*)
        return 0
        ;;
    esac
    shift
  done
  return 1
}

has_unsupported_commit_message_source() {
  local arg next_arg
  local saw_commit=0
  while [[ $# -gt 0 ]]; do
    arg="$1"
    if [[ $saw_commit -eq 0 ]]; then
      case "$arg" in
        -c|--config|-C|--git-dir|--work-tree|--namespace)
          shift 2
          continue
          ;;
        --config=*|--git-dir=*|--work-tree=*|--namespace=*)
          shift
          continue
          ;;
        commit)
          saw_commit=1
          shift
          continue
          ;;
      esac
    fi
    case "$arg" in
      -C|--reuse-message|-c|--reedit-message|--fixup|--squash)
        return 0
        ;;
      -F|--file)
        shift
        next_arg="${SHELL_DOLLAR}{1:-}"
        [[ -z "$next_arg" || ! -f "$next_arg" ]] && return 0
        ;;
      --file=*)
        next_arg="${SHELL_DOLLAR}{arg#--file=}"
        [[ ! -f "$next_arg" ]] && return 0
        ;;
      -F?*)
        next_arg="${SHELL_DOLLAR}{arg:2}"
        [[ ! -f "$next_arg" ]] && return 0
        ;;
    esac
    shift
  done
  return 1
}

message_already_has_trailer() {
  local arg next_arg
  while [[ $# -gt 0 ]]; do
    arg="$1"
    case "$arg" in
      -m|--message)
        shift
        next_arg="${SHELL_DOLLAR}{1:-}"
        grep -Fqi "$trailer" <<<"$next_arg" && return 0
        ;;
      --message=*)
        grep -Fqi "$trailer" <<<"${SHELL_DOLLAR}{arg#--message=}" && return 0
        ;;
      -m?*)
        grep -Fqi "$trailer" <<<"${SHELL_DOLLAR}{arg:2}" && return 0
        ;;
      -[!-]*m)
        shift
        next_arg="${SHELL_DOLLAR}{1:-}"
        grep -Fqi "$trailer" <<<"$next_arg" && return 0
        ;;
      -F|--file)
        shift
        next_arg="${SHELL_DOLLAR}{1:-}"
        [[ -n "$next_arg" && -f "$next_arg" ]] && grep -Fqi "$trailer" "$next_arg" && return 0
        ;;
      --file=*)
        next_arg="${SHELL_DOLLAR}{arg#--file=}"
        [[ -f "$next_arg" ]] && grep -Fqi "$trailer" "$next_arg" && return 0
        ;;
      -F?*)
        next_arg="${SHELL_DOLLAR}{arg:2}"
        [[ -f "$next_arg" ]] && grep -Fqi "$trailer" "$next_arg" && return 0
        ;;
    esac
    shift
  done
  return 1
}

if ! has_explicit_commit_message "$@" || has_unsupported_commit_message_source "$@" || message_already_has_trailer "$@"; then
  PATH="$real_path" exec "$real_git" "$@"
fi

tmp_file=""
cleanup_commit_message() {
  if [[ -n "$tmp_file" ]]; then
    rm -f "$tmp_file"
  fi
}
trap cleanup_commit_message EXIT

attributed_args=()
replaced_file_message=0
while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    -F|--file)
      if [[ $replaced_file_message -eq 0 ]]; then
        shift
        source_file="${SHELL_DOLLAR}{1:-}"
        tmp_file="$(mktemp)"
        if [[ -n "$source_file" && -f "$source_file" ]]; then
          printf '%s\n\n%s\n' "$(cat "$source_file")" "$trailer" >"$tmp_file"
          attributed_args+=("$arg" "$tmp_file")
          replaced_file_message=1
        else
          attributed_args+=("$arg" "$source_file")
        fi
      else
        attributed_args+=("$arg")
      fi
      ;;
    --file=*)
      if [[ $replaced_file_message -eq 0 ]]; then
        source_file="${SHELL_DOLLAR}{arg#--file=}"
        tmp_file="$(mktemp)"
        if [[ -f "$source_file" ]]; then
          printf '%s\n\n%s\n' "$(cat "$source_file")" "$trailer" >"$tmp_file"
          attributed_args+=("--file=$tmp_file")
          replaced_file_message=1
        else
          attributed_args+=("$arg")
        fi
      else
        attributed_args+=("$arg")
      fi
      ;;
    -F?*)
      if [[ $replaced_file_message -eq 0 ]]; then
        source_file="${SHELL_DOLLAR}{arg:2}"
        tmp_file="$(mktemp)"
        if [[ -f "$source_file" ]]; then
          printf '%s\n\n%s\n' "$(cat "$source_file")" "$trailer" >"$tmp_file"
          attributed_args+=("-F$tmp_file")
          replaced_file_message=1
        else
          attributed_args+=("$arg")
        fi
      else
        attributed_args+=("$arg")
      fi
      ;;
    *)
      attributed_args+=("$arg")
      ;;
  esac
  shift
done

if [[ $replaced_file_message -eq 0 ]]; then
  attributed_args+=("-m" "$trailer")
fi

# Why: commit-msg hooks and commit signing must see the final message. Only
# commands that already provide a noninteractive message get attribution; editor
# based commits pass through unchanged instead of being amended after success.
ORCA_ATTRIBUTION_BYPASS=1 PATH="$real_path" exec "$real_git" "${SHELL_DOLLAR}{attributed_args[@]}"
`

export const POSIX_GH_WRAPPER = `${POSIX_COMMON}
real_path="$(clean_path)"
real_gh="$(PATH="$real_path" command -v gh || true)"
if [[ -z "$real_gh" ]]; then
  echo "Orca attribution wrapper could not locate gh on PATH." >&2
  exit 127
fi

append_footer() {
  local kind="$1"
  local url_pattern="$2"
  local footer="$3"
  local stdout_capture="$4"
  local stderr_capture="$5"
  local url=""

  url="$(printf '%s\n%s\n' "$stdout_capture" "$stderr_capture" | grep -Eo "$url_pattern" | tail -n 1 || true)"
  append_footer_url "$kind" "$footer" "$url"
}

append_footer_url() {
  local kind="$1"
  local footer="$2"
  local url="$3"

  if [[ -z "$url" ]]; then
    return 0
  fi

  local api_path
  api_path="$(github_api_path "$kind" "$url" || true)"
  if [[ -z "$api_path" ]]; then
    return 0
  fi

  local body
  if ! body="$(PATH="$real_path" "$real_gh" api "$api_path" --jq '.body // ""' 2>/dev/null)"; then
    return 0
  fi
  if grep -Fqi "$footer" <<<"$body"; then
    return 0
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if [[ -n "$body" ]]; then
    printf '%s\n\n%s\n' "$body" "$footer" >"$tmp_file"
  else
    printf '%s\n' "$footer" >"$tmp_file"
  fi
  # Why: gh exposes create output as a URL, but does not provide a transactional
  # body append. Use REST instead of gh pr/issue edit because those commands can
  # hit unrelated GraphQL fields, while the URL maps directly to one REST item.
  PATH="$real_path" "$real_gh" api -X PATCH "$api_path" -F "body=@$tmp_file" >/dev/null || true
  rm -f "$tmp_file"
}

github_api_path() {
  local kind="$1"
  local url="$2"
  if [[ "$kind" == "pr" && "$url" =~ ^https://github[.]com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    printf 'repos/%s/%s/pulls/%s' "${SHELL_DOLLAR}{BASH_REMATCH[1]}" "${SHELL_DOLLAR}{BASH_REMATCH[2]}" "${SHELL_DOLLAR}{BASH_REMATCH[3]}"
    return 0
  fi
  if [[ "$kind" == "issue" && "$url" =~ ^https://github[.]com/([^/]+)/([^/]+)/issues/([0-9]+) ]]; then
    printf 'repos/%s/%s/issues/%s' "${SHELL_DOLLAR}{BASH_REMATCH[1]}" "${SHELL_DOLLAR}{BASH_REMATCH[2]}" "${SHELL_DOLLAR}{BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}

has_noninteractive_create_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --title|-t|--title=*|--body|-b|--body=*|--body-file|-F|--body-file=*|--fill|--fill-first|--fill-verbose|--template|-T|--template=*|--recover|--recover=*|--web)
        return 0
        ;;
    esac
  done
  return 1
}

has_passthrough_create_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --help|-h|--version)
        return 0
        ;;
    esac
  done
  return 1
}

if [[ "\${ORCA_ENABLE_GIT_ATTRIBUTION:-0}" != "1" || "\${ORCA_ATTRIBUTION_BYPASS:-0}" == "1" ]]; then
  PATH="$real_path" exec "$real_gh" "$@"
fi

if [[ "\${1:-}" == "pr" && "\${2:-}" == "create" ]]; then
  footer="\${ORCA_GH_PR_FOOTER:-Made with [Orca](https://github.com/stablyai/orca) 🐋}"
  if has_passthrough_create_args "$@"; then
    PATH="$real_path" exec "$real_gh" "$@"
  fi
  if ! has_noninteractive_create_args "$@"; then
    # Why: gh switches off interactive prompts when stdout/stderr are redirected,
    # and post-create "pr view" can select the wrong PR in fork/multi-PR cases.
    # Preserve interactive UX and skip attribution rather than guessing.
    PATH="$real_path" exec "$real_gh" "$@"
  fi
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"
  cleanup_capture() {
    rm -f "$stdout_file" "$stderr_file"
  }
  trap cleanup_capture EXIT
  if PATH="$real_path" "$real_gh" "$@" >"$stdout_file" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  stdout_capture="$(cat "$stdout_file")"
  stderr_capture="$(cat "$stderr_file")"
  cat "$stderr_file" >&2
  cat "$stdout_file"
  if [[ $status -eq 0 ]]; then
    append_footer "pr" 'https://github.com/[^[:space:]]+/pull/[0-9]+' "$footer" "$stdout_capture" "$stderr_capture"
  fi
  cleanup_capture
  trap - EXIT
  exit $status
fi

if [[ "\${1:-}" == "issue" && "\${2:-}" == "create" ]]; then
  footer="\${ORCA_GH_ISSUE_FOOTER:-Made with [Orca](https://github.com/stablyai/orca) 🐋}"
  if has_passthrough_create_args "$@"; then
    PATH="$real_path" exec "$real_gh" "$@"
  fi
  if ! has_noninteractive_create_args "$@"; then
    # Why: gh issue create also requires a live TTY for prompts, but gh has no
    # current-issue lookup equivalent to "pr view". Do not guess with issue list:
    # that can edit an unrelated issue if the command printed no URL.
    PATH="$real_path" exec "$real_gh" "$@"
  fi
  stdout_file="$(mktemp)"
  stderr_file="$(mktemp)"
  cleanup_capture() {
    rm -f "$stdout_file" "$stderr_file"
  }
  trap cleanup_capture EXIT
  if PATH="$real_path" "$real_gh" "$@" >"$stdout_file" 2>"$stderr_file"; then
    status=0
  else
    status=$?
  fi
  stdout_capture="$(cat "$stdout_file")"
  stderr_capture="$(cat "$stderr_file")"
  cat "$stderr_file" >&2
  cat "$stdout_file"
  if [[ $status -eq 0 ]]; then
    append_footer "issue" 'https://github.com/[^[:space:]]+/issues/[0-9]+' "$footer" "$stdout_capture" "$stderr_capture"
  fi
  cleanup_capture
  trap - EXIT
  exit $status
fi

PATH="$real_path" exec "$real_gh" "$@"
`

const WIN32_GIT_CMD_WRAPPER = String.raw`@echo off
