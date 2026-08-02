// Why: worktree create helpers (local + remote) split out of worktrees.ts; the cohesive create flow runs this file just over the per-file line limit.

import type { BrowserWindow } from 'electron'
import { posix, win32 } from 'node:path'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  CreateWorktreeResult,
  GitPushTarget,
  GlobalSettings,
  LocalBaseRefRefreshResult,
  LocalBaseRefUpdateSuggestion,
  Repo,
  Worktree,
  WorktreeCreateBaseFallback,
  WorktreeHeadIdentity,
  WorktreeMeta
} from '../../shared/types'
import { getPRForBranch } from '../github/client'
import { listWorktrees, addWorktree, addSparseWorktree } from '../git/worktree'
import type { AddWorktreeOptions, AddWorktreeResult } from '../git/worktree'
import {
  getBranchConflictKind,
  resolveDefaultBaseRefViaExec,
  resolveDefaultBaseRefWithLocalGit
} from '../git/repo'
import { resolveLocalGitUsername, getSshGitUsername } from '../git/git-username'
import { hasCommitObjectViaGitExec } from '../git/commit-object-ref'
import { resolveWorktreeCreateBase } from '../worktree-create-base'
import { resolveWorktreeAddBaseRef } from '../../shared/worktree-base-ref'
import { getHostedReviewForBranch } from '../source-control/hosted-review'
import type { ForgeProviderId } from '../source-control/forge-provider'
import { validateGitPushTarget } from '../git/push-target-validation'
import { assertGitPushTargetShape } from '../../shared/git-push-target-validation'
import { gitExecFileAsync } from '../git/runner'
import { parseGitHubOwnerRepo } from '../github/gh-utils'
import type {
  OrcaRuntimeService,
  RemoteFetchResult,
  RemoteTrackingBase
} from '../runtime/orca-runtime'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import {
  buildPosixRunnerScript,
  buildWindowsRunnerScript,
  createSetupRunnerScript,
  getDefaultTabsLaunch,
  getEffectiveHooks,
  getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars,
  loadHooks,
  parseOrcaYaml,
  shouldRunSetupForCreate
} from '../hooks'
import { requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import type { SshGitProvider } from '../providers/ssh-git-provider'
import { TUI_AGENT_CONFIG, isTuiAgent } from '../../shared/tui-agent-config'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { runWorktreeChangeInvalidators } from './worktree-change-invalidators'
import {
  registerOptionalSshWorktreeCreateRoots,
  registerRequiredSshWorktreeCreateRoots
} from './ssh-worktree-create-root-registration'

export type CreateWorktreeArgsWithSystemProvenance = CreateWorktreeArgs & {
  automationProvenance?: AutomationWorkspaceProvenance
  cliProvenance?: CliWorkspaceProvenance
}
import {
  sanitizeWorktreeName,
  sanitizeWorktreeDisplayName,
  computeValidatedBranchName,
  computeWorktreePath,
  computeRemoteWorktreePath,
  computeWorkspaceRoot,
  ensurePathWithinWorkspace,
  getWorktreeCreationLayout,
  getWorktreePathSettings,
  hasRepoWorktreeBasePath,
  shouldSetDisplayName,
  mergeWorktree
} from './worktree-logic'
import { findCreatedWorktree } from './created-worktree-reconciliation'
import type { BranchPrefixSettings } from '../../shared/branch-prefix'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import { parseWorkspaceKey, worktreeWorkspaceKey } from '../../shared/workspace-scope'
import {
  cleanupUnusedWorktreePushTargetRemoteWithExec,
  sameGitHubRemoteUrl,
  type WorktreePushTargetStore
} from './worktree-push-target-cleanup'
import {
  configureCreatedWorktreePushTargetWithExec,
  prepareWorktreePushTargetWithExec
} from './worktree-push-target-setup'
import { isENOENT, registerWorktreeRootsForRepo } from './filesystem-auth'
import {
  createWorktreeCopiedPaths,
  createWorktreeLinkedPaths,
  createWorktreeSharedPaths
} from './worktree-symlinks'
import { formatWorktreeIncludeCopyWarning } from './worktree-include-copy-budget'
import { resolveWorktreeIncludePaths } from '../git/worktree-include-file'
import { resolveWorktreeSharedDirectories } from '../git/worktree-shared-directories'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import type { IFilesystemProvider } from '../providers/types'
import {
  buildSetupRunnerCommand,
  getSetupRunnerCommandPlatformForPath
} from '../../shared/setup-runner-command'
import { createSequencedSetupAgentCommands } from '../../shared/setup-agent-sequencing'
import { shouldWaitForSetupBeforeAgentStartup } from '../../shared/setup-agent-startup-policy'
import { createWorktreeCreateTimingRecorder } from '../worktree-create-timing'
import {
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted
} from '../agent-trust-presets'
import {
  getLocalProjectGitExecOptions,
  getLocalProjectWorktreeGitOptions
} from '../project-runtime-git-options'
import {
  getBranchNameOverrideCandidate,
  getWorktreeCreateCandidate,
  WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS
} from '../worktree-create-candidates'

export const SSH_WORKTREE_CREATE_FETCH_FRESHNESS_MS = 30_000
export const SSH_WORKTREE_CREATE_FETCH_CACHE_MAX = 512
// Why: bound the fallback `git fetch origin` so a Windows credential-manager GUI hang (STA-1292) can't wedge worktree creation forever.
export const CREATE_BASE_FALLBACK_FETCH_TIMEOUT_MS = 60_000
export const sshWorktreeCreateFetchInflight = new Map<string, Promise<void>>()
export const sshWorktreeCreateFetchCompletedAt = new Map<string, number>()
export const sshWorktreeCreateFetchQueueTail = new Map<string, Promise<void>>()
export const sshWorktreeCreateBasePlanInflight = new Map<
  string,
  Promise<RemoteWorktreeCreateBasePlan | null>
>()

export type RemoteWorktreeCreateBasePlan = {
  baseBranch: string
  remoteTrackingBase: RemoteTrackingBase | null
}

export type StagedStartupResult = {
  startupTerminal?: CreateWorktreeResult['startupTerminal']
  activationSetup?: CreateWorktreeResult['setup']
  didSpawnSetup: boolean
  warning?: string
}

export type RemoteLocalBaseRefRefreshability =
  | {
      refreshable: true
      baseRef: string
      localBranch: string
      fullRef: string
      remoteTrackingRef: string
      behind: number
      ownerWorktreePath?: string
    }
  | {
      refreshable: false
      result: LocalBaseRefRefreshResult
    }

