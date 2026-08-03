import { RuntimeGitRemoteCommands } from './orca-runtime-git-remote'
import type {
  GitWorktreeInfo,
  GlobalSettings,
  Repo,
  TuiAgent,
  Worktree
} from '../../shared/types'

import { getCommitMessageModelDiscoveryHostKey } from '../../shared/commit-message-host-key'

import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  type ResolvedSourceControlAiGenerationParams
} from '../../shared/source-control-ai'
import { withLinkedIssueDraftContext } from '../../shared/source-control-ai-action-variables'
import type { SourceControlAiOperation } from '../../shared/source-control-ai-types'









import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'


import {
  cancelGenerateCommitMessageLocal,
  cancelGeneratePullRequestFieldsLocal,
  discoverCommitMessageModelsLocal,
  discoverCommitMessageModelsRemote,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  type CommitMessageGenerationTarget,
  type DiscoverCommitMessageModelsResult,
  type GeneratePullRequestFieldsResult
} from '../text-generation/commit-message-text-generation'
import type {
  CommitMessageAgentEnvironmentResolvers,
  CommitMessageAgentRuntimeTarget
} from '../text-generation/commit-message-agent-environment'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'
import { getPullRequestDraftContext } from '../text-generation/pull-request-context'
import { normalizeRuntimeRelativePath } from './runtime-relative-paths'
import { gitExecFileAsync } from '../git/runner'
import type { GitRuntimeOptions } from '../git/git-runtime-options'
import { resolveHostedReviewBodyForGeneration } from '../source-control/pull-request-template'
import type { HostedReviewProvider } from '../../shared/hosted-review'

type ResolvedRuntimeGitWorktree = Worktree & { git: GitWorktreeInfo }
type RuntimeCommitMessageSettingsOverride = Partial<
  Pick<
    GlobalSettings,
    'commitMessageAi' | 'sourceControlAi' | 'agentCmdOverrides' | 'enableGitHubAttribution'
  >
> & {
  commitMessageDiscoveryHostKey?: string
  sourceControlAiResolvedParams?: ResolvedSourceControlAiGenerationParams
}

function getRuntimeGitGenerationSettings(
  settings: GlobalSettings,
  settingsOverride: RuntimeCommitMessageSettingsOverride | undefined,
  operation: SourceControlAiOperation
): GlobalSettings {
  const mergedSettings = {
    ...settings,
    ...settingsOverride
  }
  if (
    settingsOverride?.commitMessageAi !== undefined &&
    settingsOverride.sourceControlAi === undefined
  ) {
    mergedSettings.sourceControlAi = mergeLegacyCommitMessageAiIntoSourceControlAi(
      settings.sourceControlAi,
      settingsOverride.commitMessageAi,
      { pullRequestInstructionsFromLegacy: operation === 'pullRequest' }
    )
  }
  return mergedSettings
}

function normalizeRuntimeGitRelativePath(filePath: string): string {
  const relativePath = normalizeRuntimeRelativePath(filePath)
  if (relativePath === '') {
    // Why: git mutation APIs treat an empty pathspec as the worktree root;
    // runtime RPC must never let malformed file paths discard whole worktrees.
    throw new Error('invalid_relative_path')
  }
  return relativePath
}

type RuntimeGitTarget = {
  worktree: ResolvedRuntimeGitWorktree
  repo?: Repo
  connectionId?: string
  localGitOptions?: GitRuntimeOptions
}

function localGitOptionsForTarget(target: RuntimeGitTarget): GitRuntimeOptions {
  return target.connectionId ? {} : (target.localGitOptions ?? {})
}

function localAgentRuntimeTargetForTarget(
  target: RuntimeGitTarget
): CommitMessageAgentRuntimeTarget {
  const wslDistro = localGitOptionsForTarget(target).wslDistro
  return wslDistro ? { runtime: 'wsl', wslDistro } : { runtime: 'host' }
}

function localTextGenerationTargetForTarget(
  target: RuntimeGitTarget,
  env?: NodeJS.ProcessEnv
): Extract<CommitMessageGenerationTarget, { kind: 'local' }> {
  const wslDistro = localGitOptionsForTarget(target).wslDistro
  return {
    kind: 'local',
    cwd: target.worktree.path,
    ...(wslDistro ? { wslDistro } : {}),
    ...(env ? { env } : {})
  }
}

export type RuntimeGitCommandHost = {
  resolveRuntimeGitTarget(selector: string): Promise<RuntimeGitTarget>
  getRuntimeSettings(): GlobalSettings
  getCommitMessageAgentEnvironment?(): CommitMessageAgentEnvironmentResolvers | undefined
  /**
   * Live linked-issue read by worktree id. Resolved worktrees come from a
   * short-TTL cache, so link/unlink would otherwise lag generation; hosts that
   * implement this are authoritative, including the `null` unlinked answer.
   * Return `undefined` when metadata is unavailable (store not ready) so the
   * caller keeps the resolved worktree's cached value instead of reading it as
   * unlinked.
   */
  getWorktreeLinkedIssue?(worktreeId: string): number | null | undefined
}

export class RuntimeGitGenerationCommands extends RuntimeGitRemoteCommands {
  async cancelRuntimeGenerateCommitMessage(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      await provider?.cancelGenerateCommitMessage(target.worktree.path, 'commit-message')
      return { ok: true }
    }
    cancelGenerateCommitMessageLocal(target.worktree.path)
    return { ok: true }
  }

  async generateRuntimePullRequestFields(
    worktreeSelector: string,
    input: {
      base: string
      title: string
      body: string
      draft: boolean
      provider?: HostedReviewProvider
      useTemplate?: boolean
    },
    settingsOverride?: RuntimeCommitMessageSettingsOverride
  ): Promise<GeneratePullRequestFieldsResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const discoveryHostKey =
      settingsOverride?.commitMessageDiscoveryHostKey ??
      getCommitMessageModelDiscoveryHostKey(target.connectionId ?? null)
    const resolvedSettings = settingsOverride?.sourceControlAiResolvedParams
      ? { ok: true as const, params: settingsOverride.sourceControlAiResolvedParams }
      : resolveCommitMessageSettings(
          getRuntimeGitGenerationSettings(
            this.host.getRuntimeSettings(),
            settingsOverride,
            'pullRequest'
          ),
          discoveryHostKey,
          'pullRequest',
          target.repo ?? null
        )
    if (!resolvedSettings.ok) {
      return { success: false, error: resolvedSettings.error }
    }

    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId && !provider) {
      return {
        success: false,
        error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
      }
    }
    let context: Awaited<ReturnType<typeof getPullRequestDraftContext>>
    try {
      const currentBody = await resolveHostedReviewBodyForGeneration({
        body: input.body,
        repoPath: target.worktree.path,
        connectionId: target.connectionId,
        provider: input.provider,
        useTemplate: input.useTemplate
      })
      context = target.connectionId
        ? await getPullRequestDraftContext((argv) => provider!.exec(argv, target.worktree.path), {
            base: input.base,
            currentTitle: input.title,
            currentBody,
            currentDraft: input.draft
          })
        : await getPullRequestDraftContext(
            (argv, options) =>
              gitExecFileAsync(argv, {
                cwd: target.worktree.path,
                ...localGitOptionsForTarget(target),
                ...options
              }),
            {
              base: input.base,
              currentTitle: input.title,
              currentBody,
              currentDraft: input.draft
            }
          )
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to prepare branch for PR details.'
      }
    }
    if (!context) {
      return { success: false, error: 'No branch changes to summarize.' }
    }
    // Why: both SSH and local branches share this context, so one attach covers each.
    context = withLinkedIssueDraftContext(context, this.linkedIssueForTarget(target))

    if (target.connectionId) {
      return generatePullRequestFieldsFromContext(context, resolvedSettings.params, {
        kind: 'remote',
        cwd: target.worktree.path,
        execute: (plan, cwd, timeoutMs, operation) =>
          provider!.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
        missingBinaryLocation: 'remote PATH'
      })
    }

    const localEnv = await prepareLocalCommitMessageAgentEnv(
      resolvedSettings.params.agentId,
      this.host.getCommitMessageAgentEnvironment?.(),
      localAgentRuntimeTargetForTarget(target)
    )
    if (!localEnv.ok) {
      return { success: false, error: localEnv.error }
    }
    return generatePullRequestFieldsFromContext(
      context,
      resolvedSettings.params,
      localTextGenerationTargetForTarget(target, localEnv.env)
    )
  }

  async cancelRuntimeGeneratePullRequestFields(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      await provider?.cancelGenerateCommitMessage(target.worktree.path, 'pull-request-fields')
      return { ok: true }
    }
    cancelGeneratePullRequestFieldsLocal(target.worktree.path)
    return { ok: true }
  }

  async discoverRuntimeCommitMessageModels(
    worktreeSelector: string,
    agentId: string,
    settingsOverride?: Pick<RuntimeCommitMessageSettingsOverride, 'agentCmdOverrides'>
  ): Promise<DiscoverCommitMessageModelsResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const typedAgentId = agentId as TuiAgent
    const agentCommandOverride =
      settingsOverride?.agentCmdOverrides?.[typedAgentId] ??
      this.host.getRuntimeSettings().agentCmdOverrides?.[typedAgentId]
    if (target.connectionId) {
      const provider = getSshGitProvider(target.connectionId)
      if (!provider) {
        return {
          success: false,
          error: `No git provider for connection "${target.connectionId}"`
        }
      }
      return discoverCommitMessageModelsRemote(
        typedAgentId,
        target.worktree.path,
        (plan, cwd, timeoutMs) => provider.executeCommitMessagePlan(plan, cwd, timeoutMs),
        agentCommandOverride
      )
    }
    const localEnv = await prepareLocalCommitMessageAgentEnv(
      typedAgentId,
      this.host.getCommitMessageAgentEnvironment?.(),
      localAgentRuntimeTargetForTarget(target)
    )
    if (!localEnv.ok) {
      return { success: false, error: localEnv.error }
    }
    const localOptions = localGitOptionsForTarget(target)
    return localOptions.wslDistro
      ? discoverCommitMessageModelsLocal(typedAgentId, localEnv.env, agentCommandOverride, {
          cwd: target.worktree.path,
          wslDistro: localOptions.wslDistro
        })
      : discoverCommitMessageModelsLocal(typedAgentId, localEnv.env, agentCommandOverride)
  }
}
