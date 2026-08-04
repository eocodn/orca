import { getRepoIdFromWorktreeId } from '../../../shared/worktree-id'
import type {
  RuntimeGenerateCommitMessageOverrides,
  RuntimeGenerateCommitMessageResult,
  RuntimeGeneratePullRequestFieldsOverrides,
  RuntimeGeneratePullRequestFieldsResult,
  RuntimeDiscoverCommitMessageModelsResult,
  RuntimeGitContext,
  RuntimePullRequestGenerationInput
} from './runtime-git-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { resolveLocalWorktreePath, getRuntimeCommitMessageSettings } from './runtime-git-context'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { getClientRuntime } from './client-runtime'

export async function generateRuntimeCommitMessage(
  context: RuntimeGitContext,
  overrides?: RuntimeGenerateCommitMessageOverrides
): Promise<RuntimeGenerateCommitMessageResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.generateCommitMessage({
      worktreePath: resolveLocalWorktreePath(context),
      // Why: raw id — the `::workspace:<uuid>` suffix is part of the worktree meta key.
      ...(context.worktreeId ? { worktreeId: context.worktreeId } : {}),
      repoId: context.worktreeId ? getRepoIdFromWorktreeId(context.worktreeId) : undefined,
      connectionId: context.connectionId,
      ...(overrides?.sourceControlAiResolvedParams
        ? { sourceControlAiResolvedParams: overrides.sourceControlAiResolvedParams }
        : {}),
      ...(overrides?.sourceControlAi ? { sourceControlAi: overrides.sourceControlAi } : {}),
      ...(overrides?.agentCmdOverrides ? { agentCmdOverrides: overrides.agentCmdOverrides } : {})
    }) as Promise<RuntimeGenerateCommitMessageResult>
  }
  return callRuntimeRpc<RuntimeGenerateCommitMessageResult>(
    target,
    'git.generateCommitMessage',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      ...getRuntimeCommitMessageSettings(context.settings, context.connectionId),
      ...(overrides?.sourceControlAiResolvedParams
        ? { sourceControlAiResolvedParams: overrides.sourceControlAiResolvedParams }
        : {}),
      ...(overrides?.sourceControlAi ? { sourceControlAi: overrides.sourceControlAi } : {}),
      ...(overrides?.agentCmdOverrides ? { agentCmdOverrides: overrides.agentCmdOverrides } : {})
    },
    { timeoutMs: 75_000 }
  )
}

export async function discoverRuntimeCommitMessageModels(
  context: RuntimeGitContext,
  agentId: string
): Promise<RuntimeDiscoverCommitMessageModelsResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.discoverCommitMessageModels({
      agentId,
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    }) as Promise<RuntimeDiscoverCommitMessageModelsResult>
  }
  return callRuntimeRpc<RuntimeDiscoverCommitMessageModelsResult>(
    target,
    'git.discoverCommitMessageModels',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      agentId,
      ...(context.settings?.agentCmdOverrides
        ? { agentCmdOverrides: context.settings.agentCmdOverrides }
        : {})
    },
    { timeoutMs: 75_000 }
  )
}

export async function cancelRuntimeGenerateCommitMessage(
  context: RuntimeGitContext
): Promise<void> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    await getClientRuntime().git.cancelGenerateCommitMessage({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
    return
  }
  await callRuntimeRpc(
    target,
    'git.cancelGenerateCommitMessage',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 5_000 }
  )
}

export async function generateRuntimePullRequestFields(
  context: RuntimeGitContext,
  input: RuntimePullRequestGenerationInput,
  overrides?: RuntimeGeneratePullRequestFieldsOverrides
): Promise<RuntimeGeneratePullRequestFieldsResult> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    return getClientRuntime().git.generatePullRequestFields({
      worktreePath: resolveLocalWorktreePath(context),
      // Why: raw id — the `::workspace:<uuid>` suffix is part of the worktree meta key.
      ...(context.worktreeId ? { worktreeId: context.worktreeId } : {}),
      repoId: context.worktreeId ? getRepoIdFromWorktreeId(context.worktreeId) : undefined,
      connectionId: context.connectionId,
      ...input,
      ...(overrides?.sourceControlAiResolvedParams
        ? { sourceControlAiResolvedParams: overrides.sourceControlAiResolvedParams }
        : {}),
      ...(overrides?.sourceControlAi ? { sourceControlAi: overrides.sourceControlAi } : {}),
      ...(overrides?.agentCmdOverrides ? { agentCmdOverrides: overrides.agentCmdOverrides } : {})
    }) as Promise<RuntimeGeneratePullRequestFieldsResult>
  }
  return callRuntimeRpc<RuntimeGeneratePullRequestFieldsResult>(
    target,
    'git.generatePullRequestFields',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      ...input,
      ...getRuntimeCommitMessageSettings(context.settings, context.connectionId),
      ...(overrides?.sourceControlAiResolvedParams
        ? { sourceControlAiResolvedParams: overrides.sourceControlAiResolvedParams }
        : {}),
      ...(overrides?.sourceControlAi ? { sourceControlAi: overrides.sourceControlAi } : {}),
      ...(overrides?.agentCmdOverrides ? { agentCmdOverrides: overrides.agentCmdOverrides } : {})
    },
    { timeoutMs: 75_000 }
  )
}

export async function cancelRuntimeGeneratePullRequestFields(
  context: RuntimeGitContext
): Promise<void> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind === 'local' || !context.worktreeId) {
    await getClientRuntime().git.cancelGeneratePullRequestFields({
      worktreePath: resolveLocalWorktreePath(context),
      connectionId: context.connectionId
    })
    return
  }
  await callRuntimeRpc(
    target,
    'git.cancelGeneratePullRequestFields',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 5_000 }
  )
}
