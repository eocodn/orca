/* import type { StateCreator, StoreApi } from 'zustand'
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
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createWorktreeSlicePurgeStaleRuntimeHostStateActions12(set: SliceSet, get: SliceGet) {
  return {
  purgeStaleRuntimeHostState: (removedEnvironmentIds) => {
    const removed = new Set(removedEnvironmentIds)
    if (removed.size === 0) {
      return
    }
    set((s) => {
      const repoIdsWithRemovedOwners = new Set<string>()
      const survivingRepoIds = new Set<string>()
      const repoIdsWithSurvivingOwners = new Set<string>()
      const survivingRepos: AppState['repos'] = []
      for (const repo of s.repos) {
        if (isRemovedRuntimeHostId(getRepoExecutionHostId(repo), removed)) {
          repoIdsWithRemovedOwners.add(repo.id)
        } else {
          survivingRepos.push(repo)
          survivingRepoIds.add(repo.id)
          repoIdsWithSurvivingOwners.add(repo.id)
        }
      }
      const reposChanged = survivingRepos.length !== s.repos.length

      // Why: a repoId-less setup on the removed host can still split a surviving project group, so drop every setup it owns.
      const survivingSetups: AppState['projectHostSetups'] = []
      for (const setup of s.projectHostSetups) {
        if (isRemovedRuntimeHostId(setup.hostId, removed)) {
          if (setup.repoId) {
            repoIdsWithRemovedOwners.add(setup.repoId)
          }
        } else {
          survivingSetups.push(setup)
          if (setup.repoId) {
            repoIdsWithSurvivingOwners.add(setup.repoId)
          }
        }
      }
      const setupsChanged = survivingSetups.length !== s.projectHostSetups.length
      const detectedRows: Record<string, DetectedWorktreeListResult['worktrees']> =
        Object.fromEntries(
          Object.entries(s.detectedWorktreesByRepo).map(([repoId, result]) => [
            repoId,
            result.worktrees
          ])
        )
      // Why: repo/setup catalogs can lag session hydration, so hosted worktree rows are ownership evidence during that gap.
      const recordWorktreeOwners = (
        rowsByRepo: Record<
          string,
          readonly { hostId?: ExecutionHostId; runtimeOwnerEnvironmentId?: string }[]
        >
      ): void => {
        for (const [repoId, rows] of Object.entries(rowsByRepo)) {
          for (const row of rows) {
            if (!row.hostId && !row.runtimeOwnerEnvironmentId) {
              continue
            }
            const ownerWasRemoved = row.runtimeOwnerEnvironmentId
              ? removed.has(row.runtimeOwnerEnvironmentId)
              : isRemovedRuntimeHostId(row.hostId, removed)
            const ownerSet = ownerWasRemoved ? repoIdsWithRemovedOwners : repoIdsWithSurvivingOwners
            ownerSet.add(repoId)
          }
        }
      }
      recordWorktreeOwners(s.worktreesByRepo)
      recordWorktreeOwners(detectedRows)

      const sessionWorktreeIdsOwnedByRemovedHosts = new Set<string>()
      let survivingRestoredSessionOwners = s.restoredRuntimeHostIdByWorkspaceSessionKey
      for (const [workspaceKey, hostId] of Object.entries(
        s.restoredRuntimeHostIdByWorkspaceSessionKey
      )) {
        const scope = parseWorkspaceKey(workspaceKey)
        if (scope?.type === 'folder') {
          continue
        }
        const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceKey
        const repoId = getRepoIdFromWorktreeId(worktreeId)
        if (!isRemovedRuntimeHostId(hostId, removed)) {
          // Why: restored sessions can be the only surviving-owner evidence before catalogs load.
          repoIdsWithSurvivingOwners.add(repoId)
          continue
        }
        sessionWorktreeIdsOwnedByRemovedHosts.add(worktreeId)
        repoIdsWithRemovedOwners.add(repoId)
        if (survivingRestoredSessionOwners === s.restoredRuntimeHostIdByWorkspaceSessionKey) {
          survivingRestoredSessionOwners = { ...survivingRestoredSessionOwners }
        }
        delete survivingRestoredSessionOwners[workspaceKey]
      }

      // Why: legacy rows predate host stamps; every owner record must agree no host survives before an unhosted row is retired.
      const repoIdsWithoutSurvivingOwners = new Set(repoIdsWithRemovedOwners)
      for (const repoId of repoIdsWithSurvivingOwners) {
        repoIdsWithoutSurvivingOwners.delete(repoId)
      }

      const worktreeDrop = dropWorktreeRowsForRemovedRuntimeEnvironments(
        s.worktreesByRepo,
        removed,
        repoIdsWithoutSurvivingOwners
      )
      const detectedDrop = dropWorktreeRowsForRemovedRuntimeEnvironments(
        detectedRows,
        removed,
        repoIdsWithoutSurvivingOwners
      )

      const worktreesChanged = worktreeDrop.rowsByRepo !== s.worktreesByRepo
      const detectedChanged = detectedDrop.rowsByRepo !== detectedRows

      const removedWorktreeIds = new Set([
        ...worktreeDrop.removedWorktreeIds,
        ...detectedDrop.removedWorktreeIds,
        ...sessionWorktreeIdsOwnedByRemovedHosts
      ])
      // Why: terminal tabs hydrate before worktree metadata, so session-only ids for owner-less repos still need purging.
      if (repoIdsWithoutSurvivingOwners.size > 0) {
        for (const worktreeId of Object.keys(s.tabsByWorktree)) {
          const scope = parseWorkspaceKey(worktreeId)
          const rawWorktreeId = scope?.type === 'worktree' ? scope.worktreeId : worktreeId
          if (
            scope?.type !== 'folder' &&
            repoIdsWithoutSurvivingOwners.has(getRepoIdFromWorktreeId(rawWorktreeId))
          ) {
            removedWorktreeIds.add(rawWorktreeId)
          }
        }
      }
      // Why: bare-id state follows an exact survivor unless the restored-session partition proves it belonged to the removed host.
      for (const rows of Object.values(worktreeDrop.rowsByRepo)) {
        for (const row of rows) {
          if (!sessionWorktreeIdsOwnedByRemovedHosts.has(row.id)) {
            removedWorktreeIds.delete(row.id)
          }
        }
      }
      for (const rows of Object.values(detectedDrop.rowsByRepo)) {
        for (const row of rows) {
          if (!sessionWorktreeIdsOwnedByRemovedHosts.has(row.id)) {
            removedWorktreeIds.delete(row.id)
          }
        }
      }
      const purgeState =
        removedWorktreeIds.size > 0 ? buildWorktreePurgeState(s, [...removedWorktreeIds]) : {}

      const restoredSessionOwnersChanged =
        survivingRestoredSessionOwners !== s.restoredRuntimeHostIdByWorkspaceSessionKey
      if (
        !reposChanged &&
        !setupsChanged &&
        !worktreesChanged &&
        !detectedChanged &&
        !restoredSessionOwnersChanged &&
        removedWorktreeIds.size === 0
      ) {
        return s
      }

      const detectedWorktreesByRepo = detectedChanged
        ? Object.fromEntries(
            Object.entries(s.detectedWorktreesByRepo).map(([repoId, result]) => [
              repoId,
              { ...result, worktrees: detectedDrop.rowsByRepo[repoId] }
            ])
          )
        : s.detectedWorktreesByRepo

      const rowsChanged = worktreesChanged || detectedChanged
      return {
        ...purgeState,
        ...(reposChanged ? { repos: survivingRepos } : {}),
        ...(setupsChanged ? { projectHostSetups: survivingSetups } : {}),
        ...(worktreesChanged ? { worktreesByRepo: worktreeDrop.rowsByRepo } : {}),
        ...(detectedChanged ? { detectedWorktreesByRepo } : {}),
        ...(restoredSessionOwnersChanged
          ? { restoredRuntimeHostIdByWorkspaceSessionKey: survivingRestoredSessionOwners }
          : {}),
        ...(rowsChanged ? { sortEpoch: s.sortEpoch + 1 } : {}),
        // Why: mirror validateRepoScopedUi so a filtered/active sidebar can't reference a purged repo id.
        ...(reposChanged
          ? {
              activeRepoId:
                s.activeRepoId && survivingRepoIds.has(s.activeRepoId) ? s.activeRepoId : null,
              filterRepoIds: s.filterRepoIds.filter((repoId) => survivingRepoIds.has(repoId))
            }
          : {})
      }
    })
  },
  migrateWorktreeIdentity: (oldWorktreeId: string, newWorktreeId: string) => {
    if (oldWorktreeId === newWorktreeId) {
      return
    }
    // Why: invalidate pre-rename toast actions before publishing the new path, carrying the dismissal forward.
    migrateHugeRepoWarningDismissal(oldWorktreeId, newWorktreeId)
    set((s) => buildWorktreeRenameState(s, oldWorktreeId, newWorktreeId))
    migrateHostedReviewLinkMutationGeneration(oldWorktreeId, newWorktreeId)
  }
  }
}