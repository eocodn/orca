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
export function createEditorSliceOpenNewMarkdownInActiveWorkspaceActions3(set: SliceSet, get: SliceGet) {
  return {
  openNewMarkdownInActiveWorkspace: async (groupId) => {
    const state = get()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return
    }
    const worktree = state.getKnownWorktreeById(worktreeId)
    if (!worktree) {
      return
    }
    try {
      const operationProvenance = captureEditorFileOperationProvenance(
        state,
        worktreeId,
        undefined,
        false
      )
      const operationContext = getEditorFileOperationContext(
        state,
        { worktreeId, operationProvenance },
        worktree.path
      )
      const fileInfo = await createUntitledMarkdownFileWithTemplateSelection(
        worktree.path,
        worktreeId,
        operationContext.connectionId,
        operationContext.settings,
        operationProvenance,
        operationContext.expectedSshConnectionGeneration,
        operationContext.expectedSshTargetId,
        operationContext.expectedExecutionHostId,
        () => assertEditorFileOperationCurrent(get(), worktreeId, operationProvenance)
      )
      if (!fileInfo) {
        return
      }
      get().openFile(fileInfo, { preview: false, targetGroupId: groupId })
      get().recordFeatureInteraction('markdown-file-created')
    } catch (err) {
      toast.error(extractIpcErrorMessage(err, 'Failed to create untitled markdown file.'))
    }
  },
  openMarkdownPreview: (file, options) => {
    const initialState = get()
    const resolvedRuntimeEnvironmentId =
      file.runtimeEnvironmentId === null
        ? null
        : (file.runtimeEnvironmentId ??
          initialState.settings?.activeRuntimeEnvironmentId?.trim() ??
          undefined)
    const sourceFileId =
      options?.sourceFileId ??
      resolveEditorFileIdForOwner(
        initialState,
        file.filePath,
        file.worktreeId,
        resolvedRuntimeEnvironmentId,
        ['edit']
      )
    const id = `markdown-preview::${sourceFileId}`
    const externalSshTargetId =
      file.externalSshTargetId ??
      initialState.openFiles.find((openFile) => openFile.id === sourceFileId)?.externalSshTargetId
    const anchor = options?.anchor || undefined
    set((s) => {
      const existing = s.openFiles.find((openFile) => openFile.id === id)
      const worktreeId = file.worktreeId
      const runtimeEnvironmentId = resolvedRuntimeEnvironmentId
      const activeResult = buildEditorActiveResult(s, worktreeId, id)

      if (existing) {
        const needsUpdate =
          existing.relativePath !== file.relativePath ||
          existing.filePath !== file.filePath ||
          existing.language !== file.language ||
          existing.externalSshTargetId !== externalSshTargetId ||
          existing.markdownPreviewSourceFileId !== sourceFileId ||
          existing.markdownPreviewAnchor !== anchor ||
          existing.mode !== 'markdown-preview'
        return needsUpdate
          ? {
              openFiles: s.openFiles.map((openFile) =>
                openFile.id === id
                  ? {
                      ...openFile,
                      filePath: file.filePath,
                      relativePath: file.relativePath,
                      worktreeId: file.worktreeId,
                      language: file.language,
                      runtimeEnvironmentId,
                      externalSshTargetId,
                      markdownPreviewSourceFileId: sourceFileId,
                      markdownPreviewAnchor: anchor,
                      mode: 'markdown-preview' as const
                    }
                  : openFile
              ),
              ...activeResult
            }
          : activeResult
      }

      const newFile: OpenFile = {
        id,
        filePath: file.filePath,
        relativePath: file.relativePath,
        worktreeId: file.worktreeId,
        language: file.language,
        isDirty: false,
        runtimeEnvironmentId,
        externalSshTargetId,
        markdownPreviewSourceFileId: sourceFileId,
        markdownPreviewAnchor: anchor,
        mode: 'markdown-preview'
      }

      return {
        openFiles: [...s.openFiles, newFile],
        ...activeResult
      }
    })
    void openWorkspaceEditorItem(
      get(),
      id,
      file.worktreeId,
      `${file.relativePath} (preview)`,
      'editor',
      false,
      options?.targetGroupId
    )
  },
  makePreviewFilePermanent: (fileId, tabId) => {
    set((s) => {
      let changed = false
      const openFiles = s.openFiles.map((file) => {
        if (file.id !== fileId || !file.isPreview) {
          return file
        }
        changed = true
        return { ...file, isPreview: undefined }
      })
      const unifiedTabsByWorktree: typeof s.unifiedTabsByWorktree = {}
      for (const [worktreeId, tabs] of Object.entries(s.unifiedTabsByWorktree ?? {})) {
        unifiedTabsByWorktree[worktreeId] = tabs.map((tab) => {
          if (tab.entityId !== fileId || (tabId && tab.id !== tabId) || !tab.isPreview) {
            return tab
          }
          changed = true
          return { ...tab, isPreview: false }
        })
      }
      return changed ? { openFiles, unifiedTabsByWorktree } : s
    })
  },
  pinFile: (fileId, tabId) => {
    get().makePreviewFilePermanent(fileId, tabId)
    const state = get()
    for (const tabs of Object.values(state.unifiedTabsByWorktree ?? {})) {
      for (const item of tabs) {
        if (item.entityId === fileId && (!tabId || item.id === tabId)) {
          state.pinTab?.(item.id)
        }
      }
    }
  },

  // Why: closing a tab does NOT clear Resolved-locally state — trackedConflictPaths is tied to sidebar presence, not tab lifecycle.
  }
}