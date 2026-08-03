 import type { StateCreator } from 'zustand'
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
export function createEditorSliceSetGitStatusActions10(set: SliceSet, get: SliceGet) {
  return {
  setGitStatus: (worktreeId, status) =>
    set((s) => {
      const hadStatusEntry = Object.prototype.hasOwnProperty.call(s.gitStatusByWorktree, worktreeId)
      const prevEntries = s.gitStatusByWorktree[worktreeId] ?? []
      const prevOperation = s.gitConflictOperationByWorktree[worktreeId] ?? 'unknown'
      const currentTracked = { ...s.trackedConflictPathsByWorktree[worktreeId] }
      // Why: main process doesn't set conflictStatusSource; stamp 'git' here for live u-records ('session' is stamped below for Resolved-locally).
      const normalizedEntries = status.entries.map((entry) =>
        entry.conflictStatus === 'unresolved'
          ? { ...entry, conflictStatusSource: 'git' as const }
          : entry
      )
      const unresolvedEntries = normalizedEntries.filter(
        (entry) => entry.conflictStatus === 'unresolved' && entry.conflictKind
      )
      const unresolvedByPath = new Map(unresolvedEntries.map((entry) => [entry.path, entry]))
      const statusIsComplete = status.didHitLimit !== true
      // Why: a capped snapshot cannot prove that an omitted conflict operation ended.
      const nextOperation =
        !statusIsComplete && status.conflictOperation === 'unknown'
          ? prevOperation
          : status.conflictOperation

      // Why: operation → 'unknown' with zero unresolved means an abort (git merge --abort), not resolution; clear tracked paths instead of marking each "Resolved locally".
      if (
        statusIsComplete &&
        nextOperation === 'unknown' &&
        prevOperation !== 'unknown' &&
        unresolvedByPath.size === 0
      ) {
        for (const path of Object.keys(currentTracked)) {
          delete currentTracked[path]
        }
      }

      const nextEntries = normalizedEntries.map((entry) => {
        if (entry.conflictStatus === 'unresolved') {
          return entry
        }
        const trackedConflictKind = currentTracked[entry.path]
        if (!trackedConflictKind) {
          return entry
        }
        return {
          ...entry,
          conflictKind: trackedConflictKind,
          conflictStatus: 'resolved_locally' as const,
          conflictStatusSource: 'session' as const
        }
      })

      if (statusIsComplete) {
        const visiblePaths = new Set(nextEntries.map((entry) => entry.path))
        for (const path of Object.keys(currentTracked)) {
          if (!visiblePaths.has(path) && !unresolvedByPath.has(path)) {
            delete currentTracked[path]
          }
        }
      }

      const nextOpenFiles = reconcileOpenFilesForStatus(
        s.openFiles,
        worktreeId,
        nextEntries,
        statusIsComplete
      )
      const statusUnchanged = hadStatusEntry && areGitStatusEntriesEqual(prevEntries, nextEntries)
      const trackedUnchanged = areTrackedConflictMapsEqual(
        s.trackedConflictPathsByWorktree[worktreeId] ?? {},
        currentTracked
      )
      const openFilesUnchanged = nextOpenFiles === s.openFiles
      const operationUnchanged = prevOperation === nextOperation

      const prevIgnored = s.gitIgnoredPathsByWorktree[worktreeId]
      const nextIgnored = status.ignoredPaths ?? []
      const ignoredUnchanged =
        prevIgnored !== undefined &&
        prevIgnored.length === nextIgnored.length &&
        prevIgnored.every((p, i) => p === nextIgnored[i])

      const prevHuge = s.gitStatusHugeByWorktree[worktreeId]
      const nextHuge = status.didHitLimit ? { limit: nextEntries.length } : undefined
      const hugeUnchanged = (prevHuge?.limit ?? null) === (nextHuge?.limit ?? null)
      const prevStatusHead = s.gitStatusHeadByWorktree[worktreeId]
      const nextStatusHead = getKnownGitHead(status.head)
      const statusHeadUnchanged = prevStatusHead === nextStatusHead

      const prevBranchSummary = s.gitBranchCompareSummaryByWorktree[worktreeId]
      // Why: a compare request can finish after git status observed a new HEAD; reject the stale snapshot before it renders a false clean state.
      const shouldInvalidateBranchCompare =
        !statusHeadUnchanged &&
        nextStatusHead !== undefined &&
        prevBranchSummary?.status === 'ready' &&
        !branchCompareMatchesStatusHead(prevBranchSummary, nextStatusHead)

      if (
        statusUnchanged &&
        trackedUnchanged &&
        openFilesUnchanged &&
        operationUnchanged &&
        ignoredUnchanged &&
        hugeUnchanged &&
        statusHeadUnchanged &&
        !shouldInvalidateBranchCompare
      ) {
        return s
      }

      const nextHugeMap = hugeUnchanged
        ? s.gitStatusHugeByWorktree
        : nextHuge
          ? { ...s.gitStatusHugeByWorktree, [worktreeId]: nextHuge }
          : (() => {
              const copy = { ...s.gitStatusHugeByWorktree }
              delete copy[worktreeId]
              return copy
            })()

      const nextStatusHeadMap = statusHeadUnchanged
        ? s.gitStatusHeadByWorktree
        : nextStatusHead
          ? { ...s.gitStatusHeadByWorktree, [worktreeId]: nextStatusHead }
          : (() => {
              const copy = { ...s.gitStatusHeadByWorktree }
              delete copy[worktreeId]
              return copy
            })()
      const nextBranchCompareSummaries = shouldInvalidateBranchCompare
        ? {
            ...s.gitBranchCompareSummaryByWorktree,
            [worktreeId]: createLoadingBranchCompareSummary(prevBranchSummary.baseRef)
          }
        : s.gitBranchCompareSummaryByWorktree
      const nextBranchChanges = shouldInvalidateBranchCompare
        ? { ...s.gitBranchChangesByWorktree, [worktreeId]: [] }
        : s.gitBranchChangesByWorktree

      return {
        openFiles: nextOpenFiles,
        gitStatusHugeByWorktree: nextHugeMap,
        gitStatusHeadByWorktree: nextStatusHeadMap,
        gitStatusByWorktree: statusUnchanged
          ? s.gitStatusByWorktree
          : { ...s.gitStatusByWorktree, [worktreeId]: nextEntries },
        gitIgnoredPathsByWorktree: ignoredUnchanged
          ? s.gitIgnoredPathsByWorktree
          : { ...s.gitIgnoredPathsByWorktree, [worktreeId]: nextIgnored },
        gitConflictOperationByWorktree: operationUnchanged
          ? s.gitConflictOperationByWorktree
          : { ...s.gitConflictOperationByWorktree, [worktreeId]: nextOperation },
        trackedConflictPathsByWorktree: trackedUnchanged
          ? s.trackedConflictPathsByWorktree
          : { ...s.trackedConflictPathsByWorktree, [worktreeId]: currentTracked },
        gitBranchCompareSummaryByWorktree: nextBranchCompareSummaries,
        gitBranchChangesByWorktree: nextBranchChanges
      }
    }),
  setConflictOperation: (worktreeId, operation) =>
    set((s) => {
      const prev = s.gitConflictOperationByWorktree[worktreeId] ?? 'unknown'
      if (prev === operation) {
        return s
      }
      // Why: when the operation clears on a non-active worktree, also clear tracked conflict paths — same as setGitStatus does for the active one.
      const nextTracked =
        operation === 'unknown' && prev !== 'unknown'
          ? {}
          : s.trackedConflictPathsByWorktree[worktreeId]
      const trackedUnchanged = nextTracked === s.trackedConflictPathsByWorktree[worktreeId]
      return {
        gitConflictOperationByWorktree: {
          ...s.gitConflictOperationByWorktree,
          [worktreeId]: operation
        },
        ...(trackedUnchanged
          ? {}
          : {
              trackedConflictPathsByWorktree: {
                ...s.trackedConflictPathsByWorktree,
                [worktreeId]: nextTracked
              }
            })
      }
    }),
  remoteStatusesByWorktree: {},
  setUpstreamStatus: (worktreeId, status) =>
    set((s) => {
      if (areUpstreamStatusesEqual(s.remoteStatusesByWorktree[worktreeId], status)) {
        return s
      }
      return {
        remoteStatusesByWorktree: {
          ...s.remoteStatusesByWorktree,
          [worktreeId]: status
        }
      }
    }),
  isRemoteOperationActive: false,
  remoteOperationDepth: 0,
  inFlightRemoteOpKind: null,
  beginRemoteOperation: (kind) =>
    set((s) => ({
      remoteOperationDepth: s.remoteOperationDepth + 1,
      isRemoteOperationActive: true,
      // Why: last-write-wins on the kind; the UI blocks a second user-initiated op, so the most recent kind matches what the user is watching.
      inFlightRemoteOpKind: kind ?? s.inFlightRemoteOpKind
    })),
  endRemoteOperation: () =>
    set((s) => {
      const next = Math.max(0, s.remoteOperationDepth - 1)
      return {
        remoteOperationDepth: next,
        isRemoteOperationActive: next > 0,
        // Why: keep the in-flight kind (its label/spinner) until depth reaches 0 and no remote op remains.
        inFlightRemoteOpKind: next > 0 ? s.inFlightRemoteOpKind : null
      }
    }),
  fetchUpstreamStatus: async (worktreeId, worktreePath, connectionId, pushTarget, options) => {
    const runtimeSettings = options?.runtimeTargetSettings ?? get().settings
    try {
      const status = await getRuntimeGitUpstreamStatus(
        {
          settings: runtimeSettings,
          worktreeId,
          worktreePath,
          connectionId
        },
        pushTarget
      )
      if (options?.applyUpstreamStatus !== false) {
        get().setUpstreamStatus(worktreeId, status)
      }
      return status
    } catch (error) {
      // Why: keep prior status on error — a synthetic {hasUpstream:false} would flash 'Publish Branch' on a tracked branch and a click could re-publish, clobbering the upstream.
      if (pushTarget) {
        // Why: don't let an old automatic-poll cache entry suppress the next retry after a transient refresh failure.
        invalidateAutomaticPushTargetUpstreamStatusCache({
          settings: runtimeSettings,
          worktreeId,
          worktreePath,
          connectionId,
          pushTarget
        })
      }
      console.error('fetchUpstreamStatus failed', error)
      return null
    }
  },
  }
}
