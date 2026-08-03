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
export function createEditorSliceOpenConflictFileActions8(set: SliceSet, get: SliceGet) {
  return {
  openConflictFile: (worktreeId, worktreePath, entry, language, options) => {
    const absolutePath = joinPath(worktreePath, entry.path)
    const isPreview = options?.preview ?? false
    let editorItemTargetGroupId = options?.targetGroupId
    set((s) => {
      const id = absolutePath
      const conflict = toOpenConflictMetadata(entry)
      const targetGroupId =
        resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
      editorItemTargetGroupId = targetGroupId
      const existing = s.openFiles.find((f) => f.id === id)
      const nextTracked =
        entry.conflictStatus === 'unresolved' && entry.conflictKind
          ? {
              ...s.trackedConflictPathsByWorktree[worktreeId],
              [entry.path]: entry.conflictKind
            }
          : s.trackedConflictPathsByWorktree[worktreeId]

      if (!conflict) {
        return s
      }

      if (existing) {
        const updatedPreview = isPreview ? existing.isPreview : false
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  mode: 'edit' as const,
                  language,
                  relativePath: entry.path,
                  filePath: absolutePath,
                  conflict,
                  diffSource: undefined,
                  skippedConflicts: undefined,
                  conflictReview: undefined,
                  isPreview: updatedPreview
                }
              : f
          ),
          activeFileId: id,
          activeTabType: 'editor',
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' },
          trackedConflictPathsByWorktree:
            nextTracked === s.trackedConflictPathsByWorktree[worktreeId]
              ? s.trackedConflictPathsByWorktree
              : { ...s.trackedConflictPathsByWorktree, [worktreeId]: nextTracked }
        }
      }

      const newFile: OpenFile = {
        id,
        filePath: absolutePath,
        relativePath: entry.path,
        worktreeId,
        language,
        isDirty: false,
        mode: 'edit',
        conflict,
        isPreview: isPreview || undefined
      }

      if (isPreview) {
        const replaceablePreviewId = getReplaceablePreviewFileId(s, worktreeId, targetGroupId)
        const replaceablePreviewIndex = s.openFiles.findIndex(
          (file) => file.id === replaceablePreviewId
        )
        if (replaceablePreviewIndex !== -1) {
          return {
            openFiles: s.openFiles.map((file, index) =>
              index === replaceablePreviewIndex ? newFile : file
            ),
            ...removeEditorStateForReplacedPreview(s, s.openFiles[replaceablePreviewIndex], id),
            activeFileId: id,
            activeTabType: 'editor',
            activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
            activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' },
            trackedConflictPathsByWorktree:
              nextTracked === s.trackedConflictPathsByWorktree[worktreeId]
                ? s.trackedConflictPathsByWorktree
                : { ...s.trackedConflictPathsByWorktree, [worktreeId]: nextTracked }
          }
        }
      }

      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' },
        trackedConflictPathsByWorktree:
          nextTracked === s.trackedConflictPathsByWorktree[worktreeId]
            ? s.trackedConflictPathsByWorktree
            : { ...s.trackedConflictPathsByWorktree, [worktreeId]: nextTracked }
      }
    })
    void openWorkspaceEditorItem(
      get(),
      absolutePath,
      worktreeId,
      entry.path,
      'editor',
      isPreview,
      editorItemTargetGroupId
    )
  },
  openConflictReviewFile: (reviewFileId, worktreeId, worktreePath, entry, language) => {
    const absolutePath = joinPath(worktreePath, entry.path)
    const reviewTab = (get().unifiedTabsByWorktree?.[worktreeId] ?? []).find(
      (tab) => tab.entityId === reviewFileId && tab.contentType === 'conflict-review'
    )
    set((s) => {
      const conflict = toOpenConflictMetadata(entry)
      const existing = s.openFiles.find((f) => f.id === absolutePath)
      const nextTracked =
        entry.conflictStatus === 'unresolved' && entry.conflictKind
          ? {
              ...s.trackedConflictPathsByWorktree[worktreeId],
              [entry.path]: entry.conflictKind
            }
          : s.trackedConflictPathsByWorktree[worktreeId]

      if (!conflict) {
        return s
      }

      const nextOpenFiles = existing
        ? s.openFiles.map((f) =>
            f.id === absolutePath
              ? {
                  ...f,
                  mode: 'edit' as const,
                  language,
                  relativePath: entry.path,
                  filePath: absolutePath,
                  conflict,
                  diffSource: undefined,
                  skippedConflicts: undefined,
                  conflictReview: undefined
                }
              : f.id === reviewFileId && f.conflictReview
                ? {
                    ...f,
                    conflictReview: {
                      ...f.conflictReview,
                      selectedFileId: absolutePath
                    }
                  }
                : f
          )
        : [
            ...s.openFiles.map((f) =>
              f.id === reviewFileId && f.conflictReview
                ? {
                    ...f,
                    conflictReview: {
                      ...f.conflictReview,
                      selectedFileId: absolutePath
                    }
                  }
                : f
            ),
            {
              id: absolutePath,
              filePath: absolutePath,
              relativePath: entry.path,
              worktreeId,
              language,
              isDirty: false,
              mode: 'edit' as const,
              conflict
            }
          ]

      return {
        openFiles: nextOpenFiles,
        activeFileId: reviewFileId,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: reviewFileId },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' },
        trackedConflictPathsByWorktree:
          nextTracked === s.trackedConflictPathsByWorktree[worktreeId]
            ? s.trackedConflictPathsByWorktree
            : { ...s.trackedConflictPathsByWorktree, [worktreeId]: nextTracked }
      }
    })

    // Why: the conflict file needs a normal editor backing tab for save/close, but selecting from Conflict Review must keep the review tab visible; restore focus after.
    void openWorkspaceEditorItem(
      get(),
      absolutePath,
      worktreeId,
      entry.path,
      'editor',
      undefined,
      reviewTab?.groupId
    )
    if (reviewTab) {
      get().activateTab?.(reviewTab.id)
    }
  },

  // Why: renders from a stored snapshot (entries + timestamp), not live status, so the list stays stable across polls while reviewing.
  openConflictReview: (worktreeId, worktreePath, entries, source) => {
    const id = `${worktreeId}::conflict-review`
    set((s) => {
      const conflictReview: ConflictReviewState = {
        source,
        snapshotTimestamp: Date.now(),
        entries
      }
      const existing = s.openFiles.find((f) => f.id === id)

      if (existing) {
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  mode: 'conflict-review' as const,
                  relativePath: 'Conflict Review',
                  filePath: worktreePath,
                  language: 'plaintext',
                  conflictReview,
                  conflict: undefined,
                  skippedConflicts: undefined
                }
              : f
          ),
          activeFileId: id,
          activeTabType: 'editor',
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
        }
      }

      const newFile: OpenFile = {
        id,
        filePath: worktreePath,
        relativePath: 'Conflict Review',
        worktreeId,
        language: 'plaintext',
        isDirty: false,
        mode: 'conflict-review',
        conflictReview
      }

      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
      }
    })
    void openWorkspaceEditorItem(get(), id, worktreeId, 'Conflict Review', 'conflict-review')
  },

  // Why: the checks sidebar only fits inline summaries; full logs and annotations belong in the center editor pane.
  }
}
