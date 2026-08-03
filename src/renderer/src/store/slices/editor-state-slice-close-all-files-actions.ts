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
export function createEditorSliceCloseAllFilesActions5(set: SliceSet, get: SliceGet) {
  return {
  closeAllFiles: () => {
    const state = get()
    const activeWorktreeId = state.activeWorktreeId

    // Why: like closeFile — untitled unedited files are empty placeholders that shouldn't survive close-all.
    const untitledToDelete = state.openFiles.filter(
      (f) =>
        shouldDeleteUntouchedUntitledFile(f, !!state.editorDrafts[f.id]) &&
        (!activeWorktreeId || f.worktreeId === activeWorktreeId)
    )
    const closingFiles = state.openFiles.filter(
      (file) => !activeWorktreeId || file.worktreeId === activeWorktreeId
    )
    // Why: close-all bypasses closeFile, so notify mirrored host-owned editors here or the next host snapshot reopens them.
    for (const file of closingFiles) {
      notifyHostOfMirroredEditorClose(state, file.worktreeId, file.id)
    }

    const closingItemIds = Object.values(state.unifiedTabsByWorktree ?? {})
      .flat()
      .filter(
        (item) =>
          (item.contentType === 'editor' ||
            item.contentType === 'diff' ||
            item.contentType === 'conflict-review' ||
            item.contentType === 'check-details') &&
          (!activeWorktreeId || item.worktreeId === activeWorktreeId)
      )
      .map((item) => item.id)
    set((s) => {
      const activeWorktreeId = s.activeWorktreeId
      if (!activeWorktreeId) {
        return {
          openFiles: [],
          editorDrafts: {},
          editorCursorLine: {},
          activeFileId: null,
          activeTabType: 'terminal',
          markdownViewMode: {},
          editorViewMode: {},
          markdownFrontmatterVisible: {},
          markdownTableOfContentsVisible: {},
          pendingEditorReveal: null,
          pendingEditorFocusRequest: null
        }
      }
      // Only close files for the current worktree
      const newFiles = s.openFiles.filter((f) => f.worktreeId !== activeWorktreeId)
      const remainingFileIds = new Set(newFiles.map((f) => f.id))
      const newEditorDrafts = Object.fromEntries(
        Object.entries(s.editorDrafts).filter(([fileId]) => remainingFileIds.has(fileId))
      )
      const newMarkdownViewMode = Object.fromEntries(
        Object.entries(s.markdownViewMode).filter(([fileId]) => remainingFileIds.has(fileId))
      )
      const newEditorViewMode = Object.fromEntries(
        Object.entries(s.editorViewMode).filter(([fileId]) => remainingFileIds.has(fileId))
      )
      const newMarkdownFrontmatterVisible = Object.fromEntries(
        Object.entries(s.markdownFrontmatterVisible).filter(([fileId]) =>
          remainingFileIds.has(fileId)
        )
      )
      const newMarkdownTableOfContentsVisible = Object.fromEntries(
        Object.entries(s.markdownTableOfContentsVisible).filter(([fileId]) =>
          remainingFileIds.has(fileId)
        )
      )
      const newEditorCursorLine = Object.fromEntries(
        Object.entries(s.editorCursorLine).filter(([fileId]) => remainingFileIds.has(fileId))
      )
      const newActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
      delete newActiveFileIdByWorktree[activeWorktreeId]
      const newActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
      const browserTabsForWorktree = s.browserTabsByWorktree[activeWorktreeId] ?? []
      const terminalTabsForWorktree = s.tabsByWorktree[activeWorktreeId] ?? []
      newActiveTabTypeByWorktree[activeWorktreeId] =
        browserTabsForWorktree.length > 0 ? 'browser' : 'terminal'
      const shouldDeactivateWorktree =
        browserTabsForWorktree.length === 0 && terminalTabsForWorktree.length === 0

      // Why: mirrored tabs use host tab ids in tab order while local entries use file ids; remove both shapes.
      const closedFileIds = new Set(
        s.openFiles.filter((f) => f.worktreeId === activeWorktreeId).map((f) => f.id)
      )
      const closedTabOrderIds = new Set([...closedFileIds, ...closingItemIds])
      const nextTabBarOrderByWorktree = s.tabBarOrderByWorktree
        ? {
            ...s.tabBarOrderByWorktree,
            [activeWorktreeId]: (s.tabBarOrderByWorktree[activeWorktreeId] ?? []).filter(
              (entryId) => !closedTabOrderIds.has(entryId)
            )
          }
        : s.tabBarOrderByWorktree

      const closingFiles = s.openFiles.filter((f) => f.worktreeId === activeWorktreeId)
      let nextRecentClosed = s.recentlyClosedEditorTabsByWorktree[activeWorktreeId] ?? []
      let capturedCloseCount = 0
      for (const f of [...closingFiles].toReversed()) {
        // Why: skip untitled non-dirty files (deleted from disk after close) and ephemeral preview tabs so the reopen stack has no vanished/junk paths.
        if (
          shouldDeleteUntouchedUntitledFile(f, !!s.editorDrafts[f.id]) ||
          f.mode === 'markdown-preview'
        ) {
          continue
        }
        const { id: _id, isDirty: _dirty, mirroredFromRuntimeSession: _mirrored, ...snap } = f
        nextRecentClosed = [snap as ClosedEditorTabSnapshot, ...nextRecentClosed].slice(
          0,
          MAX_RECENT_CLOSED_EDITOR_TABS
        )
        capturedCloseCount += 1
      }

      return {
        openFiles: newFiles,
        editorDrafts: newEditorDrafts,
        editorCursorLine: newEditorCursorLine,
        activeFileId: null,
        // Why: closing every editor can leave no renderable surface; clear the active worktree so the renderer shows the landing page, not a blank workspace.
        activeWorktreeId: shouldDeactivateWorktree ? null : s.activeWorktreeId,
        activeBrowserTabId: shouldDeactivateWorktree
          ? null
          : browserTabsForWorktree.length > 0
            ? (s.activeBrowserTabIdByWorktree[activeWorktreeId] ??
              browserTabsForWorktree[0]?.id ??
              null)
            : s.activeBrowserTabId,
        activeTabType: browserTabsForWorktree.length > 0 ? 'browser' : 'terminal',
        markdownViewMode: newMarkdownViewMode,
        editorViewMode: newEditorViewMode,
        markdownFrontmatterVisible: newMarkdownFrontmatterVisible,
        markdownTableOfContentsVisible: newMarkdownTableOfContentsVisible,
        activeFileIdByWorktree: newActiveFileIdByWorktree,
        activeTabTypeByWorktree: newActiveTabTypeByWorktree,
        tabBarOrderByWorktree: nextTabBarOrderByWorktree,
        // Why: clear the one-shot search reveal; keeping it after closing all editors would make a later reopen jump to an old match.
        pendingEditorReveal: null,
        pendingEditorFocusRequest:
          s.pendingEditorFocusRequest?.worktreeId === activeWorktreeId
            ? null
            : s.pendingEditorFocusRequest,
        recentlyClosedEditorTabsByWorktree: {
          ...s.recentlyClosedEditorTabsByWorktree,
          [activeWorktreeId]: nextRecentClosed
        },
        recentlyClosedTabKindsByWorktree: pushRecentlyClosedTabKind(
          s.recentlyClosedTabKindsByWorktree,
          activeWorktreeId,
          'editor',
          capturedCloseCount
        )
      }
    })
    if (typeof window !== 'undefined') {
      const postCloseState = get()
      for (const f of untitledToDelete) {
        deleteUntouchedUntitledFile(postCloseState, f)
      }
    }
    for (const itemId of closingItemIds) {
      get().closeUnifiedTab?.(itemId)
    }
  },
  setActiveFile: (fileId) => {
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      const worktreeId = file?.worktreeId
      return {
        activeFileId: fileId,
        activeFileIdByWorktree: worktreeId
          ? { ...s.activeFileIdByWorktree, [worktreeId]: fileId }
          : s.activeFileIdByWorktree
      }
    })
    const state = get()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return
    }
    const groupId =
      state.activeGroupIdByWorktree?.[worktreeId] ?? state.groupsByWorktree?.[worktreeId]?.[0]?.id
    if (!groupId) {
      return
    }
    const item =
      state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'editor') ??
      state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'diff') ??
      state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'conflict-review')
    if (item) {
      state.activateTab?.(item.id)
    }
  },
  reorderFiles: (fileIds) =>
    set((s) => {
      const reorderedSet = new Set(fileIds)
      const byId = new Map(s.openFiles.map((f) => [f.id, f]))
      const reordered = fileIds.map((id) => byId.get(id)).filter(Boolean) as OpenFile[]
      // Replace the reordered subset in-place: keep other-worktree files at their positions
      const result: OpenFile[] = []
      let ri = 0
      for (const f of s.openFiles) {
        if (reorderedSet.has(f.id)) {
          result.push(reordered[ri++])
        } else {
          result.push(f)
        }
      }
      return { openFiles: result }
    }),
  markFileDirty: (fileId, dirty) =>
    set((s) => {
      // Why: this fires on every keystroke; rebuilding openFiles unconditionally thrashes subscribers and caused typing lag, so bail when nothing changes.
      const file = s.openFiles.find((f) => f.id === fileId)
      if (!file) {
        return s
      }
      // Why: read-only tabs can never become dirty; hard no-op any stray change/save callback that reached here.
      if (file.readOnly === true) {
        return s
      }
      const needsPreviewClear = dirty && file.isPreview
      if (file.isDirty === dirty && !needsPreviewClear) {
        return s
      }
      const nextOpenFiles = s.openFiles.map((f) =>
        f.id === fileId
          ? { ...f, isDirty: dirty, ...(needsPreviewClear ? { isPreview: undefined } : {}) }
          : f
      )
      return {
        openFiles: nextOpenFiles,
        ...(needsPreviewClear
          ? {
              unifiedTabsByWorktree: Object.fromEntries(
                Object.entries(s.unifiedTabsByWorktree ?? {}).map(([worktreeId, tabs]) => [
                  worktreeId,
                  tabs.map((tab) =>
                    tab.entityId === fileId && isEditorTabContentType(tab.contentType)
                      ? { ...tab, isPreview: false }
                      : tab
                  )
                ])
              )
            }
          : {})
      }
    }),
  setExternalMutation: (fileId, mutation) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      if (!file) {
        return s
      }
      const next = mutation ?? undefined
      if (file.externalMutation === next) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, externalMutation: next } : f))
      }
    }),
  setLastKnownDiskSignature: (fileId, signature) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      if (!file || file.lastKnownDiskSignature === signature) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, lastKnownDiskSignature: signature } : f
        )
      }
    }),
  clearPendingDiskBaselineVerification: (fileId) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      if (!file?.pendingDiskBaselineVerification) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, pendingDiskBaselineVerification: undefined } : f
        )
      }
    }),
  setPendingDiskBaselineVerification: (fileId, value) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      const next = value || undefined
      if (!file || file.pendingDiskBaselineVerification === next) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, pendingDiskBaselineVerification: next } : f
        )
      }
    }),
  }
}
