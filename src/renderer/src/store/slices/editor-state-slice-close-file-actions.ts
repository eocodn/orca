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
export function createEditorSliceCloseFileActions4(set: SliceSet, get: SliceGet) {
  return {
  closeFile: (fileId) => {
    // Why: capture untitled+dirty state before set() mutates the store, so cleanup of throwaway untitled files can decide after removal.
    const preClose = get().openFiles.find((f) => f.id === fileId)
    // Why: also check editorDrafts — isDirty is set by a debounced callback, so a draft can exist before isDirty flushes; a draft means the user typed something.
    const hasDraft = !!get().editorDrafts[fileId]
    const shouldDeleteFromDisk = shouldDeleteUntouchedUntitledFile(preClose, hasDraft)

    // Why: mirrored tabs are host-owned, so the host must close its copy or its next snapshot re-mirrors the file and the tab reopens.
    notifyHostOfMirroredEditorClose(get(), preClose?.worktreeId, fileId)

    set((s) => {
      const closedFile = s.openFiles.find((f) => f.id === fileId)
      const idx = s.openFiles.findIndex((f) => f.id === fileId)
      const newFiles = s.openFiles.filter((f) => f.id !== fileId)
      const newEditorDrafts = { ...s.editorDrafts }
      delete newEditorDrafts[fileId]
      const newMarkdownViewMode = { ...s.markdownViewMode }
      delete newMarkdownViewMode[fileId]
      const newEditorViewMode = { ...s.editorViewMode }
      delete newEditorViewMode[fileId]
      const markdownVisibilityKeys = new Set([fileId])
      if (closedFile?.markdownPreviewSourceFileId) {
        markdownVisibilityKeys.add(closedFile.markdownPreviewSourceFileId)
      }
      const visibilityKeysToRemove = [...markdownVisibilityKeys].filter(
        (key) =>
          !newFiles.some((file) => file.id === key || file.markdownPreviewSourceFileId === key)
      )
      const newMarkdownFrontmatterVisible =
        visibilityKeysToRemove.length > 0
          ? removeMarkdownVisibilityKeys(s.markdownFrontmatterVisible, visibilityKeysToRemove)
          : s.markdownFrontmatterVisible
      const newMarkdownTableOfContentsVisible =
        visibilityKeysToRemove.length > 0
          ? removeMarkdownVisibilityKeys(s.markdownTableOfContentsVisible, visibilityKeysToRemove)
          : s.markdownTableOfContentsVisible
      // Why: editorCursorLine is keyed by fileId and grows unbounded across a long session without cleanup on close.
      const newEditorCursorLine = { ...s.editorCursorLine }
      delete newEditorCursorLine[fileId]
      let newActiveId = s.activeFileId
      const newActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }

      if (s.activeFileId === fileId) {
        // Find next file within the same worktree
        const worktreeId = closedFile?.worktreeId
        const worktreeFiles = worktreeId
          ? newFiles.filter((f) => f.worktreeId === worktreeId)
          : newFiles
        if (worktreeFiles.length === 0) {
          newActiveId = null
        } else {
          // Pick adjacent file from same worktree
          const closedWorktreeIdx = worktreeId
            ? s.openFiles
                .filter((f) => f.worktreeId === worktreeId)
                .findIndex((f) => f.id === fileId)
            : idx
          newActiveId =
            closedWorktreeIdx >= worktreeFiles.length
              ? worktreeFiles.at(-1)!.id
              : worktreeFiles[closedWorktreeIdx].id
        }
        if (worktreeId) {
          newActiveFileIdByWorktree[worktreeId] = newActiveId
        }
      }

      // Why: editors share a mixed tab strip with browser tabs; closing the last editor should reveal a browser tab before falling back to a terminal.
      const activeWorktreeId = s.activeWorktreeId
      const remainingForWorktree = activeWorktreeId
        ? newFiles.filter((f) => f.worktreeId === activeWorktreeId)
        : newFiles
      const browserTabsForWorktree = activeWorktreeId
        ? (s.browserTabsByWorktree[activeWorktreeId] ?? [])
        : []
      const terminalTabsForWorktree = activeWorktreeId
        ? (s.tabsByWorktree[activeWorktreeId] ?? [])
        : []
      const fallbackBrowserTabId =
        activeWorktreeId && browserTabsForWorktree.length > 0
          ? (s.activeBrowserTabIdByWorktree[activeWorktreeId] ??
            browserTabsForWorktree[0]?.id ??
            null)
          : s.activeBrowserTabId
      const newActiveTabType =
        remainingForWorktree.length > 0
          ? s.activeTabType
          : browserTabsForWorktree.length > 0
            ? 'browser'
            : 'terminal'
      const newActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
      if (activeWorktreeId && remainingForWorktree.length === 0) {
        newActiveTabTypeByWorktree[activeWorktreeId] =
          browserTabsForWorktree.length > 0 ? 'browser' : 'terminal'
      }
      const shouldDeactivateWorktree =
        activeWorktreeId !== null &&
        remainingForWorktree.length === 0 &&
        browserTabsForWorktree.length === 0 &&
        terminalTabsForWorktree.length === 0

      // Why: prune the closed id from tabBarOrderByWorktree so stale ids don't shift positions on the next reconcile.
      const worktreeId = closedFile?.worktreeId ?? activeWorktreeId
      const nextTabBarOrderByWorktree =
        worktreeId && s.tabBarOrderByWorktree
          ? {
              ...s.tabBarOrderByWorktree,
              [worktreeId]: (s.tabBarOrderByWorktree[worktreeId] ?? []).filter(
                (entryId) => entryId !== fileId
              )
            }
          : s.tabBarOrderByWorktree

      let nextRecentlyClosed = s.recentlyClosedEditorTabsByWorktree
      let nextRecentlyClosedKinds = s.recentlyClosedTabKindsByWorktree
      const wtRecent = closedFile?.worktreeId
      // Why: exclude untitled unedited files (deleted from disk after close, so Cmd+Shift+T can't reopen a gone path) and ephemeral preview tabs from the reopen stack.
      if (
        closedFile &&
        wtRecent &&
        !shouldDeleteFromDisk &&
        closedFile.mode !== 'markdown-preview'
      ) {
        const {
          id: _id,
          isDirty: _dirty,
          mirroredFromRuntimeSession: _mirrored,
          ...snap
        } = closedFile
        const stack = s.recentlyClosedEditorTabsByWorktree[wtRecent] ?? []
        nextRecentlyClosed = {
          ...s.recentlyClosedEditorTabsByWorktree,
          [wtRecent]: [snap as ClosedEditorTabSnapshot, ...stack].slice(
            0,
            MAX_RECENT_CLOSED_EDITOR_TABS
          )
        }
        nextRecentlyClosedKinds = pushRecentlyClosedTabKind(
          s.recentlyClosedTabKindsByWorktree,
          wtRecent,
          'editor'
        )
      }

      return {
        openFiles: newFiles,
        editorDrafts: newEditorDrafts,
        editorCursorLine: newEditorCursorLine,
        activeFileId: newActiveId,
        // Why: if the last editor closes with no browser/terminal surface left, return to the landing state like the terminal/browser close handlers do.
        activeWorktreeId: shouldDeactivateWorktree ? null : s.activeWorktreeId,
        activeBrowserTabId: shouldDeactivateWorktree
          ? null
          : activeWorktreeId && remainingForWorktree.length === 0
            ? fallbackBrowserTabId
            : s.activeBrowserTabId,
        activeTabType: newActiveTabType,
        activeFileIdByWorktree: newActiveFileIdByWorktree,
        activeTabTypeByWorktree: newActiveTabTypeByWorktree,
        markdownViewMode: newMarkdownViewMode,
        editorViewMode: newEditorViewMode,
        markdownFrontmatterVisible: newMarkdownFrontmatterVisible,
        markdownTableOfContentsVisible: newMarkdownTableOfContentsVisible,
        tabBarOrderByWorktree: nextTabBarOrderByWorktree,
        pendingEditorReveal: null,
        pendingEditorFocusRequest:
          s.pendingEditorFocusRequest?.fileId === fileId ? null : s.pendingEditorFocusRequest,
        recentlyClosedEditorTabsByWorktree: nextRecentlyClosed,
        recentlyClosedTabKindsByWorktree: nextRecentlyClosedKinds
      }
    })

    // Why: untitled unedited files exist on disk only because createUntitledMarkdownFile() eagerly writes a bindable path; delete the clutter (fire-and-forget).
    if (shouldDeleteFromDisk && preClose && typeof window !== 'undefined') {
      deleteUntouchedUntitledFile(get(), preClose)
    }

    // Why: route editor/diff closes through the unified close path (MRU + visual-neighbor fallback) so they match terminal/browser tab-close behavior.
    for (const tabs of Object.values(get().unifiedTabsByWorktree ?? {})) {
      const unifiedTab = tabs.find(
        (entry) =>
          entry.entityId === fileId &&
          (entry.contentType === 'editor' ||
            entry.contentType === 'diff' ||
            entry.contentType === 'conflict-review' ||
            entry.contentType === 'check-details')
      )
      if (unifiedTab) {
        get().closeUnifiedTab(unifiedTab.id)
        break
      }
    }
  },
  reopenClosedEditorTab: (worktreeId) => {
    const stack = get().recentlyClosedEditorTabsByWorktree[worktreeId] ?? []
    const next = stack[0]
    if (!next) {
      return false
    }
    set((s) => ({
      recentlyClosedEditorTabsByWorktree: {
        ...s.recentlyClosedEditorTabsByWorktree,
        [worktreeId]: (s.recentlyClosedEditorTabsByWorktree[worktreeId] ?? []).slice(1)
      }
    }))
    get().openFile(next)
    return true
  },
  }
}
