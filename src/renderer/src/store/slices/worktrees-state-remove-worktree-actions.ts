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
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createWorktreeSliceRemoveWorktreeActions5(set: SliceSet, get: SliceGet) {
  return {
  removeWorktree: async (worktreeId, force, options) => {
    const forgetLocalOnly = options?.mode === 'forget-local'
    const removalRoute = resolveWorktreeOperationRoute(get(), worktreeId)
    if (!forgetLocalOnly && !removalRoute) {
      return { ok: false, error: WORKTREE_REMOVAL_AMBIGUOUS_ERROR }
    }
    const hostId = removalRoute?.executionHostId ?? undefined
    const removalGenerationGuard = removalRoute
      ? captureWorktreeOperationGenerationGuard(
          get,
          worktreeId,
          removalRoute,
          () => new Error(WORKTREE_REMOVAL_AMBIGUOUS_ERROR)
        )
      : null
    set((s) => ({
      deleteStateByWorktreeId: {
        ...s.deleteStateByWorktreeId,
        [worktreeId]: {
          isDeleting: true,
          phase: 'deleting',
          error: null,
          canForceDelete: false,
          forceDeleteReason: null
        }
      }
    }))

    try {
      // Why: forget-local touches no remote, so there's no archive hook to run or trust prompt needed.
      const skipArchive = forgetLocalOnly
        ? true
        : (await ensureHooksConfirmed(
            get(),
            getRepoIdFromWorktreeId(worktreeId),
            'archive',
            hostId,
            removalRoute?.runtimeEnvironmentId
          )) === 'skip'

      const worktreeBeforeRemoval = get()
        .allWorktrees()
        .find((entry) => entry.id === worktreeId)
      const terminalPtyIdsBeforeRemoval = (get().tabsByWorktree[worktreeId] ?? []).flatMap(
        (tab) => get().ptyIdsByTabId[tab.id] ?? []
      )
      if (!forgetLocalOnly) {
        removalGenerationGuard?.assertCurrent()
      }
      // Why: forget-local clears Orca's records via local IPC regardless of host — the remote is gone or unreachable.
      const target = getActiveRuntimeTarget(
        removalRoute
          ? settingsForWorktreeOperationRoute(get().settings, removalRoute)
          : get().settings
            ? { ...get().settings, activeRuntimeEnvironmentId: null }
            : { activeRuntimeEnvironmentId: null }
      )
      const removalResult = await (forgetLocalOnly
        ? window.api.worktrees.forgetLocal({ worktreeId, hostId })
        : target.kind === 'local'
          ? (removalGenerationGuard?.assertCurrent(),
            window.api.worktrees.remove({ worktreeId, hostId, force, skipArchive }))
          : (removalGenerationGuard?.assertCurrent(),
            callRuntimeRpc<RemoveWorktreeResult>(
              target,
              'worktree.rm',
              {
                worktree: toRuntimeWorktreeSelector(worktreeId),
                force,
                runHooks: !skipArchive
              },
              { timeoutMs: 60_000 }
            )))

      // Why: invalidate stale probes once deletion is authoritative, so an old toast can't mutate a same-path replacement.
      forgetHugeRepoWarningDismissalsForWorktrees([worktreeId])

      // Why: renderer state follows the successful backend result, so blocked dirty deletes keep their terminals intact.
      // Why browsers first: unregister Chromium guests before other teardown can intercept them (avoids a browser-state race).
      await get().shutdownWorktreeBrowsers(worktreeId)
      await get().shutdownWorktreeTerminals(worktreeId)
      // Why: dispose the SSH relay AFTER terminal teardown so a still-mounted pane can't hit a gone relay and toast "SSH not active".
      const destroyedRuntimeSshTargetIds = await cleanupEphemeralVmRuntimesForDeleted({
        workspaceIds: [worktreeId]
      })
      // Remove the orphaned project for the destroyed SSH target so it can't surface as a dead project in the composer.
      await purgeOrphanedRuntimeSshProjects(get, destroyedRuntimeSshTargetIds)
      const tabs = get().tabsByWorktree[worktreeId] ?? []
      const tabIds = new Set(tabs.map((t) => t.id))

      // Why: this path deletes tabsByWorktree wholesale (not via closeTab), so purge the module-level tab maps here too.
      detachedHeadAutoDerivedDisplayNames.delete(worktreeId)
      forgetForegroundTerminalTabs(tabIds)
      forgetAgentStartupDeliveriesForTabs(tabIds)

      // Why: snapshot the sidebar top-row anchor in the same tick we remove the row; recording at click time goes stale across the await.
      requestVirtualizedScrollAnchorRecord('[data-worktree-sidebar]')

      // Why: dispose parked terminal watchers only on explicit deletion; identity migration/remounts must keep buffered PTY state.
      disposeRemovedWorktreeParkedTerminalWatchers(worktreeId, terminalPtyIdsBeforeRemoval)
      set((s) => {
        const next = { ...s.worktreesByRepo }
        for (const repoId of Object.keys(next)) {
          next[repoId] = next[repoId].filter((w) => w.id !== worktreeId)
        }
        const nextTabs = { ...s.tabsByWorktree }
        delete nextTabs[worktreeId]
        const nextLayouts = { ...s.terminalLayoutsByTabId }
        const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
        const nextRuntimePaneTitlesByTabId = { ...s.runtimePaneTitlesByTabId }
        const nextAutomaticAgentResumeClaimsByTabId = {
          ...s.automaticAgentResumeClaimsByTabId
        }
        // Why: closeTab deletes these per-tab maps but removeWorktree missed them, leaking a split pane's expand flags.
        const nextExpandedPaneByTabId = { ...s.expandedPaneByTabId }
        const nextCanExpandPaneByTabId = { ...s.canExpandPaneByTabId }
        for (const tabId of tabIds) {
          delete nextLayouts[tabId]
          delete nextPtyIdsByTabId[tabId]
          delete nextRuntimePaneTitlesByTabId[tabId]
          delete nextAutomaticAgentResumeClaimsByTabId[tabId]
          delete nextExpandedPaneByTabId[tabId]
          delete nextCanExpandPaneByTabId[tabId]
        }
        const nextDeleteState = { ...s.deleteStateByWorktreeId }
        delete nextDeleteState[worktreeId]
        const nextLineage = { ...s.worktreeLineageById }
        delete nextLineage[worktreeId]
        const nextWorkspaceLineage = { ...s.workspaceLineageByChildKey }
        delete nextWorkspaceLineage[worktreeWorkspaceKey(worktreeId)]
        // Clean up editor files belonging to this worktree
        const newOpenFiles = s.openFiles.filter((f) => f.worktreeId !== worktreeId)
        const nextBrowserTabsByWorktree = { ...s.browserTabsByWorktree }
        delete nextBrowserTabsByWorktree[worktreeId]
        const nextActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
        delete nextActiveFileIdByWorktree[worktreeId]
        const nextActiveBrowserTabIdByWorktree = { ...s.activeBrowserTabIdByWorktree }
        delete nextActiveBrowserTabIdByWorktree[worktreeId]
        // Why: closeBrowserTab records a Cmd+Shift+T undo snapshot, but a deleted worktree's tabs can't be restored; purge it.
        const nextRecentlyClosedBrowserTabsByWorktree = {
          ...s.recentlyClosedBrowserTabsByWorktree
        }
        delete nextRecentlyClosedBrowserTabsByWorktree[worktreeId]
        const nextActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
        delete nextActiveTabTypeByWorktree[worktreeId]
        const nextActiveTabIdByWorktree = { ...s.activeTabIdByWorktree }
        delete nextActiveTabIdByWorktree[worktreeId]
        const nextTabBarOrderByWorktree = { ...s.tabBarOrderByWorktree }
        // Why: the tab strip persists visual order per worktree; drop the entry so stale tab IDs aren't retained.
        delete nextTabBarOrderByWorktree[worktreeId]
        const nextPendingReconnectTabByWorktree = { ...s.pendingReconnectTabByWorktree }
        delete nextPendingReconnectTabByWorktree[worktreeId]
        // Why: split-tab layout/group state is worktree-owned; leaving it makes a deleted worktree look restorable.
        const nextUnifiedTabsByWorktree = { ...s.unifiedTabsByWorktree }
        delete nextUnifiedTabsByWorktree[worktreeId]
        const nextGroupsByWorktree = { ...s.groupsByWorktree }
        delete nextGroupsByWorktree[worktreeId]
        const nextLayoutByWorktree = { ...s.layoutByWorktree }
        delete nextLayoutByWorktree[worktreeId]
        const nextActiveGroupIdByWorktree = { ...s.activeGroupIdByWorktree }
        delete nextActiveGroupIdByWorktree[worktreeId]
        // Why: git status/compare caches stop refreshing once the worktree is deleted; remove them so no stale badges/diffs linger.
        const nextGitStatusByWorktree = { ...s.gitStatusByWorktree }
        delete nextGitStatusByWorktree[worktreeId]
        const nextGitStatusHeadByWorktree = { ...s.gitStatusHeadByWorktree }
        delete nextGitStatusHeadByWorktree[worktreeId]
        const nextGitIgnoredPathsByWorktree = { ...s.gitIgnoredPathsByWorktree }
        delete nextGitIgnoredPathsByWorktree[worktreeId]
        const nextGitConflictOperationByWorktree = { ...s.gitConflictOperationByWorktree }
        delete nextGitConflictOperationByWorktree[worktreeId]
        const nextTrackedConflictPathsByWorktree = { ...s.trackedConflictPathsByWorktree }
        delete nextTrackedConflictPathsByWorktree[worktreeId]
        const nextGitBranchChangesByWorktree = { ...s.gitBranchChangesByWorktree }
        delete nextGitBranchChangesByWorktree[worktreeId]
        const nextGitBranchCompareSummaryByWorktree = { ...s.gitBranchCompareSummaryByWorktree }
        delete nextGitBranchCompareSummaryByWorktree[worktreeId]
        const nextGitBranchCompareRequestKeyByWorktree = {
          ...s.gitBranchCompareRequestKeyByWorktree
        }
        delete nextGitBranchCompareRequestKeyByWorktree[worktreeId]
        const nextGitBranchCompareRequestStatusHeadByWorktree = {
          ...s.gitBranchCompareRequestStatusHeadByWorktree
        }
        delete nextGitBranchCompareRequestStatusHeadByWorktree[worktreeId]
        // Why: clean up per-file editor state for the removed worktree so stale drafts/view modes don't accumulate.
        const removedFileIds = new Set<string>()
        for (const file of s.openFiles) {
          if (file.worktreeId !== worktreeId) {
            continue
          }
          removedFileIds.add(file.id)
          if (file.markdownPreviewSourceFileId) {
            removedFileIds.add(file.markdownPreviewSourceFileId)
          }
        }
        const nextEditorDrafts = removedFileIds.size > 0 ? { ...s.editorDrafts } : s.editorDrafts
        const nextMarkdownViewMode =
          removedFileIds.size > 0 ? { ...s.markdownViewMode } : s.markdownViewMode
        const nextEditorViewMode =
          removedFileIds.size > 0 ? { ...s.editorViewMode } : s.editorViewMode
        const nextMarkdownFrontmatterVisible =
          removedFileIds.size > 0
            ? { ...s.markdownFrontmatterVisible }
            : s.markdownFrontmatterVisible
        // Why: editorCursorLine is keyed by fileId; clear it with the other per-file state so it doesn't leak.
        const nextEditorCursorLine =
          removedFileIds.size > 0 ? { ...s.editorCursorLine } : s.editorCursorLine
        if (removedFileIds.size > 0) {
          for (const fileId of removedFileIds) {
            delete nextEditorDrafts[fileId]
            delete nextMarkdownViewMode[fileId]
            delete nextEditorViewMode[fileId]
            delete nextMarkdownFrontmatterVisible[fileId]
            delete nextEditorCursorLine[fileId]
          }
        }
        const nextExpandedDirs = { ...s.expandedDirs }
        delete nextExpandedDirs[worktreeId]
        const nextShowDotfilesByWorktree = { ...s.showDotfilesByWorktree }
        delete nextShowDotfilesByWorktree[worktreeId]
        // Why: clear the huge-status marker so it doesn't linger after the worktree is gone.
        const nextGitStatusHugeByWorktree = { ...s.gitStatusHugeByWorktree }
        delete nextGitStatusHugeByWorktree[worktreeId]
        const nextRightSidebarExplorerViewByWorktree = {
          ...s.rightSidebarExplorerViewByWorktree
        }
        delete nextRightSidebarExplorerViewByWorktree[worktreeId]
        // If the active file belonged to the removed worktree, clear it
        const activeFileCleared = s.activeFileId
          ? s.openFiles.some((f) => f.id === s.activeFileId && f.worktreeId === worktreeId)
          : false
        const removedActiveWorktree = s.activeWorktreeId === worktreeId
        const nextEverActivatedWorktreeIds = s.everActivatedWorktreeIds.has(worktreeId)
          ? new Set([...s.everActivatedWorktreeIds].filter((id) => id !== worktreeId))
          : s.everActivatedWorktreeIds
        const nextLastVisitedAtByWorktreeId =
          worktreeId in s.lastVisitedAtByWorktreeId
            ? (() => {
                const next = { ...s.lastVisitedAtByWorktreeId }
                delete next[worktreeId]
                return next
              })()
            : s.lastVisitedAtByWorktreeId
        return {
          worktreesByRepo: next,
          worktreeLineageById: nextLineage,
          workspaceLineageByChildKey: nextWorkspaceLineage,
          tabsByWorktree: nextTabs,
          ptyIdsByTabId: nextPtyIdsByTabId,
          runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId,
          automaticAgentResumeClaimsByTabId: nextAutomaticAgentResumeClaimsByTabId,
          terminalLayoutsByTabId: nextLayouts,
          expandedPaneByTabId: nextExpandedPaneByTabId,
          canExpandPaneByTabId: nextCanExpandPaneByTabId,
          deleteStateByWorktreeId: nextDeleteState,
          baseStatusByWorktreeId: (() => {
            const nextStatus = { ...s.baseStatusByWorktreeId }
            delete nextStatus[worktreeId]
            return nextStatus
          })(),
          remoteBranchConflictByWorktreeId: (() => {
            const nextConflict = { ...s.remoteBranchConflictByWorktreeId }
            delete nextConflict[worktreeId]
            return nextConflict
          })(),
          fileSearchStateByWorktree: (() => {
            const nextSearch = { ...s.fileSearchStateByWorktree }
            // Why: file search state is worktree-scoped; clear it so another worktree can't inherit stale matches.
            delete nextSearch[worktreeId]
            return nextSearch
          })(),
          // Why: these worktree-keyed maps are re-keyed on rename but were missed by removal, leaking one entry each.
          remoteStatusesByWorktree: (() => {
            const next = { ...s.remoteStatusesByWorktree }
            delete next[worktreeId]
            return next
          })(),
          recentlyClosedEditorTabsByWorktree: (() => {
            const next = { ...s.recentlyClosedEditorTabsByWorktree }
            delete next[worktreeId]
            return next
          })(),
          recentlyClosedTerminalTabsByWorktree: (() => {
            const next = { ...s.recentlyClosedTerminalTabsByWorktree }
            delete next[worktreeId]
            return next
          })(),
          // Why: a deleted worktree's tabs can never be reopened; purge the kind list with the snapshot stacks above.
          recentlyClosedTabKindsByWorktree: (() => {
            const next = { ...s.recentlyClosedTabKindsByWorktree }
            delete next[worktreeId]
            return next
          })(),
          defaultTerminalTabsAppliedByWorktreeId: (() => {
            const next = { ...s.defaultTerminalTabsAppliedByWorktreeId }
            delete next[worktreeId]
            return next
          })(),
          activeWorktreeId: removedActiveWorktree ? null : s.activeWorktreeId,
          activeWorkspaceExecutionHostId: removedActiveWorktree
            ? null
            : s.activeWorkspaceExecutionHostId,
          activeTabId: s.activeTabId && tabIds.has(s.activeTabId) ? null : s.activeTabId,
          openFiles: newOpenFiles,
          browserTabsByWorktree: nextBrowserTabsByWorktree,
          recentlyClosedBrowserTabsByWorktree: nextRecentlyClosedBrowserTabsByWorktree,
          activeFileIdByWorktree: nextActiveFileIdByWorktree,
          activeBrowserTabIdByWorktree: nextActiveBrowserTabIdByWorktree,
          activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
          rightSidebarExplorerViewByWorktree: nextRightSidebarExplorerViewByWorktree,
          activeTabIdByWorktree: nextActiveTabIdByWorktree,
          tabBarOrderByWorktree: nextTabBarOrderByWorktree,
          pendingReconnectTabByWorktree: nextPendingReconnectTabByWorktree,
          unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
          groupsByWorktree: nextGroupsByWorktree,
          layoutByWorktree: nextLayoutByWorktree,
          activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
          editorDrafts: nextEditorDrafts,
          markdownViewMode: nextMarkdownViewMode,
          editorViewMode: nextEditorViewMode,
          markdownFrontmatterVisible: nextMarkdownFrontmatterVisible,
          editorCursorLine: nextEditorCursorLine,
          showDotfilesByWorktree: nextShowDotfilesByWorktree,
          expandedDirs: nextExpandedDirs,
          gitStatusHugeByWorktree: nextGitStatusHugeByWorktree,
          gitStatusByWorktree: nextGitStatusByWorktree,
          gitStatusHeadByWorktree: nextGitStatusHeadByWorktree,
          gitIgnoredPathsByWorktree: nextGitIgnoredPathsByWorktree,
          gitConflictOperationByWorktree: nextGitConflictOperationByWorktree,
          trackedConflictPathsByWorktree: nextTrackedConflictPathsByWorktree,
          gitBranchChangesByWorktree: nextGitBranchChangesByWorktree,
          gitBranchCompareSummaryByWorktree: nextGitBranchCompareSummaryByWorktree,
          gitBranchCompareRequestKeyByWorktree: nextGitBranchCompareRequestKeyByWorktree,
          gitBranchCompareRequestStatusHeadByWorktree:
            nextGitBranchCompareRequestStatusHeadByWorktree,
          activeFileId: activeFileCleared ? null : s.activeFileId,
          activeBrowserTabId: removedActiveWorktree ? null : s.activeBrowserTabId,
          activeTabType: removedActiveWorktree || activeFileCleared ? 'terminal' : s.activeTabType,
          everActivatedWorktreeIds: nextEverActivatedWorktreeIds,
          lastVisitedAtByWorktreeId: nextLastVisitedAtByWorktreeId,
          sortEpoch: s.sortEpoch + 1
        }
      })
      get().removeWorkspaceSpaceWorktrees?.([worktreeId])
      // Why: PR/commit-message generation records are keyed by worktree; prune to the surviving set so they don't leak.
      const liveWorktreeKeys = new Set(
        get()
          .allWorktrees()
          .map((w) => w.id)
      )
      // Optional-chained: minimal store assemblies (some unit tests) omit the generation slices.
      get().prunePullRequestGenerationRecords?.(liveWorktreeKeys)
      get().pruneCommitMessageGenerationRecords?.(liveWorktreeKeys)
      // Why: Source Control may be unmounted during deletion, so it can't be the only stale-draft cleanup path.
      clearSessionCommitDraftForWorktree(worktreeId)
      const preservedBranch = removalResult?.preservedBranch
      if (preservedBranch && options?.suppressPreservedBranchToast !== true) {
        showPreservedBranchToast(removalResult, worktreeBeforeRemoval, (branch, expectedHead) => {
          void get().forceDeletePreservedBranch(worktreeId, branch, expectedHead)
        })
      }
      pruneHostedReviewLinkMutationGenerations([worktreeId])
      return preservedBranch ? { ok: true as const, preservedBranch } : { ok: true as const }
    } catch (err) {
      // Why: git refusing a non-force delete for dirty/untracked files is a handled user decision, not an app error.
      console.warn('Failed to remove worktree:', err)
      const error = err instanceof Error ? err.message : String(err)
      const forceDeleteReason = classifyWorktreeForceDeleteReason(error, force)
      const locked = isLockedWorktreeRemovalError(error)
      set((s) => ({
        deleteStateByWorktreeId: {
          ...s.deleteStateByWorktreeId,
          [worktreeId]: {
            isDeleting: false,
            error,
            canForceDelete: forceDeleteReason !== null,
            forceDeleteReason,
            ...(locked ? { lockReason: getLockedWorktreeRemovalReason(error) } : {})
          }
        }
      }))
      return { ok: false as const, error }
    }
  },
  }
}
