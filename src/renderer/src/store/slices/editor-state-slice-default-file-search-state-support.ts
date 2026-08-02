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
import { openWorkspaceEditorItem, isEditorTabContentType, getReplaceablePreviewFileId, removeEditorStateForReplacedPreview, removeMarkdownVisibilityKeys, getGroupActiveTab, getMostRecentEditorTabForGroup, resolveEditorOpenTargetGroupId, buildEditorActiveResult, runtimeOwnerKey, isSameEditorOwner, buildOwnedEditorFileId, buildDiffEditorFileId, withDiffContentReloadRequest, shouldRequestExistingFileContentReload, isEditorFileIdOccupiedByOtherOwner, matchesEditorMode, getReusableOpenFileModes, resolveEditorFileIdForOwner, getOpenedEditFileIdAfterOpen, shouldHydrateWithOwnedEditorFileId, addEditorFileIdMigration, resolveLegacyHydratedEditorFileId, migrateEditorFileId, dedupeEditorTabOrder, areStringArraysEqual, migrateHydratedEditorTabsAndGroups, rekeyFileIdRecord, deleteUntouchedUntitledFile, shouldDeleteUntouchedUntitledFile } from './editor-state-slice'
import type { EditorSlice, LegacyHydratedEditorFile, OpenFilePathRekey, RekeyOpenFilesResult } from './editor-state-slice'
export const DEFAULT_FILE_SEARCH_STATE = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  includePattern: '',
  excludePattern: '',
  results: null,
  resultOwner: null,
  loading: false,
  collapsedFiles: new Set<string>()
} satisfies Omit<
  EditorSlice['fileSearchStateByWorktree'][string],
  'seedRequestId' | 'focusRequestId'
>
export function defaultFileSearchState(): EditorSlice['fileSearchStateByWorktree'][string] {
  return { ...DEFAULT_FILE_SEARCH_STATE, collapsedFiles: new Set<string>() }
}
export type DiffSource =
  | 'unstaged'
  | 'staged'
  | 'branch'
  | 'commit'
  | 'combined-all'
  | 'combined-uncommitted'
  | 'combined-branch'
  | 'combined-commit'
export type BranchCompareSnapshot = Pick<
  GitBranchCompareSummary,
  'baseRef' | 'baseOid' | 'compareRef' | 'headOid' | 'mergeBase'
> & {
  compareVersion: string
}
export type CommitCompareSnapshot = Pick<
  GitCommitCompareSummary,
  'commitOid' | 'parentOid' | 'compareRef' | 'baseRef'
> & {
  compareVersion: string
  subject?: string
  message?: string
}
export type BranchCompareLike = Pick<
  GitBranchCompareSummary,
  'baseRef' | 'baseOid' | 'compareRef' | 'headOid' | 'mergeBase'
>
export function getKnownGitHead(head: string | null | undefined): string | undefined {
  const trimmed = head?.trim()
  return trimmed ? trimmed : undefined
}
export function createLoadingBranchCompareSummary(baseRef: string): GitBranchCompareSummary {
  return {
    baseRef,
    baseOid: null,
    compareRef: 'HEAD',
    headOid: null,
    mergeBase: null,
    changedFiles: 0,
    status: 'loading'
  }
}
export function branchCompareMatchesStatusHead(
  summary: GitBranchCompareSummary,
  statusHead: string
): boolean {
  const summaryHead = getKnownGitHead(summary.headOid)
  // Why: git status reports '(initial)' for unborn branches; branch compare represents that same state as a null headOid.
  return summaryHead === statusHead || (statusHead === '(initial)' && summary.headOid === null)
}
export type CommitCompareLike = Pick<
  GitCommitCompareSummary,
  'commitOid' | 'parentOid' | 'compareRef' | 'baseRef'
> & {
  subject?: string
  message?: string
}
export type CombinedDiffAlternate = {
  source: 'combined-all' | 'combined-branch'
  branchCompare?: BranchCompareSnapshot
}
export type OpenConflictMetadata = {
  kind: 'conflict-editable' | 'conflict-placeholder'
  conflictKind: GitConflictKind
  conflictStatus: GitConflictResolutionStatus
  conflictStatusSource: GitConflictStatusSource
  message?: string
  guidance?: string
}
export type ConflictReviewEntry = {
  path: string
  conflictKind: GitConflictKind
}
export type ConflictReviewState = {
  source: 'live-summary' | 'combined-diff-exclusion'
  snapshotTimestamp: number
  entries: ConflictReviewEntry[]
  selectedFileId?: string
}
export type CombinedDiffSkippedConflict = {
  path: string
  conflictKind: GitConflictKind
}

// OpenFile is one type (not a `mode` union); consumers reading `filePath` must check `mode` first — conflict-review tabs use the worktree root, not a real file.
// `skippedConflicts` lives on the tab so the combined-diff exclusion notice stays stable; live status changing between polls would make it flicker.
// `branchEntriesSnapshot` keeps a combined-branch tab's file list known after switching away from an inactive worktree whose compare data is stale.
export type OpenFile = {
  id: string // use filePath as unique key
  filePath: string // absolute path
  relativePath: string // relative to worktree root
  worktreeId: string
  language: string
  isDirty: boolean
  // Why: remote untitled cleanup must target the creating environment even if the user later switches runtime.
  runtimeEnvironmentId?: string | null
  /** SSH target that owns an absolute path outside the worktree. */
  externalSshTargetId?: string
  /** Host provenance captured when the tab opened; mutations reject replacement owners. */
  operationProvenance?: EditorFileOperationProvenance
  /** Why: preview tabs mirror a source file's live draft; storing its ID lets the preview follow unsaved edits without becoming editable. */
  markdownPreviewSourceFileId?: string
  /** Hash fragment to reveal when a preview tab opens from a link (`./guide.md#setup`); kept on tab state so repeat opens can retarget it. */
  markdownPreviewAnchor?: string
  diffSource?: DiffSource
  branchCompare?: BranchCompareSnapshot
  commitCompare?: CommitCompareSnapshot
  branchOldPath?: string
  combinedAlternate?: CombinedDiffAlternate
  combinedAreaFilter?: string // filter combined diff to a specific area (e.g. 'staged', 'unstaged', 'untracked')
  branchEntriesSnapshot?: GitBranchChangeEntry[]
  commitEntriesSnapshot?: GitBranchChangeEntry[]
  /** Why: snapshot uncommitted entries at tab-open so a later commit can't yank them out from under the combined diff (rebuild + lost scroll). */
  uncommittedEntriesSnapshot?: GitStatusEntry[]
  conflict?: OpenConflictMetadata
  skippedConflicts?: CombinedDiffSkippedConflict[]
  conflictReview?: ConflictReviewState
  isPreview?: boolean // preview tabs are replaced when another file is single-clicked
  isUntitled?: boolean // true for files created via "New Markdown" that haven't been renamed yet
  // Why: templated New Markdown files have real content at creation, unlike blank placeholders that can be discarded.
  deleteUntouchedOnClose?: boolean
  // Why: external delete/rename of an open file keeps the tab (strikethrough label); 'changed' = rewritten on disk under unsaved edits → changed-on-disk banner (#7265).
  externalMutation?: 'deleted' | 'renamed' | 'changed'
  /** Signature of the disk content this tab's edits are based on; persisted so a restore detects a changed-on-disk conflict before autosave clobbers an agent write. */
  lastKnownDiskSignature?: string
  /** Why: gates autosave for restored dirty tabs until the conflict scan compares disk vs baseline, else a slow SSH read loses the race. Not persisted. */
  pendingDiskBaselineVerification?: boolean
  /** Why: gates autosave during a live self-move echo's disk verification; separate flag from the restored scan's so the two can't clear each other's gate. Not persisted. */
  pendingLiveDiskVerification?: boolean
  /** Why: routes an Orca-owned move's destination-watcher echo into content verification. On the tab so it survives the atomic rekey; operationId supersedes a stale verification on re-move. Not persisted. */
  pendingSelfMoveEcho?: { operationId: string; targetPath: string }
  /** Why: diff bodies are cached in EditorPanel; bump this on re-select so the panel refetches instead of reusing a stale snapshot. */
  diffContentReloadNonce?: number
  /** Why: bumping refetches clean tabs — the user's manual recovery when a remote watcher misses an external write. */
  fileContentReloadNonce?: number
  /** Why: CI check-details tabs are virtual editor tabs backed by fetched PR check-run metadata, not a file on disk. */
  checkRunDetails?: OpenCheckRunDetailsState
  /** Why: web-client tab mirrored from the host snapshot; only mirrored tabs may be culled when they vanish, locally-opened tabs must survive. */
  mirroredFromRuntimeSession?: boolean
  /** Why: orthogonal to `mode` — an edit-mode tab that must never accept edits/autosave/rename (AI Vault View Log). Persisted only when true. */
  readOnly?: boolean
  /** Why: explicit live tail, only meaningful for a read-only local log. */
  liveTail?: boolean
  mode: 'edit' | 'diff' | 'conflict-review' | 'markdown-preview' | 'check-details'
}
export type ActivityBarPosition = 'top' | 'side'
export type MarkdownViewMode = 'source' | 'rich' | 'preview'

// Why: orthogonal to MarkdownViewMode; 'changes' renders diff-vs-HEAD in place of the editor without a separate tab. See reviews/changes-view-mode-plan.md.
export type EditorViewMode = 'edit' | 'changes'

/** Enough state to restore a tab via `openFile` after `closeFile` (id is always filePath). */
// Why: omit mirroredFromRuntimeSession so a user-reopened tab isn't treated as host-owned and culled by the next web session sync.
export type ClosedEditorTabSnapshot = Omit<
  OpenFile,
  'id' | 'isDirty' | 'mirroredFromRuntimeSession'
>
export const MAX_RECENT_CLOSED_EDITOR_TABS = 10
export type EditorOpenTargetOptions = {
  targetGroupId?: string
  preview?: boolean
  runtimeEnvironmentId?: string | null
  forceContentReload?: boolean
}
export type GitRuntimeOperationOptions = {
  runtimeTargetSettings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  applyUpstreamStatus?: boolean
}
export function resolveDiffRuntimeEnvironmentId(
  state: AppState,
  worktreeId: string,
  explicitRuntimeEnvironmentId: string | null | undefined
): string | null | undefined {
  if (explicitRuntimeEnvironmentId !== undefined) {
    return explicitRuntimeEnvironmentId
  }
  // Why: route diffs by explicit worktree owner; null forces LOCAL, undefined would inherit the focused runtime → wrong host (#6957, #8484).
  return getExplicitRuntimeEnvironmentIdForWorktree(state, worktreeId) ?? null
}
export type PendingEditorReveal = {
  filePath: string
  fileId?: string
  line: number
  column: number
  matchLength: number
}
export type PendingEditorFocusRequest = {
  fileId: string
  worktreeId: string
  viewStateId: string
  expiresAt: number
  token: number
}

// Why: allow slow SSH mounts without leaving an unrelated future remount armed indefinitely.
export const EDITOR_FOCUS_REQUEST_TTL_MS = 30_000
let nextEditorFocusRequestToken = 0
export const pendingEditorLineRevealFrameIds = new Set<number>()
export function cancelPendingEditorLineRevealFrames(): void {
  if (typeof cancelAnimationFrame === 'function') {
    for (const frameId of pendingEditorLineRevealFrameIds) {
      cancelAnimationFrame(frameId)
    }
  }
  pendingEditorLineRevealFrameIds.clear()
}
export function trackEditorLineRevealFrameId(frameId: number): void {
  pendingEditorLineRevealFrameIds.add(frameId)
}
export function requestTrackedEditorLineRevealFrame(callback: FrameRequestCallback): void {
  let completed = false
  let frameId: number | undefined
  frameId = requestAnimationFrame((timestamp) => {
    completed = true
    if (frameId !== undefined) {
      pendingEditorLineRevealFrameIds.delete(frameId)
    }
    callback(timestamp)
  })
  if (!completed) {
    trackEditorLineRevealFrameId(frameId)
  }
}
export function scheduleEditorLineReveal(
  get: () => AppState,
  filePath: string,
  line: number,
  column?: number,
  fileId?: string
): void {
  // Why: openFile may remount Monaco async; the reveal must land after remount or the old editor clears it.
  cancelPendingEditorLineRevealFrames()
  get().setPendingEditorReveal(null)
  requestTrackedEditorLineRevealFrame(() => {
    requestTrackedEditorLineRevealFrame(() => {
      get().setPendingEditorReveal({
        filePath,
        fileId,
        line,
        column: column ?? 1,
        matchLength: 0
      })
    })
  })
}
