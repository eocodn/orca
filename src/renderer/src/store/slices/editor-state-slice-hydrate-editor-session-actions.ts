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
export function createEditorSliceHydrateEditorSessionActions13(set: SliceSet, get: SliceGet) {
  return {
  hydrateEditorSession: (session, options) => {
    set((s) => {
      const openFilesByWorktree = session.openFilesByWorktree ?? {}
      const persistedActiveFileIdByWorktree = session.activeFileIdByWorktree ?? {}
      const persistedActiveTabTypeByWorktree = session.activeTabTypeByWorktree ?? {}
      const persistedMarkdownFrontmatterVisible = session.markdownFrontmatterVisible ?? {}

      const validWorktreeIds = buildValidWorktreeIdsForSessionHydration(
        s,
        Object.keys(openFilesByWorktree)
      )
      validWorktreeIds.add(FLOATING_TERMINAL_WORKTREE_ID)
      for (const workspace of s.folderWorkspaces) {
        validWorktreeIds.add(folderWorkspaceKey(workspace.id))
      }
      addAdditionalValidWorkspaceKeys(validWorktreeIds, options)

      const openFiles: OpenFile[] = []
      const editorDrafts: Record<string, string> = {}
      const usedOpenFileIds = new Set<string>()
      const legacyHydratedOpenFiles: LegacyHydratedEditorFile[] = []
      const editorFileIdMigrationsByWorktree: Record<string, Map<string, string>> = {}
      for (const [worktreeId, files] of Object.entries(openFilesByWorktree)) {
        if (!validWorktreeIds.has(worktreeId)) {
          continue
        }
        for (const pf of files) {
          const legacyId = resolveLegacyHydratedEditorFileId(
            legacyHydratedOpenFiles,
            pf,
            worktreeId
          )
          // Why: floating/runtime-owned files need IDs that survive peers disappearing between restarts; collision-based IDs drift when the path is no longer open elsewhere.
          const ownedId = buildOwnedEditorFileId(pf.filePath, worktreeId, pf.runtimeEnvironmentId)
          const id =
            shouldHydrateWithOwnedEditorFileId(worktreeId, pf.runtimeEnvironmentId) ||
            usedOpenFileIds.has(pf.filePath)
              ? ownedId
              : pf.filePath
          usedOpenFileIds.add(id)
          // Why: map from the collision-derived legacy id; keying by filePath would collapse same-path local/runtime tabs onto the last owner to hydrate.
          addEditorFileIdMigration(editorFileIdMigrationsByWorktree, worktreeId, legacyId, id)
          legacyHydratedOpenFiles.push({
            id: legacyId,
            filePath: pf.filePath,
            worktreeId,
            runtimeEnvironmentId: pf.runtimeEnvironmentId
          })
          // Why: read-only tabs (AI Vault View Log) must restore clean — ignore any persisted dirty draft/baseline so they can't come back writable.
          const isReadOnly = pf.readOnly === true
          if (!isReadOnly && pf.dirtyDraftContent !== undefined) {
            editorDrafts[id] = pf.dirtyDraftContent
          }
          openFiles.push({
            id,
            filePath: pf.filePath,
            relativePath: pf.relativePath,
            worktreeId,
            // Why: re-detect language on hydrate — older sessions stored ids from before extensions like .ipynb were supported.
            language: detectLanguage(pf.relativePath || pf.filePath),
            isDirty: !isReadOnly && pf.dirtyDraftContent !== undefined,
            isPreview: pf.isPreview,
            runtimeEnvironmentId: pf.runtimeEnvironmentId,
            externalSshTargetId: pf.externalSshTargetId,
            ...(isReadOnly ? { readOnly: true } : {}),
            ...(isReadOnly && pf.liveTail === true ? { liveTail: true } : {}),
            lastKnownDiskSignature: isReadOnly ? undefined : pf.lastKnownDiskSignature,
            // Why: suspend autosave until the conflict scan verifies disk vs baseline, else a slow remote read clobbers an offline write.
            pendingDiskBaselineVerification:
              !isReadOnly &&
              pf.dirtyDraftContent !== undefined &&
              pf.lastKnownDiskSignature !== undefined
                ? true
                : undefined,
            mode: 'edit'
          })
        }
      }

      // Why: use the store's activeWorktreeId — hydrateWorkspaceSession may have nulled an invalid ID, and we must respect that.
      const activeWorktreeId = s.activeWorktreeId
      const fallbackActiveFileId = activeWorktreeId
        ? (openFiles.find((f) => f.worktreeId === activeWorktreeId)?.id ?? null)
        : null
      const persistedActiveFileId = activeWorktreeId
        ? migrateEditorFileId(
            editorFileIdMigrationsByWorktree,
            activeWorktreeId,
            persistedActiveFileIdByWorktree[activeWorktreeId]
          )
        : null
      // Why: the persisted active file may be gone (worktree validation or stale path), so verify it exists in the restored set.
      const activeFileExists = persistedActiveFileId
        ? openFiles.some((f) => f.id === persistedActiveFileId && f.worktreeId === activeWorktreeId)
        : false
      // Why: the previous active surface may have been a transient diff/conflict tab (not restored), so promote the first restored edit file.
      const nextActiveFileId = activeFileExists ? persistedActiveFileId : fallbackActiveFileId
      const activeTabType: WorkspaceVisibleTabType =
        activeWorktreeId && persistedActiveTabTypeByWorktree[activeWorktreeId]
          ? persistedActiveTabTypeByWorktree[activeWorktreeId]
          : 'terminal'

      // Filter per-worktree maps to only valid worktrees with valid file references
      const filteredActiveFileIdByWorktree = Object.fromEntries(
        [...validWorktreeIds].flatMap((wId) => {
          const persistedFileId = migrateEditorFileId(
            editorFileIdMigrationsByWorktree,
            wId,
            persistedActiveFileIdByWorktree[wId]
          )
          if (
            persistedFileId &&
            openFiles.some((f) => f.id === persistedFileId && f.worktreeId === wId)
          ) {
            return [[wId, persistedFileId]]
          }
          const fallbackFileId = openFiles.find((f) => f.worktreeId === wId)?.id
          return fallbackFileId ? [[wId, fallbackFileId]] : []
        })
      )
      const filteredActiveTabTypeByWorktree = Object.fromEntries(
        Object.entries(persistedActiveTabTypeByWorktree).filter(([wId, tabType]) => {
          if (!validWorktreeIds.has(wId)) {
            return false
          }
          if (tabType !== 'editor') {
            return true
          }
          // Why: an "editor" marker is valid only if the worktree restored a concrete active file; otherwise it's a stale marker.
          return Boolean(filteredActiveFileIdByWorktree[wId])
        })
      )

      // Why: transient diff/conflict surfaces aren't restored, so clear a stale "editor" marker and fall back to terminal.
      const nextActiveTabType =
        nextActiveFileId || activeTabType !== 'editor' ? activeTabType : 'terminal'
      const openFileIds = new Set(openFiles.map((file) => file.id))
      // Why: visible is the default, so restore only per-file hide overrides (`false`); legacy `true` entries collapse to the default.
      const hiddenFrontmatterEntries = new Map<string, boolean>()
      for (const [persistedFileId, visible] of Object.entries(
        persistedMarkdownFrontmatterVisible
      )) {
        if (visible) {
          continue
        }
        if (openFileIds.has(persistedFileId)) {
          hiddenFrontmatterEntries.set(persistedFileId, false)
        }
        for (const migrations of Object.values(editorFileIdMigrationsByWorktree)) {
          const migratedFileId = migrations.get(persistedFileId)
          if (migratedFileId && openFileIds.has(migratedFileId)) {
            hiddenFrontmatterEntries.set(migratedFileId, false)
          }
        }
      }
      const markdownFrontmatterVisible = Object.fromEntries(hiddenFrontmatterEntries)

      return {
        openFiles,
        editorDrafts,
        markdownFrontmatterVisible,
        activeFileId: nextActiveFileId,
        activeFileIdByWorktree: filteredActiveFileIdByWorktree,
        activeTabType: nextActiveTabType,
        activeTabTypeByWorktree: filteredActiveTabTypeByWorktree,
        ...migrateHydratedEditorTabsAndGroups(s, editorFileIdMigrationsByWorktree)
      }
    })
  }
  }
}