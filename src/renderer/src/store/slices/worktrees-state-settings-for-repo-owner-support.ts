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
import { cleanupEphemeralVmRuntimesForDeleted } from '@/lib/ephemeral-vm-runtime-cleanup'
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
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
export function settingsForRepoOwner(
  state: Pick<AppState, 'repos' | 'settings'>,
  repoId: string,
  hostId?: ExecutionHostId | null,
  honorMissingHostId = false
) {
  const repo = findRepoForHost(state.repos, repoId, { hostId, settings: state.settings })
  if (repo) {
    return settingsForKnownRepoOwner(state.settings, repo)
  }
  const parsedHost = honorMissingHostId && hostId ? parseExecutionHostId(hostId) : null
  if (parsedHost?.kind === 'runtime') {
    return state.settings
      ? { ...state.settings, activeRuntimeEnvironmentId: parsedHost.environmentId }
      : ({ activeRuntimeEnvironmentId: parsedHost.environmentId } as AppState['settings'])
  }
  if (parsedHost?.kind === 'local' || parsedHost?.kind === 'ssh') {
    return state.settings
      ? { ...state.settings, activeRuntimeEnvironmentId: null }
      : ({ activeRuntimeEnvironmentId: null } as AppState['settings'])
  }
  return state.settings
}
export function settingsForKnownRepoOwner(
  settings: AppState['settings'],
  repo: { connectionId?: string | null; executionHostId?: ExecutionHostId | null }
) {
  if (!repo.executionHostId && !repo.connectionId) {
    return settings
  }
  const parsed = parseExecutionHostId(getRepoExecutionHostId(repo))
  if (parsed?.kind === 'runtime') {
    return settings
      ? { ...settings, activeRuntimeEnvironmentId: parsed.environmentId }
      : ({ activeRuntimeEnvironmentId: parsed.environmentId } as AppState['settings'])
  }
  if (parsed?.kind === 'local' && settings?.activeRuntimeEnvironmentId) {
    return { ...settings, activeRuntimeEnvironmentId: null }
  }
  if (parsed?.kind !== 'ssh') {
    return settings
  }
  // Why: SSH repos are owned by the desktop client/SSH provider, not the focused runtime server.
  return settings
    ? { ...settings, activeRuntimeEnvironmentId: null }
    : ({ activeRuntimeEnvironmentId: null } as AppState['settings'])
}
export function trySettingsForWorktreeOwner(
  state: Pick<
    AppState,
    | 'repos'
    | 'settings'
    | 'worktreesByRepo'
    | 'detectedWorktreesByRepo'
    | 'folderWorkspaces'
    | 'projectGroups'
    | 'restoredRuntimeHostIdByWorkspaceSessionKey'
    | 'runtimeEnvironments'
    | 'runtimeEnvironmentCatalogHydrated'
    | 'removedRuntimeEnvironmentIds'
  >,
  worktreeId: string
): AppState['settings'] | null {
  const route = resolveWorktreeOperationRoute(state, worktreeId)
  if (!route) {
    return null
  }
  return settingsForWorktreeOperationRoute(state.settings, route)
}
export function settingsForWorktreeOwner(
  state: Parameters<typeof trySettingsForWorktreeOwner>[0],
  worktreeId: string
) {
  const settings = trySettingsForWorktreeOwner(state, worktreeId)
  if (!settings) {
    throw new Error(WORKTREE_REMOVAL_AMBIGUOUS_ERROR)
  }
  return settings
}

// Why: activity bumps fire on every PTY event, so an ambiguous workspace would warn continuously.
// One line per workspace is enough to diagnose it (#10634).
export const ambiguousOwnerWarnedWorktreeIds = new Set<string>()
export function warnAmbiguousOwnerOnce(worktreeId: string, errorLabel: string): void {
  if (ambiguousOwnerWarnedWorktreeIds.has(worktreeId)) {
    return
  }
  ambiguousOwnerWarnedWorktreeIds.add(worktreeId)
  console.warn(`Skipped ${errorLabel}: workspace identity is ambiguous across hosts`, worktreeId)
}
export function persistPassiveWorktreeMetaForOwner(
  get: WorktreeSliceGet,
  worktreeId: string,
  updates: Partial<WorktreeMeta>,
  errorLabel: string
): void {
  const ownerSettings = trySettingsForWorktreeOwner(get(), worktreeId)
  if (!ownerSettings) {
    warnAmbiguousOwnerOnce(worktreeId, errorLabel)
    return
  }
  void persistWorktreeMeta(ownerSettings, worktreeId, updates).catch((err) => {
    if (isRuntimeSelectorNotFoundError(err)) {
      void get().fetchWorktrees(getRepoIdFromWorktreeId(worktreeId))
      return
    }
    console.error(`Failed to ${errorLabel}:`, err)
    void get().fetchWorktrees(getRepoIdFromWorktreeId(worktreeId))
  })
}

async function listDetectedWorktreesForRepo(
  settings: AppState['settings'],
  repoId: string,
  options: BackgroundRuntimeRefreshOptions = {}
): Promise<DetectedWorktreeListResult> {
  const target = getActiveRuntimeTarget(settings)
  if (target.kind === 'local') {
    throw new Error('Local detected-worktree reads require a provider lease')
  }
  try {
    return await callRuntimeRpc<DetectedWorktreeListResult>(
      target,
      'worktree.detectedList',
      { repo: repoId },
      {
        timeoutMs: 15_000,
        reuseRecentCompatibilityFailure: options.reuseRecentCompatibilityFailure
      }
    )
  } catch (error) {
    if (!isRuntimeMethodNotFoundError(error)) {
      throw error
    }
    const legacy = await callRuntimeRpc<RuntimeWorktreeListResult>(
      target,
      'worktree.list',
      { repo: repoId, limit: REMOTE_WORKTREE_LIST_PARITY_LIMIT },
      {
        timeoutMs: 15_000,
        reuseRecentCompatibilityFailure: options.reuseRecentCompatibilityFailure
      }
    )
    return toLegacyDetectedWorktreeResult(repoId, legacy)
  }
}
export function detectedWorktreeRefreshKey(
  settings: AppState['settings'],
  repoId: string,
  options: DetectedWorktreeRefreshOptions
): string {
  const target = getActiveRuntimeTarget(settings)
  const targetKey = target.kind === 'local' ? 'local' : `runtime:${target.environmentId}`
  const parts = [
    repoId,
    options.executionHostId,
    targetKey,
    options.requireAuthoritative === true ? 'authoritative' : 'best-effort'
  ]
  // Why: only remote targets run a compat preflight, so a foreground (reuse:false) refresh must re-probe not coalesce onto a stale-failure background scan; local targets have no preflight and stay coalesced.
  if (target.kind === 'environment') {
    parts.push(`connection:${getEnvironmentSshStateGeneration(target.environmentId)}`)
    parts.push(`runtime:${getRuntimeEnvironmentConnectionGeneration(target.environmentId)}`)
    parts.push(options.reuseRecentCompatibilityFailure === true ? 'reuse-failure' : 'reprobe')
  }
  return parts.join('\n')
}
export function isDetectedWorktreeListResult(value: unknown): value is DetectedWorktreeListResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const result = value as Partial<DetectedWorktreeListResult>
  return (
    typeof result.repoId === 'string' &&
    typeof result.authoritative === 'boolean' &&
    (result.source === 'git' ||
      result.source === 'metadata-fallback' ||
      result.source === 'session-fallback') &&
    Array.isArray(result.worktrees)
  )
}
export function rejectedDetectedWorktreeProviderResult(
  request: ListDetectedWorktreesArgs
): HostQualifiedDetectedWorktreeResult {
  return {
    providerRequestId: request.providerRequestId,
    executionHostId: request.executionHostId,
    status: 'rejected'
  }
}

async function startDetectedWorktreeProviderRequest(
  request: ListDetectedWorktreesArgs
): Promise<HostQualifiedDetectedWorktreeResult> {
  const worktreesApi = window.api.worktrees as typeof window.api.worktrees & {
    listDetected?: typeof window.api.worktrees.listDetected
  }
  if (typeof worktreesApi.listDetected !== 'function') {
    if (request.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
      return rejectedDetectedWorktreeProviderResult(request)
    }
    const worktrees = await worktreesApi.list({ repoId: request.repoId })
    return {
      status: 'complete',
      providerRequestId: request.providerRequestId,
      repoId: request.repoId,
      authority: { kind: 'local', executionHostId: LOCAL_EXECUTION_HOST_ID },
      result: toLegacyDetectedWorktreeResult(request.repoId, { worktrees })
    }
  }
  const result = await worktreesApi.listDetected(request)
  if (result && typeof result === 'object' && 'status' in result && 'providerRequestId' in result) {
    return result as unknown as HostQualifiedDetectedWorktreeResult
  }
  // Why: web and older preload implementations return the legacy local shape.
  if (request.executionHostId === LOCAL_EXECUTION_HOST_ID && isDetectedWorktreeListResult(result)) {
    return {
      status: result.authoritative ? 'complete' : 'non-authoritative',
      providerRequestId: request.providerRequestId,
      repoId: request.repoId,
      authority: { kind: 'local', executionHostId: LOCAL_EXECUTION_HOST_ID },
      result
    }
  }
  return rejectedDetectedWorktreeProviderResult(request)
}
export const detectedWorktreeRefreshLeaseRegistry = createDetectedWorktreeRefreshLeaseRegistry({
  startProviderRequest: startDetectedWorktreeProviderRequest,
  cancelProviderRequest: async (request) => {
    await window.api.worktrees.cancelListDetected?.({
      providerRequestId: request.providerRequestId
    })
  }
})
export function acquireDetectedWorktreeRefreshLeaseForRepo(
  settings: AppState['settings'],
  repoId: string,
  options: DetectedWorktreeRefreshOptions
): DetectedWorktreeRefreshLease {
  const parsedHost = parseExecutionHostId(options.executionHostId)
  if (!parsedHost || parsedHost.kind === 'runtime') {
    throw new Error('Provider leases require a local or direct SSH execution host')
  }
  const publicKey = detectedWorktreeRefreshKey(settings, repoId, options)
  if (parsedHost.kind === 'local') {
    return detectedWorktreeRefreshLeaseRegistry.acquire(publicKey, {
      repoId,
      executionHostId: LOCAL_EXECUTION_HOST_ID
    })
  }
  if (
    !options.directSshAuthority ||
    !directSshAuthorityIsComplete(options.directSshAuthority, parsedHost.targetId)
  ) {
    throw new Error('Direct SSH provider leases require exact target authority')
  }
  return detectedWorktreeRefreshLeaseRegistry.acquire(publicKey, {
    repoId,
    executionHostId: options.executionHostId as SshExecutionHostId,
    expectedAuthority: { ...options.directSshAuthority }
  })
}
export function qualifiedProviderResultIsAdmitted(
  result: HostQualifiedDetectedWorktreeResult,
  providerRequestId: ProviderRequestId,
  repoId: string,
  options: DetectedWorktreeRefreshOptions
): result is Extract<
  HostQualifiedDetectedWorktreeResult,
  { status: 'complete' | 'non-authoritative' }
> {
  if (
    result.providerRequestId !== providerRequestId ||
    (result.status !== 'complete' && result.status !== 'non-authoritative') ||
    !isDetectedWorktreeListResult(result.result) ||
    !result.authority ||
    result.repoId !== repoId ||
    result.result.repoId !== repoId ||
    result.result.authoritative !== (result.status === 'complete')
  ) {
    return false
  }
  const parsedHost = parseExecutionHostId(options.executionHostId)
  if (parsedHost?.kind === 'local') {
    return (
      result.authority.kind === 'local' &&
      result.authority.executionHostId === LOCAL_EXECUTION_HOST_ID
    )
  }
  const expected = options.directSshAuthority
  return (
    parsedHost?.kind === 'ssh' &&
    expected !== undefined &&
    result.authority.kind === 'direct-ssh' &&
    result.authority.executionHostId === options.executionHostId &&
    result.authority.targetId === expected.targetId &&
    result.authority.providerEpoch === expected.providerEpoch &&
    result.authority.connectionGeneration === expected.connectionGeneration
  )
}
