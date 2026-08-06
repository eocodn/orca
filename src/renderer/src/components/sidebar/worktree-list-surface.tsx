import React, { useMemo, useCallback, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { toast } from 'sonner'
import { CircleX } from 'lucide-react'
import { useAppStore } from '@/store'
import { createLineageToggleHandlerCache } from './worktree-lineage-toggle-handler-cache'
import { reuseArrayIfEqual } from './worktree-agent-row-selectors'
import type { AppState } from '@/store/types'
import {
  getAllWorktreesFromState,
  useAllWorktrees,
  useProjectHostSetupProjection,
  useRepoMap,
  useWorktreeMap
} from '@/store/selectors'
import { WorktreeSidebarDropIndicator } from './WorktreeSidebarDropIndicator'
import {
  getProjectGroupHeaderSectionEndByGroupId,
  getRepoHeaderSectionEndByRepoId
} from './worktree-header-section-boundaries'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import { cn } from '@/lib/utils'
import type {
  Worktree,
  Repo,
  ProjectGroup,
  WorktreeMeta,
  WorkspaceStatus
} from '../../../../shared/types'
import { DEFAULT_SHOW_SLEEPING_WORKSPACES } from '../../../../shared/constants'
import { buildWorktreeComparator, compareWorktreeSortLabel } from './smart-sort'
import {
  buildAttentionByWorktree,
  hasFreshAttributedAgentStatus,
  type WorktreeAttention
} from './smart-attention'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { deriveRunningAgentSendTargets } from '@/lib/running-agent-targets'
import { rightSidebarShowsPullRequestData } from '@/lib/right-sidebar-visibility'
import {
  type Row,
  PINNED_GROUP_KEY,
  buildRows,
  getGroupKeysForWorktree,
  getLineageGroupKey,
  getPinnedWorktreeDisplayPolicy
} from './worktree-list-groups'
import {
  buildLineageRowRekeyMap,
  getActiveStickyIndexesForScroll,
  getRenderRowKey,
  getStickyHeaderIndexes,
  getVirtualRowTransform,
  pruneStaleVirtualRowElementCache,
  shouldUseHeaderTopSpacing
} from './worktree-list-virtual-rows'
import {
  getWorkspaceStatus,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey
} from './workspace-status'
import { useWorkspaceStatusDocumentDrop } from './use-workspace-status-drop'
import {
  computeClearFilterActions,
  computeVisibleWorktreeIds,
  setVisibleWorktreeIds,
  sidebarHasActiveFilters
} from './visible-worktrees'
import {
  getCyclicProjectedWorktreeLineageIds,
  getWorktreeLineageAncestors
} from './worktree-lineage-projection'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import { getEmptyProjectPlaceholderRepoIds } from './empty-project-placeholder-repos'
import {
  getVisibleWorktreeBrowserActivityTabs,
  getVisibleWorktreeTerminalActivityTabs
} from './visible-worktree-activity-inputs'
import { selectWorktreeListReviewCacheInputs } from './worktree-list-review-cache-inputs'
import {
  VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT,
  useVirtualizedScrollAnchor,
  type VirtualizedScrollAnchor
} from '@/hooks/useVirtualizedScrollAnchor'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT,
  type ScrollToCurrentWorkspaceRevealRequestDetail
} from '@/lib/scroll-to-current-workspace-status'
import { getLogicalRepoOrderRankById } from './project-header-drop'
import {
  buildManualOrderUpdatesForGroupDrop,
  buildManualOrderUpdatesForVisibleGroups,
  shouldWriteManualOrderForGroupDrop,
  type WorktreeDragGroup
} from './worktree-manual-order'
import {
  buildWorkspaceKanbanSidebarDropUpdates,
  clearWorkspaceKanbanSidebarDropTargetVisual
} from './workspace-kanban-sidebar-drop'
import type { WorktreeSidebarDragPoint } from './worktree-sidebar-drag-autoscroll'
import type { WorktreeSidebarStatusDropTarget } from './worktree-sidebar-drop-preview'
import {
  getReorderedWorktreeIdsToUnnest,
} from './worktree-lineage-drag-drop'
import { getPointerDropStatusTarget } from './worktree-list-drop-target'
import { resolveProjectGroupHeaderColor } from './project-header-color'
import {
  areWorktreeSelectionsEqual,
  getWorktreeSelectionIntent,
  pruneWorktreeSelection,
  updateWorktreeSelection
} from './worktree-multi-selection'
import { persistWorktreeSortOrderByHost } from '@/lib/worktree-sort-order-persistence'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getRepoHeaderCreateState } from './repo-header-create-state'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import { ProjectGroupDeleteDialog } from './ProjectGroupDeleteDialog'
import { selectProjectGroupRemovalTargets } from '@/store/slices/project-group-removal-targets'
import SuppressExternalWorktreeInboxDialog from './SuppressExternalWorktreeInboxDialog'
import {
  keepImportedWorktreesHiddenCard,
  IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR,
  showImportedWorktreesCard,
  type ImportedWorktreeCardActionState
} from './imported-worktrees-card-actions'
import {
  importNewExternalWorktreeInboxPaths,
  keepNewExternalWorktreeInboxHidden,
  suppressNewExternalWorktreeInbox,
  type NewExternalWorktreesInboxActionState
} from './new-external-worktrees-inbox-actions'
import { isEligibleWorktreeParent } from './worktree-parent-candidates'
import {
  buildImportedWorktreesCardCandidates,
  getHiddenImportedWorktrees
} from './imported-worktrees-card-candidates'
import {
  buildNewExternalWorktreesInboxCandidates,
  toNewExternalWorktreeInboxPreview
} from './new-external-worktrees-inbox-candidates'
import {
  WORKTREE_SECTION_HEADER_PADDING_LEFT,
  getFolderBackedRepoWorktreeCardContentIndent,
  getFolderBackedRepoWorktreeCardSurfaceInset,
  getFolderWorkspaceRowGeometry,
  getLineageChildrenInlineStyle,
  getLineageNestedRowGeometry,
  getProjectGroupHeaderPaddingLeft,
  getWorktreeCardContentIndent,
  getWorktreeCardSurfaceInset
} from './worktree-list-indentation'
import { addHostSectionRows } from './host-section-rows'
import { orderHostSectionOptions } from './host-section-order'
import { buildSidebarHostOptions } from './sidebar-host-options'
import { translate } from '@/i18n/i18n'
import { folderWorkspaceKey, getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { isConfirmedStaleFolderPathStatus } from '../../../../shared/folder-workspace-path-status'
import { getKnownSidebarWorktreeById } from './worktree-list-folder-reveal'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getVisibleSidebarHostIdSet
} from './worktree-list-host-filtering'
import { getFolderWorkspaceCardPrDisplay } from './folder-workspace-card-pr-display'
import { getRenderedWorktreesInSidebarOrder } from './worktree-sidebar-row-preference'
import { getCyclableWorktreeIds, resolveCycledWorktreeId } from './worktree-keyboard-cycle'
import {
  countRecordKeysByReference,
  handleRepoHeaderActionPointerDown,
  handleRepoHeaderCollapseAffordancePointerDown,
  markSidebarWorktreeActiveImmediately,
  stopNestedWorktreeCardBubble,
  stopRepoHeaderMenuEvent,
  stopRepoHeaderKeyboardToggle
} from './worktree-list-row-dom'
import { useWorktreeListVirtualizer } from './worktree-list-virtualizer'
import { useWorktreeListFolderPathStatus } from './worktree-list-folder-path-status'
import { useWorktreeListKeyboard } from './worktree-list-keyboard'
import { useWorktreeListRevealEffects } from './worktree-list-reveal-effects'
import { useWorktreeListDragSession } from './worktree-list-drag-session'
import { useWorktreeListPointerDragController } from './use-worktree-list-pointer-drag'
import { useWorktreeListStatusDrop } from './use-worktree-list-status-drop'
import { useWorktreeListNativeDrag } from './use-worktree-list-native-drag'
import { useWorktreeListNativeDocument } from './use-worktree-list-native-document'

export {
  countRecordKeysByReference,
  resolvePendingSidebarReveal,
  shouldAdjustWorktreeSidebarMeasuredRowScroll
} from './worktree-list-row-dom'

export {
  getScrollTopToRevealBounds,
  WORKTREE_SIDEBAR_REVEAL_TOP_INSET
} from './worktree-sidebar-reveal'
import { HostSectionHeader } from './worktree-list-host-header'
import {
  WorktreeListContentRow,
  WorktreeListFolderRow,
  WorktreeListSpecialRow
} from './worktree-list-content-row'
import { WorktreeListCardRow, renderWorktreeLineageDescendants } from './worktree-list-card-row'
import { WorktreeListHeaderRow } from './worktree-list-header-row'
import type { ActiveSurfaceVariant } from './WorktreeCard'
import type {
  ProjectGroupDeleteDialogState,
  ProjectGroupNameDialogState,
  WorktreePointerDrag,
  VirtualizedWorktreeViewportProps,
  WorktreeRowDragState
} from './worktree-list-types'

// Why: epoch-driven recomputes often produce arrays whose contents and order are unchanged; reusing the previous identity when element-wise equal keeps downstream memos and React.memo'd cards bailing out. Safe only because elements (Worktree objects / id strings) are immutably REPLACED on change — never wrap arrays of mutated-in-place objects.
function useReusedArrayIdentity<T>(next: T[]): T[] {
  const previousRef = useRef<T[]>(next)
  const result = reuseArrayIfEqual(previousRef.current, next)
  previousRef.current = result
  return result
}

// Debounce re-sort after a sortEpoch bump so background score changes don't jar row positions.
const SORT_SETTLE_MS = 3_000
const EMPTY_PROJECT_GROUPS: readonly ProjectGroup[] = []
const EMPTY_AGENT_STATUS_BY_PANE_KEY: AppState['agentStatusByPaneKey'] = {}
const EMPTY_WORKTREE_ID_SET: ReadonlySet<string> = new Set()
const EMPTY_TABS_BY_WORKTREE: AppState['tabsByWorktree'] = {}
const EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID: AppState['terminalLayoutsByTabId'] = {}
const EMPTY_PTY_IDS_BY_TAB_ID: AppState['ptyIdsByTabId'] = {}
const EMPTY_RUNTIME_PANE_TITLES_BY_TAB_ID: AppState['runtimePaneTitlesByTabId'] = {}
const NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK = (): void => {}
const WORKTREE_SIDEBAR_SCROLL_STYLE: React.CSSProperties = {
  // Why: TanStack Virtual owns scroll correction; native overflow anchoring fights it and causes jumps.
  overflowAnchor: 'none'
}

const EMPTY_WORKTREE_DRAG_PREVIEW_OFFSETS: ReadonlyMap<string, number> = new Map()

const WORKTREE_ROW_DRAG_INITIAL_STATE: WorktreeRowDragState = {
  draggingWorktreeId: null,
  sourceGroupKey: null,
  dropIndex: null,
  dropIndicatorY: null,
  previewOffsetsByWorktreeId: EMPTY_WORKTREE_DRAG_PREVIEW_OFFSETS,
  pointerY: null
}

function getWorktreeVirtualRowTransform(start: number, previewOffset: number): string {
  const base = getVirtualRowTransform(start)
  return previewOffset === 0 ? base : `${base} translateY(${previewOffset}px)`
}

import {
  canKeepImportedWorktreesHidden,
  buildRenderableRows,
  findPreferredRenderRowIndexForWorktree,
  getActiveDescendantOptionId,
  getVirtualRowKey,
  uniqueWorktreeIds
} from './worktree-list-row-model'

export {
  canKeepImportedWorktreesHidden,
  getPinnedWorktreeRevealCollapsedGroupKeys,
  getRenderRowKey,
  getWorktreeDragGroups,
  getWorktreeDragIndexes,
  renderRowContainsWorktree
} from './worktree-list-row-model'

const VirtualizedWorktreeViewport = React.memo(function VirtualizedWorktreeViewport({
  rows,
  activeWorktreeId,
  currentWorktreeId,
  groupBy,
  pinnedDisplayPolicy,
  projectOrderBy,
  toggleGroup,
  collapsedGroups,
  handleCreateForRepo,
  handleOpenRepoSettings,
  handleOpenWorktreeVisibility,
  handleShowImportedWorktrees,
  handleKeepImportedWorktreesHidden,
  importedWorktreeCardActionState,
  handleImportNewExternalWorktree,
  handleImportAllNewExternalWorktrees,
  handleKeepNewExternalWorktreeInboxHidden,
  handleOpenSuppressExternalWorktreeInbox,
  newExternalWorktreeInboxActionState,
  handleRemoveProject,
  handleCreateGroupFromRepo,
  handleMoveProjectToGroup,
  handleRemoveProjectFromGroup,
  handleRenameProjectGroup,
  handleDeleteProjectGroup,
  handleCreateFolderWorkspace,
  activeModal,
  pendingRevealWorktree,
  pendingRevealSidebarRow,
  clearPendingRevealWorktreeId,
  clearPendingRevealSidebarRow,
  agentSendTargetWorktreeId,
  worktrees,
  folderWorkspaces,
  selectedWorktreeIds,
  selectedWorktrees,
  onSelectionGesture,
  onImmediateWorktreeActivate,
  onContextMenuSelect,
  repoMap,
  defaultHostId,
  worktreeMap,
  worktreeLineageById,
  workspaceLineageByChildKey,
  allRepoIds,
  onReorderHostSections,
  onHostDragActiveChange,
  prCache,
  hostedReviewCache,
  workspaceStatuses,
  projectGrouping,
  projectGroups = EMPTY_PROJECT_GROUPS,
  onMoveWorktreeToStatus,
  onMoveWorktreesToStatus,
  onMoveWorktreesToStatusAtIndex,
  onPinWorktree,
  onPinWorktrees,
  onDropWorktreesOnWorkspaceBoard,
  workspaceBoardOpen,
  onWorkspaceBoardDragPreviewStart,
  onWorkspaceBoardDragPreviewCommit,
  onWorkspaceBoardDragPreviewCancel,
  shouldShowWorkspaceBoardDropIndicator,
  onReorderWorktrees,
  scrollOffsetRef,
  scrollAnchorRef
}: VirtualizedWorktreeViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const suppressMeasurementAdjustmentUntilRef = useRef(0)
  const directScrollInputUntilRef = useRef(0)
  const [dragOverStatus, setDragOverStatus] = useState<WorkspaceStatus | null>(null)
  const [pinDragOver, setPinDragOver] = useState(false)
  const [nativeLineageDropTargetId, setNativeLineageDropTargetId] = useState<string | null>(null)
  const [worktreeDragState, setWorktreeDragState] = useState<WorktreeRowDragState>(
    WORKTREE_ROW_DRAG_INITIAL_STATE
  )
  const [documentVisibilityRevision, setDocumentVisibilityRevision] = useState(0)
  const assignWorktreeParent = useAppStore((s) => s.assignWorktreeParent)
  const updateWorktreeLineage = useAppStore((s) => s.updateWorktreeLineage)
  const cyclicLineageIds = useMemo(
    () => getCyclicProjectedWorktreeLineageIds(worktreeLineageById, worktreeMap),
    [worktreeLineageById, worktreeMap]
  )
  const worktreePointerDragRef = useRef<WorktreePointerDrag | null>(null)
  const worktreePointerAutoscrollFrameIdRef = useRef<number | null>(null)
  const worktreePointerAutoscrollLastFrameTimeRef = useRef<number | null>(null)
  const worktreeNativeAutoscrollFrameIdRef = useRef<number | null>(null)
  const worktreeNativeAutoscrollLastFrameTimeRef = useRef<number | null>(null)
  const worktreeNativeLatestPointRef = useRef<WorktreeSidebarDragPoint | null>(null)
  const suppressWorktreeClickUntilRef = useRef(0)
  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)
  const lastVisibleRefreshKeyRef = useRef('')
  const reportVisibleGitHubPRRefreshCandidates = useAppStore(
    (s) => s.reportVisibleGitHubPRRefreshCandidates
  )
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const rightSidebarShowsPR = useAppStore((s) => rightSidebarShowsPullRequestData(s))
  const keybindings = useAppStore((s) => s.keybindings)
  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const prVisibleRefreshGeneration = useAppStore((s) => s.prVisibleRefreshGeneration)
  const settings = useAppStore((s) => s.settings)
  const newCardStyle = settings?.experimentalNewWorktreeCardStyle === true
  const reorderRepos = useAppStore((s) => s.reorderRepos)
  const folderBackedProjectGroupIds = useMemo(
    () =>
      new Set(
        projectGroups
          .filter((group) => group.createdFrom === 'folder-scan')
          .map((group) => group.id)
      ),
    [projectGroups]
  )

  useEffect(
    () =>
      installWorktreeVisibleRefreshVisibilityListener(() => {
        if (document.visibilityState !== 'visible') {
          // Why: row identity may be unchanged after a hidden window; reset the key so PR/CI rows refresh.
          lastVisibleRefreshKeyRef.current = '__document_hidden__'
          return
        }
        setDocumentVisibilityRevision((revision) => revision + 1)
      }),
    []
  )

  const {
    worktreeDragSessionRef,
    statusDropAnchorsRef,
    worktreeDragGroups,
    worktreeDragUnitGroups,
    groupKeyByRowKey,
    groupIndexByRowKey,
    getReorderDraggedIds,
    getReorderUnitDraggedIds,
    refreshDragSession: refreshWorktreeDragSession,
    computeDrop: computeWorktreeDrop,
    computeStatusDrop: computeWorktreeStatusDrop
  } = useWorktreeListDragSession({ rows, scrollRef })
  const renderRows = useMemo(() => buildRenderableRows(rows), [rows])
  const {
    canReorderRepoHeaders,
    canReorderProjectGroupHeaders,
    orderedHostIds,
    hostDrag,
    sidebarRepoHeaderIdsByBucket,
    sidebarProjectGroupHeaderIdsByBucket,
    repoHeaderIndexByRepoId,
    repoHeaderBucketByRepoId,
    projectGroupHeaderIndexByGroupId,
    projectGroupHeaderBucketByGroupId,
    repoDrag,
    projectGroupDrag
  } = useWorktreeListHeaderDrag({
    rows,
    projectGroups,
    allRepoIds,
    repoMap,
    groupBy,
    projectOrderBy,
    onReorderHostSections,
    onHostDragActiveChange,
    reorderRepos,
    moveProjectToGroup,
    updateProjectGroup,
    scrollRef,
    suppressMeasurementAdjustmentUntilRef,
    directScrollInputUntilRef
  })
  const [primaryActiveWorktreeRow, setPrimaryActiveWorktreeRow] = useState<{
    worktreeId: string
    rowKey: string
  } | null>(null)
  useEffect(() => {
    if (activeWorktreeId === null) {
      setPrimaryActiveWorktreeRow(null)
      return
    }
    setPrimaryActiveWorktreeRow((current) => {
      if (current === null || current.worktreeId !== activeWorktreeId) {
        return null
      }
      const rowStillVisible = rows.some(
        (row) =>
          row.type === 'item' &&
          row.worktree.id === current.worktreeId &&
          row.rowKey === current.rowKey
      )
      return rowStillVisible ? current : null
    })
  }, [activeWorktreeId, rows])
  const getActiveSurfaceVariant = useCallback(
    (row: WorktreeItemRow): ActiveSurfaceVariant => {
      if (primaryActiveWorktreeRow?.worktreeId === row.worktree.id) {
        return primaryActiveWorktreeRow.rowKey === row.rowKey ? 'primary' : 'secondary'
      }
      if (
        pinnedDisplayPolicy === 'duplicate-in-groups' &&
        activeWorktreeId === row.worktree.id &&
        isPinnedWorktreeRow(row)
      ) {
        return 'secondary'
      }
      return 'primary'
    },
    [activeWorktreeId, pinnedDisplayPolicy, primaryActiveWorktreeRow]
  )
  const handleImmediateWorktreeRowActivate = useCallback(
    (worktreeId: string, rowKey: string | undefined): void => {
      setPrimaryActiveWorktreeRow(rowKey ? { worktreeId, rowKey } : null)
      onImmediateWorktreeActivate(worktreeId, rowKey)
    },
    [onImmediateWorktreeActivate]
  )
  const firstHeaderIndex = useMemo(
    () => renderRows.findIndex((row) => row.type === 'header' || row.type === 'host-header'),
    [renderRows]
  )
  const repoHeaderSectionEndByRepoId = useMemo(
    () =>
      getRepoHeaderSectionEndByRepoId({
        rows: renderRows,
        firstHeaderIndex,
        sidebarRepoHeaderIdsByBucket,
        repoHeaderBucketByRepoId
      }),
    [firstHeaderIndex, renderRows, repoHeaderBucketByRepoId, sidebarRepoHeaderIdsByBucket]
  )
  const projectGroupHeaderSectionEndByGroupId = useMemo(
    () =>
      getProjectGroupHeaderSectionEndByGroupId({
        rows: renderRows,
        firstHeaderIndex,
        sidebarProjectGroupHeaderIdsByBucket,
        projectGroupHeaderBucketByGroupId
      }),
    [
      firstHeaderIndex,
      projectGroupHeaderBucketByGroupId,
      renderRows,
      sidebarProjectGroupHeaderIdsByBucket
    ]
  )
  const stickyHeaderIndexes = useMemo(() => getStickyHeaderIndexes(renderRows), [renderRows])
  const activeStickyHostIndexRef = useRef<number | null>(null)
  const {
    virtualizer,
    activeStickyHeaderIndexRef,
    stickyRangeStartIndexRef,
    isCurrentVirtualRowElement,
    measureVirtualRowElement,
    markScrollMovement,
    markDirectScrollInput,
    hasDirectScrollInput,
    shouldSkipScrollAnchorRestore
  } = useWorktreeListVirtualizer({
    renderRows,
    firstHeaderIndex,
    stickyHeaderIndexes,
    scrollRef,
    scrollOffsetRef,
    suppressMeasurementAdjustmentUntilRef,
    directScrollInputUntilRef
  })
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const getCachedFolderWorkspacePathStatus = useWorktreeListFolderPathStatus({
    projectGroups,
    folderWorkspaces,
    allRepoIds,
    repoMap,
    sshConnectionStates
  })
  const {
    highlightedRevealRowKey,
    cancelPendingRevealFrames,
    clearRevealHighlightFrame,
    clearRevealHighlightTimeout
  } = useWorktreeListRevealEffects({
    pendingRevealWorktree,
    pendingRevealSidebarRow,
    clearPendingRevealWorktreeId,
    clearPendingRevealSidebarRow,
    agentSendTargetWorktreeId,
    groupBy,
    worktrees,
    folderWorkspaces,
    repoMap,
    defaultHostId,
    worktreeMap,
    worktreeLineageById,
    projectGroups,
    projectGrouping,
    pinnedDisplayPolicy,
    collapsedGroups,
    toggleGroup,
    prCache,
    workspaceStatuses,
    settings,
    renderRows,
    virtualizer,
    scrollRef
  })

  const prCacheLen = useAppStore((s) => countRecordKeysByReference(s.prCache))
  const issueCacheLen = useAppStore((s) => countRecordKeysByReference(s.issueCache))
  const renderRowKeySignature = useMemo(
    () => renderRows.map(getRenderRowKey).join('\n'),
    [renderRows]
  )
  const activeRenderRowKeys = useMemo(() => new Set(renderRows.map(getRenderRowKey)), [renderRows])
  const lineageRowRekeys = useMemo(() => buildLineageRowRekeyMap(renderRows), [renderRows])
  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()
  const activeStickyIndexes = getActiveStickyIndexesForScroll({
    rows: renderRows,
    rangeStartIndex: stickyRangeStartIndexRef.current,
    scrollOffset: virtualizer.scrollOffset ?? scrollOffsetRef.current,
    stickyHeaderIndexes,
    virtualItems
  })
  activeStickyHeaderIndexRef.current = activeStickyIndexes.groupIndex
  activeStickyHostIndexRef.current = activeStickyIndexes.hostIndex

  const measureMountedRows = useCallback(() => {
    virtualizer.elementsCache.forEach((element) => {
      if (!isCurrentVirtualRowElement(element)) {
        return
      }
      virtualizer.measureElement(element)
    })
  }, [isCurrentVirtualRowElement, virtualizer])
  useLayoutEffect(() => {
    pruneStaleVirtualRowElementCache({
      activeRowKeys: activeRenderRowKeys,
      virtualizer
    })
    // Why: a stale retained element after delete/collapse measures 0px and corrupts the next slot; measure only key-matched rows.
    measureMountedRows()
    const frameId = window.requestAnimationFrame(measureMountedRows)
    return () => window.cancelAnimationFrame(frameId)
  }, [
    activeRenderRowKeys,
    prCacheLen,
    issueCacheLen,
    measureMountedRows,
    renderRowKeySignature,
    virtualizer
  ])

  useVirtualizedScrollAnchor({
    anchorRef: scrollAnchorRef,
    getItemElementKey: getVirtualRowKey,
    getRowKey: getRenderRowKey,
    itemElementSelector: '[data-worktree-virtual-row]',
    rekeyedRowKeys: lineageRowRekeys,
    rows: renderRows,
    scrollElementRef: scrollRef,
    scrollOffsetRef,
    hasDirectScrollInput,
    shouldSkipRestore: shouldSkipScrollAnchorRestore,
    totalSize,
    virtualizer
  })

  const recordCurrentScrollAnchor = useCallback(() => {
    scrollRef.current?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT))
  }, [])
  const toggleGroupWithScrollAnchor = useCallback(
    (groupKey: string) => {
      recordCurrentScrollAnchor()
      toggleGroup(groupKey)
    },
    [recordCurrentScrollAnchor, toggleGroup]
  )
  // Why: memo'd WorktreeCard needs a per-group-key stable onLineageToggle
  // identity to bail out of re-renders; see worktree-lineage-toggle-handler-cache.
  const getLineageToggleHandler = useMemo(
    () => createLineageToggleHandlerCache(toggleGroupWithScrollAnchor),
    [toggleGroupWithScrollAnchor]
  )

  const navigateWorktree = useCallback(
    (direction: 'up' | 'down') => {
      // Why: cycle over the rows the sidebar actually rendered — collapsing a group
      // means "not now", and a rebuilt near-copy would drift from what is on screen
      // (host sections, pinned placement, folder workspaces).
      const nextWorktreeId = resolveCycledWorktreeId({
        worktreeIds: getCyclableWorktreeIds(rows, pinnedDisplayPolicy),
        activeWorktreeId,
        direction
      })
      if (nextWorktreeId === null) {
        return
      }

      // Why: keyboard cycling is real navigation; route through the activation helper that records history.
      activateAndRevealWorktree(nextWorktreeId)

      const rowIndex = findPreferredRenderRowIndexForWorktree(
        renderRows,
        nextWorktreeId,
        pinnedDisplayPolicy
      )
      if (rowIndex !== -1) {
        virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
      }
    },
    [rows, renderRows, activeWorktreeId, virtualizer, pinnedDisplayPolicy]
  )

  const { handleContainerKeyDown, handleScrollPointerDown, handleScroll } = useWorktreeListKeyboard(
    {
      activeModal,
      keybindings,
      scrollRef,
      markDirectScrollInput,
      markScrollMovement,
      navigateWorktree
    }
  )

  const cancelWorktreePointerAutoscroll = useCallback(() => {
    if (worktreePointerAutoscrollFrameIdRef.current !== null) {
      window.cancelAnimationFrame(worktreePointerAutoscrollFrameIdRef.current)
      worktreePointerAutoscrollFrameIdRef.current = null
    }
    worktreePointerAutoscrollLastFrameTimeRef.current = null
  }, [])

  const cancelWorktreeNativeAutoscroll = useCallback(() => {
    if (worktreeNativeAutoscrollFrameIdRef.current !== null) {
      window.cancelAnimationFrame(worktreeNativeAutoscrollFrameIdRef.current)
      worktreeNativeAutoscrollFrameIdRef.current = null
    }
    worktreeNativeAutoscrollLastFrameTimeRef.current = null
    worktreeNativeLatestPointRef.current = null
  }, [])

  const cleanupWorktreePointerDrag = useCallback(() => {
    const drag = worktreePointerDragRef.current
    cancelWorktreePointerAutoscroll()
    setNativeLineageDropTargetId(null)
    if (!drag) {
      return
    }
    if (drag.frameId !== null) {
      window.cancelAnimationFrame(drag.frameId)
    }
    drag.preview?.remove()
    worktreePointerDragRef.current = null
    setSidebarPointerDragDocumentStyles(false)
    setDragOverStatus(null)
    setPinDragOver(false)
    clearWorkspaceKanbanSidebarDropTargetVisual()
    onWorkspaceBoardDragPreviewCancel()
  }, [cancelWorktreePointerAutoscroll, onWorkspaceBoardDragPreviewCancel])

  const clearWorktreeDrag = useCallback(() => {
    cleanupWorktreePointerDrag()
    cancelWorktreeNativeAutoscroll()
    worktreeDragSessionRef.current = null
    statusDropAnchorsRef.current.clear()
    setWorktreeDragState(WORKTREE_ROW_DRAG_INITIAL_STATE)
  }, [cancelWorktreeNativeAutoscroll, cleanupWorktreePointerDrag])

  const setScrollRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null && scrollRef.current !== null) {
        // Why: drag previews, autoscroll frames, and reveal snapshots are tied to the scroll root; clear them before it unmounts.
        cancelPendingRevealFrames()
        clearRevealHighlightFrame()
        clearRevealHighlightTimeout()
        clearWorktreeDrag()
      }
      scrollRef.current = node
    },
    [
      cancelPendingRevealFrames,
      clearRevealHighlightFrame,
      clearRevealHighlightTimeout,
      clearWorktreeDrag
    ]
  )

  const getEligibleLineageDropTarget = useCallback(
    (
      target: WorktreeSidebarStatusDropTarget & { lineageParentId: string | null },
      draggedIds: readonly string[]
    ): WorktreeSidebarStatusDropTarget & { lineageParentId: string | null } => {
      const parentId = target.lineageParentId
      if (!parentId) {
        return target
      }
      const canAssignAll = draggedIds.every((draggedId) => {
        const child = worktreeMap.get(draggedId)
        if (!child) {
          return false
        }
        const candidateParent = worktreeMap.get(parentId)
        return Boolean(
          candidateParent &&
          isEligibleWorktreeParent({
            child,
            candidateParent,
            lineageById: worktreeLineageById,
            worktreeMap,
            repoMap,
            cyclicLineageIds
          })
        )
      })
      return canAssignAll ? target : { ...target, lineageParentId: null }
    },
    [cyclicLineageIds, repoMap, worktreeLineageById, worktreeMap]
  )

  const commitWorktreeLineageParentDrop = useCallback(
    (draggedIds: readonly string[], parentId: string): boolean => {
      const target = getEligibleLineageDropTarget(
        { status: null, isPinDrop: false, lineageParentId: parentId },
        draggedIds
      )
      if (!target.lineageParentId) {
        return false
      }
      void Promise.all(
        draggedIds.map((id) => assignWorktreeParent(id, { parentWorktreeId: parentId }))
      ).catch((err) => {
        console.error('Failed to nest workspace:', err)
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.failedNestWorkspace',
            'Failed to nest workspace'
          )
        )
      })
      return true
    },
    [assignWorktreeParent, getEligibleLineageDropTarget]
  )

  const clearReorderedWorktreeParents = useCallback(
    (args: { draggedIds: readonly string[]; sourceGroupKey: string }) => {
      const sourceGroup = worktreeDragGroups.find((group) => group.key === args.sourceGroupKey)
      if (!sourceGroup) {
        return
      }
      const ids = getReorderedWorktreeIdsToUnnest({
        draggedIds: args.draggedIds,
        sourceGroupIds: sourceGroup.worktreeIds,
        lineageById: worktreeLineageById,
        worktreeMap,
        cyclicLineageIds
      })
      if (ids.length === 0) {
        return
      }
      // Why: dropping a nested card on a reorder line is the un-nest escape hatch; clear only the dragged children.
      void Promise.all(ids.map((id) => updateWorktreeLineage(id, { noParent: true }))).catch(
        (err) => {
          console.error('Failed to unnest workspace:', err)
          toast.error(
            translate(
              'auto.components.sidebar.WorktreeList.failedUnnestWorkspace',
              'Failed to unnest workspace'
            )
          )
        }
      )
    },
    [cyclicLineageIds, updateWorktreeLineage, worktreeDragGroups, worktreeLineageById, worktreeMap]
  )

  useWorktreeListPointerDragController({
    scrollRef,
    worktreePointerDragRef,
    pointerAutoscrollFrameRef: worktreePointerAutoscrollFrameIdRef,
    pointerAutoscrollLastFrameRef: worktreePointerAutoscrollLastFrameTimeRef,
    worktreeDragSessionRef,
    groupKeyByRowKey,
    selectedWorktreeIds,
    selectedWorktrees,
    workspaceBoardOpen,
    canPreviewWorkspaceBoardOnDrag:
      !workspaceBoardOpen &&
      onWorkspaceBoardDragPreviewStart !== NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
    workspaceStatuses,
    worktreeDragGroups,
    worktreeDragUnitGroups,
    worktreeDragStateSetter: setWorktreeDragState,
    setDragOverStatus,
    setPinDragOver,
    clearWorktreeDrag,
    refreshWorktreeDragSession,
    computeWorktreeDrop,
    computeWorktreeStatusDrop,
    getReorderDraggedIds,
    getReorderUnitDraggedIds,
    getEligibleLineageDropTarget,
    commitLineageParentDrop: commitWorktreeLineageParentDrop,
    clearReorderedParents: clearReorderedWorktreeParents,
    markScrollMovement,
    onWorkspaceBoardDragPreviewStart,
    onWorkspaceBoardDragPreviewCommit,
    onWorkspaceBoardDragPreviewCancel,
    shouldShowWorkspaceBoardDropIndicator,
    onDropWorktreesOnWorkspaceBoard,
    onPinWorktrees,
    onMoveWorktreesToStatus,
    onMoveWorktreesToStatusAtIndex,
    onReorderWorktrees
  })

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (window.performance.now() >= suppressWorktreeClickUntilRef.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  const {
    handleCardDragStart: handleWorktreeCardDragStart,
    handleDragOver: handleWorktreeDragOver,
    handleDrop: handleWorktreeDrop
  } = useWorktreeListNativeDrag({
    scrollRef,
    nativeFrameRef: worktreeNativeAutoscrollFrameIdRef,
    nativeLastFrameRef: worktreeNativeAutoscrollLastFrameTimeRef,
    nativeLatestPointRef: worktreeNativeLatestPointRef,
    dragSessionRef: worktreeDragSessionRef,
    groups: worktreeDragGroups,
    unitGroups: worktreeDragUnitGroups,
    setLineageTarget: setNativeLineageDropTargetId,
    setDragState: setWorktreeDragState,
    refreshDragSession: refreshWorktreeDragSession,
    computeDrop: computeWorktreeDrop,
    computeStatusDrop: computeWorktreeStatusDrop,
    getEligibleLineageDropTarget,
    commitLineageParentDrop: commitWorktreeLineageParentDrop,
    clearReorderedParents: clearReorderedWorktreeParents,
    clearDrag: clearWorktreeDrag,
    markScrollMovement,
    getReorderDraggedIds,
    getReorderUnitDraggedIds,
    onMoveWorktreesToStatusAtIndex,
    onReorderWorktrees
  })

  useEffect(() => {
    if (document.visibilityState !== 'visible') {
      lastVisibleRefreshKeyRef.current = '__document_hidden__'
      return
    }
    const currentWorktree = currentWorktreeId ? (worktreeMap.get(currentWorktreeId) ?? null) : null
    // Why: this reporter feeds the GitHub coordinator; GitLab-only MR panels refresh via hosted-review paths.
    const sidebarWorktreeHasGitHubReview =
      currentWorktree !== null &&
      ((currentWorktree.linkedGitLabMR ?? null) === null ||
        (currentWorktree.linkedPR ?? null) !== null)
    const shouldTrackSidebarWorktree = rightSidebarShowsPR && sidebarWorktreeHasGitHubReview
    const shouldTrackVisibleRows =
      groupBy === 'pr-status' ||
      (newCardStyle
        ? cardProps.includes('status')
        : cardProps.includes('pr') || cardProps.includes('ci'))
    if (!shouldTrackVisibleRows && !shouldTrackSidebarWorktree) {
      if (lastVisibleRefreshKeyRef.current !== '__hidden__') {
        lastVisibleRefreshKeyRef.current = '__hidden__'
        reportVisibleGitHubPRRefreshCandidates([], Date.now())
      }
      return
    }
    const scrollEl = scrollRef.current
    if (!scrollEl) {
      return
    }
    const viewportTop = scrollEl.scrollTop
    const viewportBottom = viewportTop + scrollEl.clientHeight
    const visibleRows = virtualItems
      .filter((item) => item.start < viewportBottom && item.end > viewportTop)
      .map((item) => renderRows[item.index])
      .filter((row): row is WorktreeItemRow => row?.type === 'item')
      .filter((row) => row.repo?.kind === 'git' && !row.worktree.isBare && row.worktree.branch)
    const visibleWorktreeIds = new Set(visibleRows.map((row) => row.worktree.id))
    if (
      shouldTrackSidebarWorktree &&
      currentWorktree &&
      !currentWorktree.isBare &&
      currentWorktree.branch
    ) {
      visibleWorktreeIds.add(currentWorktree.id)
    }
    const visibleIdentity = visibleRows
      .map((row) => `${row.worktree.id}:${row.worktree.branch}:${row.worktree.linkedPR ?? ''}`)
      .join('|')
    const sidebarIdentity =
      shouldTrackSidebarWorktree && currentWorktree
        ? `${currentWorktree.id}:${currentWorktree.branch}:${currentWorktree.linkedPR ?? ''}`
        : ''
    const key = `${visibleIdentity}:${sidebarIdentity}:${sshConnectedGeneration}:${prVisibleRefreshGeneration}:${cardProps.join(',')}`
    if (!key || key === lastVisibleRefreshKeyRef.current) {
      return
    }
    lastVisibleRefreshKeyRef.current = key
    reportVisibleGitHubPRRefreshCandidates(Array.from(visibleWorktreeIds), Date.now())
  }, [
    cardProps,
    currentWorktreeId,
    documentVisibilityRevision,
    groupBy,
    renderRows,
    reportVisibleGitHubPRRefreshCandidates,
    prVisibleRefreshGeneration,
    rightSidebarShowsPR,
    sshConnectedGeneration,
    newCardStyle,
    virtualItems,
    worktreeMap
  ])

  const activeDescendantId = getActiveDescendantOptionId({
    activeWorktreeId,
    primaryActiveRowKey:
      primaryActiveWorktreeRow?.worktreeId === activeWorktreeId
        ? primaryActiveWorktreeRow.rowKey
        : undefined,
    pinnedDisplayPolicy,
    renderRows,
    virtualItems
  })

  const hasWorkspaceDropTargets = useMemo(
    () =>
      groupBy === 'workspace-status' ||
      rows.some((row) => row.type === 'header' && row.key === PINNED_GROUP_KEY),
    [groupBy, rows]
  )

  const {
    handleStatusDragOver: handleWorkspaceStatusDragOver,
    handleStatusDragLeave: handleWorkspaceStatusDragLeave,
    handlePinDragOver: handleWorkspacePinDragOver,
    handlePinDragLeave: handleWorkspacePinDragLeave,
    handleStatusDrop: handleWorkspaceStatusDrop,
    finishStatusDrop: handleWorkspaceStatusDragFinish
  } = useWorktreeListStatusDrop({
    setDragOverStatus,
    setPinDragOver,
    dragSessionRef: worktreeDragSessionRef,
    computeStatusDrop: computeWorktreeStatusDrop,
    getReorderDraggedIds,
    groups: worktreeDragGroups,
    clearDrag: clearWorktreeDrag,
    onMoveWorktreeToStatus,
    onPinWorktree,
    onMoveWorktreesToStatus,
    onMoveWorktreesToStatusAtIndex
  })

  const handleDocumentDrop = useCallback((event: DragEvent): void => {
      const session = worktreeDragSessionRef.current
      if (!session) {
        return
      }
      if (!refreshWorktreeDragSession()) {
        clearWorktreeDrag()
        return
      }
      const drop = computeWorktreeDrop(event.clientY)
      if (!drop) {
        const container = scrollRef.current
        const target = getEligibleLineageDropTarget(
          container
            ? getPointerDropStatusTarget({
                container,
                x: event.clientX,
                y: event.clientY
              })
            : { status: null, isPinDrop: false, lineageParentId: null },
          session.draggedIds
        )
        if (target.lineageParentId) {
          event.preventDefault()
          event.stopPropagation()
          commitWorktreeLineageParentDrop(session.draggedIds, target.lineageParentId)
          clearWorktreeDrag()
          return
        }
        const statusDrop = target.status
          ? computeWorktreeStatusDrop({
              pointerY: event.clientY,
              status: target.status,
              draggedIds: session.reorderDraggedIds
            })
          : null
        if (target.status && statusDrop) {
          event.preventDefault()
          event.stopPropagation()
          onMoveWorktreesToStatusAtIndex({
            worktreeIds: session.reorderDraggedIds,
            status: target.status,
            dropIndex: statusDrop.dropIndex,
            groups: worktreeDragGroups
          })
          clearWorktreeDrag()
          return
        }
        clearWorktreeDrag()
        return
      }
      // Why: pointer still inside the source group means reorder, not status move; commit here and stop the capture handler.
      event.preventDefault()
      event.stopPropagation()
      onReorderWorktrees({
        groups: worktreeDragGroups,
        sourceGroupKey: session.sourceGroupKey,
        draggedIds: session.reorderDraggedIds,
        dropIndex: getFullDropIndexForWorktreeDragUnit({
          groups: worktreeDragUnitGroups,
          sourceGroupKey: session.sourceGroupKey,
          dropIndex: drop.dropIndex
        })
      })
      clearReorderedWorktreeParents({
        draggedIds: session.draggedIds,
        sourceGroupKey: session.sourceGroupKey
      })
      clearWorktreeDrag()
  }, [
    clearWorktreeDrag,
    clearReorderedWorktreeParents,
    commitWorktreeLineageParentDrop,
    computeWorktreeDrop,
    computeWorktreeStatusDrop,
    getEligibleLineageDropTarget,
    onMoveWorktreesToStatusAtIndex,
    onReorderWorktrees,
    refreshWorktreeDragSession,
    scrollRef,
    worktreeDragGroups,
    worktreeDragUnitGroups
  ])

  const handleDocumentDragEnd = useCallback(() => {
    if (worktreeDragSessionRef.current) {
      clearWorktreeDrag()
    }
  }, [clearWorktreeDrag])

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState !== 'visible' && worktreeDragSessionRef.current) {
      clearWorktreeDrag()
    }
  }, [clearWorktreeDrag])

  useWorktreeListNativeDocument({
    onDocumentDrop: handleDocumentDrop,
    onDocumentDragEnd: handleDocumentDragEnd,
    onVisibilityChange: handleVisibilityChange
  })

  // Why: expand here (not the shared hook, used by the flat board) so a dropped parent carries its lineage children (#9083).
  const moveWorktreesToStatusForDocumentDrop = useCallback(
    (ids: readonly string[], status: WorkspaceStatus) =>
      onMoveWorktreesToStatus(getReorderDraggedIds(ids), status),
    [getReorderDraggedIds, onMoveWorktreesToStatus]
  )

  useWorkspaceStatusDocumentDrop(
    scrollRef,
    onMoveWorktreeToStatus,
    onPinWorktree,
    handleWorkspaceStatusDragFinish,
    hasWorkspaceDropTargets,
    {
      onMoveWorktreesToStatus: moveWorktreesToStatusForDocumentDrop,
      onPinWorktrees
    }
  )

  return (
    <div
      data-worktree-sidebar-container
      data-contextual-tour-target="workspace-list"
      className="relative min-h-0 flex-1"
    >
      <div
        ref={setScrollRootRef}
        data-worktree-sidebar
        tabIndex={0}
        role="listbox"
        aria-label={translate('auto.components.sidebar.WorktreeList.bfbedc547b', 'Worktrees')}
        aria-orientation="vertical"
        aria-multiselectable="true"
        aria-activedescendant={activeDescendantId}
        onKeyDown={handleContainerKeyDown}
        // Why: trackpad momentum fires sparse scroll events after the input stream quiets; suppress correction until the viewport stops.
        onScroll={handleScroll}
        onPointerDown={handleScrollPointerDown}
        onTouchMove={markDirectScrollInput}
        onWheel={markDirectScrollInput}
        onDragOver={handleWorktreeDragOver}
        onDrop={handleWorktreeDrop}
        className="worktree-sidebar-scrollbar h-full overflow-y-auto overflow-x-hidden pl-1 scrollbar-sleek outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset pt-px"
        style={WORKTREE_SIDEBAR_SCROLL_STYLE}
      >
        <div
          role="presentation"
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {canReorderRepoHeaders &&
          repoDrag.state.draggingRepoId !== null &&
          repoDrag.state.dropIndicatorY !== null ? (
            <WorktreeSidebarDropIndicator y={repoDrag.state.dropIndicatorY} />
          ) : null}
          {canReorderProjectGroupHeaders &&
          projectGroupDrag.state.draggingGroupId !== null &&
          projectGroupDrag.state.dropIndicatorY !== null ? (
            <WorktreeSidebarDropIndicator y={projectGroupDrag.state.dropIndicatorY} />
          ) : null}
          {hostDrag.state.draggingHostId !== null && hostDrag.state.dropIndicatorY !== null ? (
            <WorktreeSidebarDropIndicator y={hostDrag.state.dropIndicatorY} className="z-40" />
          ) : null}
          {worktreeDragState.draggingWorktreeId !== null &&
          worktreeDragState.dropIndicatorY !== null ? (
            <WorktreeSidebarDropIndicator y={worktreeDragState.dropIndicatorY} />
          ) : null}
          {virtualItems.map((vItem) => {
            const row = renderRows[vItem.index]
            if (!row) {
              return null
            }

            if (row.type === 'host-header') {
              // Why: the host card is the outer tier; it pins above group headers (z-30 vs z-20) and stays put as they hand off.
              const isActiveStickyHost = activeStickyHostIndexRef.current === vItem.index
              const hasHeaderTopSpacing = shouldUseHeaderTopSpacing({
                rows: renderRows,
                index: vItem.index,
                firstHeaderIndex
              })
              return (
                <div
                  key={vItem.key}
                  role="presentation"
                  data-worktree-virtual-row
                  data-worktree-virtual-row-key={String(vItem.key)}
                  data-worktree-sticky-header=""
                  data-worktree-sticky-header-active={isActiveStickyHost ? '' : undefined}
                  data-index={vItem.index}
                  ref={measureVirtualRowElement}
                  className={cn(
                    'left-0 right-0',
                    hasHeaderTopSpacing && !isActiveStickyHost && 'pt-1',
                    isActiveStickyHost
                      ? 'sticky -top-px z-30 bg-worktree-sidebar'
                      : 'absolute top-0'
                  )}
                  style={
                    isActiveStickyHost
                      ? undefined
                      : { transform: getVirtualRowTransform(vItem.start) }
                  }
                >
                  <HostSectionHeader
                    row={row}
                    onToggle={() => toggleGroupWithScrollAnchor(row.key)}
                    onDragPointerDown={
                      orderedHostIds.length > 1
                        ? (e) => hostDrag.onHandlePointerDown(e, row.hostId)
                        : undefined
                    }
                    dragging={hostDrag.state.draggingHostId === row.hostId}
                  />
                </div>
              )
            }

            if (row.type === 'header') {
              const isActiveStickyHeader = activeStickyHeaderIndexRef.current === vItem.index
              const stickyTopClass =
                activeStickyHostIndexRef.current !== null ? 'top-[35px]' : '-top-px'
              const hasHeaderTopSpacing = shouldUseHeaderTopSpacing({
                rows: renderRows,
                index: vItem.index,
                firstHeaderIndex
              })
              const isRepoHeader = groupBy === 'repo' && row.repo !== undefined
              const isProjectGroupHeader = groupBy === 'repo' && row.projectGroup !== undefined
              const projectIdForHeader = isRepoHeader ? row.repo!.id : undefined
              const projectGroupIdForHeader =
                isProjectGroupHeader && !row.repo && typeof row.projectGroup?.id === 'string'
                  ? row.projectGroup.id
                  : undefined
              const repoHeaderIndex =
                projectIdForHeader !== undefined
                  ? repoHeaderIndexByRepoId.get(projectIdForHeader)
                  : undefined
              const repoHeaderBucketKey =
                projectIdForHeader !== undefined
                  ? repoHeaderBucketByRepoId.get(projectIdForHeader)
                  : undefined
              const projectGroupHeaderIndex =
                projectGroupIdForHeader !== undefined
                  ? projectGroupHeaderIndexByGroupId.get(projectGroupIdForHeader)
                  : undefined
              const projectGroupHeaderBucketKey =
                projectGroupIdForHeader !== undefined
                  ? projectGroupHeaderBucketByGroupId.get(projectGroupIdForHeader)
                  : undefined
              const isDraggableRepoHeader = Boolean(
                canReorderRepoHeaders &&
                isRepoHeader &&
                projectIdForHeader &&
                repoHeaderBucketKey &&
                (sidebarRepoHeaderIdsByBucket.get(repoHeaderBucketKey)?.length ?? 0) > 1
              )
              const isDraggableProjectGroupHeader = Boolean(
                canReorderProjectGroupHeaders &&
                projectGroupIdForHeader &&
                projectGroupHeaderBucketKey &&
                (sidebarProjectGroupHeaderIdsByBucket.get(projectGroupHeaderBucketKey)?.length ??
                  0) > 1
              )
              const isDraggingThis =
                canReorderRepoHeaders &&
                repoDrag.state.draggingRepoId !== null &&
                repoDrag.state.draggingRepoId === projectIdForHeader
              const isDraggingThisProjectGroup =
                canReorderProjectGroupHeaders &&
                projectGroupDrag.state.draggingGroupId !== null &&
                projectGroupDrag.state.draggingGroupId === projectGroupIdForHeader
              const headerWorkspaceStatus =
                groupBy === 'workspace-status'
                  ? getWorkspaceStatusFromGroupKey(row.key, workspaceStatuses)
                  : null
              const isPinnedHeader = row.key === PINNED_GROUP_KEY
              const repoHeaderColor = resolveProjectGroupHeaderColor({
                groupBy,
                headerKey: row.key,
                badgeColor: row.repo?.badgeColor
              })
              const createState = row.repo
                ? getRepoHeaderCreateState({
                    repo: row.repo,
                    label: row.label,
                    sshStatus: row.repo.connectionId
                      ? (sshConnectionStates.get(row.repo.connectionId)?.status ?? null)
                      : null
                  })
                : null
              const projectGroupPathStatus =
                isProjectGroupHeader &&
                row.projectGroup &&
                'parentPath' in row.projectGroup &&
                row.projectGroup.parentPath
                  ? getCachedFolderWorkspacePathStatus({
                      scope: 'project-group',
                      projectGroupId: row.projectGroup.id
                    })
                  : null
              const folderWorkspaceCreateDisabled =
                projectGroupPathStatus?.exists === false &&
                (isConfirmedStaleFolderPathStatus(projectGroupPathStatus) ||
                  projectGroupPathStatus.reason === 'ambiguous-connection')
              const projectGroupDepth = row.projectGroupDepth ?? 0
              const isHeaderCollapsed = collapsedGroups.has(row.key)
              const showHeaderCollapseAffordance =
                row.count > 0 &&
                (isRepoHeader || isProjectGroupHeader || headerWorkspaceStatus !== null)
              const headerPaddingLeft =
                isRepoHeader || isProjectGroupHeader
                  ? getProjectGroupHeaderPaddingLeft(projectGroupDepth)
                  : WORKTREE_SECTION_HEADER_PADDING_LEFT
              return (
                <WorktreeListHeaderRow
                  key={vItem.key}
                  row={row}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  isActiveStickyHeader={isActiveStickyHeader}
                  stickyTopClass={stickyTopClass}
                  hasHeaderTopSpacing={hasHeaderTopSpacing}
                  isDraggableRepoHeader={isDraggableRepoHeader}
                  isDraggableProjectGroupHeader={isDraggableProjectGroupHeader}
                  isDraggingThis={isDraggingThis}
                  isDraggingThisProjectGroup={isDraggingThisProjectGroup}
                  headerWorkspaceStatus={headerWorkspaceStatus}
                  isPinnedHeader={isPinnedHeader}
                  repoHeaderColor={repoHeaderColor}
                  projectGroupPathStatus={projectGroupPathStatus}
                  folderWorkspaceCreateDisabled={folderWorkspaceCreateDisabled}
                  isHeaderCollapsed={isHeaderCollapsed}
                  showHeaderCollapseAffordance={showHeaderCollapseAffordance}
                  headerPaddingLeft={headerPaddingLeft}
                  projectIdForHeader={projectIdForHeader}
                  projectGroupIdForHeader={projectGroupIdForHeader}
                  repoHeaderIndex={repoHeaderIndex}
                  repoHeaderBucketKey={repoHeaderBucketKey}
                  projectGroupHeaderIndex={projectGroupHeaderIndex}
                  projectGroupHeaderBucketKey={projectGroupHeaderBucketKey}
                  repoHeaderSectionEnd={
                    projectIdForHeader
                      ? repoHeaderSectionEndByRepoId.get(projectIdForHeader)
                      : undefined
                  }
                  projectGroupHeaderSectionEnd={
                    projectGroupIdForHeader
                      ? projectGroupHeaderSectionEndByGroupId.get(projectGroupIdForHeader)
                      : undefined
                  }
                  highlighted={highlightedRevealRowKey === row.key}
                  pinDragOver={pinDragOver}
                  dragOverStatus={dragOverStatus}
                  toggleGroup={() => toggleGroupWithScrollAnchor(row.key)}
                  onRepoHeaderPointerDown={
                    isDraggableRepoHeader && projectIdForHeader
                      ? (event) => repoDrag.onHandlePointerDown(event, projectIdForHeader)
                      : undefined
                  }
                  onProjectGroupHeaderPointerDown={
                    isDraggableProjectGroupHeader && projectGroupIdForHeader
                      ? (event) =>
                          projectGroupDrag.onHandlePointerDown(event, projectGroupIdForHeader)
                      : undefined
                  }
                  onDragOver={
                    isPinnedHeader
                      ? handleWorkspacePinDragOver
                      : headerWorkspaceStatus
                        ? (event) => handleWorkspaceStatusDragOver(event, headerWorkspaceStatus)
                        : undefined
                  }
                  onDragLeave={
                    isPinnedHeader
                      ? handleWorkspacePinDragLeave
                      : headerWorkspaceStatus
                        ? handleWorkspaceStatusDragLeave
                        : undefined
                  }
                  onDrop={
                    headerWorkspaceStatus
                      ? (event) => handleWorkspaceStatusDrop(event, headerWorkspaceStatus)
                      : undefined
                  }
                  onCollapseAffordancePointerDown={handleRepoHeaderCollapseAffordancePointerDown}
                  onIgnoreToggle={shouldIgnoreRepoHeaderToggle}
                  headerActions={{
                    row,
                    groupBy,
                    projectGroups,
                    createState,
                    folderWorkspaceCreateDisabled,
                    projectGroupPathStatus,
                    handleOpenRepoSettings,
                    handleOpenWorktreeVisibility,
                    handleCreateGroupFromRepo,
                    handleMoveProjectToGroup,
                    handleRemoveProjectFromGroup,
                    handleRemoveProject,
                    handleCreateForRepo,
                    handleCreateFolderWorkspace,
                    handleRenameProjectGroup,
                    handleDeleteProjectGroup,
                    canShowFolderWorkspaceCreate:
                      isProjectGroupHeader &&
                      !row.repo &&
                      Boolean(
                        row.projectGroup &&
                        'parentPath' in row.projectGroup &&
                        row.projectGroup.parentPath
                      ),
                    stopRepoHeaderKeyboardToggle,
                    handleRepoHeaderActionPointerDown,
                    stopRepoHeaderMenuEvent
                  }}
                />
              )
            }

            const renderWorktreeRow = (
              itemRow: WorktreeItemRow,
              nested: boolean,
              lineageChildren?: React.ReactNode,
              forceActiveSurface = false
            ): React.ReactNode => (
              <WorktreeListCardRow
                itemRow={itemRow}
                nested={nested}
                lineageChildren={lineageChildren}
                forceActiveSurface={forceActiveSurface}
                groupBy={groupBy}
                activeWorktreeId={activeWorktreeId}
                currentWorktreeId={currentWorktreeId}
                selectedWorktreeIds={selectedWorktreeIds}
                selectedWorktrees={selectedWorktrees}
                agentSendTargetWorktreeId={agentSendTargetWorktreeId}
                highlightedRevealRowKey={highlightedRevealRowKey}
                folderBackedProjectGroupIds={folderBackedProjectGroupIds}
                experimentalNewWorktreeCardStyle={
                  settings?.experimentalNewWorktreeCardStyle === true
                }
                worktreeDragState={worktreeDragState}
                worktreeDragGroupKey={groupKeyByRowKey.get(itemRow.rowKey)}
                worktreeDragGroupIndex={groupIndexByRowKey.get(itemRow.rowKey)}
                nativeLineageDropTargetId={nativeLineageDropTargetId}
                getActiveSurfaceVariant={getActiveSurfaceVariant}
                getLineageNestedRowGeometry={getLineageNestedRowGeometry}
                getWorktreeCardContentIndent={getWorktreeCardContentIndent}
                getFolderBackedRepoWorktreeCardContentIndent={
                  getFolderBackedRepoWorktreeCardContentIndent
                }
                getWorktreeCardSurfaceInset={getWorktreeCardSurfaceInset}
                getFolderBackedRepoWorktreeCardSurfaceInset={
                  getFolderBackedRepoWorktreeCardSurfaceInset
                }
                getLineageChildrenInlineStyle={getLineageChildrenInlineStyle}
                getLineageToggleHandler={getLineageToggleHandler}
                handleWorktreeRowClickCapture={handleWorktreeRowClickCapture}
                handleWorktreeRowPointerDown={handleWorktreeRowPointerDown}
                stopNestedWorktreeCardBubble={stopNestedWorktreeCardBubble}
                handleImmediateWorktreeRowActivate={handleImmediateWorktreeRowActivate}
                onSelectionGesture={onSelectionGesture}
                onContextMenuSelect={onContextMenuSelect}
                handleWorktreeCardDragStart={handleWorktreeCardDragStart}
                clearWorktreeDrag={clearWorktreeDrag}
              />
            )

            const renderLineageDescendants = (
              parent: WorktreeItemRow,
              descendants: readonly WorktreeItemRow[]
            ): React.ReactNode | undefined =>
              renderWorktreeLineageDescendants(
                parent,
                descendants,
                (child, childNested, children) => renderWorktreeRow(child, childNested, children)
              )

            if (row.type === 'lineage-group') {
              const [parent, ...children] = row.rows
              const childIsActive = children.some((child) => child.worktree.id === activeWorktreeId)
              const parentPreviewOffset = parent
                ? (worktreeDragState.previewOffsetsByWorktreeId.get(parent.worktree.id) ?? 0)
                : 0
              return (
                <WorktreeListContentRow
                  key={vItem.key}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  className={cn(
                    'absolute left-0 right-0 top-0',
                    worktreeDragState.draggingWorktreeId !== null &&
                      'transition-transform duration-150 ease-out will-change-transform'
                  )}
                  style={{
                    transform: getWorktreeVirtualRowTransform(vItem.start, parentPreviewOffset)
                  }}
                >
                  <div className="overflow-visible">
                    {parent
                      ? renderWorktreeRow(
                          parent,
                          false,
                          renderLineageDescendants(parent, children),
                          childIsActive
                        )
                      : null}
                  </div>
                </WorktreeListContentRow>
              )
            }

            if (row.type === 'imported-worktrees-card') {
              const actionState = importedWorktreeCardActionState.get(row.repo.id)
              return (
                <WorktreeListSpecialRow
                  key={vItem.key}
                  row={row}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  importedActionState={actionState}
                  canKeepImported={canKeepImportedWorktreesHidden(row, actionState)}
                  onShowImported={() => handleShowImportedWorktrees(row.repo.id)}
                  onKeepImported={() => handleKeepImportedWorktreesHidden(row.repo.id)}
                  onImportWorktree={() => {}}
                  onKeepInboxHidden={() => {}}
                  onImportAll={() => {}}
                  onSuppressInbox={() => {}}
                  toInboxPreview={toNewExternalWorktreeInboxPreview}
                />
              )
            }

            if (row.type === 'new-external-worktrees-inbox') {
              const actionState = newExternalWorktreeInboxActionState.get(row.repo.id)
              return (
                <WorktreeListSpecialRow
                  key={vItem.key}
                  row={row}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  inboxActionState={actionState}
                  canKeepImported={false}
                  onShowImported={() => {}}
                  onKeepImported={() => {}}
                  onImportWorktree={(worktreeId) =>
                    handleImportNewExternalWorktree(row.repo.id, worktreeId)
                  }
                  onKeepInboxHidden={() => handleKeepNewExternalWorktreeInboxHidden(row.repo.id)}
                  onImportAll={() => handleImportAllNewExternalWorktrees(row.repo.id)}
                  onSuppressInbox={() => handleOpenSuppressExternalWorktreeInbox(row.repo.id)}
                  toInboxPreview={toNewExternalWorktreeInboxPreview}
                />
              )
            }

            if (row.type === 'pending-creation') {
              return (
                <WorktreeListSpecialRow
                  key={vItem.key}
                  row={row}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  canKeepImported={false}
                  onShowImported={() => {}}
                  onKeepImported={() => {}}
                  onImportWorktree={() => {}}
                  onKeepInboxHidden={() => {}}
                  onImportAll={() => {}}
                  onSuppressInbox={() => {}}
                  toInboxPreview={toNewExternalWorktreeInboxPreview}
                />
              )
            }

            if (row.type === 'folder-workspace') {
              const folderWorktree = folderWorkspaceToWorktree(row.folderWorkspace)
              const folderWorkspacePathStatus = getCachedFolderWorkspacePathStatus({
                scope: 'folder-workspace',
                folderWorkspaceId: row.folderWorkspace.id
              })
              const folderWorkspaceActivationDisabled =
                folderWorkspacePathStatus?.exists === false &&
                (isConfirmedStaleFolderPathStatus(folderWorkspacePathStatus) ||
                  folderWorkspacePathStatus.reason === 'ambiguous-connection')
              const folderPrDisplay = getFolderWorkspaceCardPrDisplay({
                folderWorkspaceId: row.folderWorkspace.id,
                workspaceLineageByChildKey,
                worktreeLineageById,
                worktreeMap,
                repoMap,
                hostedReviewCache,
                prCache,
                settings
              })
              const isFolderBackedWorkspaceChild =
                groupBy === 'repo' && row.projectGroup.createdFrom === 'folder-scan'
              const { surfaceInset, cardContentIndent } = getFolderWorkspaceRowGeometry({
                experimentalNewWorktreeCardStyle: newCardStyle,
                isFolderBackedWorkspaceChild,
                isGrouped: groupBy !== 'none',
                groupDepth: row.groupDepth,
                lineageDepth: row.depth
              })
              return (
                <WorktreeListFolderRow
                  key={vItem.key}
                  row={row}
                  itemKey={vItem.key}
                  index={vItem.index}
                  start={vItem.start}
                  measureRef={measureVirtualRowElement}
                  folderWorktree={folderWorktree}
                  activeWorktreeId={activeWorktreeId}
                  currentWorktreeId={currentWorktreeId}
                  selectedWorktreeIds={selectedWorktreeIds}
                  surfaceInset={surfaceInset}
                  cardContentIndent={cardContentIndent}
                  pathStatus={folderWorkspacePathStatus}
                  activationDisabled={folderWorkspaceActivationDisabled}
                  prDisplay={folderPrDisplay}
                  onClickCapture={handleWorktreeRowClickCapture}
                  onPointerDown={(event) =>
                    handleWorktreeRowPointerDown(event, folderWorktree.id, folderWorktree.id)
                  }
                  onImmediateActivate={handleImmediateWorktreeRowActivate}
                  onSelectionGesture={onSelectionGesture}
                  onContextMenuSelect={onContextMenuSelect}
                />
              )
            }

            const itemWorkspaceStatus =
              groupBy === 'workspace-status'
                ? getWorkspaceStatus(row.worktree, workspaceStatuses)
                : null
            const itemPreviewOffset =
              worktreeDragState.previewOffsetsByWorktreeId.get(row.worktree.id) ?? 0

            return (
              <div
                key={vItem.key}
                role="presentation"
                data-worktree-virtual-row
                data-worktree-virtual-row-key={String(vItem.key)}
                data-worktree-virtual-row-start={vItem.start}
                data-index={vItem.index}
                ref={measureVirtualRowElement}
                data-workspace-status-drop-target={itemWorkspaceStatus ? '' : undefined}
                data-workspace-status={itemWorkspaceStatus ?? undefined}
                className={cn(
                  'absolute left-0 right-0 top-0',
                  worktreeDragState.draggingWorktreeId !== null &&
                    'transition-transform duration-150 ease-out will-change-transform'
                )}
                style={{
                  transform: getWorktreeVirtualRowTransform(vItem.start, itemPreviewOffset)
                }}
                onDragOver={
                  itemWorkspaceStatus
                    ? (event) => handleWorkspaceStatusDragOver(event, itemWorkspaceStatus)
                    : undefined
                }
                onDragLeave={itemWorkspaceStatus ? handleWorkspaceStatusDragLeave : undefined}
                onDrop={
                  itemWorkspaceStatus
                    ? (event) => handleWorkspaceStatusDrop(event, itemWorkspaceStatus)
                    : undefined
                }
              >
                {renderWorktreeRow(row, false)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
})

type WorktreeListProps = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
  workspaceBoardOpen?: boolean
  onWorkspaceBoardDragPreviewStart?: () => void
  onWorkspaceBoardDragPreviewCommit?: () => void
  onWorkspaceBoardDragPreviewCancel?: () => void
}

export function installWorktreeVisibleRefreshVisibilityListener(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const WorktreeList = React.memo(function WorktreeList({
  scrollOffsetRef,
  scrollAnchorRef,
  workspaceBoardOpen = false,
  onWorkspaceBoardDragPreviewStart = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCommit = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK,
  onWorkspaceBoardDragPreviewCancel = NOOP_WORKSPACE_BOARD_DRAG_PREVIEW_CALLBACK
}: WorktreeListProps) {
  // ── Granular selectors (each is a primitive or shallow-stable ref) ──
  const allWorktrees = useAllWorktrees()
  const repoMap = useRepoMap()
  const worktreeMap = useWorktreeMap()
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const workspaceLineageByChildKey = useAppStore((s) => s.workspaceLineageByChildKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const detectedWorktreesByRepo = useAppStore((s) => s.detectedWorktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const currentSidebarWorktreeId = useMemo(
    () => getActiveSidebarWorkspaceId(activeWorkspaceKey, activeWorktreeId),
    [activeWorkspaceKey, activeWorktreeId]
  )
  const groupBy = useAppStore((s) => s.groupBy)
  const setGroupBy = useAppStore((s) => s.setGroupBy)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const visibleWorkspaceHostIds = useAppStore((s) => s.visibleWorkspaceHostIds)
  const workspaceHostOrder = useAppStore((s) => s.workspaceHostOrder)
  const setWorkspaceHostOrder = useAppStore((s) => s.setWorkspaceHostOrder)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const agentStatusEpoch = useAppStore((s) => (!showSleepingWorkspaces ? s.agentStatusEpoch : 0))
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const hideCliCreatedWorkspaces = useAppStore((s) => s.hideCliCreatedWorkspaces)
  const hideDetachedHeadWorkspaces = useAppStore((s) => s.hideDetachedHeadWorkspaces)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const updateWorktreesMeta = useAppStore((s) => s.updateWorktreesMeta)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const activeView = useAppStore((s) => s.activeView)
  const activeModal = useAppStore((s) => s.activeModal)
  const pendingRevealWorktree = useAppStore((s) => s.pendingRevealWorktree)
  const pendingRevealSidebarRow = useAppStore((s) => s.pendingRevealSidebarRow)
  const revealWorktreeInSidebar = useAppStore((s) => s.revealWorktreeInSidebar)
  const revealSidebarRow = useAppStore((s) => s.revealSidebarRow)
  const setWorktreesPinnedAndReveal = useAppStore((s) => s.setWorktreesPinnedAndReveal)
  const clearPendingRevealWorktreeId = useAppStore((s) => s.clearPendingRevealWorktreeId)
  const clearPendingRevealSidebarRow = useAppStore((s) => s.clearPendingRevealSidebarRow)
  const agentSendPopoverTargetMode = useAppStore((s) => s.agentSendPopoverTargetMode)
  // Why: eligibility only matters while the picker is open; when closed, don't subscribe to wake-time layout churn.
  const agentTargetStatusByPaneKey = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.agentStatusByPaneKey : EMPTY_AGENT_STATUS_BY_PANE_KEY
  )
  const agentTargetStatusEpoch = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.agentStatusEpoch : 0
  )
  const agentTargetTabsByWorktree = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.tabsByWorktree : EMPTY_TABS_BY_WORKTREE
  )
  const agentTargetTerminalLayoutsByTabId = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.terminalLayoutsByTabId : EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID
  )
  const agentTargetPtyIdsByTabId = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.ptyIdsByTabId : EMPTY_PTY_IDS_BY_TAB_ID
  )
  const agentTargetRuntimePaneTitlesByTabId = useAppStore((s) =>
    agentSendPopoverTargetMode ? s.runtimePaneTitlesByTabId : EMPTY_RUNTIME_PANE_TITLES_BY_TAB_ID
  )
  const agentSendTargetWorktreeId = useMemo(() => {
    void agentTargetStatusEpoch
    if (!agentSendPopoverTargetMode) {
      return null
    }
    const targets = deriveRunningAgentSendTargets(
      {
        agentStatusByPaneKey: agentTargetStatusByPaneKey,
        tabsByWorktree: agentTargetTabsByWorktree,
        terminalLayoutsByTabId: agentTargetTerminalLayoutsByTabId,
        ptyIdsByTabId: agentTargetPtyIdsByTabId,
        runtimePaneTitlesByTabId: agentTargetRuntimePaneTitlesByTabId
      },
      agentSendPopoverTargetMode.worktreeId
    )
    return targets.some((target) => target.status === 'eligible')
      ? agentSendPopoverTargetMode.worktreeId
      : null
  }, [
    // Why: eligibility can flip when the stale-boundary scheduler bumps this epoch without replacing the status map.
    agentTargetStatusEpoch,
    agentSendPopoverTargetMode,
    agentTargetStatusByPaneKey,
    agentTargetTabsByWorktree,
    agentTargetTerminalLayoutsByTabId,
    agentTargetPtyIdsByTabId,
    agentTargetRuntimePaneTitlesByTabId
  ])

  // Read tabsByWorktree when needed for filtering or sorting
  const needsActivityMaps = !showSleepingWorkspaces || sortBy === 'smart'
  const tabsByWorktree = useAppStore((s) =>
    needsActivityMaps ? getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree) : null
  )
  const ptyIdsByTabId = useAppStore((s) => (needsActivityMaps ? s.ptyIdsByTabId : null))
  const browserTabsByWorktree = useAppStore((s) =>
    !showSleepingWorkspaces ? getVisibleWorktreeBrowserActivityTabs(s.browserTabsByWorktree) : null
  )

  const cardProps = useAppStore((s) => s.worktreeCardProperties)

  const { prCache, hostedReviewCache } = useAppStore(
    useShallow((s) => selectWorktreeListReviewCacheInputs(s, groupBy, cardProps))
  )
  const settings = useAppStore((s) => s.settings)
  const pinnedDisplayPolicy = getPinnedWorktreeDisplayPolicy(settings)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)

  const sortEpoch = useAppStore((s) => s.sortEpoch)

  // Non-archived count — detects structural changes (add/remove) so the debounce below can apply immediately.
  const worktreeCount = useMemo(() => {
    let count = 0
    for (const worktree of allWorktrees) {
      if (!worktree.isArchived) {
        count++
      }
    }
    return count
  }, [allWorktrees])

  // Why debounce: scores are time-decaying, so recomputing on every sortEpoch bump makes worktrees jump; settle to coalesce.
  // Structural changes (add/remove) bypass the debounce so a new worktree appears at its sorted position immediately.
  const [debouncedSortEpoch, setDebouncedSortEpoch] = useState(sortEpoch)
  const prevWorktreeCountRef = useRef(worktreeCount)
  useEffect(() => {
    if (debouncedSortEpoch === sortEpoch) {
      return
    }

    const structuralChange = worktreeCount !== prevWorktreeCountRef.current
    prevWorktreeCountRef.current = worktreeCount

    // Why: manual drag/drop is direct manipulation; the settle-window delay would make a successful drop look broken.
    if (structuralChange || sortBy === 'manual') {
      setDebouncedSortEpoch(sortEpoch)
      return
    }

    const timer = setTimeout(() => setDebouncedSortEpoch(sortEpoch), SORT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [sortEpoch, debouncedSortEpoch, worktreeCount, sortBy])

  // Why a latching ref: a live signal makes Smart authoritative for the session, even after that activity ends.
  const sessionHasHadLiveSmartSignal = useRef(false)

  // ── Stable sort order ──────────────────────────────────────────
  // Why sortEpoch (not selection): selection side-effects (clearing isUnread, PR-cache refresh) must not reorder the sidebar under the user.
  // Why useMemo not useEffect: order must be computed synchronously before the worktrees memo reads it.
  const sortedIds = useMemo(() => {
    const state = useAppStore.getState()
    const nonArchivedWorktrees = getAllWorktreesFromState(state).filter(
      (worktree) => !worktree.isArchived
    )
    const now = Date.now()

    // Why cold-start detection: agent-status hydrates async, so the warm comparator would collapse all to Class 4; keep the persisted order until a live signal appears.
    if (sortBy === 'smart' && !sessionHasHadLiveSmartSignal.current) {
      // Why tabHasLivePty over tab.ptyId: slept terminals keep tab.ptyId as a wake hint, so it'd falsely keep cold-start ordering off.
      const hasAnyLivePty = Object.values(state.tabsByWorktree)
        .flat()
        .some((tab) => tabHasLivePty(state.ptyIdsByTabId, tab.id))
      if (
        hasAnyLivePty ||
        hasFreshAttributedAgentStatus(state.agentStatusByPaneKey, now, state.tabsByWorktree)
      ) {
        sessionHasHadLiveSmartSignal.current = true
      } else {
        nonArchivedWorktrees.sort(
          (a, b) => b.sortOrder - a.sortOrder || compareWorktreeSortLabel(a, b)
        )
        return nonArchivedWorktrees.map((w) => w.id)
      }
    }

    const currentTabs = state.tabsByWorktree
    // Why precompute: hot sort — build the attention map once so the O(N log N) comparator does O(1) lookups.
    const attentionByWorktree =
      sortBy === 'smart'
        ? buildAttentionByWorktree(
            nonArchivedWorktrees,
            currentTabs,
            state.agentStatusByPaneKey,
            state.runtimePaneTitlesByTabId,
            state.ptyIdsByTabId,
            now,
            state.migrationUnsupportedByPtyId,
            state.terminalLayoutsByTabId
          )
        : new Map<string, WorktreeAttention>()
    nonArchivedWorktrees.sort(buildWorktreeComparator(sortBy, repoMap, now, attentionByWorktree))
    return nonArchivedWorktrees.map((w) => w.id)
    // debouncedSortEpoch is an intentional trigger not read in the memo; its change (debounced) signals a recompute.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSortEpoch, repoMap, sortBy])

  // Why: only persist during live sessions so cold start reads the persisted order instead of overwriting it.
  useEffect(() => {
    if (sortBy !== 'smart' || sortedIds.length === 0 || !sessionHasHadLiveSmartSignal.current) {
      return
    }
    // Why: sortOrder lives in each host's worktreeMeta, so persist each host's ids on that host.
    const state = useAppStore.getState()
    persistWorktreeSortOrderByHost(state, sortedIds)
  }, [sortedIds, sortBy])

  // Flatten/filter/sort via the shared utility so card order matches Cmd+1–9 numbering.
  const recomputedVisibleWorktrees = useMemo(() => {
    void agentStatusEpoch
    const ids = computeVisibleWorktreeIds(worktreesByRepo, sortedIds, {
      filterRepoIds,
      showSleepingWorkspaces,
      tabsByWorktree,
      ptyIdsByTabId,
      browserTabsByWorktree,
      // Why snapshot on agentStatusEpoch: update membership immediately without repainting on every hook ping.
      worktreeIdsWithLiveAgent: showSleepingWorkspaces
        ? EMPTY_WORKTREE_ID_SET
        : getWorktreeIdsWithLiveAgent(
            useAppStore.getState().agentStatusByPaneKey,
            tabsByWorktree,
            Date.now()
          ),
      hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces,
      repoMap,
      workspaceHostScope,
      visibleWorkspaceHostIds,
      defaultHostId: getSettingsFocusedExecutionHostId(settings),
      worktreeLineageById,
      forcedVisibleWorktreeIds: agentSendTargetWorktreeId ? [agentSendTargetWorktreeId] : undefined
    })
    return ids.map((id) => worktreeMap.get(id)).filter((w): w is Worktree => w != null)
  }, [
    agentSendTargetWorktreeId,
    agentStatusEpoch,
    filterRepoIds,
    showSleepingWorkspaces,
    hideDefaultBranchWorkspace,
    hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces,
    hideDetachedHeadWorkspaces,
    workspaceHostScope,
    visibleWorkspaceHostIds,
    settings,
    repoMap,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    sortedIds,
    worktreeMap,
    worktreeLineageById,
    worktreesByRepo
  ])
  // Why: agentStatusEpoch bumps recompute this memo even when membership and
  // order are unchanged; keeping the previous identity stops the whole
  // rows/sectionRows/renderedWorktrees chain from churning per epoch.
  const visibleWorktrees = useReusedArrayIdentity(recomputedVisibleWorktrees)

  const worktrees = visibleWorktrees
  const collapsedGroups = useAppStore((s) => s.collapsedGroups)
  const toggleGroup = useAppStore((s) => s.toggleCollapsedGroup)

  // Why: manual header order is bound to state.repos; Recent/Smart derive order from the sorted worktree stream.
  const repos = useAppStore((s) => s.repos)
  const projectHostSetupProjection = useProjectHostSetupProjection()
  const projectGrouping = useMemo(
    () => ({
      projects: projectHostSetupProjection.projects,
      projectHostSetups: projectHostSetupProjection.setups
    }),
    [projectHostSetupProjection]
  )
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const effectiveCollapsedGroups = useMemo(() => {
    if (!agentSendTargetWorktreeId) {
      return collapsedGroups
    }
    const targetWorktree = worktreeMap.get(agentSendTargetWorktreeId)
    if (!targetWorktree) {
      return collapsedGroups
    }
    const next = new Set(collapsedGroups)
    if (targetWorktree.isPinned) {
      next.delete(PINNED_GROUP_KEY)
    } else {
      for (const groupKey of getGroupKeysForWorktree(
        groupBy,
        targetWorktree,
        repoMap,
        prCache,
        workspaceStatuses,
        settings,
        projectGroups,
        projectGrouping
      )) {
        next.delete(groupKey)
      }
    }

    for (const parent of getWorktreeLineageAncestors(
      targetWorktree,
      worktreeLineageById,
      worktreeMap
    )) {
      next.delete(getLineageGroupKey(parent.id))
    }
    return next
  }, [
    agentSendTargetWorktreeId,
    collapsedGroups,
    groupBy,
    prCache,
    projectGroups,
    projectGrouping,
    repoMap,
    settings,
    workspaceStatuses,
    worktreeLineageById,
    worktreeMap
  ])
  const defaultHostId = getSettingsFocusedExecutionHostId(settings)
  const visibleHostIdSet = useMemo(
    () => getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope),
    [visibleWorkspaceHostIds, workspaceHostScope]
  )
  const visibleReposForRows = useMemo(() => {
    if (!visibleHostIdSet) {
      return repos
    }
    return repos.filter((repo) => {
      const hostId =
        repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }, [defaultHostId, repos, visibleHostIdSet])
  const visibleProjectGroupsForRows = useMemo(
    () => filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
    [defaultHostId, projectGroups, visibleHostIdSet]
  )
  const visibleFolderWorkspacesForRows = useMemo(
    () =>
      filterFolderWorkspacesForVisibleHosts(
        folderWorkspaces,
        projectGroups,
        visibleHostIdSet,
        defaultHostId
      ),
    [defaultHostId, folderWorkspaces, projectGroups, visibleHostIdSet]
  )
  const repoOrder = useMemo(() => {
    return getLogicalRepoOrderRankById(repos.map((repo) => repo.id))
  }, [repos])
  const [importedWorktreeCardActionState, setImportedWorktreeCardActionState] = useState<
    Map<string, ImportedWorktreeCardActionState>
  >(new Map())
  const [newExternalWorktreeInboxActionState, setNewExternalWorktreeInboxActionState] = useState<
    Map<string, NewExternalWorktreesInboxActionState>
  >(new Map())
  const [suppressExternalWorktreeInboxRepoId, setSuppressExternalWorktreeInboxRepoId] = useState<
    string | null
  >(null)
  const importedWorktreesByRepo = useMemo(() => {
    const forceVisibleRepoIds = new Set(
      [...importedWorktreeCardActionState.entries()]
        .filter(([, state]) => state.forceVisible)
        .map(([repoId]) => repoId)
    )
    return buildImportedWorktreesCardCandidates({
      repos: visibleReposForRows,
      detectedWorktreesByRepo,
      filterRepoIds,
      forceVisibleRepoIds
    })
  }, [detectedWorktreesByRepo, filterRepoIds, importedWorktreeCardActionState, visibleReposForRows])
  const newExternalWorktreesInboxByRepo = useMemo(
    () =>
      buildNewExternalWorktreesInboxCandidates({
        repos: visibleReposForRows,
        detectedWorktreesByRepo,
        filterRepoIds
      }),
    [detectedWorktreesByRepo, filterRepoIds, visibleReposForRows]
  )
  const placeholderRepoIds = useMemo(() => {
    return getEmptyProjectPlaceholderRepoIds({
      groupBy,
      repos: visibleReposForRows,
      worktreesByRepo,
      visibleWorktrees,
      filterRepoIds
    })
  }, [filterRepoIds, groupBy, visibleReposForRows, visibleWorktrees, worktreesByRepo])
  const allRepoIds = useMemo(() => repos.map((r) => r.id), [repos])

  // Why: subscribe on a flat key array (useShallow) so progress ticks don't rebuild the whole row model.
  // Split on first space — creationId is a UUID (no space) so a space-containing repoId stays intact.
  const pendingCreationKeys = useAppStore(
    useShallow((s) =>
      Object.values(s.pendingWorktreeCreations ?? {}).map(
        (creation) => `${creation.creationId} ${creation.request.repoId}`
      )
    )
  )
  const pendingCreations = useMemo(
    () =>
      pendingCreationKeys.map((key) => {
        const separator = key.indexOf(' ')
        return { creationId: key.slice(0, separator), repoId: key.slice(separator + 1) }
      }),
    [pendingCreationKeys]
  )
  const hostLabelOverrides = useMemo(() => getHostDisplayLabelOverrides(settings), [settings])
  const hostOptions = useMemo(
    () =>
      buildSidebarHostOptions({
        repos,
        sshTargetLabels,
        sshConnectionStates,
        settings,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides
      }),
    [
      repos,
      sshTargetLabels,
      sshConnectionStates,
      settings,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId,
      hostLabelOverrides
    ]
  )
  const hostLabelById = useMemo(
    () => new Map(hostOptions.map((host) => [host.id, host.label])),
    [hostOptions]
  )

  const rows: Row[] = useMemo(
    () =>
      buildRows(
        groupBy,
        worktrees,
        repoMap,
        prCache,
        effectiveCollapsedGroups,
        repoOrder,
        workspaceStatuses,
        projectOrderBy,
        worktreeLineageById,
        worktreeMap,
        true,
        settings,
        visibleProjectGroupsForRows,
        placeholderRepoIds,
        importedWorktreesByRepo,
        newExternalWorktreesInboxByRepo,
        pendingCreations,
        projectGrouping,
        visibleFolderWorkspacesForRows,
        hostLabelById,
        defaultHostId,
        pinnedDisplayPolicy
      ),
    [
      groupBy,
      worktrees,
      repoMap,
      prCache,
      effectiveCollapsedGroups,
      defaultHostId,
      repoOrder,
      workspaceStatuses,
      projectOrderBy,
      worktreeLineageById,
      worktreeMap,
      settings,
      projectGrouping,
      visibleProjectGroupsForRows,
      visibleFolderWorkspacesForRows,
      placeholderRepoIds,
      importedWorktreesByRepo,
      newExternalWorktreesInboxByRepo,
      pendingCreations,
      hostLabelById,
      pinnedDisplayPolicy
    ]
  )
  const orderedHostOptions = useMemo(
    () => orderHostSectionOptions(hostOptions, workspaceHostOrder),
    [hostOptions, workspaceHostOrder]
  )
  const [hostDragActive, setHostDragActive] = useState(false)
  const handleReorderHostSections = useCallback(
    (orderedVisibleHostIds: ExecutionHostId[]) => {
      const visibleHostIds = new Set(orderedVisibleHostIds)
      const hostOptionIds = orderedHostOptions.map((host) => host.id)
      const knownHostIds = new Set(hostOptionIds)
      const nextOrder: ExecutionHostId[] = [...orderedVisibleHostIds]
      const seen = new Set(nextOrder)
      // Why: dragging only covers rendered hosts; keep non-rendered SSH/runtime hosts in the saved order so they return in place.
      for (const hostId of [...workspaceHostOrder, ...hostOptionIds]) {
        if (!knownHostIds.has(hostId) || visibleHostIds.has(hostId) || seen.has(hostId)) {
          continue
        }
        nextOrder.push(hostId)
        seen.add(hostId)
      }
      setWorkspaceHostOrder(nextOrder)
    },
    [orderedHostOptions, setWorkspaceHostOrder, workspaceHostOrder]
  )
  const sectionRows = useMemo(
    () =>
      addHostSectionRows({
        rows,
        hostOptions: orderedHostOptions,
        workspaceHostScope,
        visibleWorkspaceHostIds,
        defaultHostId,
        collapsedHostKeys: effectiveCollapsedGroups,
        forceCollapseHosts: hostDragActive,
        // Why: projects/workspaces are the primary sidebar object; host sections are only an explicit host-filter view.
        preferProjectGrouping: true
      }),
    [
      defaultHostId,
      effectiveCollapsedGroups,
      hostDragActive,
      orderedHostOptions,
      rows,
      visibleWorkspaceHostIds,
      workspaceHostScope
    ]
  )
  const renderedSidebarRowKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of sectionRows) {
      if (row.type === 'header') {
        keys.add(row.key)
      } else if (row.type === 'item') {
        keys.add(row.rowKey)
      } else if (row.type === 'folder-workspace') {
        keys.add(folderWorkspaceKey(row.folderWorkspace.id))
      } else if (row.type === 'pending-creation') {
        keys.add(`pending:${row.creationId}`)
      } else if (row.type === 'imported-worktrees-card') {
        keys.add(row.key)
      } else if (row.type === 'new-external-worktrees-inbox') {
        keys.add(row.key)
      }
    }
    return keys
  }, [sectionRows])
  // Why: status headers move during wake (inactive -> active); key only on grouping mode so row identity survives.
  const visibleHostResetKey = visibleWorkspaceHostIds?.join(',') ?? 'all'
  const viewportResetKey = `group:${groupBy}:host:${visibleHostResetKey}:lineage`

  // Why: derive order from the built rows, not the flat worktrees array, so Cmd+1–9 match visual positions when grouping reorders cards.
  const renderedWorktrees = useMemo(
    () => getRenderedWorktreesInSidebarOrder(sectionRows, pinnedDisplayPolicy),
    [pinnedDisplayPolicy, sectionRows]
  )
  // Why: order-preserving sectionRows rebuilds must not give this array a new
  // identity — updateSelectionForGesture depends on it, and a fresh identity
  // there defeats React.memo bail-out for every WorktreeCard on epoch bumps.
  const renderedWorktreeIds = useReusedArrayIdentity(
    useMemo(
      () => uniqueWorktreeIds(renderedWorktrees.map((worktree) => worktree.id)),
      [renderedWorktrees]
    )
  )
  const [selectedWorktreeIds, setSelectedWorktreeIds] = useState<Set<string>>(new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)

  const prunedSelection = pruneWorktreeSelection(
    selectedWorktreeIds,
    selectionAnchorId,
    renderedWorktreeIds
  )
  // Why: filters/grouping can hide selected cards; prune during render so nothing sees stale ids for unrendered worktrees.
  if (!areWorktreeSelectionsEqual(selectedWorktreeIds, prunedSelection.selectedIds)) {
    setSelectedWorktreeIds(prunedSelection.selectedIds)
  }
  if (selectionAnchorId !== prunedSelection.anchorId) {
    setSelectionAnchorId(prunedSelection.anchorId)
  }

  // Why identity reuse: the empty/unchanged-selection case must keep one array
  // identity — selectForContextMenu and both drag-start handlers depend on
  // this array, and card memo bail-out depends on those staying stable.
  const selectedWorktrees = useReusedArrayIdentity(
    useMemo(() => {
      if (selectedWorktreeIds.size === 0) {
        return []
      }
      const selected = new Map<string, Worktree>()
      for (const worktree of renderedWorktrees) {
        if (selectedWorktreeIds.has(worktree.id) && !selected.has(worktree.id)) {
          selected.set(worktree.id, worktree)
        }
      }
      return Array.from(selected.values())
    }, [renderedWorktrees, selectedWorktreeIds])
  )

  useEffect(() => {
    if (selectedWorktreeIds.size === 0) {
      return
    }

    const clearSelectionOutsideSidebar = (event: PointerEvent): void => {
      const target = event.target
      const sidebarContainer = document.querySelector('[data-worktree-sidebar-container]')
      if (target instanceof Node && sidebarContainer?.contains(target)) {
        return
      }
      setSelectedWorktreeIds(new Set())
      setSelectionAnchorId(null)
    }

    document.addEventListener('pointerdown', clearSelectionOutsideSidebar, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', clearSelectionOutsideSidebar, { capture: true })
    }
  }, [selectedWorktreeIds.size])

  const updateSelectionForGesture = useCallback(
    (event: React.MouseEvent<HTMLElement>, worktreeId: string): boolean => {
      const intent = getWorktreeSelectionIntent(event, navigator.userAgent.includes('Mac'))
      const result = updateWorktreeSelection({
        visibleIds: renderedWorktreeIds,
        previousSelectedIds: selectedWorktreeIds,
        previousAnchorId: selectionAnchorId,
        targetId: worktreeId,
        intent
      })
      setSelectedWorktreeIds(result.selectedIds)
      setSelectionAnchorId(result.anchorId)
      // Plain click navigates; modifier gestures are selection-only so a batch can build without switching away.
      return intent !== 'replace'
    },
    [renderedWorktreeIds, selectedWorktreeIds, selectionAnchorId]
  )

  const selectForContextMenu = useCallback(
    (_event: React.MouseEvent<HTMLElement>, worktree: Worktree): readonly Worktree[] => {
      if (selectedWorktreeIds.has(worktree.id) && selectedWorktreeIds.size > 1) {
        return selectedWorktrees
      }
      setSelectedWorktreeIds(new Set([worktree.id]))
      setSelectionAnchorId(worktree.id)
      return [worktree]
    },
    [selectedWorktreeIds, selectedWorktrees]
  )

  const handleImmediateWorktreeActivate = useCallback((worktreeId: string, rowKey?: string) => {
    // Why: re-rendering the virtualized sidebar on the pointer path adds visible latency; mutate the row directly and let store state reconcile after.
    markSidebarWorktreeActiveImmediately(worktreeId, rowKey)
  }, [])

  // Why: full-page nav views aren't scoped to a worktree, so no sidebar card should look selected.
  const selectedSidebarWorktreeId =
    activeView === 'tasks' || activeView === 'activity' ? null : currentSidebarWorktreeId

  // Why layout effect: the Cmd/Ctrl+1–9 handler can fire right after commit; publishing after paint would leave the shortcut cache stale.
  useLayoutEffect(() => {
    setVisibleWorktreeIds(renderedWorktreeIds)
    // Why null, not []: [] is a real rendered order (all collapsed/filtered); null tells shortcuts the list is unmounted.
    return () => setVisibleWorktreeIds(null)
  }, [renderedWorktreeIds])

  const handleCreateForRepo = useCallback(
    (projectId: string) => {
      openModal('new-workspace-composer', { initialRepoId: projectId })
    },
    [openModal]
  )

  const handleOpenRepoSettings = useCallback(
    (projectId: string, sectionId?: string) => {
      openSettingsTarget({ pane: 'repo', repoId: projectId, ...(sectionId ? { sectionId } : {}) })
      openSettingsPage()
    },
    [openSettingsPage, openSettingsTarget]
  )

  const handleOpenWorktreeVisibility = useCallback(
    (projectId: string) => {
      openModal('worktree-visibility', { repoId: projectId })
    },
    [openModal]
  )

  const setImportedWorktreeCardState = useCallback(
    (projectId: string, state: ImportedWorktreeCardActionState | null) => {
      setImportedWorktreeCardActionState((previous) => {
        const next = new Map(previous)
        if (state) {
          next.set(projectId, state)
        } else {
          next.delete(projectId)
        }
        return next
      })
    },
    []
  )

  const handleShowImportedWorktrees = useCallback(
    async (projectId: string) => {
      await showImportedWorktreesCard({
        projectId,
        forceVisible: importedWorktreeCardActionState.get(projectId)?.forceVisible === true,
        updateRepo,
        fetchWorktrees,
        setCardState: setImportedWorktreeCardState
      })
    },
    [fetchWorktrees, importedWorktreeCardActionState, setImportedWorktreeCardState, updateRepo]
  )

  const handleKeepImportedWorktreesHidden = useCallback(
    async (projectId: string) => {
      const repo = repos.find((candidate) => candidate.id === projectId)
      let detected = detectedWorktreesByRepo[projectId]
      // Why: baseline seeding needs authoritative hidden paths, so don't dismiss on a stale snapshot.
      if (detected?.authoritative !== true) {
        const refreshed = await fetchWorktrees(projectId, { requireAuthoritative: true })
        if (!refreshed) {
          setImportedWorktreeCardState(projectId, {
            pending: false,
            error: IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR
          })
          return
        }
        detected = useAppStore.getState().detectedWorktreesByRepo[projectId]
      }
      if (detected?.authoritative !== true) {
        setImportedWorktreeCardState(projectId, {
          pending: false,
          error: IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR
        })
        return
      }
      const hiddenWorktrees = getHiddenImportedWorktrees(detected)
      await keepImportedWorktreesHiddenCard({
        projectId,
        updateRepo,
        setCardState: setImportedWorktreeCardState,
        hiddenWorktreePaths: hiddenWorktrees.map((worktree) => worktree.path),
        existingBaselinePaths: repo?.externalWorktreeInboxBaselinePaths
      })
    },
    [detectedWorktreesByRepo, fetchWorktrees, repos, setImportedWorktreeCardState, updateRepo]
  )

  const setNewExternalWorktreeInboxState = useCallback(
    (projectId: string, state: NewExternalWorktreesInboxActionState | null) => {
      setNewExternalWorktreeInboxActionState((previous) => {
        const next = new Map(previous)
        if (state) {
          next.set(projectId, state)
        } else {
          next.delete(projectId)
        }
        return next
      })
    },
    []
  )

  const getNewExternalWorktreeInboxActionArgs = useCallback(
    (projectId: string, worktreePaths: readonly string[]) => {
      const repo = repos.find((candidate) => candidate.id === projectId)
      if (!repo) {
        return null
      }
      return {
        projectId,
        repo,
        worktreePaths,
        updateRepo,
        fetchWorktrees,
        setInboxState: setNewExternalWorktreeInboxState
      }
    },
    [fetchWorktrees, repos, setNewExternalWorktreeInboxState, updateRepo]
  )

  const handleImportNewExternalWorktree = useCallback(
    async (projectId: string, worktreeId: string) => {
      const inboxWorktrees = newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees ?? []
      const worktree = inboxWorktrees.find((candidate) => candidate.id === worktreeId)
      if (!worktree) {
        return
      }
      const args = getNewExternalWorktreeInboxActionArgs(projectId, [worktree.path])
      if (!args) {
        return
      }
      await importNewExternalWorktreeInboxPaths(args)
    },
    [getNewExternalWorktreeInboxActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleImportAllNewExternalWorktrees = useCallback(
    async (projectId: string) => {
      const inboxWorktrees = newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees ?? []
      const args = getNewExternalWorktreeInboxActionArgs(
        projectId,
        inboxWorktrees.map((worktree) => worktree.path)
      )
      if (!args) {
        return
      }
      await importNewExternalWorktreeInboxPaths(args)
    },
    [getNewExternalWorktreeInboxActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleKeepNewExternalWorktreeInboxHidden = useCallback(
    async (projectId: string) => {
      const inboxWorktrees = newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees ?? []
      const args = getNewExternalWorktreeInboxActionArgs(
        projectId,
        inboxWorktrees.map((worktree) => worktree.path)
      )
      if (!args) {
        return
      }
      await keepNewExternalWorktreeInboxHidden(args)
    },
    [getNewExternalWorktreeInboxActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleOpenSuppressExternalWorktreeInbox = useCallback((projectId: string) => {
    setSuppressExternalWorktreeInboxRepoId(projectId)
  }, [])

  const handleConfirmSuppressExternalWorktreeInbox = useCallback(async () => {
    if (!suppressExternalWorktreeInboxRepoId) {
      return
    }
    const projectId = suppressExternalWorktreeInboxRepoId
    const inboxWorktrees = newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees ?? []
    const args = getNewExternalWorktreeInboxActionArgs(
      projectId,
      inboxWorktrees.map((worktree) => worktree.path)
    )
    if (!args) {
      setSuppressExternalWorktreeInboxRepoId(null)
      return
    }
    const suppressed = await suppressNewExternalWorktreeInbox(args)
    if (suppressed) {
      setSuppressExternalWorktreeInboxRepoId(null)
    }
  }, [
    getNewExternalWorktreeInboxActionArgs,
    newExternalWorktreesInboxByRepo,
    suppressExternalWorktreeInboxRepoId
  ])

  const handleRemoveProject = useCallback(
    (repo: Repo) => {
      openModal('confirm-remove-folder', {
        repoId: repo.id,
        displayName: repo.displayName
      })
    },
    [openModal]
  )

  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const createProjectGroup = useAppStore((s) => s.createProjectGroup)
  const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)
  const deleteProjectGroupWithContainedProjects = useAppStore(
    (s) => s.deleteProjectGroupWithContainedProjects
  )
  const [projectGroupNameDialog, setProjectGroupNameDialog] =
    useState<ProjectGroupNameDialogState | null>(null)
  const [projectGroupDeleteDialog, setProjectGroupDeleteDialog] =
    useState<ProjectGroupDeleteDialogState | null>(null)

  const handleCreateGroupFromRepo = useCallback((repo: Repo) => {
    setProjectGroupNameDialog({ type: 'create-from-repo', repo })
  }, [])

  const handleMoveProjectToGroup = useCallback(
    (repo: Repo, groupId: string) => {
      if (repo.projectGroupId === groupId) {
        return
      }
      void moveProjectToGroup(repo.id, groupId)
    },
    [moveProjectToGroup]
  )

  const handleRemoveProjectFromGroup = useCallback(
    (repo: Repo) => {
      void moveProjectToGroup(repo.id, null)
    },
    [moveProjectToGroup]
  )

  const handleRenameProjectGroup = useCallback((groupId: string, currentName: string) => {
    setProjectGroupNameDialog({ type: 'rename', groupId, currentName })
  }, [])

  const handleSubmitProjectGroupName = useCallback(
    async (name: string) => {
      if (!projectGroupNameDialog) {
        return
      }
      if (projectGroupNameDialog.type === 'create-from-repo') {
        const group = await createProjectGroup(name)
        if (group) {
          await moveProjectToGroup(projectGroupNameDialog.repo.id, group.id)
        }
        return
      }
      await updateProjectGroup(projectGroupNameDialog.groupId, { name })
    },
    [createProjectGroup, moveProjectToGroup, projectGroupNameDialog, updateProjectGroup]
  )

  const projectGroupDeleteTargets = useMemo(() => {
    if (!projectGroupDeleteDialog) {
      return null
    }
    return selectProjectGroupRemovalTargets(projectGroups, repos, projectGroupDeleteDialog.groupId)
  }, [projectGroupDeleteDialog, projectGroups, repos])
  const projectGroupDeleteProjectCount = projectGroupDeleteTargets?.projectIds.length ?? 0
  const projectGroupDeleteProjectNames = useMemo(
    () =>
      (projectGroupDeleteTargets?.projectIds ?? []).map(
        (projectId) => repoMap.get(projectId)?.displayName ?? projectId
      ),
    [projectGroupDeleteTargets, repoMap]
  )
  const projectGroupRemoveContainedProjects =
    projectGroupDeleteProjectCount > 0 && projectGroupDeleteDialog?.removeContainedProjects === true

  const handleDeleteProjectGroup = useCallback((groupId: string, groupName: string) => {
    setProjectGroupDeleteDialog({ groupId, groupName, removeContainedProjects: false })
  }, [])

  const handleConfirmDeleteProjectGroup = useCallback(async () => {
    if (!projectGroupDeleteDialog) {
      return
    }
    try {
      const result = await deleteProjectGroupWithContainedProjects(
        projectGroupDeleteDialog.groupId,
        {
          removeContainedProjects: projectGroupRemoveContainedProjects
        }
      )
      // Why: a missing group is already the desired end state, so only a real delete failure warrants a toast.
      if (result.status === 'group-delete-failed') {
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.groupDeleteFailed',
            'Failed to delete group'
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.groupDeleteFailedDesc',
              'Something went wrong while deleting the group. No projects were removed.'
            )
          }
        )
        return
      }
      if (result.status === 'deleted-group' && result.failedProjectRemovals.length > 0) {
        const failedCount = result.failedProjectRemovals.length
        const requestedCount = result.requestedProjectIds.length
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.b667b59632',
            'Some projects could not be removed from Orca'
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.f94466bc39',
              '{{value0}} of {{value1}} contained project{{value2}} remained after deleting the group.',
              {
                value0: failedCount,
                value1: requestedCount,
                value2: requestedCount === 1 ? '' : 's'
              }
            )
          }
        )
      }
    } finally {
      // Why: deleting contained projects can unmount this dialog before its close handler runs, so the parent owns cleanup.
      setProjectGroupDeleteDialog(null)
    }
  }, [
    deleteProjectGroupWithContainedProjects,
    projectGroupRemoveContainedProjects,
    projectGroupDeleteDialog
  ])

  const handleCreateFolderWorkspace = useCallback(
    (projectGroup: ProjectGroup) => {
      if (!projectGroup.parentPath) {
        return
      }
      openModal('new-workspace-composer', {
        initialProjectGroupId: projectGroup.id
      })
    },
    [openModal]
  )

  const moveWorktreeToStatus = useCallback(
    (worktreeId: string, status: WorkspaceStatus) => {
      const current = worktreeMap.get(worktreeId)
      if (!current || getWorkspaceStatus(current, workspaceStatuses) === status) {
        return
      }
      void updateWorktreeMeta(worktreeId, { workspaceStatus: status })
    },
    [updateWorktreeMeta, worktreeMap, workspaceStatuses]
  )

  const moveWorktreesToStatus = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      const updates = new Map<string, { workspaceStatus: WorkspaceStatus }>()
      for (const worktreeId of worktreeIds) {
        const current = worktreeMap.get(worktreeId)
        if (!current || getWorkspaceStatus(current, workspaceStatuses) === status) {
          continue
        }
        updates.set(worktreeId, { workspaceStatus: status })
      }
      if (updates.size > 0) {
        void updateWorktreesMeta(updates)
      }
    },
    [updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )

  const moveWorktreesToStatusAtIndex = useCallback(
    (args: {
      worktreeIds: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      groups: readonly WorktreeDragGroup[]
    }) => {
      const targetGroupKey = getWorkspaceStatusGroupKey(args.status)
      const rankByWorktreeId = new Map<string, number>()
      for (const group of args.groups) {
        for (const worktreeId of group.worktreeIds) {
          const worktree = worktreeMap.get(worktreeId)
          if (worktree) {
            rankByWorktreeId.set(worktreeId, worktree.manualOrder ?? worktree.sortOrder)
          }
        }
      }
      const order = buildManualOrderUpdatesForGroupDrop({
        groups: args.groups,
        targetGroupKey,
        draggedIds: args.worktreeIds,
        dropIndex: args.dropIndex,
        now: Date.now(),
        rankByWorktreeId
      })
      const updates = new Map<string, Partial<WorktreeMeta>>()
      for (const worktreeId of args.worktreeIds) {
        const current = worktreeMap.get(worktreeId)
        if (!current) {
          continue
        }
        const next: Partial<WorktreeMeta> = {}
        if (getWorkspaceStatus(current, workspaceStatuses) !== args.status) {
          next.workspaceStatus = args.status
        }
        updates.set(worktreeId, next)
      }
      for (const [worktreeId, manualOrder] of order.updates) {
        updates.set(worktreeId, { ...updates.get(worktreeId), ...manualOrder })
      }
      for (const [worktreeId, update] of Array.from(updates)) {
        if (Object.keys(update).length === 0) {
          updates.delete(worktreeId)
        }
      }
      if (updates.size === 0) {
        return
      }
      // Why: the insertion line promises exact placement, so persist manual order on a cross-status drop.
      if (order.changed) {
        setSortBy('manual')
      }
      void updateWorktreesMeta(updates)
    },
    [setSortBy, updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )

  const pinWorktree = useCallback(
    (worktreeId: string) => {
      setWorktreesPinnedAndReveal([worktreeId], true)
    },
    [setWorktreesPinnedAndReveal]
  )

  const pinWorktrees = useCallback(
    (worktreeIds: readonly string[]) => {
      setWorktreesPinnedAndReveal(worktreeIds, true)
    },
    [setWorktreesPinnedAndReveal]
  )

  const reorderWorktrees = useCallback(
    (args: {
      groups: readonly WorktreeDragGroup[]
      sourceGroupKey: string
      draggedIds: readonly string[]
      dropIndex: number
    }) => {
      const rankByWorktreeId = new Map<string, number>()
      for (const group of args.groups) {
        for (const worktreeId of group.worktreeIds) {
          const worktree = worktreeMap.get(worktreeId)
          if (worktree) {
            rankByWorktreeId.set(worktreeId, worktree.manualOrder ?? worktree.sortOrder)
          }
        }
      }
      const result = buildManualOrderUpdatesForVisibleGroups({
        ...args,
        now: Date.now(),
        rankByWorktreeId
      })
      if (!result.changed) {
        return
      }
      // Why: only switch to Manual after a real move so accidental click-drags don't change the sort.
      setSortBy('manual')
      void updateWorktreesMeta(result.updates)
    },
    [setSortBy, updateWorktreesMeta, worktreeMap]
  )

  const shouldShowWorkspaceBoardDropIndicator = useCallback(
    (worktreeIds: readonly string[], status: WorkspaceStatus) => {
      const sourceGroupKeys = worktreeIds.flatMap((worktreeId) => {
        const worktree = worktreeMap.get(worktreeId)
        return worktree ? [getWorkspaceStatus(worktree, workspaceStatuses)] : []
      })
      return shouldWriteManualOrderForGroupDrop({
        sortBy,
        sourceGroupKeys,
        targetGroupKey: status
      })
    },
    [sortBy, worktreeMap, workspaceStatuses]
  )

  const dropWorktreesOnWorkspaceBoard = useCallback(
    (args: {
      worktreeIds: readonly string[]
      status: WorkspaceStatus
      dropIndex: number
      groups: readonly WorktreeDragGroup[]
    }) => {
      const result = buildWorkspaceKanbanSidebarDropUpdates({
        ...args,
        worktreeById: worktreeMap,
        workspaceStatuses,
        sortBy,
        now: Date.now()
      })
      if (result.updates.size === 0) {
        return
      }
      // Why: switch to Manual when the drop changes order so the placement stays visible.
      if (result.shouldSwitchToManual) {
        setSortBy('manual')
      }
      useAppStore.getState().recordFeatureInteraction('workspace-board-actions')
      void updateWorktreesMeta(result.updates)
    },
    [setSortBy, sortBy, updateWorktreesMeta, worktreeMap, workspaceStatuses]
  )

  // Why: count hideDefaultBranchWorkspace as a filter so the Clear Filters escape hatch stays reachable when it alone empties the list.
  const filterState = useMemo(
    () => ({
      showSleepingWorkspaces,
      filterRepoIds,
      hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces,
      visibleWorkspaceHostIds,
      workspaceHostScope
    }),
    [
      showSleepingWorkspaces,
      filterRepoIds,
      hideDefaultBranchWorkspace,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDetachedHeadWorkspaces,
      visibleWorkspaceHostIds,
      workspaceHostScope
    ]
  )
  const hasFilters = sidebarHasActiveFilters(filterState)
  const setShowSleepingWorkspaces = useAppStore((s) => s.setShowSleepingWorkspaces)
  const setHideDefaultBranchWorkspace = useAppStore((s) => s.setHideDefaultBranchWorkspace)
  const setHideAutomationGeneratedWorkspaces = useAppStore(
    (s) => s.setHideAutomationGeneratedWorkspaces
  )
  const setHideCliCreatedWorkspaces = useAppStore((s) => s.setHideCliCreatedWorkspaces)
  const setHideDetachedHeadWorkspaces = useAppStore((s) => s.setHideDetachedHeadWorkspaces)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const setVisibleWorkspaceHostIds = useAppStore((s) => s.setVisibleWorkspaceHostIds)

  const clearFilters = useCallback(() => {
    const actions = computeClearFilterActions(filterState)
    if (actions.resetShowSleepingWorkspaces) {
      setShowSleepingWorkspaces(DEFAULT_SHOW_SLEEPING_WORKSPACES)
    }
    if (actions.resetFilterRepoIds) {
      setFilterRepoIds([])
    }
    if (actions.resetHideDefaultBranchWorkspace) {
      setHideDefaultBranchWorkspace(false)
    }
    if (actions.resetHideAutomationGeneratedWorkspaces) {
      setHideAutomationGeneratedWorkspaces(false)
    }
    if (actions.resetHideCliCreatedWorkspaces) {
      setHideCliCreatedWorkspaces(false)
    }
    if (actions.resetHideDetachedHeadWorkspaces) {
      setHideDetachedHeadWorkspaces(false)
    }
    if (actions.resetVisibleWorkspaceHostIds) {
      setVisibleWorkspaceHostIds(null)
    }
  }, [
    setShowSleepingWorkspaces,
    setFilterRepoIds,
    setHideDefaultBranchWorkspace,
    setHideAutomationGeneratedWorkspaces,
    setHideCliCreatedWorkspaces,
    setHideDetachedHeadWorkspaces,
    setVisibleWorkspaceHostIds,
    filterState
  ])

  useEffect(() => {
    if (!pendingRevealSidebarRow) {
      return
    }
    const rowKey = pendingRevealSidebarRow.rowKey
    const isProjectHeaderTarget =
      rowKey.startsWith('project-group:') ||
      rowKey.startsWith('project:') ||
      rowKey.startsWith('repo:')
    if (isProjectHeaderTarget && groupBy !== 'repo') {
      setGroupBy('repo')
      return
    }
    if (!renderedSidebarRowKeys.has(rowKey) && hasFilters) {
      clearFilters()
    }
  }, [
    clearFilters,
    groupBy,
    hasFilters,
    pendingRevealSidebarRow,
    renderedSidebarRowKeys,
    setGroupBy
  ])

  const handleRevealCurrentWorkspaceRequest = useCallback(
    (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as ScrollToCurrentWorkspaceRevealRequestDetail | undefined)
          : undefined
      if (detail?.target?.type === 'sidebar-row') {
        const sidebarDetail = detail as Extract<
          ScrollToCurrentWorkspaceRevealRequestDetail,
          { target: { type: 'sidebar-row' } }
        >
        revealSidebarRow(detail.target.rowKey, {
          behavior: 'smooth',
          highlight: sidebarDetail.highlight !== false
        })
        return
      }
      if (!currentSidebarWorktreeId) {
        return
      }
      const activeWorktree = getKnownSidebarWorktreeById(
        currentSidebarWorktreeId,
        worktreeMap,
        folderWorkspaces
      )
      if (!activeWorktree || activeWorktree.isArchived) {
        return
      }
      if (!renderedWorktreeIds.includes(currentSidebarWorktreeId)) {
        // Why: the reveal action must show the current workspace, so relax filters that hide it first.
        clearFilters()
      }
      revealWorktreeInSidebar(currentSidebarWorktreeId, {
        behavior: 'smooth',
        highlight: true,
        beginRename: (detail as { beginRename?: boolean } | undefined)?.beginRename === true
      })
    },
    [
      clearFilters,
      currentSidebarWorktreeId,
      folderWorkspaces,
      revealSidebarRow,
      renderedWorktreeIds,
      revealWorktreeInSidebar,
      worktreeMap
    ]
  )

  useEffect(() => {
    window.addEventListener(
      SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT,
      handleRevealCurrentWorkspaceRequest
    )
    return () => {
      window.removeEventListener(
        SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT,
        handleRevealCurrentWorkspaceRequest
      )
    }
  }, [handleRevealCurrentWorkspaceRequest])

  const filtersHideAllRows =
    hasFilters &&
    worktrees.length === 0 &&
    placeholderRepoIds.size === 0 &&
    importedWorktreesByRepo.size === 0
  // Why: when active filters hide every row, the Clear Filters empty state must win over Project Group headers.
  if (rows.length === 0 || filtersHideAllRows) {
    return (
      <div
        data-worktree-sidebar-container
        data-contextual-tour-target="workspace-list"
        className="relative min-h-0 flex-1"
      >
        <div className="worktree-sidebar-scrollbar flex h-full flex-col overflow-y-auto overflow-x-hidden pl-1 scrollbar-sleek pt-px">
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[11px] text-muted-foreground">
            <span>
              {translate('auto.components.sidebar.WorktreeList.b7acbf038b', 'No workspaces found')}
            </span>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-[11px] px-2.5 py-1 rounded-md cursor-pointer hover:bg-accent transition-colors"
              >
                <CircleX className="size-3.5" />
                {translate('auto.components.sidebar.WorktreeList.370c6a55dd', 'Clear Filters')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <ProjectGroupNameDialog
        open={projectGroupNameDialog !== null}
        title={
          projectGroupNameDialog?.type === 'rename'
            ? translate('auto.components.sidebar.WorktreeList.f9dc6cc5d3', 'Rename Project Group')
            : translate('auto.components.sidebar.WorktreeList.13757c053c', 'New Project Group')
        }
        description={
          projectGroupNameDialog?.type === 'rename'
            ? translate(
                'auto.components.sidebar.WorktreeList.bc1460beb3',
                'Update the group name shown in the sidebar.'
              )
            : translate(
                'auto.components.sidebar.WorktreeList.d880ea0744',
                'Create a group and move this project into it.'
              )
        }
        initialName={
          projectGroupNameDialog?.type === 'rename'
            ? projectGroupNameDialog.currentName
            : projectGroupNameDialog
              ? `${projectGroupNameDialog.repo.displayName} group`
              : ''
        }
        confirmLabel={projectGroupNameDialog?.type === 'rename' ? 'Rename' : 'Create'}
        onOpenChange={(open) => {
          if (!open) {
            setProjectGroupNameDialog(null)
          }
        }}
        onSubmit={handleSubmitProjectGroupName}
      />
      <SuppressExternalWorktreeInboxDialog
        open={suppressExternalWorktreeInboxRepoId !== null}
        repoDisplayName={
          suppressExternalWorktreeInboxRepoId
            ? (repos.find((repo) => repo.id === suppressExternalWorktreeInboxRepoId)?.displayName ??
              '')
            : ''
        }
        pending={
          suppressExternalWorktreeInboxRepoId
            ? (newExternalWorktreeInboxActionState.get(suppressExternalWorktreeInboxRepoId)
                ?.pending ?? false)
            : false
        }
        onOpenChange={(open) => {
          if (!open) {
            setSuppressExternalWorktreeInboxRepoId(null)
          }
        }}
        onConfirm={() => {
          void handleConfirmSuppressExternalWorktreeInbox()
        }}
        onOpenRecovery={() => {
          if (!suppressExternalWorktreeInboxRepoId) {
            return
          }
          const projectId = suppressExternalWorktreeInboxRepoId
          setSuppressExternalWorktreeInboxRepoId(null)
          handleOpenWorktreeVisibility(projectId)
        }}
      />
      <ProjectGroupDeleteDialog
        open={projectGroupDeleteDialog !== null}
        groupName={projectGroupDeleteDialog?.groupName ?? ''}
        projectCount={projectGroupDeleteProjectCount}
        projectNames={projectGroupDeleteProjectNames}
        removeContainedProjects={projectGroupRemoveContainedProjects}
        onRemoveContainedProjectsChange={(removeContainedProjects) => {
          setProjectGroupDeleteDialog((current) =>
            current ? { ...current, removeContainedProjects } : current
          )
        }}
        onOpenChange={(open) => {
          if (!open) {
            setProjectGroupDeleteDialog(null)
          }
        }}
        onConfirm={handleConfirmDeleteProjectGroup}
      />
      <VirtualizedWorktreeViewport
        key={viewportResetKey}
        rows={sectionRows}
        activeWorktreeId={selectedSidebarWorktreeId}
        currentWorktreeId={currentSidebarWorktreeId}
        groupBy={groupBy}
        pinnedDisplayPolicy={pinnedDisplayPolicy}
        projectOrderBy={projectOrderBy}
        toggleGroup={toggleGroup}
        collapsedGroups={effectiveCollapsedGroups}
        handleCreateForRepo={handleCreateForRepo}
        handleOpenRepoSettings={handleOpenRepoSettings}
        handleOpenWorktreeVisibility={handleOpenWorktreeVisibility}
        handleShowImportedWorktrees={handleShowImportedWorktrees}
        handleKeepImportedWorktreesHidden={handleKeepImportedWorktreesHidden}
        importedWorktreeCardActionState={importedWorktreeCardActionState}
        handleImportNewExternalWorktree={handleImportNewExternalWorktree}
        handleImportAllNewExternalWorktrees={handleImportAllNewExternalWorktrees}
        handleKeepNewExternalWorktreeInboxHidden={handleKeepNewExternalWorktreeInboxHidden}
        handleOpenSuppressExternalWorktreeInbox={handleOpenSuppressExternalWorktreeInbox}
        newExternalWorktreeInboxActionState={newExternalWorktreeInboxActionState}
        handleRemoveProject={handleRemoveProject}
        handleCreateGroupFromRepo={handleCreateGroupFromRepo}
        handleMoveProjectToGroup={handleMoveProjectToGroup}
        handleRemoveProjectFromGroup={handleRemoveProjectFromGroup}
        handleRenameProjectGroup={handleRenameProjectGroup}
        handleDeleteProjectGroup={handleDeleteProjectGroup}
        handleCreateFolderWorkspace={handleCreateFolderWorkspace}
        activeModal={activeModal}
        pendingRevealWorktree={pendingRevealWorktree}
        pendingRevealSidebarRow={pendingRevealSidebarRow}
        clearPendingRevealWorktreeId={clearPendingRevealWorktreeId}
        clearPendingRevealSidebarRow={clearPendingRevealSidebarRow}
        agentSendTargetWorktreeId={agentSendTargetWorktreeId}
        worktrees={worktrees}
        folderWorkspaces={folderWorkspaces}
        selectedWorktreeIds={selectedWorktreeIds}
        selectedWorktrees={selectedWorktrees}
        onSelectionGesture={updateSelectionForGesture}
        onImmediateWorktreeActivate={handleImmediateWorktreeActivate}
        onContextMenuSelect={selectForContextMenu}
        repoMap={repoMap}
        defaultHostId={defaultHostId}
        worktreeMap={worktreeMap}
        worktreeLineageById={worktreeLineageById}
        workspaceLineageByChildKey={workspaceLineageByChildKey}
        allRepoIds={allRepoIds}
        onReorderHostSections={handleReorderHostSections}
        onHostDragActiveChange={setHostDragActive}
        prCache={prCache}
        hostedReviewCache={hostedReviewCache}
        workspaceStatuses={workspaceStatuses}
        projectGrouping={projectGrouping}
        projectGroups={projectGroups}
        onMoveWorktreeToStatus={moveWorktreeToStatus}
        onMoveWorktreesToStatus={moveWorktreesToStatus}
        onMoveWorktreesToStatusAtIndex={moveWorktreesToStatusAtIndex}
        onPinWorktree={pinWorktree}
        onPinWorktrees={pinWorktrees}
        onDropWorktreesOnWorkspaceBoard={dropWorktreesOnWorkspaceBoard}
        workspaceBoardOpen={workspaceBoardOpen}
        onWorkspaceBoardDragPreviewStart={onWorkspaceBoardDragPreviewStart}
        onWorkspaceBoardDragPreviewCommit={onWorkspaceBoardDragPreviewCommit}
        onWorkspaceBoardDragPreviewCancel={onWorkspaceBoardDragPreviewCancel}
        shouldShowWorkspaceBoardDropIndicator={shouldShowWorkspaceBoardDropIndicator}
        onReorderWorktrees={reorderWorktrees}
        scrollOffsetRef={scrollOffsetRef}
        scrollAnchorRef={scrollAnchorRef}
      />
    </>
  )
})

export default WorktreeList
