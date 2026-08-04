import type { GitDiffResult } from '../../../shared/types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { resolveLocalWorktreePath, type RuntimeGitContext } from './runtime-git-context'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { getClientRuntime } from './client-runtime'

export async function getRuntimeGitRemoteFileUrl(
  context: RuntimeGitContext,
  args: { relativePath: string; line: number }
): Promise<string | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.remoteFileUrl({
      worktreePath: resolveLocalWorktreePath(context),
      relativePath: args.relativePath,
      line: args.line,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<string | null>(
    target,
    'git.remoteFileUrl',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      relativePath: args.relativePath,
      line: args.line
    },
    { timeoutMs: 15_000 }
  )
}

export async function getRuntimeGitRemoteCommitUrl(
  context: RuntimeGitContext,
  args: { sha: string }
): Promise<string | null> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.remoteCommitUrl({
      worktreePath: resolveLocalWorktreePath(context),
      sha: args.sha,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<string | null>(
    target,
    'git.remoteCommitUrl',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      sha: args.sha
    },
    { timeoutMs: 15_000 }
  )
}
