import type {
  GlobalSettings,
  LinearCollectionResult,
  LinearIssue,
  LinearProjectDetail,
  LinearViewer
} from '../../../shared/types'
import {
  getActiveRuntimeTarget
} from './runtime-rpc-client'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'

export type RuntimeLinearSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | TaskSourceContext
  | null
  | undefined

// Why: mixed-version remotes must not look like an empty filtered result. The
// Linear store swallows most read failures; this typed error is rethrown so UI
// can show an upgrade message instead of "no matching issues".
export class LinearIssueAttributeFilterUnsupportedError extends Error {
  constructor(message = 'This remote runtime must be updated to filter Linear issues.') {
    super(message)
    this.name = 'LinearIssueAttributeFilterUnsupportedError'
  }
}

export function isLinearIssueAttributeFilterUnsupportedError(
  error: unknown
): error is LinearIssueAttributeFilterUnsupportedError {
  return error instanceof LinearIssueAttributeFilterUnsupportedError
}

export type LinearIssueFilter = 'assigned' | 'created' | 'all' | 'completed'
export type LinearConnectResult = { ok: true; viewer: LinearViewer } | { ok: false; error: string }
export type LinearCreateIssueResult =
  | { ok: true; id: string; identifier: string; title: string; url: string }
  | { ok: false; error: string }
export type LinearCreateProjectResult =
  | { ok: true; project: LinearProjectDetail }
  | { ok: false; error: string }
export type LinearMutationResult = { ok: true } | { ok: false; error: string }
export type LinearCommentResult = { ok: true; id: string } | { ok: false; error: string }
export type LinearReadOptions = { force?: boolean }

export function linearReadForce(options?: LinearReadOptions): { force: true } | {} {
  return options?.force ? { force: true } : {}
}

function isTaskSourceRuntimeSettings(
  settings: RuntimeLinearSettings
): settings is TaskSourceContext {
  return settings !== null && settings !== undefined && 'kind' in settings
}

export function getLinearRuntimeTarget(
  settings: RuntimeLinearSettings
): ReturnType<typeof getActiveRuntimeTarget> {
  // Why: task source context makes provider ownership explicit; legacy callers
  // still pass focused runtime settings until Tasks finishes migrating.
  return getActiveRuntimeTarget(
    isTaskSourceRuntimeSettings(settings) ? getTaskSourceRuntimeSettings(settings) : settings
  )
}

export function normalizeLinearIssueCollectionResult(
  result: unknown
): LinearCollectionResult<LinearIssue> {
  if (Array.isArray(result)) {
    return { items: result as LinearIssue[] }
  }
  if (!result || typeof result !== 'object') {
    return { items: [] }
  }
  const collection = result as Partial<LinearCollectionResult<LinearIssue>>
  if (!Array.isArray(collection.items)) {
    return { items: [] }
  }
  return {
    items: collection.items,
    ...(Array.isArray(collection.errors) ? { errors: collection.errors } : {}),
    ...(typeof collection.hasMore === 'boolean' ? { hasMore: collection.hasMore } : {})
  }
}
