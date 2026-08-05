 import type { StateCreator, StoreApi } from 'zustand'
import type { AppState } from '../types'
import type {
  DetectedWorktreeListResult,
  LocalBaseRefRefreshResult,
  ForceDeleteWorktreeBranchResult,
  FolderWorkspace,
  GitHubPrStartPoint,
  Worktree,
  WorkspaceVisibleTabType,
  GitPushTarget,
  RemoveWorktreeResult,
  WorktreeLineage,
  WorkspaceLineage,
  ProjectHostSetup,
  WorktreeMeta
} from '../../../../shared/types'
import type { RuntimeWorktreeListResult } from '../../../../shared/runtime-types'
import {
  findWorktreeById,
  applyWorktreeUpdates,
  withoutErasedRequiredWorktreeFields,
  getRepoIdFromWorktreeId,
  type DirectSshWorktreeFetchOptions,
  type WorktreeFetchOptions,
  type WorktreeSlice
} from './worktree-helpers'
import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree-id'
import { areWorkspaceLinkedItemsEqual } from '../../../../shared/workspace-linked-item'
import { areTaskSourceContextsEqual } from '../../../../shared/task-source-context'
import {
  remapClosedTerminalTabSnapshotCwds,
  type ClosedTerminalTabSnapshot
} from './recently-closed-tabs'
import { findRepoForHost } from './repo-host-identity'
import {
  dropWorktreeRowsForRemovedRuntimeEnvironments,
  isRemovedRuntimeHostId
} from './stale-runtime-host-rows'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { disposeRemovedWorktreeParkedTerminalWatchers } from '../../components/terminal-pane/terminal-parked-watcher-registry'
import {
  callRuntimeRpc,
  assertRuntimeEnvironmentCapability,
  getActiveRuntimeTarget,
  isRuntimeScopeForbiddenError,
  RuntimeRpcCallError
} from '../../runtime/runtime-rpc-client'
import { WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { getHostedReviewCacheKey, refreshHostedReviewCard } from './hosted-review'
import { routeListingBranchSwitchesThroughGitIdentity } from './worktree-listing-branch-switch'
import { isPositiveHostedReviewNumber } from '../../../../shared/hosted-review'
import { getGitHubPRCacheKey, getLegacyGitHubPRCacheKey } from './github-cache-key'
import { moveFocusToRendererBeforeFocusedWebviewHidden } from './browser-webview-cleanup'
import { toast } from 'sonner'
import { requestVirtualizedScrollAnchorRecord } from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { forgetAgentHibernationTabOutput } from '@/lib/agent-hibernation-output-activity'
import { forgetForegroundTerminalTabs } from '@/lib/foreground-terminal-tabs'
import { forgetAgentStartupDeliveriesForTabs } from '@/lib/agent-startup-delivery-guards'
import { forgetAgentPaneAuthorityAliasesByTabIds } from './agent-pane-authority'
import { branchName } from '@/lib/git-utils'
import { markInputQuietSchedulerInput, scheduleAfterInputQuiet } from '@/lib/input-quiet-scheduler'
import { clearSessionCommitDraftForWorktree } from '@/lib/source-control-commit-draft-session'
import {
  forgetHugeRepoWarningDismissalsForWorktrees,
  migrateHugeRepoWarningDismissal
} from '@/lib/source-control-huge-repo-warning-dismissals'
import { showLocalBaseRefUpdateSuggestionToast } from '@/components/sidebar/local-base-ref-suggestion-toast'
import { showPreservedBranchToast } from '@/components/sidebar/preserved-branch-toast'
import { requestWorktreeBaseFallbackNotice } from '@/components/worktree-base-fallback-notice'
import { translate } from '@/i18n/i18n'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  resolveWorktreeOperationRoute,
  settingsForWorktreeOperationRoute
} from '@/lib/worktree-operation-route'
import { captureWorktreeOperationGenerationGuard } from '@/lib/worktree-operation-generation'
import { getEnvironmentSshStateGeneration } from './runtime-environment-ssh'
import { getRuntimeEnvironmentConnectionGeneration } from './runtime-status'
import {
  folderWorkspaceKey,
  getActiveSidebarWorkspaceId,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  isRetryableWorktreeCreateConflict
} from '../../../../shared/new-workspace/worktree-create-retry-policy'
import {
  classifyWorktreeForceDeleteReason,
  getLockedWorktreeRemovalReason,
  isLockedWorktreeRemovalError
} from '../../../../shared/worktree-removal'
import { FolderWorkspaceActivityPersistence } from './folder-workspace-activity-persistence'
import {
  createDetectedWorktreeRefreshLeaseRegistry,
  type DetectedWorktreeRefreshLease
} from './detected-worktree-refresh-leases'
import { getTerminalActivationSpawnSuppression } from './terminal-activation-spawn-suppression'
import type {
  HostQualifiedDetectedWorktreeResult,
  ListDetectedWorktreesArgs,
  ProviderRequestId,
  SshExecutionHostId
} from '../../../../shared/detected-worktree-provider-contract'
import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { findIndexedWorktreeOwnerForHost } from '@/lib/worktree-runtime-owner-index'
export type { WorktreeSlice, WorktreeDeleteState } from './worktree-helpers'

// Why: old runtime servers only have `worktree.list`; preserve the large-list UI hydration parity used before `worktree.detectedList` existed.
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
export function withRepoHostOwnership<
  T extends {
    hostId?: ExecutionHostId
    runtimeOwnerEnvironmentId?: string
    projectId?: string
    projectHostSetupId?: string
  }
>(worktree: T, hostId: ExecutionHostId, setup?: ProjectHostSetup): T {
  const parsedOwner = parseExecutionHostId(hostId)
  const runtimeOwnerEnvironmentId =
    parsedOwner?.kind === 'runtime' ? parsedOwner.environmentId : undefined
  const worktreeHost = parseExecutionHostId(worktree.hostId)
  // Why: an SSH worktree reached through a paired HUB has two owners; retain the SSH execution host and stamp the HUB transport separately.
  const nextHostId =
    hostId === LOCAL_EXECUTION_HOST_ID ||
    (runtimeOwnerEnvironmentId !== undefined && worktreeHost?.kind === 'ssh')
      ? worktree.hostId
      : hostId
  const projectId = worktree.projectId ?? setup?.projectId
  const projectHostSetupId = worktree.projectHostSetupId ?? setup?.id
  if (
    nextHostId === worktree.hostId &&
    runtimeOwnerEnvironmentId === worktree.runtimeOwnerEnvironmentId &&
    projectId === worktree.projectId &&
    projectHostSetupId === worktree.projectHostSetupId
  ) {
    return worktree
  }
  return {
    ...worktree,
    ...(nextHostId ? { hostId: nextHostId } : {}),
    runtimeOwnerEnvironmentId,
    ...(projectId ? { projectId } : {}),
    ...(projectHostSetupId ? { projectHostSetupId } : {})
  } as T
}
export function repoHostId(
  state: Pick<AppState, 'repos' | 'settings'>,
  repoId: string,
  hostId?: ExecutionHostId | null
): ExecutionHostId {
  const repo = findRepoForHost(state.repos, repoId, { hostId, settings: state.settings })
  if (repo) {
    return getRepoExecutionHostId(repo)
  }
  return hostId && parseExecutionHostId(hostId) ? hostId : LOCAL_EXECUTION_HOST_ID
}
export function repoHasExactlyOneExecutionHostOwner(
  state: Pick<AppState, 'repos'>,
  repoId: string,
  hostId: ExecutionHostId,
  ownerWasMissingAtStart: boolean
): boolean {
  const repoOwners = state.repos.filter((repo) => repo.id === repoId)
  if (repoOwners.length === 0) {
    return ownerWasMissingAtStart
  }
  const ownerHostIds = repoOwners.map((repo) => {
    const hasExplicitHost = repo.executionHostId !== null && repo.executionHostId !== undefined
    const explicitHost = hasExplicitHost ? parseExecutionHostId(repo.executionHostId) : null
    if (hasExplicitHost && !explicitHost) {
      return null
    }
    const rawConnectionId = repo.connectionId
    const hasConnection = rawConnectionId !== null && rawConnectionId !== undefined
    const connectionId = hasConnection ? rawConnectionId.trim() : null
    if (hasConnection && !connectionId) {
      return null
    }
    if (!connectionId || explicitHost?.kind === 'runtime') {
      return explicitHost?.id ?? LOCAL_EXECUTION_HOST_ID
    }
    if (explicitHost && explicitHost.id !== toSshExecutionHostId(connectionId)) {
      return null
    }
    return explicitHost?.id ?? toSshExecutionHostId(connectionId)
  })
  return (
    ownerHostIds.every((ownerHostId) => ownerHostId !== null) &&
    ownerHostIds.filter((ownerHostId) => ownerHostId === hostId).length === 1
  )
}
export function toVisibleWorktrees(
  result: DetectedWorktreeListResult,
  hostId: ExecutionHostId,
  setup?: ProjectHostSetup
): Worktree[] {
  return result.worktrees
    .filter((worktree) => worktree.visible)
    .map(toVisibleWorktree)
    .map((worktree) => withRepoHostOwnership(worktree, hostId, setup))
}
export function getProjectHostSetupForRepoHost(
  state: Partial<Pick<AppState, 'projectHostSetups'>>,
  repoId: string,
  hostId: ExecutionHostId
): ProjectHostSetup | undefined {
  return state.projectHostSetups?.find(
    (setup) => setup.repoId === repoId && setup.hostId === hostId
  )
}
export function getHydratedSessionWorktreeIdsForRepo(state: AppState, repoId: string): string[] {
  return Object.keys(state.tabsByWorktree).filter((id) => getRepoIdFromWorktreeId(id) === repoId)
}
export type WorktreeHostMatchOptions = {
  unhostedWorktreesMatchHost?: boolean
}
export type RepoHostSummary = {
  count: number
  onlyHostId?: ExecutionHostId
}
export const repoHostSummariesByRepos = new WeakMap<AppState['repos'], Map<string, RepoHostSummary>>()
export function getRepoHostSummaries(repos: AppState['repos']): Map<string, RepoHostSummary> {
  const cached = repoHostSummariesByRepos.get(repos)
  if (cached) {
    return cached
  }

  const summaries = new Map<string, RepoHostSummary>()
  for (const repo of repos) {
    const current = summaries.get(repo.id)
    if (current) {
      summaries.set(repo.id, { count: current.count + 1 })
    } else {
      summaries.set(repo.id, { count: 1, onlyHostId: getRepoExecutionHostId(repo) })
    }
  }
  repoHostSummariesByRepos.set(repos, summaries)
  return summaries
}
export function unhostedWorktreesMatchRefreshHost(
  state: Pick<AppState, 'repos'>,
  repoId: string,
  hostId: ExecutionHostId
): boolean {
  if (hostId === LOCAL_EXECUTION_HOST_ID) {
    return true
  }

  const summary = getRepoHostSummaries(state.repos).get(repoId)
  return summary?.count === 1 && summary.onlyHostId === hostId
}
export function worktreeHostMatchOptions(
  state: Pick<AppState, 'repos'>,
  repoId: string,
  hostId: ExecutionHostId
): WorktreeHostMatchOptions {
  return {
    // Why: pre-host persisted runtime/SSH worktrees lack hostId; treat them as the sole repo owner's rows but keep ambiguous duplicates local.
    unhostedWorktreesMatchHost: unhostedWorktreesMatchRefreshHost(state, repoId, hostId)
  }
}
export function worktreeMatchesHost(
  worktree: { hostId?: ExecutionHostId; runtimeOwnerEnvironmentId?: string },
  hostId: ExecutionHostId,
  options: WorktreeHostMatchOptions = {}
): boolean {
  const parsedRefreshHost = parseExecutionHostId(hostId)
  if (parsedRefreshHost?.kind === 'runtime') {
    if (worktree.runtimeOwnerEnvironmentId) {
      return worktree.runtimeOwnerEnvironmentId === parsedRefreshHost.environmentId
    }
    if (worktree.hostId) {
      return worktree.hostId === hostId
    }
    return options.unhostedWorktreesMatchHost ?? false
  }
  if (worktree.runtimeOwnerEnvironmentId) {
    return false
  }
  if (worktree.hostId) {
    return worktree.hostId === hostId
  }
  return options.unhostedWorktreesMatchHost ?? hostId === LOCAL_EXECUTION_HOST_ID
}
export function mergeWorktreesForHost<
  T extends { hostId?: ExecutionHostId; runtimeOwnerEnvironmentId?: string }
>(
  current: readonly T[] | undefined,
  refreshed: readonly T[],
  hostId: ExecutionHostId,
  options?: WorktreeHostMatchOptions
): T[] {
  // Why: host-scoped refreshes replace that host in place so alternating local/runtime refreshes don't churn sibling row order or sortEpoch.
  const existing = current ?? []
  const next: T[] = []
  let inserted = false

  for (const worktree of existing) {
    if (worktreeMatchesHost(worktree, hostId, options)) {
      if (!inserted) {
        next.push(...refreshed)
        inserted = true
      }
      continue
    }
    next.push(worktree)
  }

  return inserted ? next : [...next, ...refreshed]
}
export function mergeDetectedWorktreesForHost(
  current: DetectedWorktreeListResult | undefined,
  refreshed: DetectedWorktreeListResult,
  hostId: ExecutionHostId,
  setup?: ProjectHostSetup,
  options?: WorktreeHostMatchOptions
): DetectedWorktreeListResult {
  const refreshedForHost = sanitizeHostedReviewLinksForBranchClears(
    refreshed.worktrees,
    current?.worktrees
  ).map((worktree) => withRepoHostOwnership(worktree, hostId, setup))
  return {
    ...refreshed,
    worktrees: mergeWorktreesForHost(current?.worktrees, refreshedForHost, hostId, options)
  }
}
export function getKnownWorktreeIdsForPurge(
  state: AppState,
  repoId: string,
  hostId: ExecutionHostId
): string[] {
  const detected = state.detectedWorktreesByRepo[repoId]
  const knownIds = new Set<string>()
  const matchOptions = worktreeHostMatchOptions(state, repoId, hostId)
  if (detected?.authoritative === true) {
    for (const worktree of detected.worktrees) {
      if (worktreeMatchesHost(worktree, hostId, matchOptions)) {
        knownIds.add(worktree.id)
      }
    }
  } else {
    for (const worktree of state.worktreesByRepo[repoId] ?? []) {
      if (worktreeMatchesHost(worktree, hostId, matchOptions)) {
        knownIds.add(worktree.id)
      }
    }
  }
  if (!state.hasHydratedWorktreePurge && matchOptions.unhostedWorktreesMatchHost === true) {
    // Why (#1158): hydration can preserve tab keys before worktree metadata exists; the first authoritative scan must still reap deleted session-only keys.
    for (const id of getHydratedSessionWorktreeIdsForRepo(state, repoId)) {
      knownIds.add(id)
    }
  }
  return [...knownIds]
}
export function getRemovedWorktreeIdsAfterAuthoritativeScan(
  state: AppState,
  repoId: string,
  detected: DetectedWorktreeListResult,
  hostId: ExecutionHostId
): string[] {
  if (!detected.authoritative) {
    return []
  }
  const detectedIds = new Set(detected.worktrees.map((worktree) => worktree.id))
  return getKnownWorktreeIdsForPurge(state, repoId, hostId).filter((id) => !detectedIds.has(id))
}
export function toLegacyDetectedWorktreeResult(
  repoId: string,
  result: { worktrees: Worktree[] }
): DetectedWorktreeListResult {
  return {
    repoId,
    authoritative: true,
    source: 'session-fallback',
    worktrees: result.worktrees.map((worktree) => ({
      ...worktree,
      ownership: 'orca-managed',
      selectedCheckout: false,
      visible: true
    }))
  }
}
export function isRuntimeMethodNotFoundError(error: unknown): boolean {
  return error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
}

// Why: teardown cannot ride the scan's coalescing (each caller has its own known-id
// snapshot), so dedupe on the request it actually produces — identical fan-out
// requests share one host sweep instead of re-scanning per caller.
