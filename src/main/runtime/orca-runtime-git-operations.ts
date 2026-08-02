import { RuntimeGitGenerationCommands } from './orca-runtime-git-generation'
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

export class RuntimeGitOperations extends RuntimeGitGenerationCommands {
  async stageRuntimeGitPath(worktreeSelector: string, filePath: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.stageFile(target.worktree.path, relativePath)
      return { ok: true }
    }
    await stageFile(target.worktree.path, relativePath, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async unstageRuntimeGitPath(worktreeSelector: string, filePath: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.unstageFile(target.worktree.path, relativePath)
      return { ok: true }
    }
    await unstageFile(target.worktree.path, relativePath, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async bulkStageRuntimeGitPaths(
    worktreeSelector: string,
    filePaths: string[]
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePaths = filePaths.map((path) => normalizeRuntimeGitRelativePath(path))
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.bulkStageFiles(target.worktree.path, relativePaths)
      return { ok: true }
    }
    await bulkStageFiles(target.worktree.path, relativePaths, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async bulkUnstageRuntimeGitPaths(
    worktreeSelector: string,
    filePaths: string[]
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePaths = filePaths.map((path) => normalizeRuntimeGitRelativePath(path))
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.bulkUnstageFiles(target.worktree.path, relativePaths)
      return { ok: true }
    }
    await bulkUnstageFiles(target.worktree.path, relativePaths, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async bulkDiscardRuntimeGitPaths(
    worktreeSelector: string,
    filePaths: string[]
  ): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePaths = filePaths.map((path) => normalizeRuntimeGitRelativePath(path))
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.bulkDiscardChanges(target.worktree.path, relativePaths)
      return { ok: true }
    }
    await bulkDiscardChanges(target.worktree.path, relativePaths, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async discardRuntimeGitPath(worktreeSelector: string, filePath: string): Promise<{ ok: true }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      await provider.discardChanges(target.worktree.path, relativePath)
      return { ok: true }
    }
    await discardChanges(target.worktree.path, relativePath, localGitOptionsForTarget(target))
    return { ok: true }
  }

  async getRuntimeGitRemoteFileUrl(
    worktreeSelector: string,
    relativePath: string,
    line: number
  ): Promise<string | null> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const normalizedRelativePath = normalizeRuntimeGitRelativePath(relativePath)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getRemoteFileUrl(target.worktree.path, normalizedRelativePath, line)
    }
    return getRemoteFileUrl(target.worktree.path, normalizedRelativePath, line)
  }

  async getRuntimeGitRemoteCommitUrl(
    worktreeSelector: string,
    sha: string
  ): Promise<string | null> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const provider = target.connectionId ? getSshGitProvider(target.connectionId) : null
    if (target.connectionId) {
      if (!provider) {
        throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
      }
      return provider.getRemoteCommitUrl(target.worktree.path, sha)
    }
    return getRemoteCommitUrl(target.worktree.path, sha)
  }
}
