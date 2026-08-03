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
export function createEditorSliceOpenBranchDiffActions7(set: SliceSet, get: SliceGet) {
  return {
  openBranchDiff: (worktreeId, worktreePath, entry, compare, language, options) => {
    const branchCompare = toBranchCompareSnapshot(compare)
    const id = `${worktreeId}::diff::branch::${compare.baseRef}::${branchCompare.compareVersion}::${entry.path}`
    const isPreview = options?.preview ?? false
    let editorItemTargetGroupId = options?.targetGroupId
    set((s) => {
      const targetGroupId =
        resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
      editorItemTargetGroupId = targetGroupId
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(
        s,
        worktreeId,
        options?.runtimeEnvironmentId
      )
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        const updatedPreview = isPreview ? existing.isPreview : false
        const reopenedDiff = withDiffContentReloadRequest({
          ...existing,
          mode: 'diff' as const,
          diffSource: 'branch' as const,
          branchCompare,
          branchOldPath: entry.oldPath,
          conflict: undefined,
          skippedConflicts: undefined,
          conflictReview: undefined,
          isPreview: updatedPreview,
          runtimeEnvironmentId
        })
        return {
          openFiles: s.openFiles.map((f) => (f.id === id ? reopenedDiff : f)),
          activeFileId: id,
          activeTabType: 'editor',
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
        }
      }
      const newFile: OpenFile = {
        id,
        filePath: joinPath(worktreePath, entry.path),
        relativePath: entry.path,
        worktreeId,
        language,
        isDirty: false,
        mode: 'diff',
        diffSource: 'branch',
        branchCompare,
        branchOldPath: entry.oldPath,
        conflict: undefined,
        skippedConflicts: undefined,
        conflictReview: undefined,
        isPreview: isPreview || undefined,
        runtimeEnvironmentId
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
            activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
          }
        }
      }
      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
      }
    })
    void openWorkspaceEditorItem(
      get(),
      id,
      worktreeId,
      entry.path,
      'diff',
      isPreview,
      editorItemTargetGroupId
    )
  },
  openCommitDiff: (worktreeId, worktreePath, entry, compare, language, options) => {
    const commitCompare = toCommitCompareSnapshot(compare)
    const id = `${worktreeId}::diff::commit::${commitCompare.compareVersion}::${entry.path}`
    const isPreview = options?.preview ?? false
    let editorItemTargetGroupId = options?.targetGroupId
    set((s) => {
      const targetGroupId =
        resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
      editorItemTargetGroupId = targetGroupId
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(
        s,
        worktreeId,
        options?.runtimeEnvironmentId
      )
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        const updatedPreview = isPreview ? existing.isPreview : false
        const reopenedDiff = withDiffContentReloadRequest({
          ...existing,
          mode: 'diff' as const,
          diffSource: 'commit' as const,
          commitCompare,
          branchOldPath: entry.oldPath,
          conflict: undefined,
          skippedConflicts: undefined,
          conflictReview: undefined,
          isPreview: updatedPreview,
          runtimeEnvironmentId
        })
        return {
          openFiles: s.openFiles.map((f) => (f.id === id ? reopenedDiff : f)),
          activeFileId: id,
          activeTabType: 'editor',
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
        }
      }
      const newFile: OpenFile = {
        id,
        filePath: joinPath(worktreePath, entry.path),
        relativePath: entry.path,
        worktreeId,
        language,
        isDirty: false,
        mode: 'diff',
        diffSource: 'commit',
        commitCompare,
        branchOldPath: entry.oldPath,
        conflict: undefined,
        skippedConflicts: undefined,
        conflictReview: undefined,
        isPreview: isPreview || undefined,
        runtimeEnvironmentId
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
            activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
          }
        }
      }
      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
      }
    })
    void openWorkspaceEditorItem(
      get(),
      id,
      worktreeId,
      entry.path,
      'diff',
      isPreview,
      editorItemTargetGroupId
    )
  },
  openAllDiffs: (worktreeId, worktreePath, alternate, areaFilter, entriesSnapshot) => {
    const id = areaFilter
      ? `${worktreeId}::all-diffs::uncommitted::${areaFilter}`
      : `${worktreeId}::all-diffs::uncommitted`
    const label = areaFilter
      ? ({ staged: 'Staged Changes', unstaged: 'Changes', untracked: 'Untracked Files' }[
          areaFilter
        ] ?? 'All Changes')
      : 'All Changes'
    set((s) => {
      const branchSummary = s.gitBranchCompareSummaryByWorktree[worktreeId]
      const branchCompare =
        !areaFilter &&
        branchSummary?.status === 'ready' &&
        branchSummary.baseOid &&
        branchSummary.headOid &&
        branchSummary.mergeBase
          ? toBranchCompareSnapshot(branchSummary)
          : undefined
      const branchEntriesSnapshot = branchCompare
        ? (s.gitBranchChangesByWorktree[worktreeId] ?? [])
        : undefined
      const relevantEntries =
        entriesSnapshot ??
        (s.gitStatusByWorktree[worktreeId] ?? []).filter((entry) => {
          return areaFilter === undefined || entry.area === areaFilter
        })
      const skippedConflicts = relevantEntries
        .filter((entry) => entry.conflictStatus === 'unresolved' && entry.conflictKind)
        .map((entry) => ({ path: entry.path, conflictKind: entry.conflictKind! }))
      // Why: snapshot entries at open time so a later commit can't yank them and force a rebuild that loses loaded content + scroll position.
      const uncommittedEntriesSnapshot = relevantEntries
      const id = areaFilter
        ? `${worktreeId}::all-diffs::uncommitted::${areaFilter}`
        : `${worktreeId}::all-diffs::uncommitted`
      const label = areaFilter
        ? ({ staged: 'Staged Changes', unstaged: 'Changes', untracked: 'Untracked Files' }[
            areaFilter
          ] ?? 'All Changes')
        : 'All Changes'
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(s, worktreeId, undefined)
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  diffSource: branchCompare ? 'combined-all' : 'combined-uncommitted',
                  branchCompare,
                  branchEntriesSnapshot,
                  uncommittedEntriesSnapshot,
                  combinedAlternate: alternate,
                  combinedAreaFilter: areaFilter,
                  skippedConflicts,
                  conflictReview: undefined,
                  conflict: undefined,
                  runtimeEnvironmentId
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
        relativePath: label,
        worktreeId,
        language: 'plaintext',
        isDirty: false,
        mode: 'diff',
        diffSource: branchCompare ? 'combined-all' : 'combined-uncommitted',
        branchCompare,
        branchEntriesSnapshot,
        uncommittedEntriesSnapshot,
        combinedAlternate: alternate,
        combinedAreaFilter: areaFilter,
        skippedConflicts,
        conflictReview: undefined,
        conflict: undefined,
        runtimeEnvironmentId
      }
      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
      }
    })
    void openWorkspaceEditorItem(get(), id, worktreeId, label, 'diff')
  },
  }
}
