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
export function createEditorSliceOpenCheckRunDetailsActions9(set: SliceSet, get: SliceGet) {
  return {
  openCheckRunDetails: (worktreeId, contextKey, check, state) => {
    const id = buildCheckRunDetailsTabId(worktreeId, check)
    const label = getCheckRunDetailsTabLabel(check)
    const checkRunDetails: OpenCheckRunDetailsState = {
      contextKey,
      check,
      details: state.details,
      loading: state.loading,
      error: state.error
    }
    set((s) => {
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  mode: 'check-details' as const,
                  relativePath: label,
                  language: 'plaintext',
                  checkRunDetails
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
        filePath: id,
        relativePath: label,
        worktreeId,
        language: 'plaintext',
        isDirty: false,
        mode: 'check-details',
        checkRunDetails
      }

      return {
        openFiles: [...s.openFiles, newFile],
        activeFileId: id,
        activeTabType: 'editor',
        activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
        activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' }
      }
    })
    void openWorkspaceEditorItem(get(), id, worktreeId, label, 'check-details')
  },

  // Why: sidebar detail fetches can finish after the full-details tab is open; update the snapshot without stealing focus.
  patchOpenCheckRunDetails: (worktreeId, contextKey, check, state) => {
    const id = buildCheckRunDetailsTabId(worktreeId, check)
    const nextCheckRunDetails: OpenCheckRunDetailsState = {
      contextKey,
      check,
      details: state.details,
      loading: state.loading,
      error: state.error
    }
    set((s) => {
      const existing = s.openFiles.find((f) => f.id === id)
      if (!existing?.checkRunDetails) {
        return s
      }
      const current = existing.checkRunDetails
      if (
        current.contextKey === nextCheckRunDetails.contextKey &&
        current.check.status === nextCheckRunDetails.check.status &&
        current.check.conclusion === nextCheckRunDetails.check.conclusion &&
        current.loading === nextCheckRunDetails.loading &&
        current.error === nextCheckRunDetails.error &&
        current.details === nextCheckRunDetails.details
      ) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === id ? { ...f, checkRunDetails: nextCheckRunDetails } : f
        )
      }
    })
  },
  reloadOpenCheckRunDetailsTab: async (fileId) => {
    const state = get()
    const file = state.openFiles.find((candidate) => candidate.id === fileId)
    const checkRunDetails = file?.checkRunDetails
    if (!file || file.mode !== 'check-details' || !checkRunDetails) {
      return
    }
    const worktree = findWorktreeById(state.worktreesByRepo, file.worktreeId)
    const repoId = worktree?.repoId ?? getRepoIdFromWorktreeId(file.worktreeId)
    const repo = state.repos.find((candidate) => candidate.id === repoId)
    if (!repo?.path) {
      return
    }
    const { contextKey, check } = checkRunDetails
    const patch = (next: Pick<OpenCheckRunDetailsState, 'details' | 'loading' | 'error'>): void => {
      get().patchOpenCheckRunDetails(file.worktreeId, contextKey, check, next)
    }
    patch({ details: checkRunDetails.details, loading: true, error: null })
    try {
      const details = await get().fetchPRCheckDetails(
        repo.path,
        {
          checkRunId: check.checkRunId,
          workflowRunId: check.workflowRunId,
          checkName: check.name,
          url: check.url,
          prRepo: null
        },
        { repoId: repo.id }
      )
      patch({
        details,
        loading: false,
        error: details
          ? null
          : translate(
              'auto.store.slices.editor.checkRunDetailsUnavailable',
              'No details are available for this check.'
            )
      })
    } catch (error) {
      patch({
        details: null,
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : translate(
                'auto.store.slices.editor.checkRunDetailsLoadFailed',
                'Failed to load check details.'
              )
      })
    }
  },
  openBranchAllDiffs: (worktreeId, worktreePath, compare, alternate) => {
    const branchCompare = toBranchCompareSnapshot(compare)
    const id = `${worktreeId}::all-diffs::branch::${compare.baseRef}::${branchCompare.compareVersion}`
    set((s) => {
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(s, worktreeId, undefined)
      const branchEntriesSnapshot = s.gitBranchChangesByWorktree[worktreeId] ?? []
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  branchCompare,
                  branchEntriesSnapshot,
                  combinedAlternate: alternate,
                  conflict: undefined,
                  skippedConflicts: undefined,
                  conflictReview: undefined,
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
        relativePath: `Branch Changes (${compare.baseRef})`,
        worktreeId,
        language: 'plaintext',
        isDirty: false,
        mode: 'diff',
        diffSource: 'combined-branch',
        branchCompare,
        branchEntriesSnapshot,
        combinedAlternate: alternate,
        conflict: undefined,
        skippedConflicts: undefined,
        conflictReview: undefined,
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
    void openWorkspaceEditorItem(
      get(),
      id,
      worktreeId,
      `Branch Changes (${compare.baseRef})`,
      'diff'
    )
  },
  openCommitAllDiffs: (worktreeId, worktreePath, compare, entries, subject, message) => {
    const commitCompare = toCommitCompareSnapshot(compare, subject, message)
    const id = `${worktreeId}::all-diffs::commit::${commitCompare.commitOid}`
    const label = subject
      ? `Commit ${commitCompare.compareRef}: ${subject}`
      : `Commit ${commitCompare.compareRef}`
    set((s) => {
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(s, worktreeId, undefined)
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        return {
          openFiles: s.openFiles.map((f) =>
            f.id === id
              ? {
                  ...f,
                  relativePath: label,
                  commitCompare,
                  commitEntriesSnapshot: entries,
                  conflict: undefined,
                  skippedConflicts: undefined,
                  conflictReview: undefined,
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
        diffSource: 'combined-commit',
        commitCompare,
        commitEntriesSnapshot: entries,
        conflict: undefined,
        skippedConflicts: undefined,
        conflictReview: undefined,
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

  // Cursor line tracking
  editorCursorLine: {},
  setEditorCursorLine: (fileId, line) =>
    set((s) => ({
      editorCursorLine: { ...s.editorCursorLine, [fileId]: line }
    })),

  // Git status
  gitStatusByWorktree: {},
  gitStatusHeadByWorktree: {},
  gitStatusHugeByWorktree: {},
  gitIgnoredPathsByWorktree: {},
  gitConflictOperationByWorktree: {},
  trackedConflictPathsByWorktree: {},
  trackConflictPath: (worktreeId, path, conflictKind) =>
    set((s) => {
      const nextTracked = {
        ...s.trackedConflictPathsByWorktree[worktreeId],
        [path]: conflictKind
      }
      return {
        trackedConflictPathsByWorktree: {
          ...s.trackedConflictPathsByWorktree,
          [worktreeId]: nextTracked
        }
      }
    }),
  // Why: session-local conflict tracking (Resolved-locally) lives only in the renderer; main returns raw git status, so the renderer owns conflictStatusSource.
  }
}
