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
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates } from './worktrees-state'
export function directSshAuthorityIsComplete(
  authority: DirectSshAuthority,
  expectedTargetId: string
): boolean {
  if (
    authority.targetId !== expectedTargetId ||
    typeof authority.providerEpoch !== 'string' ||
    authority.providerEpoch.length === 0 ||
    !Number.isSafeInteger(authority.connectionGeneration) ||
    authority.connectionGeneration < 0
  ) {
    return false
  }
  return true
}
export function getCurrentDirectSshAuthority(
  state: Pick<AppState, 'sshConnectionStates'>,
  hostId: ExecutionHostId
): DirectSshAuthority | null {
  const parsedHost = parseExecutionHostId(hostId)
  if (parsedHost?.kind !== 'ssh') {
    return null
  }
  const connection = state.sshConnectionStates?.get(parsedHost.targetId)
  if (connection?.status !== 'connected') {
    return null
  }
  const authority = {
    targetId: parsedHost.targetId,
    providerEpoch: connection.providerEpoch,
    connectionGeneration: connection.connectionGeneration
  } as DirectSshAuthority
  if (!directSshAuthorityIsComplete(authority, parsedHost.targetId)) {
    return null
  }
  return {
    ...authority
  }
}
export function directSshAuthoritiesEqual(
  left: DirectSshAuthority | null | undefined,
  right: DirectSshAuthority | null | undefined
): boolean {
  if (!left || !right) {
    return false
  }
  return (
    left.targetId === right.targetId &&
    left.providerEpoch === right.providerEpoch &&
    left.connectionGeneration === right.connectionGeneration
  )
}
export function isCurrentDetectedWorktreeRefresh(
  state: Pick<AppState, 'sshConnectionStates'>,
  refresh: AdmittedDetectedWorktreeRefresh
): boolean {
  if (refresh.directSshAuthority) {
    return directSshAuthoritiesEqual(
      getCurrentDirectSshAuthority(state, refresh.executionHostId),
      refresh.directSshAuthority
    )
  }
  if (refresh.runtimeAuthority) {
    return (
      getEnvironmentSshStateGeneration(refresh.runtimeAuthority.environmentId) ===
        refresh.runtimeAuthority.connectionGeneration &&
      getRuntimeEnvironmentConnectionGeneration(refresh.runtimeAuthority.environmentId) ===
        refresh.runtimeAuthority.runtimeConnectionGeneration
    )
  }
  return true
}
export function staleDetectedWorktreeProviderResult(
  refresh: AdmittedDetectedWorktreeRefresh
): HostQualifiedDetectedWorktreeResult | undefined {
  return refresh.providerResult
    ? {
        providerRequestId: refresh.providerResult.providerRequestId,
        executionHostId: refresh.executionHostId,
        status: 'stale'
      }
    : undefined
}
export type FencedWorktreeMergeArgs = {
  repoId: string
  hostId: ExecutionHostId
  ownerWasMissingAtStart: boolean
  missingDirectSshOwnerReposSnapshot?: AppState['repos']
  requestStartedWorktrees: readonly Worktree[] | undefined
  setup?: ProjectHostSetup
  refresh: AdmittedDetectedWorktreeRefresh
  purgeRemovedWorktrees?: boolean
}
export function mergeFetchedWorktrees(
  set: Parameters<StateCreator<AppState, [], [], WorktreeSlice>>[0],
  args: FencedWorktreeMergeArgs
): boolean {
  let admitted = false
  set((s) => {
    if (
      !isCurrentDetectedWorktreeRefresh(s, args.refresh) ||
      !repoHasExactlyOneExecutionHostOwner(
        s,
        args.repoId,
        args.hostId,
        args.ownerWasMissingAtStart &&
          (!args.refresh.directSshAuthority || s.repos === args.missingDirectSshOwnerReposSnapshot)
      )
    ) {
      return s
    }
    admitted = true
    const matchOptions = worktreeHostMatchOptions(s, args.repoId, args.hostId)
    let incoming = toVisibleWorktrees(args.refresh.result, args.hostId, args.setup)
    incoming = routeListingBranchSwitchesThroughGitIdentity({
      requestStarted: args.requestStartedWorktrees,
      current: s.worktreesByRepo[args.repoId],
      incoming,
      matchesRefreshHost: (worktree) => worktreeMatchesHost(worktree, args.hostId, matchOptions),
      hasBranchScopedReviewContext: hasBranchScopedHostedReviewContext,
      updateWorktreeGitIdentity: s.updateWorktreeGitIdentity
    })
    const worktrees = sanitizeHostedReviewLinksForBranchClears(
      incoming,
      s.worktreesByRepo[args.repoId]
    )
    const currentForHost = (s.worktreesByRepo[args.repoId] ?? []).filter((worktree) =>
      worktreeMatchesHost(worktree, args.hostId, matchOptions)
    )
    const mergedDetected = mergeDetectedWorktreesForHost(
      s.detectedWorktreesByRepo[args.repoId],
      args.refresh.result,
      args.hostId,
      args.setup,
      matchOptions
    )
    if (!args.refresh.result.authoritative && worktrees.length === 0 && currentForHost.length > 0) {
      return areDetectedWorktreeResultsEqual(s.detectedWorktreesByRepo[args.repoId], mergedDetected)
        ? s
        : {
            detectedWorktreesByRepo: {
              ...s.detectedWorktreesByRepo,
              [args.repoId]: mergedDetected
            }
          }
    }
    const mergedWorktrees = mergeWorktreesForHost(
      s.worktreesByRepo[args.repoId],
      worktrees,
      args.hostId,
      matchOptions
    )
    const removedIds =
      args.purgeRemovedWorktrees === false
        ? []
        : getRemovedWorktreeIdsAfterAuthoritativeScan(
            s,
            args.repoId,
            args.refresh.result,
            args.hostId
          )
    const worktreesChanged = !areWorktreesEqual(s.worktreesByRepo[args.repoId], mergedWorktrees)
    const detectedChanged = !areDetectedWorktreeResultsEqual(
      s.detectedWorktreesByRepo[args.repoId],
      mergedDetected
    )
    if (!worktreesChanged && !detectedChanged && removedIds.length === 0) {
      return s
    }
    return {
      ...(worktreesChanged
        ? {
            worktreesByRepo: {
              ...s.worktreesByRepo,
              [args.repoId]: mergedWorktrees
            },
            sortEpoch: s.sortEpoch + 1
          }
        : {}),
      ...(detectedChanged
        ? {
            detectedWorktreesByRepo: {
              ...s.detectedWorktreesByRepo,
              [args.repoId]: mergedDetected
            }
          }
        : {}),
      ...(removedIds.length > 0 ? buildWorktreePurgeState(s, removedIds) : {})
    }
  })
  return admitted
}
export type DirectSshDetectedWorktreeRefresh = {
  waiterLeaseId: DetectedWorktreeRefreshLease['waiterLeaseId']
  providerRequestId: ProviderRequestId
  result: Promise<HostQualifiedDetectedWorktreeResult>
  release: DetectedWorktreeRefreshLease['release']
  merge(result: HostQualifiedDetectedWorktreeResult): HostQualifiedDetectedWorktreeResult
}
export function acquireDirectSshDetectedWorktreeRefresh(
  store: Pick<StoreApi<AppState>, 'getState' | 'setState'>,
  request: {
    repoId: string
    executionHostId: SshExecutionHostId
    authority: DirectSshAuthority
    requireAuthoritative?: boolean
  }
): DirectSshDetectedWorktreeRefresh {
  const requestStartedState = store.getState()
  const requestStartedWorktrees = requestStartedState.worktreesByRepo[request.repoId]
  const ownerWasMissingAtStart = !requestStartedState.repos.some(
    (repo) => repo.id === request.repoId
  )
  const setup = getProjectHostSetupForRepoHost(
    requestStartedState,
    request.repoId,
    request.executionHostId
  )
  const settings = settingsForRepoOwner(
    requestStartedState,
    request.repoId,
    request.executionHostId
  )
  const options: DetectedWorktreeRefreshOptions = {
    executionHostId: request.executionHostId,
    directSshAuthority: request.authority,
    requireAuthoritative: request.requireAuthoritative
  }
  const lease = acquireDetectedWorktreeRefreshLeaseForRepo(settings, request.repoId, options)
  let mergedResult: HostQualifiedDetectedWorktreeResult | undefined

  return {
    waiterLeaseId: lease.waiterLeaseId,
    providerRequestId: lease.providerRequestId,
    result: lease.result,
    release: lease.release,
    merge: (providerResult) => {
      if (mergedResult) {
        return mergedResult
      }
      if (
        !qualifiedProviderResultIsAdmitted(
          providerResult,
          lease.providerRequestId,
          request.repoId,
          options
        )
      ) {
        mergedResult = normalizeNotAdmittedProviderResult(
          providerResult,
          lease.providerRequestId,
          request.executionHostId
        )
        return mergedResult
      }
      if (request.requireAuthoritative && providerResult.status !== 'complete') {
        mergedResult = providerResult
        return mergedResult
      }
      const refresh: AdmittedDetectedWorktreeRefresh = {
        status: 'admitted',
        result: providerResult.result,
        providerResult,
        executionHostId: request.executionHostId,
        directSshAuthority: request.authority
      }
      const admitted = mergeFetchedWorktrees(
        store.setState as Parameters<StateCreator<AppState, [], [], WorktreeSlice>>[0],
        {
          repoId: request.repoId,
          hostId: request.executionHostId,
          ownerWasMissingAtStart,
          requestStartedWorktrees,
          setup,
          refresh
        }
      )
      mergedResult = admitted
        ? providerResult
        : (staleDetectedWorktreeProviderResult(refresh) ?? providerResult)
      return mergedResult
    }
  }
}
