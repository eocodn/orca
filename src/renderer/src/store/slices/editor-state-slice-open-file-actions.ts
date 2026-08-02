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
export function createEditorSliceOpenFileActions2(set: SliceSet, get: SliceGet) {
  return {
  openFile: (file, options) => {
    let editorItemWorktreeId = file.worktreeId
    let editorItemFileId = file.filePath
    let editorItemLabel = file.relativePath
    let editorItemContentType: 'editor' | 'diff' | 'conflict-review' | 'check-details' =
      file.mode === 'conflict-review'
        ? 'conflict-review'
        : file.mode === 'check-details'
          ? 'check-details'
          : file.mode === 'diff'
            ? 'diff'
            : 'editor'
    let editorItemTargetGroupId = options?.targetGroupId
    set((s) => {
      const worktreeId = file.worktreeId
      let operationProvenance = file.operationProvenance
      if (!operationProvenance && file.mode === 'edit' && file.readOnly !== true) {
        try {
          operationProvenance = captureEditorFileOperationProvenance(
            s,
            worktreeId,
            options?.suppressActiveRuntimeFallback ? null : file.runtimeEnvironmentId,
            options?.suppressActiveRuntimeFallback === true ||
              file.runtimeEnvironmentId !== undefined
          )
        } catch (error) {
          toast.error(extractIpcErrorMessage(error, 'Failed to resolve file owner.'))
          // Why: mirrored tabs can arrive before their graph row; allow convergence while mutation paths still fail closed without provenance.
        }
      }
      const runtimeEnvironmentId = operationProvenance
        ? operationProvenance.generation.route.runtimeEnvironmentId
        : file.runtimeEnvironmentId === null
          ? null
          : (file.runtimeEnvironmentId ??
            (options?.suppressActiveRuntimeFallback
              ? null
              : (s.settings?.activeRuntimeEnvironmentId?.trim() ?? undefined)))
      const reusableOpenFileModes = getReusableOpenFileModes(file.mode)
      const existing = s.openFiles.find(
        (f) =>
          f.filePath === file.filePath &&
          matchesEditorMode(f, reusableOpenFileModes) &&
          isSameEditorOwner(f, worktreeId, runtimeEnvironmentId)
      )
      const id = resolveEditorFileIdForOwner(
        s,
        file.filePath,
        worktreeId,
        runtimeEnvironmentId,
        reusableOpenFileModes
      )
      editorItemFileId = id
      const isPreview = options?.preview ?? false
      const recordReplacedPreview = options?.recordReplacedPreview ?? false
      // Why: resolve the target group up-front so preview replacement is scoped to it (group B open must not evict group A's preview).
      const targetGroupId =
        resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
      editorItemTargetGroupId = targetGroupId
      const activeResult = buildEditorActiveResult(s, worktreeId, id)
      if (existing) {
        // If opening as non-preview, also pin the existing tab
        const updatedPreview = isPreview ? existing.isPreview : false
        const nextExternalSshTargetId = file.externalSshTargetId ?? existing.externalSshTargetId
        const refreshExternalSshProvenance = file.externalSshTargetId !== undefined
        const fileContentReloadNonce = shouldRequestExistingFileContentReload(
          existing,
          file.mode,
          options
        )
          ? (existing.fileContentReloadNonce ?? 0) + 1
          : existing.fileContentReloadNonce
        const needsExistingUpdate =
          existing.mode !== file.mode ||
          existing.diffSource !== file.diffSource ||
          existing.branchCompare?.compareVersion !== file.branchCompare?.compareVersion ||
          existing.commitCompare?.compareVersion !== file.commitCompare?.compareVersion ||
          existing.conflict?.kind !== file.conflict?.kind ||
          existing.conflict?.conflictKind !== file.conflict?.conflictKind ||
          existing.conflict?.conflictStatus !== file.conflict?.conflictStatus ||
          existing.conflictReview?.snapshotTimestamp !== file.conflictReview?.snapshotTimestamp ||
          existing.isPreview !== updatedPreview ||
          existing.language !== file.language ||
          existing.relativePath !== file.relativePath ||
          existing.worktreeId !== file.worktreeId ||
          existing.runtimeEnvironmentId !== runtimeEnvironmentId ||
          existing.externalSshTargetId !== nextExternalSshTargetId ||
          refreshExternalSshProvenance ||
          existing.fileContentReloadNonce !== fileContentReloadNonce
        if (!needsExistingUpdate) {
          return activeResult
        }
        // Why: `readOnly` is intentionally NOT in this override map — it's sticky, so `...f` preserves the tab's own read-only state.
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  relativePath: file.relativePath,
                  worktreeId: file.worktreeId,
                  language: file.language,
                  runtimeEnvironmentId,
                  externalSshTargetId: nextExternalSshTargetId,
                  operationProvenance: refreshExternalSshProvenance
                    ? operationProvenance
                    : f.operationProvenance,
                  mode: file.mode,
                  diffSource: file.diffSource,
                  branchCompare: file.branchCompare,
                  commitCompare: file.commitCompare,
                  branchOldPath: file.branchOldPath,
                  combinedAlternate: file.combinedAlternate,
                  combinedAreaFilter: file.combinedAreaFilter,
                  commitEntriesSnapshot: file.commitEntriesSnapshot,
                  conflict: file.conflict,
                  skippedConflicts: file.skippedConflicts,
                  conflictReview: file.conflictReview,
                  isPreview: updatedPreview,
                  fileContentReloadNonce
                }
              : f
          ),
          ...activeResult
        }
      }

      // Why: scope preview replacement to worktreeId + targetGroupId so link clicks in group B don't evict group A's previews.
      let newFiles = s.openFiles
      if (isPreview) {
        const replaceablePreviewId = getReplaceablePreviewFileId(s, worktreeId, targetGroupId)
        const existingPreviewIdx = s.openFiles.findIndex((f) => f.id === replaceablePreviewId)
        if (existingPreviewIdx !== -1) {
          const replacedPreview = s.openFiles[existingPreviewIdx]
          // Why: reuse the shared eviction helper so per-file cursor/draft/visibility cleanup stays in one place.
          const {
            editorDrafts: nextEditorDrafts,
            editorCursorLine: nextEditorCursorLine,
            markdownViewMode: nextMarkdownViewMode,
            editorViewMode: nextEditorViewMode,
            markdownFrontmatterVisible: nextMarkdownFrontmatterVisible,
            markdownTableOfContentsVisible: nextMarkdownTableOfContentsVisible
          } = removeEditorStateForReplacedPreview(s, replacedPreview, id)
          // Replace in-place to preserve tab position
          newFiles = s.openFiles.map((f, i) =>
            i === existingPreviewIdx
              ? {
                  ...file,
                  id,
                  isDirty: false,
                  isPreview: true,
                  runtimeEnvironmentId,
                  operationProvenance
                }
              : f
          )
          // Swap the old preview ID for the new one in the stored tab bar order
          const prevOrder = s.tabBarOrderByWorktree?.[worktreeId]
          const previewTabBarUpdate = prevOrder
            ? {
                tabBarOrderByWorktree: {
                  ...s.tabBarOrderByWorktree,
                  [worktreeId]: prevOrder.map((eid) => (eid === replacedPreview.id ? id : eid))
                }
              }
            : {}
          // Why: push the evicted preview onto the recently-closed stack so Cmd/Ctrl+Shift+T can reopen it; gated to keep file-explorer clicks silent.
          let nextRecentlyClosed = s.recentlyClosedEditorTabsByWorktree
          let nextRecentlyClosedKinds = s.recentlyClosedTabKindsByWorktree
          if (recordReplacedPreview && replacedPreview.id !== id) {
            const {
              id: _rid,
              isDirty: _rdirty,
              mirroredFromRuntimeSession: _rmirrored,
              ...snap
            } = replacedPreview
            const stack = s.recentlyClosedEditorTabsByWorktree[worktreeId] ?? []
            nextRecentlyClosed = {
              ...s.recentlyClosedEditorTabsByWorktree,
              [worktreeId]: [snap as ClosedEditorTabSnapshot, ...stack].slice(
                0,
                MAX_RECENT_CLOSED_EDITOR_TABS
              )
            }
            nextRecentlyClosedKinds = pushRecentlyClosedTabKind(
              s.recentlyClosedTabKindsByWorktree,
              worktreeId,
              'editor'
            )
          }
          return {
            openFiles: newFiles,
            editorDrafts: nextEditorDrafts,
            editorCursorLine: nextEditorCursorLine,
            markdownViewMode: nextMarkdownViewMode,
            editorViewMode: nextEditorViewMode,
            markdownFrontmatterVisible: nextMarkdownFrontmatterVisible,
            markdownTableOfContentsVisible: nextMarkdownTableOfContentsVisible,
            recentlyClosedEditorTabsByWorktree: nextRecentlyClosed,
            recentlyClosedTabKindsByWorktree: nextRecentlyClosedKinds,
            ...previewTabBarUpdate,
            ...activeResult
          }
        }
      }

      // Why: append to the persisted tab bar order, else TabBar's reconcileOrder falls back to type-grouped ordering (terminals first).
      const tabBarUpdate: Record<string, unknown> = {}
      if (s.tabBarOrderByWorktree) {
        const currentOrder = s.tabBarOrderByWorktree[worktreeId] ?? []
        const terminalIds = (s.tabsByWorktree?.[worktreeId] ?? []).map((t) => t.id)
        const editorFileIds = s.openFiles
          .filter((f) => f.worktreeId === worktreeId)
          .map((f) => f.id)
        const browserIds = (s.browserTabsByWorktree?.[worktreeId] ?? []).map((t) => t.id)
        const allExisting = new Set([...terminalIds, ...editorFileIds, ...browserIds])
        const base = currentOrder.filter((eid) => allExisting.has(eid))
        const inBase = new Set(base)
        for (const eid of [...terminalIds, ...editorFileIds, ...browserIds]) {
          if (!inBase.has(eid)) {
            base.push(eid)
            inBase.add(eid)
          }
        }
        base.push(id)
        tabBarUpdate.tabBarOrderByWorktree = { ...s.tabBarOrderByWorktree, [worktreeId]: base }
      }

      return {
        openFiles: [
          ...newFiles,
          {
            ...file,
            id,
            isDirty: false,
            isPreview: isPreview || undefined,
            runtimeEnvironmentId,
            operationProvenance
          }
        ],
        ...tabBarUpdate,
        ...activeResult
      }
    })
    const editorItemViewStateId = openWorkspaceEditorItem(
      get(),
      editorItemFileId,
      editorItemWorktreeId,
      editorItemLabel,
      editorItemContentType,
      options?.preview ?? false,
      editorItemTargetGroupId
    )
    if (options?.focusEditor) {
      set({
        pendingEditorFocusRequest: {
          fileId: editorItemFileId,
          worktreeId: editorItemWorktreeId,
          viewStateId: editorItemViewStateId,
          expiresAt: Date.now() + EDITOR_FOCUS_REQUEST_TTL_MS,
          token: ++nextEditorFocusRequestToken
        }
      })
    }
  },
  }
}