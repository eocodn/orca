import { getClientRuntime } from '@/runtime/client-runtime'
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
export function createEditorSliceUpdateFileSearchStateActions12(set: SliceSet, get: SliceGet) {
  return {
  updateFileSearchState: (worktreeId, updates) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId] || defaultFileSearchState()
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: { ...current, ...updates }
        }
      }
    }),
  seedFileSearchQuery: (worktreeId, query) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId] || defaultFileSearchState()
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: {
            ...current,
            query,
            results: null,
            resultOwner: null,
            loading: false,
            collapsedFiles: new Set(),
            seedRequestId: (current.seedRequestId ?? 0) + 1
          }
        }
      }
    }),
  seedFileSearchIncludePattern: (worktreeId, includePattern) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId] || defaultFileSearchState()
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: {
            ...current,
            includePattern,
            results: null,
            resultOwner: null,
            loading: false,
            collapsedFiles: new Set(),
            seedRequestId: (current.seedRequestId ?? 0) + 1
          }
        }
      }
    }),
  consumeFileSearchSeedRequest: (worktreeId, seedRequestId) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId]
      if (!current || current.seedRequestId !== seedRequestId) {
        return s
      }
      const next = { ...current }
      delete next.seedRequestId
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: next
        }
      }
    }),
  toggleFileSearchCollapsedFile: (worktreeId, filePath) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId]
      if (!current) {
        return s
      }
      const nextCollapsed = new Set(current.collapsedFiles)
      if (nextCollapsed.has(filePath)) {
        nextCollapsed.delete(filePath)
      } else {
        nextCollapsed.add(filePath)
      }
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: { ...current, collapsedFiles: nextCollapsed }
        }
      }
    }),
  clearFileSearch: (worktreeId) =>
    set((s) => {
      const current = s.fileSearchStateByWorktree[worktreeId]
      if (!current) {
        return s
      }
      return {
        fileSearchStateByWorktree: {
          ...s.fileSearchStateByWorktree,
          [worktreeId]: {
            ...current,
            query: '',
            results: null,
            resultOwner: null,
            loading: false,
            collapsedFiles: new Set()
          }
        }
      }
    }),

  // Editor navigation
  pendingEditorReveal: null,
  setPendingEditorReveal: (reveal) => set({ pendingEditorReveal: reveal }),
  pendingEditorFocusRequest: null,
  consumeEditorFocusRequest: (token) =>
    set((s) =>
      s.pendingEditorFocusRequest?.token === token ? { pendingEditorFocusRequest: null } : s
    ),
  activateMarkdownLink: async (rawHref, ctx) => {
    const initialState = get()
    let inferredRuntimeEnvironmentId: string | null | undefined
    if (!ctx.sourceOwner && ctx.runtimeEnvironmentId === undefined) {
      const inferredRuntimeOwners = new Set(
        initialState.openFiles
          .filter(
            (file) => file.filePath === ctx.sourceFilePath && file.worktreeId === ctx.worktreeId
          )
          .map((file) => file.runtimeEnvironmentId?.trim() || null)
      )
      if (inferredRuntimeOwners.size > 1) {
        return
      }
      inferredRuntimeEnvironmentId =
        inferredRuntimeOwners.size === 1 ? [...inferredRuntimeOwners][0] : undefined
    }
    const sourceRuntimeEnvironmentId =
      ctx.sourceOwner?.kind === 'runtime'
        ? ctx.sourceOwner.runtimeEnvironmentId
        : ctx.sourceOwner
          ? null
          : ctx.runtimeEnvironmentId !== undefined
            ? ctx.runtimeEnvironmentId
            : inferredRuntimeEnvironmentId
    const runtimeOwnerId = sourceRuntimeEnvironmentId?.trim() || null
    const sourceSettings = settingsForRuntimeOwner(initialState.settings, runtimeOwnerId)
    const resolvedConnectionId =
      ctx.sourceOwner || runtimeOwnerId
        ? undefined
        : getConnectionIdForFileFromState(initialState, ctx.worktreeId, ctx.sourceFilePath)
    const sourceOwner: HttpLinkSourceOwner =
      ctx.sourceOwner ??
      (runtimeOwnerId
        ? { kind: 'runtime', runtimeEnvironmentId: runtimeOwnerId }
        : resolvedConnectionId === undefined
          ? { kind: 'unknown' }
          : resolvedConnectionId === null
            ? { kind: 'local' }
            : { kind: 'ssh', connectionId: resolvedConnectionId })
    if (sourceOwner.kind === 'unknown') {
      return
    }
    const sourceConnectionId = sourceOwner.kind === 'ssh' ? sourceOwner.connectionId : undefined
    const fileContext = {
      settings: sourceSettings,
      worktreeId: ctx.worktreeId,
      worktreePath: ctx.worktreeRoot,
      connectionId: sourceConnectionId
    }
    const target = resolveMarkdownLinkTarget(rawHref, ctx.sourceFilePath, ctx.worktreeRoot)
    if (!target) {
      return
    }
    if (target.kind === 'anchor') {
      return
    }
    if (target.kind === 'external') {
      openHttpLink(target.url, { worktreeId: ctx.worktreeId, sourceOwner })
      return
    }
    if (target.kind === 'file') {
      const { line, column } = target
      if (target.relativePath === undefined) {
        if (isLocalPathOpenBlocked(sourceSettings, { connectionId: sourceConnectionId })) {
          // Why: a file:// link outside the worktree is client-local; remote runtime/SSH editors must not treat server paths as client paths.
          showLocalPathOpenBlockedToast()
          return
        }
        // Why: markdown file:// links need the same user-gesture authorization terminal links get, so external paths (e.g. /tmp screenshots) can open in Orca.
        await getClientRuntime().file.authorizeExternalPath({ targetPath: target.absolutePath })
      } else {
        let stats: { isDirectory: boolean }
        try {
          stats = await statRuntimePath(fileContext, target.absolutePath)
        } catch {
          toast.error(
            translate('auto.store.slices.editor.f2e00db373', 'File not found: {{value0}}', {
              value0: target.relativePath
            })
          )
          return
        }
        if (stats.isDirectory) {
          toast.error(
            translate('auto.store.slices.editor.51f15c37d3', 'Cannot open directory: {{value0}}', {
              value0: target.relativePath
            })
          )
          return
        }
      }

      get().openFile(
        {
          filePath: target.absolutePath,
          relativePath: target.relativePath ?? target.absolutePath,
          worktreeId: ctx.worktreeId,
          runtimeEnvironmentId: sourceRuntimeEnvironmentId,
          language: detectLanguage(target.absolutePath),
          mode: 'edit'
        },
        {
          preview: true,
          targetGroupId: get().activeGroupIdByWorktree?.[ctx.worktreeId],
          recordReplacedPreview: true
        }
      )
      if (line !== undefined) {
        const fileId = getOpenedEditFileIdAfterOpen(get(), target.absolutePath, ctx.worktreeId)
        scheduleEditorLineReveal(get, target.absolutePath, line, column, fileId)
      }
      return
    }

    // target.kind === 'markdown'
    const { absolutePath, relativePath, line, column } = target
    let stats: { isDirectory: boolean }
    try {
      stats = await statRuntimePath(fileContext, absolutePath)
    } catch {
      toast.error(
        translate('auto.store.slices.editor.f2e00db373', 'File not found: {{value0}}', {
          value0: relativePath
        })
      )
      return
    }
    if (stats.isDirectory) {
      toast.error(
        translate('auto.store.slices.editor.51f15c37d3', 'Cannot open directory: {{value0}}', {
          value0: relativePath
        })
      )
      return
    }

    get().openFile(
      {
        filePath: absolutePath,
        relativePath,
        worktreeId: ctx.worktreeId,
        runtimeEnvironmentId: sourceRuntimeEnvironmentId,
        language: 'markdown',
        mode: 'edit'
      },
      {
        preview: true,
        targetGroupId: get().activeGroupIdByWorktree?.[ctx.worktreeId],
        recordReplacedPreview: true
      }
    )

    if (line !== undefined) {
      const fileId = getOpenedEditFileIdAfterOpen(get(), absolutePath, ctx.worktreeId)
      // Why: MonacoEditor drops the reveal if the file stays in rich mode; switch to source using the resolved owner-qualified id.
      get().setMarkdownViewMode(fileId, 'source')
      scheduleEditorLineReveal(get, absolutePath, line, column, fileId)
    }
  },

  // Why: only edit-mode files are restored — diffs/conflict views depend on transient git state that may be stale between sessions.
  }
}
