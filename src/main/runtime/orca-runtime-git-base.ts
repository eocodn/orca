import type {
  GitBranchCompareResult,
  GitCommitCompareResult,
  GitConflictOperation,
  GitDiffResult,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitPushTarget,
  GitStagingArea,
  GitStatusResult,
  GitUpstreamStatus,
  GitWorktreeInfo,
  GlobalSettings,
  Repo,
  TuiAgent,
  Worktree
} from '../../shared/types'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import { getCommitMessageModelDiscoveryHostKey } from '../../shared/commit-message-host-key'
import type { GitHistoryOptions, GitHistoryResult } from '../../shared/git-history'
import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  type ResolvedSourceControlAiGenerationParams
} from '../../shared/source-control-ai'
import { withLinkedIssueDraftContext } from '../../shared/source-control-ai-action-variables'
import type { SourceControlAiOperation } from '../../shared/source-control-ai-types'
import type { GitProviderStatusOptions } from '../providers/types'
import { getRemoteCommitUrl, getRemoteFileUrl } from '../git/repo'
import {
  abortMerge,
  abortRebase,
  bulkDiscardChanges,
  bulkStageFiles,
  bulkUnstageFiles,
  commitChanges,
  detectConflictOperation,
  discardChanges,
  getBranchCompare,
  getBranchDiff,
  getCommitCompare,
  getCommitDiff,
  getDiff,
  getStagedCommitContext,
  getStatus as getGitStatus,
  getSubmoduleStatus as getGitSubmoduleStatus,
  stageFile,
  unstageFile
} from '../git/status'
import { checkoutBranch, listLocalBranches } from '../git/checkout'
import type { RuntimeGitCheckoutResult, RuntimeGitLocalBranches } from '../../shared/runtime-types'
import { getHistory as getGitHistory } from '../git/history'
import { getUpstreamStatus } from '../git/upstream'
import { gitFastForward, gitFetch, gitPull, gitPullRebaseFromBase, gitPush } from '../git/remote'
import { gitSyncForkDefaultBranch } from '../git/fork-sync'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-git-dispatch'
import { checkIgnoredPaths } from '../git/check-ignored-paths'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import {
  cancelGenerateCommitMessageLocal,
  cancelGeneratePullRequestFieldsLocal,
  discoverCommitMessageModelsLocal,
  discoverCommitMessageModelsRemote,
  generateCommitMessageFromContext,
  generatePullRequestFieldsFromContext,
  resolveCommitMessageSettings,
  type CommitMessageGenerationTarget,
  type DiscoverCommitMessageModelsResult,
  type GenerateCommitMessageResult,
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

export type ResolvedRuntimeGitWorktree = Worktree & { git: GitWorktreeInfo }
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

export class RuntimeGitCommandsBase {
  constructor(protected readonly host: RuntimeGitCommandHost) {}

  protected linkedIssueForTarget(target: RuntimeGitTarget): number | null | undefined {
    const live = this.host.getWorktreeLinkedIssue?.(target.worktree.id)
    // Why: `undefined` means the host could not answer, not "unlinked".
    return live === undefined ? target.worktree.linkedIssue : live
  }

  async getRuntimeGitStatus(
    worktreeSelector: string,
    options?: GitProviderStatusOptions
  ): Promise<GitStatusResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return options
        ? provider.getStatus(target.worktree.path, options)
        : provider.getStatus(target.worktree.path)
    }
    const gitOptions = localGitOptionsForTarget(target)
    // Why: Git can't ignore a shared symlink under a directory-only rule, so tell
    // status which untracked entries are Orca's own artifacts (issue #10451).
    const sharedLinkPaths = target.repo ? getWorktreeSharedLinkPaths(target.repo) : []
    const sharedOptions = sharedLinkPaths.length > 0 ? { sharedLinkPaths } : {}
    return options
      ? getGitStatus(target.worktree.path, { ...options, ...gitOptions, ...sharedOptions })
      : getGitStatus(target.worktree.path, { ...gitOptions, ...sharedOptions })
  }

  async getRuntimeGitSubmoduleStatus(
    worktreeSelector: string,
    submodulePath: string,
    area: GitStagingArea = 'unstaged'
  ): Promise<GitStatusResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getSubmoduleStatus(target.worktree.path, submodulePath, area)
    }
    return getGitSubmoduleStatus(target.worktree.path, submodulePath, {
      ...localGitOptionsForTarget(target),
      ...(area === 'staged' ? { staged: true } : {})
    })
  }

  async checkRuntimeGitIgnoredPaths(
    worktreeSelector: string,
    relativePaths: string[]
  ): Promise<string[]> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.checkIgnoredPaths(target.worktree.path, relativePaths)
    }
    return checkIgnoredPaths(target.worktree.path, relativePaths, localGitOptionsForTarget(target))
  }

  async getRuntimeGitHistory(
    worktreeSelector: string,
    options: GitHistoryOptions = {}
  ): Promise<GitHistoryResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getHistory(target.worktree.path, options)
    }
    return getGitHistory(target.worktree.path, {
      ...options,
      ...localGitOptionsForTarget(target)
    })
  }

  async getRuntimeGitConflictOperation(worktreeSelector: string): Promise<GitConflictOperation> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.detectConflictOperation(target.worktree.path)
    }
    return detectConflictOperation(target.worktree.path)
  }

  async abortRuntimeGitMerge(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.abortMerge(target.worktree.path)
      return { ok: true }
    }
    await abortMerge(target.worktree.path, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async abortRuntimeGitRebase(worktreeSelector: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.abortRebase(target.worktree.path)
      return { ok: true }
    }
    await abortRebase(target.worktree.path, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async checkoutRuntimeGitBranch(
    worktreeSelector: string,
    branch: string
  ): Promise<RuntimeGitCheckoutResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.checkoutBranch(target.worktree.path, branch)
      return { ok: true, branch }
    }
    await checkoutBranch(target.worktree.path, branch, localGitOptionsForTarget(target))
    return { ok: true, branch }
  }

  async listRuntimeGitLocalBranches(worktreeSelector: string): Promise<RuntimeGitLocalBranches> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.listLocalBranches(target.worktree.path)
    }
    return listLocalBranches(target.worktree.path, localGitOptionsForTarget(target))
  }

  async getRuntimeGitDiff(
    worktreeSelector: string,
    filePath: string,
    staged: boolean,
    compareAgainstHead?: boolean
  ): Promise<GitDiffResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getDiff(target.worktree.path, relativePath, staged, compareAgainstHead)
    }
    return getDiff(
      target.worktree.path,
      relativePath,
      staged,
      compareAgainstHead,
      localGitOptionsForTarget(target)
    )
  }

  async getRuntimeGitBranchCompare(
    worktreeSelector: string,
    baseRef: string
  ): Promise<GitBranchCompareResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getBranchCompare(target.worktree.path, baseRef)
    }
    return getBranchCompare(target.worktree.path, baseRef, localGitOptionsForTarget(target))
  }

  async getRuntimeGitCommitCompare(
    worktreeSelector: string,
    commitId: string
  ): Promise<GitCommitCompareResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getCommitCompare(target.worktree.path, commitId)
    }
    return getCommitCompare(target.worktree.path, commitId, localGitOptionsForTarget(target))
  }

  async getRuntimeGitUpstreamStatus(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<GitUpstreamStatus> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getUpstreamStatus(target.worktree.path, pushTarget)
    }
    return getUpstreamStatus(target.worktree.path, pushTarget, localGitOptionsForTarget(target))
  }

  async fetchRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.fetchRemote(target.worktree.path, pushTarget)
      return { ok: true }
    }
    await gitFetch(target.worktree.path, pushTarget, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async syncRuntimeGitForkDefaultBranch(
    worktreeSelector: string,
    expectedUpstream: GitForkSyncExpectedUpstream
  ): Promise<GitForkSyncResult> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.syncForkDefaultBranch(target.worktree.path, expectedUpstream)
    }
    return gitSyncForkDefaultBranch(
      target.worktree.path,
      expectedUpstream,
      localGitOptionsForTarget(target)
    )
  }

  async pullRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.pullBranch(target.worktree.path, pushTarget)
      return { ok: true }
    }
    await gitPull(target.worktree.path, pushTarget, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async fastForwardRuntimeGit(
    worktreeSelector: string,
    pushTarget?: GitPushTarget
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.fastForwardBranch(target.worktree.path, pushTarget)
      return { ok: true }
    }
    await gitFastForward(target.worktree.path, pushTarget, localGitOptionsForTarget(target))
    return { ok: true }
  }


}
