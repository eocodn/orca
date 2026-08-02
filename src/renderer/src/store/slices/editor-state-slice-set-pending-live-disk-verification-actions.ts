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
export function createEditorSliceSetPendingLiveDiskVerificationActions6(set: SliceSet, get: SliceGet) {
  return {
  setPendingLiveDiskVerification: (fileId, value) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      const next = value || undefined
      if (!file || file.pendingLiveDiskVerification === next) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, pendingLiveDiskVerification: next } : f
        )
      }
    }),
  clearSelfMoveEcho: (fileId) =>
    set((s) => {
      const file = s.openFiles.find((f) => f.id === fileId)
      if (!file?.pendingSelfMoveEcho) {
        return s
      }
      return {
        openFiles: s.openFiles.map((f) =>
          f.id === fileId ? { ...f, pendingSelfMoveEcho: undefined } : f
        )
      }
    }),
  rekeyOpenFilesForPathChange: ({ rekeys, moveOperationId }) => {
    if (rekeys.length === 0) {
      return { ok: true }
    }
    let result: RekeyOpenFilesResult = { ok: true }
    set((s) => {
      const migrations = new Map<string, string>()
      const rekeyByOldId = new Map<string, OpenFilePathRekey>()
      for (const rekey of rekeys) {
        migrations.set(rekey.oldFileId, rekey.newFileId)
        rekeyByOldId.set(rekey.oldFileId, rekey)
      }
      const openById = new Map(s.openFiles.map((f) => [f.id, f]))

      // Preflight (atomic with apply): every source still open, target ids unique,
      // and no target id belongs to an UNAFFECTED live session (never merge two).
      const seenNewIds = new Set<string>()
      for (const rekey of rekeys) {
        if (!openById.has(rekey.oldFileId)) {
          result = { ok: false, reason: 'stale' }
          return s
        }
        if (seenNewIds.has(rekey.newFileId)) {
          result = { ok: false, reason: 'collision' }
          return s
        }
        seenNewIds.add(rekey.newFileId)
        const occupier = openById.get(rekey.newFileId)
        if (occupier && !migrations.has(occupier.id)) {
          result = { ok: false, reason: 'collision' }
          return s
        }
      }

      const nextOpenFiles = s.openFiles.map((f) => {
        const rekey = rekeyByOldId.get(f.id)
        if (!rekey) {
          return f
        }
        // Spread the whole OpenFile so fields this action doesn't know about survive; change only the path-derived ones.
        // Gate atomically here so autosave is suspended before any echo can be verified (only a dirty autosave-capable tab can be clobbered).
        const gatesEcho =
          moveOperationId !== undefined &&
          f.isDirty &&
          // A 'changed' tab is already autosave-suspended via externalMutation; gating it would strand the gate (verification skips a 'changed' tab), so leave the banner as terminal.
          f.externalMutation !== 'changed' &&
          (f.mode === 'edit' || (f.mode === 'diff' && f.diffSource === 'unstaged'))
        return {
          ...f,
          id: rekey.newFileId,
          filePath: rekey.newFilePath,
          relativePath: rekey.newRelativePath,
          // A moved tab's id no longer matches the host snapshot, so leaving it host-owned would cull it (losing the draft); the coordinator close-notifies the host's old-path tab. (Re-homing the host tab in place is a follow-up.)
          mirroredFromRuntimeSession: undefined,
          ...(rekey.newLanguage !== undefined ? { language: rekey.newLanguage } : {}),
          ...(rekey.newMarkdownPreviewSourceFileId !== undefined
            ? { markdownPreviewSourceFileId: rekey.newMarkdownPreviewSourceFileId }
            : {}),
          ...(rekey.consumeUntitled
            ? { isUntitled: undefined, deleteUntouchedOnClose: undefined }
            : {}),
          ...(gatesEcho
            ? {
                pendingLiveDiskVerification: true,
                pendingSelfMoveEcho: {
                  operationId: moveOperationId,
                  targetPath: rekey.newFilePath
                }
              }
            : {})
        }
      })

      const activeFileIdByWorktree: Record<string, string | null> = {}
      for (const [wtId, activeId] of Object.entries(s.activeFileIdByWorktree)) {
        activeFileIdByWorktree[wtId] = activeId ? (migrations.get(activeId) ?? activeId) : activeId
      }

      // Partition by each moved file's OWN worktree: the same path can be open in more than one worktree (e.g. a floating workspace), and tab-bar / group state is per-worktree.
      const migrationsByWorktree: Record<string, Map<string, string>> = {}
      for (const rekey of rekeys) {
        const wtId = openById.get(rekey.oldFileId)!.worktreeId
        ;(migrationsByWorktree[wtId] ??= new Map()).set(rekey.oldFileId, rekey.newFileId)
      }

      const tabBarOrderByWorktree = { ...s.tabBarOrderByWorktree }
      for (const [wtId, wtMigrations] of Object.entries(migrationsByWorktree)) {
        const prevBarOrder = tabBarOrderByWorktree[wtId]
        if (prevBarOrder) {
          tabBarOrderByWorktree[wtId] = prevBarOrder.map((id) => wtMigrations.get(id) ?? id)
        }
      }

      const reveal = s.pendingEditorReveal
      const rekeyForReveal = reveal
        ? rekeys.find((r) => r.oldFilePath === reveal.filePath)
        : undefined

      return {
        openFiles: nextOpenFiles,
        editorDrafts: rekeyFileIdRecord(s.editorDrafts, migrations),
        editorCursorLine: rekeyFileIdRecord(s.editorCursorLine, migrations),
        markdownViewMode: rekeyFileIdRecord(s.markdownViewMode, migrations),
        editorViewMode: rekeyFileIdRecord(s.editorViewMode, migrations),
        markdownFrontmatterVisible: rekeyFileIdRecord(s.markdownFrontmatterVisible, migrations),
        markdownTableOfContentsVisible: rekeyFileIdRecord(
          s.markdownTableOfContentsVisible,
          migrations
        ),
        activeFileId: s.activeFileId ? (migrations.get(s.activeFileId) ?? s.activeFileId) : null,
        activeFileIdByWorktree,
        tabBarOrderByWorktree,
        ...migrateHydratedEditorTabsAndGroups(s, migrationsByWorktree),
        ...(reveal && rekeyForReveal
          ? {
              pendingEditorReveal: {
                ...reveal,
                filePath: rekeyForReveal.newFilePath,
                // matchesPendingEditorReveal prefers fileId, so migrate it too or
                // the reveal would never match the rekeyed tab.
                ...(reveal.fileId ? { fileId: migrations.get(reveal.fileId) ?? reveal.fileId } : {})
              }
            }
          : {})
      }
    })
    return result
  },
  clearUntitled: (fileId) =>
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, isUntitled: undefined } : f))
    })),
  openDiff: (worktreeId, filePath, relativePath, language, staged, options) => {
    const isPreview = options?.preview ?? false
    let editorItemTargetGroupId = options?.targetGroupId
    let editorItemFileId = ''
    set((s) => {
      const runtimeEnvironmentId = resolveDiffRuntimeEnvironmentId(
        s,
        worktreeId,
        options?.runtimeEnvironmentId
      )
      const diffSource: DiffSource = staged ? 'staged' : 'unstaged'
      const id = buildDiffEditorFileId(worktreeId, diffSource, relativePath, runtimeEnvironmentId)
      editorItemFileId = id
      const targetGroupId =
        resolveEditorOpenTargetGroupId(s, worktreeId, options?.targetGroupId) ?? undefined
      editorItemTargetGroupId = targetGroupId
      const existing = s.openFiles.find((f) => f.id === id)
      if (existing) {
        const updatedPreview = isPreview ? existing.isPreview : false
        const reopenedDiff = withDiffContentReloadRequest({
          ...existing,
          mode: 'diff' as const,
          diffSource,
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
        filePath,
        relativePath,
        worktreeId,
        language,
        isDirty: false,
        mode: 'diff',
        diffSource,
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
      editorItemFileId,
      worktreeId,
      relativePath,
      'diff',
      isPreview,
      editorItemTargetGroupId
    )
  },
  }
}