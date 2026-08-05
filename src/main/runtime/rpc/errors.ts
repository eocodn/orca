// Why: every RPC response needs the same runtimeId envelope, and the
// runtime/browser error allowlists define the contract the CLI relies on to
// format human-facing messages. Centralizing this mapping keeps the allowlist
// auditable in one place instead of spread across per-method branches.
import type { RpcEnvelopeMeta, RpcFailure, RpcSuccess } from './core'
import { LINEAR_ERROR_CODES } from '../../../shared/linear-agent-access'
import { AGENT_SESSION_RPC_ERROR_CODES } from '../../../shared/agent-session-host-authority'

export function successResponse(id: string, meta: RpcEnvelopeMeta, result: unknown): RpcSuccess {
  return {
    id,
    ok: true,
    result,
    _meta: meta
  }
}

export function errorResponse(
  id: string,
  meta: RpcEnvelopeMeta,
  code: string,
  message: string,
  data?: unknown
): RpcFailure {
  return {
    id,
    ok: false,
    error: data === undefined ? { code, message } : { code, message, data },
    _meta: meta
  }
}

// Why: the OrcaRuntimeService throws plain Error objects whose `message` is
// actually a stable error code. This allowlist is the contract the CLI relies
// on — expanding or renaming entries without updating the CLI would silently
// change user-visible error codes.
const RUNTIME_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'runtime_unavailable',
  'selector_not_found',
  'selector_ambiguous',
  'terminal_handle_stale',
  'terminal_not_writable',
  'terminal_exited',
  'terminal_gone',
  'terminal_incarnation_stale',
  'terminal_incarnation_unavailable',
  'terminal_not_running',
  'terminal_resize_failed',
  'terminal_resize_unconfirmed',
  'terminal_resize_mismatch',
  'terminal_size_read_failed',
  'stale_generation',
  'invalid_transition',
  'terminal_not_found',
  'invalid_terminal_output_sequence',
  'generation_overflow',
  'request_id_conflict',
  'invalid_terminal_dimensions',
  'no_connected_pty',
  'session_revision_unavailable',
  'session_snapshot_unstable',
  'session_persistence_unavailable',
  'session_flush_raced',
  'persistence_writes_frozen',
  'terminal_tab_close_timeout',
  'terminal_tab_not_found',
  'terminal_tab_pinned',
  'no_active_terminal',
  'repo_not_found',
  'folder_workspace_operation_conflict',
  'folder_workspace_operation_id_invalid',
  'folder_workspace_persistence_busy',
  'folder_workspace_project_group_not_found',
  'folder_workspace_not_found',
  'folder_workspace_path_missing',
  'folder_workspace_path_not_directory',
  'folder_workspace_path_scope_not_found',
  'folder_workspace_path_unavailable',
  'folder_workspace_connection_ambiguous',
  'timeout',
  'invalid_limit',
  'remote_update_manual_required',
  'remote_update_not_available',
  'remote_update_not_downloaded',
  ...AGENT_SESSION_RPC_ERROR_CODES
])

const LINEAR_PASSTHROUGH_CODES: ReadonlySet<string> = new Set(LINEAR_ERROR_CODES)
const RUNTIME_DETAIL_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'folder_workspace_path_missing',
  'folder_workspace_path_not_directory',
  'folder_workspace_path_unavailable',
  'folder_workspace_connection_ambiguous'
])
const STRUCTURED_RUNTIME_PASSTHROUGH_CODES: ReadonlySet<string> = new Set([
  'worktree_id_requires_full_path',
  'run_not_found',
  'run_required',
  'stable_pane_required',
  'consumer_fenced',
  'task_not_found',
  'task_not_startable',
  'dispatch_not_found',
  'dispatch_run_mismatch',
  'dispatch_inactive',
  'worker_identity_changed',
  'cursor_invalid',
  'cursor_dispatch_mismatch',
  'source_changed',
  'transcript_required',
  'server_required',
  'worktree_not_found_on_server',
  'resource_server_mismatch',
  'peer_changed',
  'remote_runtime_unavailable',
  'runtime_timeout',
  'invalid_runtime_response',
  'capability_unsupported',
  'relay_quota_exceeded',
  'dispatch_capability_invalid',
  'agent_unconfigured',
  'terminal_worktree_mismatch',
  'request_mismatch',
  'mutation_ledger_full',
  'legacy_read_only',
  'orchestration_migration_required',
  'operation_unknown',
  'question_not_found',
  'answer_conflict',
  'stale_delivery',
  'waiter_exists',
  'invalid_argument'
])

export function mapRuntimeError(id: string, meta: RpcEnvelopeMeta, error: unknown): RpcFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('LINEAGE_')
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    LINEAR_PASSTHROUGH_CODES.has((error as { code: string }).code)
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    STRUCTURED_RUNTIME_PASSTHROUGH_CODES.has((error as { code: string }).code)
  ) {
    return errorResponse(
      id,
      meta,
      (error as { code: string }).code,
      message,
      (error as { data?: unknown }).data
    )
  }
  if (RUNTIME_PASSTHROUGH_CODES.has(message)) {
    return errorResponse(id, meta, message, message)
  }
  const detailSeparator = message.indexOf(':')
  const detailCode = detailSeparator > 0 ? message.slice(0, detailSeparator) : ''
  if (RUNTIME_DETAIL_PASSTHROUGH_CODES.has(detailCode)) {
    return errorResponse(id, meta, detailCode, message)
  }
  if (message === 'invalid_terminal_send') {
    return errorResponse(id, meta, 'invalid_argument', 'Missing terminal send payload')
  }
  return errorResponse(id, meta, 'runtime_error', message)
}

// Preserve structured browser error codes so callers can distinguish missing
// pages, closed tabs, and navigation failures from generic runtime errors.
export function mapBrowserError(id: string, meta: RpcEnvelopeMeta, error: unknown): RpcFailure {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return errorResponse(id, meta, (error as { code: string }).code, error.message)
  }
  return mapRuntimeError(id, meta, error)
}
