import { ipcMain, type BrowserWindow } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import { isFolderRepo } from '../../shared/repo-kind'
import { readBranchRenameFailureOutputForDisplay } from '../agent-hooks/branch-rename-failure-output'
import {
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../shared/workspace-scope'
import { inspectSetupScriptImportCandidates } from '../../shared/setup-script-imports'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import { isPathInsideOrEqual, isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { deleteWorktreeHistoryDir } from '../terminal-history-deletion'
import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  CreateWorktreeResult,
  DetectedWorktree,
  DetectedWorktreeListResult,
  ForceDeleteWorktreeBranchResult,
  GitHubPrStartPoint,
  GitPushTarget,
  GitWorktreeInfo,
  OrcaHooks,
  Repo,
  RemoveWorktreeResult,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorktreeMeta
} from '../../shared/types'
import { assertWorktreeUnlockedForRemoval } from '../../shared/worktree-removal'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import {
  PROVIDER_REQUEST_ID_MAX_UTF8_BYTES,
  type DirectSshDetectedWorktreeRequest,
  type HostQualifiedDetectedWorktreeResult,
  type ListDetectedWorktreesArgs,
  type ProviderRequestId
} from '../../shared/detected-worktree-provider-contract'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../../shared/host-lineage-contract'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import {
  applyMetadataFallbackVisibility,
  buildKnownOrcaWorkspaceLayouts,
  isLegacyRepoForExternalWorktreeVisibility,
  toDetectedWorktree
} from '../../shared/worktree-ownership'
import { createAgentScratchWorktreePathMatcher } from '../../shared/agent-scratch-worktrees'
import {
  assertWorktreeCleanForRemoval,
  forceDeleteLocalBranch,
  listWorktreesStrict as listGitWorktreesStrict,
  removeWorktree
} from '../git/worktree'
import { gitExecFileAsync } from '../git/runner'
import { withWorktreeRemoveStageSpan, withWorktreeSpan } from '../observability/instrumentation'
import { resolveGitHubPrStartPoint } from '../github/pr-start-point'
import {
  fetchGitHubPullRequestHeadRef,
  fetchPrHeadTrackingRef
} from '../github/pr-head-tracking-ref'
import { pruneWorktreePRRefreshAliases } from '../github/pr-refresh-coordinator'
import { resolveGitHubReviewHeadRemote } from '../github/review-head-remote'
import { listRepoWorktrees } from '../repo-worktrees'
import { getSshGitProvider, requireSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import {
  createIssueCommandRunnerScript,
  getEffectiveHooks,
  getEffectiveHooksFromConfig,
  getSetupRunnerEnvVars,
  loadHooks,
  parseOrcaYaml,
  readIssueCommand,
  runHook,
  hasHooksFile,
  hasUnrecognizedOrcaYamlKeys,
  writeIssueCommand
} from '../hooks'
import {
  mergeWorktree,
  parseWorktreeId,
  areWorktreePathsEqual,
  formatWorktreeRemovalError,
  isOrphanCompatiblePreflightError,
  isOrphanedWorktreeError
} from './worktree-logic'
import { dedupeWorktreesByPath } from './worktree-path-comparison'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import {
  createLocalWorktree,
  createRemoteWorktree,
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  notifyWorktreesChanged
} from './worktree-remote'
import { registerWorktreeChangeInvalidator } from './worktree-change-invalidators'
import {
  invalidateAuthorizedRootsCache,
  isENOENT,
  registerWorktreeRootsForRepo
} from './filesystem-auth'
import type { OrcaRuntimeService, RuntimeWorktreeLifecycleEvent } from '../runtime/orca-runtime'
import { killAllProcessesForWorktree } from '../runtime/worktree-teardown'
import { clearProviderPtyState, getLocalPtyProvider, getSshPtyProvider } from './pty'
import { findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths } from './worktree-symlinks'
import { getWorktreeSharedLinkPaths } from '../git/worktree-shared-directories'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { workspaceSourceSchema, type WorkspaceSource } from '../../shared/telemetry-events'
import {
  finishAutomationWorkspaceProvenanceRequest,
  releaseAutomationWorkspaceProvenanceRequest,
  resolveAutomationWorkspaceProvenance
} from '../automations/workspace-provenance'
import { shouldEmitBoundedWarning } from './bounded-warning-dedupe'
import {
  getSshProviderAuthority,
  isCurrentSshProviderAuthority,
  registerSshProviderRequestAbort
} from '../ssh/ssh-provider-authority'
import { createSenderScopedRequestCancellations } from './sender-scoped-request-cancellation'

import { type CreateWorktreeArgsWithSystemProvenance,
  type RemoveWorktreeArgs,
  type DetectedWorktreeRequestArgs,
  stopPtysForDestructiveWorktreeRemoval,
  getRepoForWorktreeRemoval,
  NullableWorkspaceLinkedItemSchema,
  NullableTaskSourceContextSchema,
  WORKTREE_ARCHIVE_HOOK_TIMEOUT_MS,
  WORKTREE_LIST_ALL_CONCURRENCY,
  normalizeLinkedWorkItemFields,
  mapWithConcurrency,
  removeWorktreeMetadataAndTransientState,
  getProjectHostSetupMetaUpdates,
  resolveWorktreeMetaWithDiscoveryBackfill,
  isAlreadyRemovedWorktreePath,
  isLocalGitRepository,
  gitStatusErrorMeansNotRepository,
  getWorktreeRemovalOptionsKey,
  getWorktreeRemovalInFlightKey,
  getArchiveHooksForRemoval } from './worktree-ipc-foundation'
export { type CreateWorktreeArgsWithSystemProvenance,
  type RemoveWorktreeArgs,
  type DetectedWorktreeRequestArgs,
  stopPtysForDestructiveWorktreeRemoval,
  getRepoForWorktreeRemoval,
  NullableWorkspaceLinkedItemSchema,
  NullableTaskSourceContextSchema,
  WORKTREE_ARCHIVE_HOOK_TIMEOUT_MS,
  WORKTREE_LIST_ALL_CONCURRENCY,
  normalizeLinkedWorkItemFields,
  mapWithConcurrency,
  removeWorktreeMetadataAndTransientState,
  getProjectHostSetupMetaUpdates,
  resolveWorktreeMetaWithDiscoveryBackfill,
  isAlreadyRemovedWorktreePath,
  isLocalGitRepository,
  gitStatusErrorMeansNotRepository,
  getWorktreeRemovalOptionsKey,
  getWorktreeRemovalInFlightKey,
  getArchiveHooksForRemoval } from './worktree-ipc-foundation'

export async function runRemoteArchiveHook(
  repo: Repo,
  worktreePath: string,
  script: string
): Promise<{ success: boolean; output: string }> {
  if (!repo.connectionId) {
    return { success: true, output: '' }
  }

  const provider = requireSshGitProvider(repo.connectionId)
  const env = getSetupRunnerEnvVars(repo, worktreePath)
  const isWindowsRemote = isWindowsAbsolutePathLike(worktreePath)
  const result = await provider
    .execNonInteractive(
      isWindowsRemote ? 'cmd.exe' : '/bin/bash',
      isWindowsRemote ? ['/d', '/s', '/c', script] : ['-lc', script],
      worktreePath,
      WORKTREE_ARCHIVE_HOOK_TIMEOUT_MS,
      undefined,
      env
    )
    .catch((error) => ({
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: false,
      spawnError: error instanceof Error ? error.message : String(error)
    }))
  const output = [
    result.stdout,
    result.stderr,
    result.spawnError,
    result.timedOut ? 'archive hook timed out' : null,
    typeof result.exitCode === 'number' && result.exitCode !== 0
      ? `archive hook exited ${result.exitCode}`
      : null
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .trim()

  return {
    success: !result.spawnError && !result.timedOut && result.exitCode === 0,
    output
  }
}

export type WorktreeRemovalInFlight = {
  optionsKey: string
  promise: Promise<RemoveWorktreeResult>
}

export type PreservedBranchCleanupTarget = {
  branchName: string
  head: string
  pushTarget?: GitPushTarget
}

export const preservedBranchCleanupByWorktreeId = new Map<string, PreservedBranchCleanupTarget>()

export function rememberPreservedBranchCleanupTarget(
  worktreeId: string,
  result: RemoveWorktreeResult | undefined,
  fallbackHead: string | undefined,
  pushTarget: GitPushTarget | undefined
): void {
  if (result?.preservedBranch) {
    const head = result.preservedBranch.head ?? fallbackHead
    if (!head) {
      throw new Error(
        `Cannot safely offer force-delete for preserved branch "${result.preservedBranch.branchName}" without its saved commit.`
      )
    }
    preservedBranchCleanupByWorktreeId.set(worktreeId, {
      branchName: result.preservedBranch.branchName,
      head,
      ...(pushTarget ? { pushTarget } : {})
    })
    return
  }
  preservedBranchCleanupByWorktreeId.delete(worktreeId)
}

export function preserveBranchHeadFallback(
  result: RemoveWorktreeResult | undefined,
  fallbackHead: string | undefined
): RemoveWorktreeResult {
  if (!result?.preservedBranch || result.preservedBranch.head || !fallbackHead) {
    return result ?? {}
  }
  return {
    ...result,
    preservedBranch: {
      ...result.preservedBranch,
      head: fallbackHead
    }
  }
}

export function getPreservedBranchCleanupTarget(
  worktreeId: string,
  branchName: string,
  expectedHead: string
): PreservedBranchCleanupTarget {
  const target = preservedBranchCleanupByWorktreeId.get(worktreeId)
  if (!target || target.branchName !== branchName || target.head !== expectedHead) {
    throw new Error(`No preserved branch cleanup is pending for "${branchName}".`)
  }
  return target
}

export const loggedUnavailableSshGitProviders = new Set<string>()
export const loggedWorktreeListFailures = new Set<string>()
export const loggedMalformedWorktreeMetaKeys = new Set<string>()
export const DETECTED_WORKTREE_PROVIDER_TIMEOUT_MS = 30_000
export const LINEAGE_HYDRATION_TIMEOUT_MS = 5_000
// Why: absorb renderer polling bursts while bounding external worktree-change lag to one short refresh window.
export const DETECTED_WORKTREE_SCAN_CACHE_TTL_MS = 5_000

export type DetectedWorktreeScanCacheEntry = {
  expiresAt: number
  worktrees: GitWorktreeInfo[]
}

export type DetectedWorktreeScan = {
  invalidated: boolean
  promise: Promise<GitWorktreeInfo[]>
}

export type DetectedWorktreeScanResult = {
  gitWorktrees: GitWorktreeInfo[]
  fresh: boolean
}

export const detectedWorktreeScanCache = new Map<string, DetectedWorktreeScanCacheEntry>()
export const detectedWorktreeScanInFlight = new Map<string, DetectedWorktreeScan>()

export function invalidateDetectedWorktreeScanCache(repoId: string): void {
  const keyPrefix = `${repoId}\0`
  for (const key of new Set([
    ...detectedWorktreeScanCache.keys(),
    ...detectedWorktreeScanInFlight.keys()
  ])) {
    if (!key.startsWith(keyPrefix)) {
      continue
    }
    detectedWorktreeScanCache.delete(key)
    const inFlight = detectedWorktreeScanInFlight.get(key)
    if (inFlight) {
      // Why: the detached scan keeps this token so later scans settle without making an older result fresh again.
      inFlight.invalidated = true
      detectedWorktreeScanInFlight.delete(key)
    }
  }
}

registerWorktreeChangeInvalidator(invalidateDetectedWorktreeScanCache)

export function __resetDetectedWorktreeScanCacheForTests(): void {
  // Why: pending scans across a test reset must not repopulate the cache and leak state into the next test.
  for (const scan of detectedWorktreeScanInFlight.values()) {
    scan.invalidated = true
  }
  detectedWorktreeScanCache.clear()
  detectedWorktreeScanInFlight.clear()
}

export function __getDetectedWorktreeScanCacheStatsForTests(): {
  cacheSize: number
  inFlightSize: number
} {
  return {
    cacheSize: detectedWorktreeScanCache.size,
    inFlightSize: detectedWorktreeScanInFlight.size
  }
}

export async function listDetectedGitWorktrees(
  store: Store,
  repo: Repo
): Promise<DetectedWorktreeScanResult> {
  const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  if (repo.connectionId || isFolderRepo(repo)) {
    return {
      gitWorktrees: await listRepoWorktrees(repo, localWorktreeGitOptions),
      fresh: true
    }
  }

  const cacheKey = getDetectedWorktreeScanCacheKey(repo.id, localWorktreeGitOptions)
  const cached = detectedWorktreeScanCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { gitWorktrees: cached.worktrees, fresh: false }
  }

  const inFlight = detectedWorktreeScanInFlight.get(cacheKey)
  if (inFlight) {
    return { gitWorktrees: await inFlight.promise, fresh: false }
  }

  const scan: DetectedWorktreeScan = {
    invalidated: false,
    promise: listRepoWorktrees(repo, localWorktreeGitOptions)
  }
  detectedWorktreeScanInFlight.set(cacheKey, scan)
  try {
    const gitWorktrees = await scan.promise
    // Why: a create/remove notification can invalidate mid-scan; don't let that stale scan repopulate the cache afterward.
    if (!scan.invalidated) {
      detectedWorktreeScanCache.set(cacheKey, {
        worktrees: gitWorktrees,
        expiresAt: Date.now() + DETECTED_WORKTREE_SCAN_CACHE_TTL_MS
      })
    }
    return { gitWorktrees, fresh: !scan.invalidated }
  } finally {
    if (detectedWorktreeScanInFlight.get(cacheKey) === scan) {
      detectedWorktreeScanInFlight.delete(cacheKey)
    }
  }
}

export function getDetectedWorktreeScanCacheKey(
  repoId: string,
  localWorktreeGitOptions: { wslDistro?: string } = {}
): string {
  return `${repoId}\0${localWorktreeGitOptions.wslDistro ?? 'host'}`
}

export function warnOnce(keySet: Set<string>, key: string, message: string, error?: unknown): void {
  if (!shouldEmitBoundedWarning(keySet, key)) {
    return
  }
  if (error) {
    console.warn(message, error)
  } else {
    console.warn(message)
  }
}

export function rememberLocalWorktreeRoots(
  store: Store,
  repo: Repo,
  gitWorktrees: GitWorktreeInfo[]
): void {
  if (repo.connectionId) {
    return
  }
  // Why: reuse the `git worktree list` result so later git/file IPC validation skips a second scan that can trigger macOS folder-permission prompts.
  registerWorktreeRootsForRepo(store, repo.id, [
    repo.path,
    ...gitWorktrees.map((worktree) => worktree.path)
  ])
}
