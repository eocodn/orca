import type {
  GitBranchCompareResult,
  GitCommitCompareResult,
  GitConflictOperation,
  GitDiffResult,
  GitPushTarget,
  GitStagingArea,
  GitStatusResult,
  GitUpstreamStatus
} from '../../../shared/types'
import type { GitHistoryOptions, GitHistoryResult } from '../../../shared/git-history'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-context'
import { getClientRuntime } from './client-runtime'

let nextGitStatusRequestToken = 0

function createGitStatusAbortError(): Error {
  const error = new Error('Git status request aborted')
  error.name = 'AbortError'
  return error
}

async function callLocalGitStatus(
  args: Parameters<Window['api']['git']['status']>[0],
  signal?: AbortSignal
): Promise<GitStatusResult> {
  if (!signal) {
    return getClientRuntime().git.status(args)
  }
  if (signal.aborted) {
    throw createGitStatusAbortError()
  }
  const requestToken = `git-status-${Date.now()}-${++nextGitStatusRequestToken}`
  const cancel = (): void => {
    void getClientRuntime()
      .git.cancelStatus({ requestToken })
      .catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const status = await getClientRuntime().git.status({ ...args, requestToken })
    // Why: cancel is best-effort; a scan that finished after abort must still
    // reject so callers never treat a cancelled request as a fresh result.
    if (signal.aborted) {
      throw createGitStatusAbortError()
    }
    return status
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export async function getRuntimeGitStatus(
  context: RuntimeGitContext,
  options?: {
    includeIgnored?: boolean
    bypassEffectiveUpstreamNegativeCache?: boolean
    reuseLineStats?: boolean
    signal?: AbortSignal
  }
): Promise<GitStatusResult> {
  const target = getActiveRuntimeTarget(context.settings)
  const includeIgnoredArgs = options?.includeIgnored ? { includeIgnored: true } : {}
  const upstreamCacheBypassArgs = options?.bypassEffectiveUpstreamNegativeCache
    ? { bypassEffectiveUpstreamNegativeCache: true }
    : {}
  const lineStatsReuseArgs = options?.reuseLineStats ? { reuseLineStats: true } : {}
  if (target.kind === 'local' || !context.worktreeId) {
    return callLocalGitStatus(
      {
        worktreePath: resolveLocalWorktreePath(context),
        connectionId: context.connectionId,
        ...includeIgnoredArgs,
        ...upstreamCacheBypassArgs,
        ...lineStatsReuseArgs
      },
      options?.signal
    )
  }
  return callRuntimeRpc<GitStatusResult>(
    target,
    'git.status',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      ...includeIgnoredArgs,
      ...upstreamCacheBypassArgs,
      ...lineStatsReuseArgs
    },
    {
      timeoutMs: 15_000,
      // Why: the steady safety refresh stays pooled; callers reject stale results and timeout bounds the request.
      ...(options?.reuseLineStats ? {} : { signal: options?.signal })
    }
  )
}

export async function getRuntimeGitSubmoduleStatus(
  context: RuntimeGitContext,
  submodulePath: string,
  area: GitStagingArea = 'unstaged'
): Promise<GitStatusResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.submoduleStatus({
      worktreePath: resolveLocalWorktreePath(context),
      submodulePath,
      connectionId: context.connectionId,
      area
    })
  }
  return callRuntimeRpc<GitStatusResult>(
    target,
    'git.submoduleStatus',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      submodulePath,
      area
    },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitIgnoredPaths(
  context: RuntimeGitContext,
  paths: string[]
): Promise<string[]> {
  const target = getActiveRuntimeTarget(context.settings)
  if (paths.length === 0) {
    return []
  }
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.checkIgnored({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId,
      paths
    })
  }
  return callRuntimeRpc<string[]>(
    target,
    'git.checkIgnored',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), paths },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitHistory(
  context: RuntimeGitContext,
  options: GitHistoryOptions = {}
): Promise<GitHistoryResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.history({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId,
      ...options
    })
  }
  return callRuntimeRpc<GitHistoryResult>(
    target,
    'git.history',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), ...options },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitConflictOperation(
  context: RuntimeGitContext
): Promise<GitConflictOperation> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.conflictOperation({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitConflictOperation>(
    target,
    'git.conflictOperation',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 15_000 }
  )
}

export async function abortRuntimeGitMerge(context: RuntimeGitContext): Promise<void> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    await getClientRuntime().git.abortMerge({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
    return
  }
  await callRuntimeRpc(
    target,
    'git.abortMerge',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 30_000 }
  )
}

export async function abortRuntimeGitRebase(context: RuntimeGitContext): Promise<void> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    await getClientRuntime().git.abortRebase({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
    return
  }
  await callRuntimeRpc(
    target,
    'git.abortRebase',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 30_000 }
  )
}

export async function getRuntimeGitDiff(
  context: RuntimeGitContext,
  args: { filePath: string; staged: boolean; compareAgainstHead?: boolean }
): Promise<GitDiffResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.diff({
      worktreePath: resolveLocalWorktreePath(context),
      filePath: args.filePath,
      staged: args.staged,
      compareAgainstHead: args.compareAgainstHead,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitDiffResult>(
    target,
    'git.diff',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), ...args },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitBranchCompare(
  context: RuntimeGitContext,
  baseRef: string
): Promise<GitBranchCompareResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.branchCompare({
      worktreePath: resolveLocalWorktreePath(context),
      baseRef,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitBranchCompareResult>(
    target,
    'git.branchCompare',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), baseRef },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitCommitCompare(
  context: RuntimeGitContext,
  commitId: string
): Promise<GitCommitCompareResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.commitCompare({
      worktreePath: resolveLocalWorktreePath(context),
      commitId,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<GitCommitCompareResult>(
    target,
    'git.commitCompare',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), commitId },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitUpstreamStatus(
  context: RuntimeGitContext,
  pushTarget?: GitPushTarget
): Promise<GitUpstreamStatus> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.upstreamStatus({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId,
      ...(pushTarget ? { pushTarget } : {})
    })
  }
  return callRuntimeRpc<GitUpstreamStatus>(
    target,
    'git.upstreamStatus',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      ...(pushTarget ? { pushTarget } : {})
    },
    { timeoutMs: 15_000 }
  )
}
