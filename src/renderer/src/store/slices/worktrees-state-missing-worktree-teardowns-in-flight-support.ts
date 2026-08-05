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
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
export const missingWorktreeTeardownsInFlight = new Map<string, Promise<void>>()

async function teardownMissingWorktreeTerminalsBestEffort(
  settings: AppState['settings'],
  repoId: string,
  connectionId: string | null | undefined,
  // Why: refreshes that never purge omit this; an absent snapshot means
  // "nothing to reconcile", never "purge everything".
  knownWorktreeIds: readonly string[] | undefined,
  detected: DetectedWorktreeListResult
): Promise<void> {
  if (!detected.authoritative || !knownWorktreeIds || knownWorktreeIds.length === 0) {
    return
  }
  const detectedIds = new Set(detected.worktrees.map((worktree) => worktree.id))
  const missingIds = knownWorktreeIds.filter((worktreeId) => !detectedIds.has(worktreeId))
  if (missingIds.length === 0) {
    return
  }
  const target = getActiveRuntimeTarget(settings)
  const normalizedConnectionId = connectionId ?? null
  const key = [
    target.kind === 'local' ? 'local' : `runtime:${target.environmentId}`,
    repoId,
    normalizedConnectionId ?? '',
    [...missingIds].sort().join('\n')
  ].join('\0')
  const existing = missingWorktreeTeardownsInFlight.get(key)
  if (existing) {
    return existing
  }
  const teardown = (async () => {
    try {
      await callRuntimeRpc(
        target,
        'worktree.teardownMissingTerminals',
        { repo: repoId, worktreeIds: missingIds, connectionId: normalizedConnectionId },
        { timeoutMs: 30_000 }
      )
    } catch (error) {
      if (!isRuntimeMethodNotFoundError(error)) {
        console.warn(`Failed to stop terminals for missing worktrees in repo ${repoId}:`, error)
      }
    }
  })()
  missingWorktreeTeardownsInFlight.set(key, teardown)
  try {
    await teardown
  } finally {
    if (missingWorktreeTeardownsInFlight.get(key) === teardown) {
      missingWorktreeTeardownsInFlight.delete(key)
    }
  }
}

// Why: a mobile-scope web pairing is denied worktree/repo RPCs (else silently empty workspaces); surface one deduped toast (stable id) instead of spamming per-repo.
export const RUNTIME_SCOPE_FORBIDDEN_TOAST_ID = 'runtime-scope-forbidden'
export function notifyRuntimeScopeForbiddenIfNeeded(error: unknown): boolean {
  if (!isRuntimeScopeForbiddenError(error)) {
    return false
  }
  toast.error(
    translate(
      'auto.store.slices.worktrees.runtimeScopeForbiddenTitle',
      'This connection has limited (mobile) access'
    ),
    {
      id: RUNTIME_SCOPE_FORBIDDEN_TOAST_ID,
      description: translate(
        'auto.store.slices.worktrees.runtimeScopeForbiddenDescription',
        'Workspaces are unavailable on a mobile-scope pairing. Reconnect using the browser access link from Settings → Runtime Environments → Share this Orca server.'
      )
    }
  )
  return true
}
export function applyDetectedWorktreeUpdates(
  detectedWorktreesByRepo: AppState['detectedWorktreesByRepo'],
  worktreeId: string,
  rawUpdates: Partial<WorktreeMeta>
): AppState['detectedWorktreesByRepo'] {
  // Why: mirrors applyWorktreeUpdates — detected rows feed the same palette.
  const updates = withoutErasedRequiredWorktreeFields(rawUpdates)
  let changed = false
  const nextByRepo: AppState['detectedWorktreesByRepo'] = {}

  for (const [repoId, result] of Object.entries(detectedWorktreesByRepo)) {
    let repoChanged = false
    const nextWorktrees = result.worktrees.map((worktree) => {
      if (worktree.id !== worktreeId) {
        return worktree
      }
      repoChanged = true
      changed = true
      return { ...worktree, ...updates }
    })
    nextByRepo[repoId] = repoChanged ? { ...result, worktrees: nextWorktrees } : result
  }

  return changed ? nextByRepo : detectedWorktreesByRepo
}
export function folderWorkspaceMatchesHost(
  workspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>,
  executionHostId: ExecutionHostId
): boolean {
  return (
    (parseExecutionHostId(workspace.executionHostId)?.id ??
      (workspace.connectionId?.trim()
        ? toSshExecutionHostId(workspace.connectionId)
        : LOCAL_EXECUTION_HOST_ID)) === executionHostId
  )
}
export function findKnownWorktreeById(
  state: Pick<AppState, 'worktreesByRepo' | 'detectedWorktreesByRepo' | 'folderWorkspaces'>,
  worktreeId: string,
  executionHostId?: ExecutionHostId
): Worktree | DetectedWorktreeListResult['worktrees'][number] | undefined {
  const workspaceScope = parseWorkspaceKey(worktreeId)
  if (workspaceScope?.type === 'folder') {
    const folderWorkspace = state.folderWorkspaces.find(
      (workspace) =>
        workspace.id === workspaceScope.folderWorkspaceId &&
        (!executionHostId || folderWorkspaceMatchesHost(workspace, executionHostId))
    )
    if (!folderWorkspace) {
      return undefined
    }
    const cached = folderWorkspaceWorktreeCache.get(folderWorkspace)
    if (cached) {
      return cached
    }
    const worktree = folderWorkspaceToWorktree(folderWorkspace)
    folderWorkspaceWorktreeCache.set(folderWorkspace, worktree)
    return worktree
  }
  const visible = executionHostId
    ? (findIndexedWorktreeOwnerForHost(
        state.worktreesByRepo,
        worktreeId,
        executionHostId
      ) as Worktree | null)
    : findWorktreeById(state.worktreesByRepo, worktreeId)
  if (visible) {
    return visible
  }
  for (const result of Object.values(state.detectedWorktreesByRepo)) {
    const detected = result.worktrees.find(
      (worktree) =>
        worktree.id === worktreeId &&
        (!executionHostId ||
          worktreeMatchesHost(worktree, executionHostId, {
            unhostedWorktreesMatchHost: executionHostId === LOCAL_EXECUTION_HOST_ID
          }))
    )
    if (detected) {
      return detected
    }
  }
  return undefined
}
export function getFolderWorkspaceMetaUpdates(
  updates: Partial<WorktreeMeta>
): Partial<
  Pick<
    FolderWorkspace,
    | 'name'
    | 'comment'
    | 'isArchived'
    | 'isUnread'
    | 'isPinned'
    | 'sortOrder'
    | 'manualOrder'
    | 'lastActivityAt'
    | 'workspaceStatus'
    | 'createdWithAgent'
    | 'pendingFirstAgentMessageRename'
    | 'firstAgentMessageRenameError'
  >
> {
  const next: Partial<
    Pick<
      FolderWorkspace,
      | 'name'
      | 'comment'
      | 'isArchived'
      | 'isUnread'
      | 'isPinned'
      | 'sortOrder'
      | 'manualOrder'
      | 'lastActivityAt'
      | 'workspaceStatus'
      | 'createdWithAgent'
      | 'pendingFirstAgentMessageRename'
      | 'firstAgentMessageRenameError'
    >
  > = {}
  if (updates.displayName !== undefined) {
    next.name = updates.displayName
    next.pendingFirstAgentMessageRename = false
    next.firstAgentMessageRenameError = null
  }
  if (updates.comment !== undefined) {
    next.comment = updates.comment
    next.lastActivityAt = Date.now()
  }
  if (updates.isArchived !== undefined) {
    next.isArchived = updates.isArchived
  }
  if (updates.isUnread !== undefined) {
    next.isUnread = updates.isUnread
  }
  if (updates.isPinned !== undefined) {
    next.isPinned = updates.isPinned
  }
  if (updates.sortOrder !== undefined) {
    next.sortOrder = updates.sortOrder
  }
  if (updates.manualOrder !== undefined) {
    next.manualOrder = updates.manualOrder
  }
  if (updates.lastActivityAt !== undefined) {
    next.lastActivityAt = updates.lastActivityAt
  }
  if (updates.workspaceStatus !== undefined) {
    next.workspaceStatus = updates.workspaceStatus
  }
  if (updates.createdWithAgent !== undefined) {
    next.createdWithAgent = updates.createdWithAgent
  }
  if (updates.pendingFirstAgentMessageRename !== undefined) {
    next.pendingFirstAgentMessageRename = updates.pendingFirstAgentMessageRename
  }
  if (updates.firstAgentMessageRenameError !== undefined) {
    next.firstAgentMessageRenameError = updates.firstAgentMessageRenameError
  }
  return next
}
export function isRuntimeSelectorNotFoundError(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    isRuntimeSelectorNotFoundError((error as { cause?: unknown }).cause)
  ) {
    return true
  }
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null
  const responseCode =
    error &&
    typeof error === 'object' &&
    'response' in error &&
    typeof (error as { response?: { error?: { code?: unknown } } }).response?.error?.code ===
      'string'
      ? (error as { response: { error: { code: string } } }).response.error.code
      : null
  const responseMessage =
    error &&
    typeof error === 'object' &&
    'response' in error &&
    typeof (error as { response?: { error?: { message?: unknown } } }).response?.error?.message ===
      'string'
      ? (error as { response: { error: { message: string } } }).response.error.message
      : null
  const message = error instanceof Error ? error.message : String(error)
  return (
    message === 'selector_not_found' ||
    message.includes('selector_not_found') ||
    code === 'selector_not_found' ||
    responseCode === 'selector_not_found' ||
    responseMessage === 'selector_not_found' ||
    String(error).includes('selector_not_found')
  )
}
export function replaceWorktreeInRepoLists(
  worktreesByRepo: Record<string, Worktree[]>,
  updatedWorktree: Worktree
): Record<string, Worktree[]> {
  const repoId = getRepoIdFromWorktreeId(updatedWorktree.id)
  const current = worktreesByRepo[repoId]
  if (!current) {
    return worktreesByRepo
  }
  return {
    ...worktreesByRepo,
    [repoId]: current.map((worktree) =>
      worktree.id === updatedWorktree.id ? updatedWorktree : worktree
    )
  }
}
