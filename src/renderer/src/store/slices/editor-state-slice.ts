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

import { DEFAULT_FILE_SEARCH_STATE, defaultFileSearchState, getKnownGitHead, createLoadingBranchCompareSummary, branchCompareMatchesStatusHead, MAX_RECENT_CLOSED_EDITOR_TABS, resolveDiffRuntimeEnvironmentId, EDITOR_FOCUS_REQUEST_TTL_MS, pendingEditorLineRevealFrameIds, cancelPendingEditorLineRevealFrames, trackEditorLineRevealFrameId, requestTrackedEditorLineRevealFrame, scheduleEditorLineReveal } type { DiffSource, BranchCompareSnapshot, CommitCompareSnapshot, BranchCompareLike, CommitCompareLike, CombinedDiffAlternate, OpenConflictMetadata, ConflictReviewEntry, ConflictReviewState, CombinedDiffSkippedConflict, OpenFile, ActivityBarPosition, MarkdownViewMode, EditorViewMode, ClosedEditorTabSnapshot, EditorOpenTargetOptions, GitRuntimeOperationOptions, PendingEditorReveal, PendingEditorFocusRequest } from './editor-state-slice-default-file-search-state-support'
import type { EditorSlice } from './editor-state-slice-editor-slice-support'
import { openWorkspaceEditorItem, isEditorTabContentType, getReplaceablePreviewFileId, removeEditorStateForReplacedPreview, removeMarkdownVisibilityKeys, getGroupActiveTab, getMostRecentEditorTabForGroup, resolveEditorOpenTargetGroupId, buildEditorActiveResult, runtimeOwnerKey, isSameEditorOwner, buildOwnedEditorFileId, buildDiffEditorFileId, withDiffContentReloadRequest, shouldRequestExistingFileContentReload } from './editor-state-slice-open-workspace-editor-item-support'
import { isEditorFileIdOccupiedByOtherOwner, matchesEditorMode, getReusableOpenFileModes, resolveEditorFileIdForOwner, getOpenedEditFileIdAfterOpen, shouldHydrateWithOwnedEditorFileId, addEditorFileIdMigration, resolveLegacyHydratedEditorFileId, migrateEditorFileId, dedupeEditorTabOrder, areStringArraysEqual, migrateHydratedEditorTabsAndGroups, rekeyFileIdRecord, deleteUntouchedUntitledFile, shouldDeleteUntouchedUntitledFile } type { LegacyHydratedEditorFile, OpenFilePathRekey, RekeyOpenFilesResult } from './editor-state-slice-is-editor-file-id-occupied-by-other-owner-support'
export { DEFAULT_FILE_SEARCH_STATE, defaultFileSearchState, getKnownGitHead, createLoadingBranchCompareSummary, branchCompareMatchesStatusHead, MAX_RECENT_CLOSED_EDITOR_TABS, resolveDiffRuntimeEnvironmentId, EDITOR_FOCUS_REQUEST_TTL_MS, pendingEditorLineRevealFrameIds, cancelPendingEditorLineRevealFrames, trackEditorLineRevealFrameId, requestTrackedEditorLineRevealFrame, scheduleEditorLineReveal, openWorkspaceEditorItem, isEditorTabContentType, getReplaceablePreviewFileId, removeEditorStateForReplacedPreview, removeMarkdownVisibilityKeys, getGroupActiveTab, getMostRecentEditorTabForGroup, resolveEditorOpenTargetGroupId, buildEditorActiveResult, runtimeOwnerKey, isSameEditorOwner, buildOwnedEditorFileId, buildDiffEditorFileId, withDiffContentReloadRequest, shouldRequestExistingFileContentReload, isEditorFileIdOccupiedByOtherOwner, matchesEditorMode, getReusableOpenFileModes, resolveEditorFileIdForOwner, getOpenedEditFileIdAfterOpen, shouldHydrateWithOwnedEditorFileId, addEditorFileIdMigration, resolveLegacyHydratedEditorFileId, migrateEditorFileId, dedupeEditorTabOrder, areStringArraysEqual, migrateHydratedEditorTabsAndGroups, rekeyFileIdRecord, deleteUntouchedUntitledFile, shouldDeleteUntouchedUntitledFile }
export type { DiffSource, BranchCompareSnapshot, CommitCompareSnapshot, BranchCompareLike, CommitCompareLike, CombinedDiffAlternate, OpenConflictMetadata, ConflictReviewEntry, ConflictReviewState, CombinedDiffSkippedConflict, OpenFile, ActivityBarPosition, MarkdownViewMode, EditorViewMode, ClosedEditorTabSnapshot, EditorOpenTargetOptions, GitRuntimeOperationOptions, PendingEditorReveal, PendingEditorFocusRequest, EditorSlice, LegacyHydratedEditorFile, OpenFilePathRekey, RekeyOpenFilesResult }
import { createEditorSliceEditorDraftsActions } from './editor-state-slice-editor-drafts-actions'
import { createEditorSliceOpenFileActions2 } from './editor-state-slice-open-file-actions'
import { createEditorSliceOpenNewMarkdownInActiveWorkspaceActions3 } from './editor-state-slice-open-new-markdown-in-active-workspace-actions'
import { createEditorSliceCloseFileActions4 } from './editor-state-slice-close-file-actions'
import { createEditorSliceCloseAllFilesActions5 } from './editor-state-slice-close-all-files-actions'
import { createEditorSliceSetPendingLiveDiskVerificationActions6 } from './editor-state-slice-set-pending-live-disk-verification-actions'
import { createEditorSliceOpenBranchDiffActions7 } from './editor-state-slice-open-branch-diff-actions'
import { createEditorSliceOpenConflictFileActions8 } from './editor-state-slice-open-conflict-file-actions'
import { createEditorSliceOpenCheckRunDetailsActions9 } from './editor-state-slice-open-check-run-details-actions'
import { createEditorSliceSetGitStatusActions10 } from './editor-state-slice-set-git-status-actions'
import { createEditorSlicePushBranchActions11 } from './editor-state-slice-push-branch-actions'
import { createEditorSliceUpdateFileSearchStateActions12 } from './editor-state-slice-update-file-search-state-actions'
import { createEditorSliceHydrateEditorSessionActions13 } from './editor-state-slice-hydrate-editor-session-actions'

export const createEditorSlice: StateCreator<AppState, [], [], EditorSlice> = (set, get) => ({
  ...createEditorSliceEditorDraftsActions(set, get),
  ...createEditorSliceOpenFileActions2(set, get),
  ...createEditorSliceOpenNewMarkdownInActiveWorkspaceActions3(set, get),
  ...createEditorSliceCloseFileActions4(set, get),
  ...createEditorSliceCloseAllFilesActions5(set, get),
  ...createEditorSliceSetPendingLiveDiskVerificationActions6(set, get),
  ...createEditorSliceOpenBranchDiffActions7(set, get),
  ...createEditorSliceOpenConflictFileActions8(set, get),
  ...createEditorSliceOpenCheckRunDetailsActions9(set, get),
  ...createEditorSliceSetGitStatusActions10(set, get),
  ...createEditorSlicePushBranchActions11(set, get),
  ...createEditorSliceUpdateFileSearchStateActions12(set, get),
  ...createEditorSliceHydrateEditorSessionActions13(set, get),
})

function getCompareVersion(
  compare: Pick<BranchCompareLike, 'baseOid' | 'headOid' | 'mergeBase'>
): string {
  return [
    compare.baseOid ?? 'no-base',
    compare.headOid ?? 'no-head',
    compare.mergeBase ?? 'no-merge-base'
  ].join(':')
}

function toBranchCompareSnapshot(compare: BranchCompareLike): BranchCompareSnapshot {
  return {
    baseRef: compare.baseRef,
    baseOid: compare.baseOid,
    compareRef: compare.compareRef,
    headOid: compare.headOid,
    mergeBase: compare.mergeBase,
    compareVersion: getCompareVersion(compare)
  }
}

function toCommitCompareSnapshot(
  compare: CommitCompareLike,
  subject?: string,
  message?: string
): CommitCompareSnapshot {
  return {
    commitOid: compare.commitOid,
    parentOid: compare.parentOid,
    compareRef: compare.compareRef,
    baseRef: compare.baseRef,
    compareVersion: `${compare.parentOid ?? 'empty-tree'}:${compare.commitOid}`,
    subject:
      subject ??
      ('subject' in compare && typeof compare.subject === 'string' ? compare.subject : undefined),
    message:
      message ??
      ('message' in compare && typeof compare.message === 'string' ? compare.message : undefined)
  }
}

function toOpenConflictMetadata(entry: GitStatusEntry): OpenConflictMetadata | undefined {
  if (!entry.conflictKind || !entry.conflictStatus || !entry.conflictStatusSource) {
    return undefined
  }

  const hasWorkingTreeFile = entry.status !== 'deleted'
  return hasWorkingTreeFile
    ? {
        kind: 'conflict-editable',
        conflictKind: entry.conflictKind,
        conflictStatus: entry.conflictStatus,
        conflictStatusSource: entry.conflictStatusSource
      }
    : {
        kind: 'conflict-placeholder',
        conflictKind: entry.conflictKind,
        conflictStatus: entry.conflictStatus,
        conflictStatusSource: entry.conflictStatusSource,
        message: translate(
          'auto.store.slices.editor.dcb521ed29',
          'This file is in a conflict state, but no working-tree file is available to edit.'
        ),
        guidance: 'Resolve the conflict in Git or restore one side before reopening it.'
      }
}

// Why: conflict state can change (unresolved↔resolved_locally) without the base status changing, so also compare conflict fields.
function areGitStatusEntriesEqual(prev: GitStatusEntry[], next: GitStatusEntry[]): boolean {
  return (
    prev.length === next.length &&
    prev.every(
      (entry, index) =>
        entry.path === next[index].path &&
        entry.status === next[index].status &&
        entry.area === next[index].area &&
        entry.oldPath === next[index].oldPath &&
        entry.conflictKind === next[index].conflictKind &&
        entry.conflictStatus === next[index].conflictStatus &&
        entry.conflictStatusSource === next[index].conflictStatusSource &&
        entry.added === next[index].added &&
        entry.removed === next[index].removed
    )
  )
}

function areTrackedConflictMapsEqual(
  prev: Record<string, GitConflictKind>,
  next: Record<string, GitConflictKind>
): boolean {
  const prevKeys = Object.keys(prev)
  const nextKeys = Object.keys(next)
  return prevKeys.length === nextKeys.length && prevKeys.every((key) => prev[key] === next[key])
}

function areUpstreamStatusesEqual(
  prev: GitUpstreamStatus | undefined,
  next: GitUpstreamStatus
): boolean {
  return (
    prev !== undefined &&
    prev.hasUpstream === next.hasUpstream &&
    prev.upstreamName === next.upstreamName &&
    prev.ahead === next.ahead &&
    prev.behind === next.behind &&
    prev.hasConfiguredPushTarget === next.hasConfiguredPushTarget &&
    prev.behindCommitsArePatchEquivalent === next.behindCommitsArePatchEquivalent
  )
}

function reconcileOpenFilesForStatus(
  openFiles: OpenFile[],
  worktreeId: string,
  nextEntries: GitStatusEntry[],
  statusIsComplete: boolean
): OpenFile[] {
  const entriesByPath = new Map(nextEntries.map((entry) => [entry.path, entry]))
  let changed = false

  const nextOpenFiles = openFiles.flatMap((file) => {
    if (file.worktreeId !== worktreeId) {
      return [file]
    }

    if (file.mode === 'conflict-review' || file.mode === 'check-details') {
      return [file]
    }

    const entry = entriesByPath.get(file.relativePath)
    if (!file.conflict) {
      return [file]
    }

    // Why: a capped snapshot cannot prove that an omitted conflict was resolved.
    if (!entry && !statusIsComplete) {
      return [file]
    }

    if (!entry || !entry.conflictKind || !entry.conflictStatus || !entry.conflictStatusSource) {
      changed = true
      return file.conflict.kind === 'conflict-placeholder' ? [] : [{ ...file, conflict: undefined }]
    }

    const nextConflict = toOpenConflictMetadata(entry)
    if (!nextConflict) {
      return [file]
    }

    if (
      file.conflict.kind === nextConflict.kind &&
      file.conflict.conflictKind === nextConflict.conflictKind &&
      file.conflict.conflictStatus === nextConflict.conflictStatus &&
      file.conflict.conflictStatusSource === nextConflict.conflictStatusSource &&
      file.conflict.message === nextConflict.message &&
      file.conflict.guidance === nextConflict.guidance
    ) {
      return [file]
    }

    changed = true
    return [{ ...file, conflict: nextConflict }]
  })

  return changed ? nextOpenFiles : openFiles
}
