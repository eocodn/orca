import { RuntimeGitCommandsBase } from './orca-runtime-git-base'
import type {
  GitDiffResult,
  GitPushTarget,
  GitWorktreeInfo,
  GlobalSettings,
  Repo,
  Worktree
} from '../../shared/types'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import { getCommitMessageModelDiscoveryHostKey } from '../../shared/commit-message-host-key'

import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  type ResolvedSourceControlAiGenerationParams
} from '../../shared/source-control-ai'
import { withLinkedIssueDraftContext } from '../../shared/source-control-ai-action-variables'
import type { SourceControlAiOperation } from '../../shared/source-control-ai-types'

import { commitChanges, getBranchDiff, getCommitDiff, getStagedCommitContext } from '../git/status'

import { gitPullRebaseFromBase, gitPush } from '../git/remote'

import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'

import {
  generateCommitMessageFromContext,
  resolveCommitMessageSettings,
  type CommitMessageGenerationTarget,
  type GenerateCommitMessageResult
} from '../text-generation/commit-message-text-generation'
import type {
  CommitMessageAgentEnvironmentResolvers,
  CommitMessageAgentRuntimeTarget
} from '../text-generation/commit-message-agent-environment'
import { prepareLocalCommitMessageAgentEnv } from '../text-generation/commit-message-agent-environment'

import { normalizeRuntimeRelativePath } from './runtime-relative-paths'

import type { GitRuntimeOptions } from '../git/git-runtime-options'

type ResolvedRuntimeGitWorktree = Worktree & { git: GitWorktreeInfo }
type RuntimeCommitMessageSettingsOverride = Partial<
  Pick<GlobalSettings, 'commitMessageAi' | 'sourceControlAi' | 'agentCmdOverrides'>
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

export class RuntimeGitRemoteCommands extends RuntimeGitCommandsBase {
  async rebaseRuntimeGitFromBase(worktreeSelector: string, baseRef: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.rebaseFromBase(target.worktree.path, baseRef)
      return { ok: true }
    }
    await gitPullRebaseFromBase(target.worktree.path, baseRef, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async pushRuntimeGit(
    worktreeSelector: string,
    publish?: boolean,
    pushTarget?: GitPushTarget,
    forceWithLease?: boolean
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.pushBranch(target.worktree.path, publish === true, pushTarget, {
        forceWithLease: forceWithLease === true
      })
      return { ok: true }
    }
    await gitPush(target.worktree.path, publish === true, pushTarget, {
      forceWithLease: forceWithLease === true,
      ...localGitOptionsForTarget(target)
    })
    return { ok: true }
  }

  async getRuntimeGitBranchDiff(
    worktreeSelector: string,
    compare: { mergeBase: string; headOid: string },
    filePath: string,
    oldPath?: string
  ): Promise<GitDiffResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    const oldRelativePath = oldPath ? normalizeRuntimeGitRelativePath(oldPath) : undefined
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      const results = await provider.getBranchDiff(target.worktree.path, compare.mergeBase, {
        includePatch: true,
        filePath: relativePath,
        oldPath: oldRelativePath
      })
      return (
        results[0] ?? {
          kind: 'text',
          originalContent: '',
          modifiedContent: '',
          originalIsBinary: false,
          modifiedIsBinary: false
        }
      )
    }
    return getBranchDiff(
      target.worktree.path,
      {
        mergeBase: compare.mergeBase,
        headOid: compare.headOid,
        filePath: relativePath,
        oldPath: oldRelativePath
      },
      localGitOptionsForTarget(target)
    )
  }

  async getRuntimeGitCommitDiff(
    worktreeSelector: string,
    args: { commitOid: string; parentOid?: string | null; filePath: string; oldPath?: string }
  ): Promise<GitDiffResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeRelativePath(args.filePath)
    const oldRelativePath = args.oldPath ? normalizeRuntimeRelativePath(args.oldPath) : undefined
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getCommitDiff(target.worktree.path, {
        commitOid: args.commitOid,
        parentOid: args.parentOid,
        filePath: relativePath,
        oldPath: oldRelativePath
      })
    }
    return getCommitDiff(
      target.worktree.path,
      {
        commitOid: args.commitOid,
        parentOid: args.parentOid,
        filePath: relativePath,
        oldPath: oldRelativePath
      },
      localGitOptionsForTarget(target)
    )
  }

  async commitRuntimeGit(
    worktreeSelector: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    if (message.trim().length === 0) {
      throw new Error('Commit message is required')
    }
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.commit(target.worktree.path, message)
    }
    return commitChanges(target.worktree.path, message, localGitOptionsForTarget(target))
  }

  async generateRuntimeCommitMessage(
    worktreeSelector: string,
    settingsOverride?: RuntimeCommitMessageSettingsOverride
  ): Promise<GenerateCommitMessageResult> {
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
            'commitMessage'
          ),
          discoveryHostKey,
          'commitMessage',
          target.repo ?? null
        )
    if (!resolvedSettings.ok) {
      return { success: false, error: resolvedSettings.error }
    }

    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        return {
          success: false,
          error: SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
        }
      }
      let context: CommitMessageDraftContext | null
      try {
        context = await provider.getStagedCommitContext(target.worktree.path)
      } catch (error) {
        console.error('[runtime-git] Failed to read remote staged commit context:', error)
        return { success: false, error: 'Failed to read staged changes.' }
      }
      if (!context) {
        return { success: false, error: 'No staged changes to summarize.' }
      }
      context = withLinkedIssueDraftContext(context, this.linkedIssueForTarget(target))
      return generateCommitMessageFromContext(context, resolvedSettings.params, {
        kind: 'remote',
        cwd: target.worktree.path,
        execute: (plan, cwd, timeoutMs, operation) =>
          provider.executeCommitMessagePlan(plan, cwd, timeoutMs, operation),
        missingBinaryLocation: 'remote PATH'
      })
    }

    let context: CommitMessageDraftContext | null
    try {
      context = await getStagedCommitContext(target.worktree.path, localGitOptionsForTarget(target))
    } catch (error) {
      console.error('[runtime-git] Failed to read staged commit context:', error)
      return { success: false, error: 'Failed to read staged changes.' }
    }
    if (!context) {
      return { success: false, error: 'No staged changes to summarize.' }
    }
    context = withLinkedIssueDraftContext(context, this.linkedIssueForTarget(target))
    const localEnv = await prepareLocalCommitMessageAgentEnv(
      resolvedSettings.params.agentId,
      this.host.getCommitMessageAgentEnvironment?.(),
      localAgentRuntimeTargetForTarget(target)
    )
    if (!localEnv.ok) {
      return { success: false, error: localEnv.error }
    }
    return generateCommitMessageFromContext(
      context,
      resolvedSettings.params,
      localTextGenerationTargetForTarget(target, localEnv.env)
    )
  }
}
