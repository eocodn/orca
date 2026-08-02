/* import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { pushRecentlyClosedTabKind } from './recently-closed-tabs'
import { joinPath } from '@/lib/path'
import { toast } from 'sonner'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import { resolveMarkdownLinkTarget } from '@/components/editor/markdown-internal-links'
import {
  buildCheckRunDetailsTabId,
  getCheckRunDetailsTabLabel,
  type OpenCheckRunDetailsState
} from '@/components/editor/check-run-details-tab'
import { openHttpLink, type HttpLinkSourceOwner } from '@/lib/http-link-routing'
import { getConnectionIdForFileFromState } from '@/lib/connection-owner-resolution'
import { isLocalPathOpenBlocked, showLocalPathOpenBlockedToast } from '@/lib/local-path-open-guard'
import { detectLanguage } from '@/lib/language-detect'
import type {
  GitBranchChangeEntry,
  GitBranchCompareSummary,
  GitCommitCompareSummary,
  GitConflictKind,
  GitConflictOperation,
  GitConflictResolutionStatus,
  GitConflictStatusSource,
  GlobalSettings,
  GitPushTarget,
  GitStatusEntry,
  GitStatusResult,
  PersistedOpenFile,
  Tab,
  TabGroup,
  GitUpstreamStatus,
  ActiveRightSidebarTab,
  RightSidebarExplorerView,
  SearchResult,
  WorkspaceSessionState,
  WorkspaceVisibleTabType
} from '../../../../shared/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { clampMarkdownTocPanelWidth } from '../../../../shared/markdown-toc-panel-width'
import {
  clampCombinedDiffFileTreeWidth,
  COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH
} from '../../../../shared/combined-diff-file-tree-width'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { RemoteOpKind } from '@/components/right-sidebar/source-control-primary-action'
import { invalidateAutomaticPushTargetUpstreamStatusCache } from '@/components/right-sidebar/push-target-upstream-refresh-cache'
import {
  isNonFastForwardRemoteError,
  markSyncPushStageError,
  resolveRemoteOperationErrorMessage
} from '@/lib/source-control-remote-error'
import { shouldForcePushWithLeaseForUpstream } from '../../../../shared/git-upstream-status'
import {
  fastForwardRuntimeGit,
  fetchRuntimeGit,
  getRuntimeGitUpstreamStatus,
  pullRuntimeGit,
  pushRuntimeGit,
  rebaseRuntimeGitFromBase
} from '@/runtime/runtime-git-client'
import {
  deleteRuntimePath,
  deleteRuntimeRelativePath,
  statRuntimePath
} from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { notifyHostOfMirroredEditorClose } from '@/runtime/close-mirrored-editor-tab'
import { findWorktreeById, getRepoIdFromWorktreeId } from './worktree-helpers'
import { getExplicitRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  addAdditionalValidWorkspaceKeys,
  type WorkspaceSessionHydrationOptions
} from '@/lib/workspace-session-hydration-keys'
import { buildValidWorktreeIdsForSessionHydration } from './degraded-repo-worktree-validity'
import { createUntitledMarkdownFileWithTemplateSelection } from '@/lib/create-untitled-markdown'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { translate } from '@/i18n/i18n'
import type { FileSearchResultOwner } from '@/lib/file-search-result-owner'
import type { EditorFileOperationProvenance } from '@/lib/editor-file-operation-owner'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from '@/lib/editor-file-operation-owner'

export type {
  ActiveRightSidebarTab,
  RightSidebarExplorerView,
  RightSidebarTab
} from '../../../../shared/types'
import { DEFAULT_FILE_SEARCH_STATE, defaultFileSearchState, getKnownGitHead, createLoadingBranchCompareSummary, branchCompareMatchesStatusHead, MAX_RECENT_CLOSED_EDITOR_TABS, resolveDiffRuntimeEnvironmentId, EDITOR_FOCUS_REQUEST_TTL_MS, pendingEditorLineRevealFrameIds, cancelPendingEditorLineRevealFrames, trackEditorLineRevealFrameId, requestTrackedEditorLineRevealFrame, scheduleEditorLineReveal, openWorkspaceEditorItem, isEditorTabContentType, getReplaceablePreviewFileId, removeEditorStateForReplacedPreview, removeMarkdownVisibilityKeys, getGroupActiveTab, getMostRecentEditorTabForGroup, resolveEditorOpenTargetGroupId, buildEditorActiveResult, runtimeOwnerKey, isSameEditorOwner, buildOwnedEditorFileId, buildDiffEditorFileId, withDiffContentReloadRequest, shouldRequestExistingFileContentReload, isEditorFileIdOccupiedByOtherOwner, matchesEditorMode, getReusableOpenFileModes, resolveEditorFileIdForOwner, getOpenedEditFileIdAfterOpen, shouldHydrateWithOwnedEditorFileId, addEditorFileIdMigration, resolveLegacyHydratedEditorFileId, migrateEditorFileId, dedupeEditorTabOrder, areStringArraysEqual, migrateHydratedEditorTabsAndGroups, rekeyFileIdRecord, deleteUntouchedUntitledFile, shouldDeleteUntouchedUntitledFile } from './editor-state-slice'
import type { DiffSource, BranchCompareSnapshot, CommitCompareSnapshot, BranchCompareLike, CommitCompareLike, CombinedDiffAlternate, OpenConflictMetadata, ConflictReviewEntry, ConflictReviewState, CombinedDiffSkippedConflict, OpenFile, ActivityBarPosition, MarkdownViewMode, EditorViewMode, ClosedEditorTabSnapshot, EditorOpenTargetOptions, GitRuntimeOperationOptions, PendingEditorReveal, PendingEditorFocusRequest, EditorSlice, LegacyHydratedEditorFile, OpenFilePathRekey, RekeyOpenFilesResult } from './editor-state-slice'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createEditorSlicePushBranchActions11(set: SliceSet, get: SliceGet) {
  return {
  pushBranch: async (
    worktreeId,
    worktreePath,
    publish = false,
    connectionId,
    pushTarget,
    options = {}
  ) => {
    // Why: fire-and-forget the upstream refresh (don't await) so compound flows aren't delayed, but the "Push"→"Commit" label still rotates faster than the 3s poll.
    get().beginRemoteOperation(
      publish ? 'publish' : options.forceWithLease === true ? 'force_push' : 'push'
    )
    let shouldRefreshAfterRejectedPush = false
    const runtimeSettings = options.runtimeTargetSettings ?? get().settings
    try {
      await pushRuntimeGit(
        { settings: runtimeSettings, worktreeId, worktreePath, connectionId },
        { publish, pushTarget, forceWithLease: options.forceWithLease }
      )
    } catch (error) {
      shouldRefreshAfterRejectedPush = isNonFastForwardRemoteError(error)
      toast.error(
        resolveRemoteOperationErrorMessage(error, {
          publish,
          isPush: !publish && options.forceWithLease !== true,
          isForcePush: !publish && options.forceWithLease === true
        })
      )
      throw error
    } finally {
      get().endRemoteOperation()
      if (shouldRefreshAfterRejectedPush) {
        const context = { settings: runtimeSettings, worktreeId, worktreePath, connectionId }
        // Why: the rejected push proved the branch moved; fetch first so legacy base-tracking worktrees discover origin/<branch>, then refresh ahead/behind.
        void fetchRuntimeGit(context, pushTarget)
          .catch(() => undefined)
          .then(() =>
            get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
              runtimeTargetSettings: runtimeSettings
            })
          )
      }
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
    const refreshGitHubForWorktree = get().refreshGitHubForWorktree
    if (typeof refreshGitHubForWorktree === 'function') {
      refreshGitHubForWorktree(worktreeId)
    }
  },
  pullBranch: async (worktreeId, worktreePath, connectionId, pushTarget, options) => {
    get().beginRemoteOperation('pull')
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      await pullRuntimeGit(
        { settings: runtimeSettings, worktreeId, worktreePath, connectionId },
        pushTarget
      )
    } catch (error) {
      toast.error(resolveRemoteOperationErrorMessage(error))
      throw error
    } finally {
      get().endRemoteOperation()
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
    const refreshGitHubForWorktree = get().refreshGitHubForWorktree
    if (typeof refreshGitHubForWorktree === 'function') {
      refreshGitHubForWorktree(worktreeId)
    }
  },
  fastForwardBranch: async (worktreeId, worktreePath, connectionId, pushTarget, options) => {
    get().beginRemoteOperation('fast_forward')
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      await fastForwardRuntimeGit(
        { settings: runtimeSettings, worktreeId, worktreePath, connectionId },
        pushTarget
      )
    } catch (error) {
      toast.error(resolveRemoteOperationErrorMessage(error, { isFastForward: true }))
      throw error
    } finally {
      get().endRemoteOperation()
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
    const refreshGitHubForWorktree = get().refreshGitHubForWorktree
    if (typeof refreshGitHubForWorktree === 'function') {
      refreshGitHubForWorktree(worktreeId)
    }
  },
  syncBranch: async (worktreeId, worktreePath, connectionId, pushTarget, options) => {
    // Why: like pushBranch — fire-and-forget the post-op upstream refresh so the primary button label rotates immediately.
    get().beginRemoteOperation('sync')
    // Why: the inner push stage toasts as Sync and marks the error so the outer catch skips toasting, avoiding a double-toast.
    let pushStageToastShown = false
    let pushed = false
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      const context = { settings: runtimeSettings, worktreeId, worktreePath, connectionId }
      await fetchRuntimeGit(context, pushTarget)
      const upstreamStatusBeforePull = await getRuntimeGitUpstreamStatus(context, pushTarget)
      if (shouldForcePushWithLeaseForUpstream(upstreamStatusBeforePull)) {
        try {
          await pushRuntimeGit(context, { pushTarget, forceWithLease: true })
          pushed = true
        } catch (error) {
          toast.error(
            resolveRemoteOperationErrorMessage(error, {
              isSync: true,
              isSyncPushStage: true
            })
          )
          pushStageToastShown = true
          throw markSyncPushStageError(error)
        }
      } else {
        await pullRuntimeGit(context, pushTarget)
        // Why: push only if the pull left local commits ahead of the remote; skip the no-op push after a pure fast-forward.
        const upstreamStatus = await getRuntimeGitUpstreamStatus(context, pushTarget)
        if (upstreamStatus.ahead > 0) {
          try {
            await pushRuntimeGit(context, { pushTarget })
            pushed = true
          } catch (error) {
            // Why: frame as Sync, not the inner push — the user clicked Sync and didn't directly invoke this push.
            toast.error(
              resolveRemoteOperationErrorMessage(error, {
                isSync: true,
                isSyncPushStage: true
              })
            )
            pushStageToastShown = true
            throw markSyncPushStageError(error)
          }
        }
      }
    } catch (error) {
      if (!pushStageToastShown) {
        // Why: frame fetch/pull/upstream failures as "Sync failed..." since the user invoked Sync, not the inner step.
        toast.error(resolveRemoteOperationErrorMessage(error, { isSync: true }))
      }
      throw error
    } finally {
      get().endRemoteOperation()
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
    if (pushed) {
      const refreshGitHubForWorktree = get().refreshGitHubForWorktree
      if (typeof refreshGitHubForWorktree === 'function') {
        refreshGitHubForWorktree(worktreeId)
      }
    }
  },
  rebaseFromBase: async (worktreeId, worktreePath, baseRef, connectionId, pushTarget, options) => {
    get().beginRemoteOperation('rebase')
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      await rebaseRuntimeGitFromBase(
        { settings: runtimeSettings, worktreeId, worktreePath, connectionId },
        baseRef
      )
    } catch (error) {
      toast.error(resolveRemoteOperationErrorMessage(error, { isRebase: true }))
      throw error
    } finally {
      get().endRemoteOperation()
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
    const refreshGitHubForWorktree = get().refreshGitHubForWorktree
    if (typeof refreshGitHubForWorktree === 'function') {
      refreshGitHubForWorktree(worktreeId)
    }
  },
  fetchBranch: async (worktreeId, worktreePath, connectionId, pushTarget, options) => {
    // Why: like pushBranch — fire-and-forget the upstream refresh after the busy flag clears so new ahead/behind counts surface.
    get().beginRemoteOperation('fetch')
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      await fetchRuntimeGit(
        { settings: runtimeSettings, worktreeId, worktreePath, connectionId },
        pushTarget
      )
    } catch (error) {
      toast.error(resolveRemoteOperationErrorMessage(error, { isFetch: true }))
      throw error
    } finally {
      get().endRemoteOperation()
    }
    void get().fetchUpstreamStatus(worktreeId, worktreePath, connectionId, pushTarget, {
      runtimeTargetSettings: runtimeSettings
    })
  },
  gitBranchChangesByWorktree: {},
  gitBranchCompareSummaryByWorktree: {},
  gitBranchCompareRequestKeyByWorktree: {},
  gitBranchCompareRequestStatusHeadByWorktree: {},
  beginGitBranchCompareRequest: (worktreeId, requestKey, baseRef, options) =>
    set((s) => ({
      gitBranchCompareRequestKeyByWorktree: {
        ...s.gitBranchCompareRequestKeyByWorktree,
        [worktreeId]: requestKey
      },
      gitBranchCompareRequestStatusHeadByWorktree: {
        ...s.gitBranchCompareRequestStatusHeadByWorktree,
        [worktreeId]: getKnownGitHead(s.gitStatusHeadByWorktree[worktreeId]) ?? null
      },
      ...(options?.preserveExistingSummary
        ? {}
        : {
            gitBranchCompareSummaryByWorktree: {
              ...s.gitBranchCompareSummaryByWorktree,
              [worktreeId]: createLoadingBranchCompareSummary(baseRef)
            }
          })
    })),
  setGitBranchCompareResult: (worktreeId, requestKey, result) =>
    set((s) => {
      if (s.gitBranchCompareRequestKeyByWorktree[worktreeId] !== requestKey) {
        return s
      }
      const statusHead = getKnownGitHead(s.gitStatusHeadByWorktree[worktreeId])
      const requestStatusHead = s.gitBranchCompareRequestStatusHeadByWorktree[worktreeId]
      // Why: never let a compare result computed before a status change overwrite a newer status snapshot.
      if (
        result.summary.status !== 'loading' &&
        statusHead !== undefined &&
        requestStatusHead !== statusHead &&
        !branchCompareMatchesStatusHead(result.summary, statusHead)
      ) {
        return s
      }
      const prevEntries = s.gitBranchChangesByWorktree[worktreeId]
      const prevSummary = s.gitBranchCompareSummaryByWorktree[worktreeId]
      const entriesUnchanged =
        prevEntries &&
        prevEntries.length === result.entries.length &&
        prevEntries.every(
          (e, i) =>
            e.path === result.entries[i].path &&
            e.status === result.entries[i].status &&
            e.oldPath === result.entries[i].oldPath
        )
      const summaryUnchanged =
        prevSummary &&
        prevSummary.status === result.summary.status &&
        prevSummary.baseOid === result.summary.baseOid &&
        prevSummary.headOid === result.summary.headOid &&
        prevSummary.changedFiles === result.summary.changedFiles
      if (entriesUnchanged && summaryUnchanged) {
        return s
      }
      return {
        gitBranchChangesByWorktree: entriesUnchanged
          ? s.gitBranchChangesByWorktree
          : { ...s.gitBranchChangesByWorktree, [worktreeId]: result.entries },
        gitBranchCompareSummaryByWorktree: summaryUnchanged
          ? s.gitBranchCompareSummaryByWorktree
          : { ...s.gitBranchCompareSummaryByWorktree, [worktreeId]: result.summary }
      }
    }),
  // Why: when the compare base resolves to "no base", drop any stale summary so the committed-changes section and "vs" row disappear instead of lingering.
  clearGitBranchCompare: (worktreeId) =>
    set((s) => {
      if (
        s.gitBranchCompareSummaryByWorktree[worktreeId] === undefined &&
        s.gitBranchChangesByWorktree[worktreeId] === undefined &&
        s.gitBranchCompareRequestKeyByWorktree[worktreeId] === undefined &&
        s.gitBranchCompareRequestStatusHeadByWorktree[worktreeId] === undefined
      ) {
        return s
      }
      const nextSummary = { ...s.gitBranchCompareSummaryByWorktree }
      const nextChanges = { ...s.gitBranchChangesByWorktree }
      const nextRequestKey = { ...s.gitBranchCompareRequestKeyByWorktree }
      const nextRequestHead = { ...s.gitBranchCompareRequestStatusHeadByWorktree }
      delete nextSummary[worktreeId]
      delete nextChanges[worktreeId]
      delete nextRequestKey[worktreeId]
      delete nextRequestHead[worktreeId]
      return {
        gitBranchCompareSummaryByWorktree: nextSummary,
        gitBranchChangesByWorktree: nextChanges,
        gitBranchCompareRequestKeyByWorktree: nextRequestKey,
        gitBranchCompareRequestStatusHeadByWorktree: nextRequestHead
      }
    }),

  // File search
  fileSearchStateByWorktree: {},
  }
}