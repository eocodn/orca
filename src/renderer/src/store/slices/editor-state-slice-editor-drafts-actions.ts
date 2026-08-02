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
export function createEditorSliceEditorDraftsActions(set: SliceSet, get: SliceGet) {
  return {
  editorDrafts: {},
  setEditorDraft: (fileId, content) =>
    set((s) => {
      // Why: read-only tabs must never accrue a draft — it seeds dirty/autosave/hot-exit restore that could overwrite an agent transcript.
      const file = s.openFiles.find((f) => f.id === fileId)
      if (file?.readOnly === true) {
        return s
      }
      return { editorDrafts: { ...s.editorDrafts, [fileId]: content } }
    }),
  clearEditorDraft: (fileId) =>
    set((s) => {
      if (!(fileId in s.editorDrafts)) {
        return s
      }
      const next = { ...s.editorDrafts }
      delete next[fileId]
      return { editorDrafts: next }
    }),
  clearEditorDrafts: (fileIds) =>
    set((s) => {
      if (fileIds.length === 0) {
        return s
      }
      const next = { ...s.editorDrafts }
      let changed = false
      for (const fileId of fileIds) {
        if (fileId in next) {
          delete next[fileId]
          changed = true
        }
      }
      return changed ? { editorDrafts: next } : s
    }),

  // Markdown view mode
  markdownViewMode: {},
  setMarkdownViewMode: (fileId, mode) =>
    set((s) => ({
      markdownViewMode: { ...s.markdownViewMode, [fileId]: mode }
    })),

  // Editor view mode (edit vs changes-diff). See EditorViewMode.
  editorViewMode: {},
  setEditorViewMode: (fileId, mode) =>
    set((s) => {
      // Why: default is 'edit' — delete rather than store it so the record stays minimal and hydration round-trips cleanly.
      if (mode === 'edit') {
        if (!(fileId in s.editorViewMode)) {
          return s
        }
        const next = { ...s.editorViewMode }
        delete next[fileId]
        return { editorViewMode: next }
      }
      return { editorViewMode: { ...s.editorViewMode, [fileId]: mode } }
    }),

  // Markdown preview front-matter visibility (#4468).
  markdownFrontmatterVisible: {},
  setMarkdownFrontmatterVisible: (fileId, visible) =>
    set((s) => {
      // Why: don't persist the default value; delete instead so the map carries only overrides and hydration round-trips cleanly.
      if (visible) {
        if (!(fileId in s.markdownFrontmatterVisible)) {
          return s
        }
        const next = { ...s.markdownFrontmatterVisible }
        delete next[fileId]
        return { markdownFrontmatterVisible: next }
      }
      return { markdownFrontmatterVisible: { ...s.markdownFrontmatterVisible, [fileId]: false } }
    }),

  // Markdown table of contents visibility
  markdownTableOfContentsVisible: {},
  setMarkdownTableOfContentsVisible: (fileId, visible) =>
    set((s) => {
      if (!visible) {
        if (!(fileId in s.markdownTableOfContentsVisible)) {
          return s
        }
        const next = { ...s.markdownTableOfContentsVisible }
        delete next[fileId]
        return { markdownTableOfContentsVisible: next }
      }
      return {
        markdownTableOfContentsVisible: {
          ...s.markdownTableOfContentsVisible,
          [fileId]: true
        }
      }
    }),

  // Markdown table of contents panel sizing
  markdownTocPanelWidth: 240,
  setMarkdownTocPanelWidth: (width) =>
    set((s) => ({
      markdownTocPanelWidth: clampMarkdownTocPanelWidth(width, undefined, s.markdownTocPanelWidth)
    })),

  // Combined diff file tree sizing
  combinedDiffFileTreeWidth: COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH,
  setCombinedDiffFileTreeWidth: (width) =>
    set((s) => ({
      combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
        width,
        undefined,
        s.combinedDiffFileTreeWidth
      )
    })),

  // Right sidebar
  rightSidebarOpen: false,
  rightSidebarWidth: 280,
  rightSidebarTab: 'explorer',
  rightSidebarExplorerView: 'files',
  rightSidebarRouteRequestId: 0,
  rightSidebarTabByWorktree: {},
  rightSidebarExplorerViewByWorktree: {},
  activityBarPosition: 'top',
  toggleRightSidebar: () => set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
  setRightSidebarTab: (tab) =>
    set((s) => ({
      rightSidebarTab: tab,
      rightSidebarRouteRequestId: s.rightSidebarRouteRequestId + 1,
      ...(tab === 'explorer' ? { rightSidebarExplorerView: 'files' as const } : {})
    })),
  setRightSidebarExplorerView: (view) =>
    set((s) => ({
      rightSidebarExplorerView: view,
      rightSidebarRouteRequestId: s.rightSidebarRouteRequestId + 1,
      ...(s.activeWorktreeId
        ? {
            rightSidebarExplorerViewByWorktree: {
              ...s.rightSidebarExplorerViewByWorktree,
              [s.activeWorktreeId]: view
            }
          }
        : {})
    })),
  showRightSidebarFiles: () =>
    set((s) => ({
      rightSidebarOpen: true,
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'files',
      rightSidebarRouteRequestId: s.rightSidebarRouteRequestId + 1,
      ...(s.activeWorktreeId
        ? {
            rightSidebarExplorerViewByWorktree: {
              ...s.rightSidebarExplorerViewByWorktree,
              [s.activeWorktreeId]: 'files'
            }
          }
        : {})
    })),
  showRightSidebarSearch: (payload) =>
    set((s) => {
      const next = {
        rightSidebarOpen: true,
        rightSidebarTab: 'explorer' as const,
        rightSidebarExplorerView: 'search' as const,
        rightSidebarRouteRequestId: s.rightSidebarRouteRequestId + 1,
        ...(s.activeWorktreeId
          ? {
              rightSidebarExplorerViewByWorktree: {
                ...s.rightSidebarExplorerViewByWorktree,
                [s.activeWorktreeId]: 'search' as const
              }
            }
          : {})
      }
      if (!s.activeWorktreeId) {
        return next
      }

      const query = payload?.query?.trim() ? payload.query : null
      const includePattern = payload?.includePattern?.trim() ? payload.includePattern : null
      const current = s.fileSearchStateByWorktree[s.activeWorktreeId] || defaultFileSearchState()
      const shouldSeed = Boolean(query || (includePattern && current.query.trim()))
      const shouldFocus = !shouldSeed
      const nextSearchState = {
        ...current,
        ...(query ? { query } : {}),
        ...(includePattern ? { includePattern } : {}),
        ...(shouldSeed
          ? {
              results: null,
              resultOwner: null,
              loading: false,
              collapsedFiles: new Set<string>(),
              seedRequestId: (current.seedRequestId ?? 0) + 1
            }
          : {}),
        ...(shouldFocus ? { focusRequestId: (current.focusRequestId ?? 0) + 1 } : {})
      }

      return {
        ...next,
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [s.activeWorktreeId]: nextSearchState
        }
      }
    }),
  setActivityBarPosition: (position) => set({ activityBarPosition: position }),

  // File explorer
  expandedDirs: {},
  collapseAllDirs: (worktreeId) =>
    set((s) => {
      const current = s.expandedDirs[worktreeId]
      if (!current?.size) {
        return s
      }
      return {
        expandedDirs: {
          ...s.expandedDirs,
          [worktreeId]: new Set<string>()
        }
      }
    }),
  collapseDirSubtree: (worktreeId, dirPath) =>
    set((s) => {
      const current = s.expandedDirs[worktreeId]
      if (!current?.size) {
        return s
      }
      const next = new Set(
        Array.from(current).filter((expandedDir) => !isPathInsideOrEqual(dirPath, expandedDir))
      )
      if (next.size === current.size) {
        return s
      }
      return { expandedDirs: { ...s.expandedDirs, [worktreeId]: next } }
    }),
  toggleDir: (worktreeId, dirPath) =>
    set((s) => {
      const current = s.expandedDirs[worktreeId] ?? new Set<string>()
      const next = new Set(current)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return { expandedDirs: { ...s.expandedDirs, [worktreeId]: next } }
    }),
  pendingExplorerReveal: null,
  revealInExplorer: (worktreeId, filePath) =>
    set((s) => ({
      rightSidebarOpen: true,
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'files',
      rightSidebarRouteRequestId: s.rightSidebarRouteRequestId + 1,
      rightSidebarExplorerViewByWorktree: {
        ...s.rightSidebarExplorerViewByWorktree,
        [worktreeId]: 'files'
      },
      pendingExplorerReveal: { worktreeId, filePath, requestId: Date.now() }
    })),
  clearPendingExplorerReveal: () => set({ pendingExplorerReveal: null }),

  // Open files
  openFiles: [],
  activeFileId: null,
  activeFileIdByWorktree: {},
  activeTabTypeByWorktree: {},
  activeTabType: 'terminal',
  recentlyClosedEditorTabsByWorktree: {},
  setActiveTabType: (type) =>
    set((s) => {
      const worktreeId = s.activeWorktreeId
      return {
        activeTabType: type,
        activeTabTypeByWorktree: worktreeId
          ? { ...s.activeTabTypeByWorktree, [worktreeId]: type }
          : s.activeTabTypeByWorktree
      }
    }),
  }
}