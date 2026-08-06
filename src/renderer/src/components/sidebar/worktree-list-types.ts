import type React from 'react'
import type { FolderWorkspacePathStatus } from '../../../../shared/folder-workspace-path-status'
import type { AppState } from '@/store/types'
import type {
  FolderWorkspace,
  ProjectGroup,
  ProjectOrderBy,
  Repo,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorkspaceStatus,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { PendingSidebarRowReveal, PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import type {
  PinnedWorktreeDisplayPolicy,
  ProjectGroupingModel,
  WorktreeGroupBy
} from './worktree-list-groups'
import type { WorktreeDragGroup } from './worktree-manual-order'
import type { WorktreeSidebarDragRect } from './worktree-sidebar-drag-autoscroll'
import type { WorktreeSidebarTrackedStatusDropTarget } from './worktree-sidebar-drop-preview'
import type { WorkspaceKanbanCardTrackedDropTarget } from './workspace-kanban-card-pointer-drag-dom'
import type { HostSectionRow } from './host-section-rows'
import type { GroupHeaderRow } from './worktree-list-groups'
import type { ImportedWorktreeCardActionState } from './imported-worktrees-card-actions'
import type { NewExternalWorktreesInboxActionState } from './new-external-worktrees-inbox-actions'

export type ProjectGroupNameDialogState =
  | { type: 'create-from-repo'; repo: Repo }
  | { type: 'rename'; groupId: string; currentName: string }

export type ProjectGroupDeleteDialogState = {
  groupId: string
  groupName: string
  removeContainedProjects: boolean
}

export type VirtualizedWorktreeViewportProps = {
  rows: HostSectionRow[]
  activeWorktreeId: string | null
  currentWorktreeId: string | null
  groupBy: WorktreeGroupBy
  pinnedDisplayPolicy: PinnedWorktreeDisplayPolicy
  projectOrderBy: ProjectOrderBy
  toggleGroup: (key: string) => void
  collapsedGroups: Set<string>
  handleCreateForRepo: (projectId: string) => void
  handleOpenRepoSettings: (projectId: string, sectionId?: string) => void
  handleOpenWorktreeVisibility: (projectId: string) => void
  handleShowImportedWorktrees: (projectId: string) => void
  handleKeepImportedWorktreesHidden: (projectId: string) => void
  importedWorktreeCardActionState: ReadonlyMap<string, ImportedWorktreeCardActionState>
  handleImportNewExternalWorktree: (projectId: string, worktreeId: string) => void
  handleImportAllNewExternalWorktrees: (projectId: string) => void
  handleKeepNewExternalWorktreeInboxHidden: (projectId: string) => void
  handleOpenSuppressExternalWorktreeInbox: (projectId: string) => void
  newExternalWorktreeInboxActionState: ReadonlyMap<string, NewExternalWorktreesInboxActionState>
  handleRemoveProject: (repo: Repo) => void
  handleCreateGroupFromRepo: (repo: Repo) => void
  handleMoveProjectToGroup: (repo: Repo, groupId: string) => void
  handleRemoveProjectFromGroup: (repo: Repo) => void
  handleRenameProjectGroup: (groupId: string, currentName: string) => void
  handleDeleteProjectGroup: (groupId: string, groupName: string) => void
  handleCreateFolderWorkspace: (projectGroup: ProjectGroup) => void
  activeModal: string
  pendingRevealWorktree: PendingSidebarWorktreeReveal | null
  pendingRevealSidebarRow: PendingSidebarRowReveal | null
  clearPendingRevealWorktreeId: () => void
  clearPendingRevealSidebarRow: () => void
  agentSendTargetWorktreeId: string | null
  worktrees: Worktree[]
  folderWorkspaces: readonly FolderWorkspace[]
  selectedWorktreeIds: ReadonlySet<string>
  selectedWorktrees: readonly Worktree[]
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, worktreeId: string) => boolean
  onImmediateWorktreeActivate: (worktreeId: string, rowKey: string | undefined) => void
  onContextMenuSelect: (
    event: React.MouseEvent<HTMLElement>,
    worktree: Worktree
  ) => readonly Worktree[]
  repoMap: Map<string, Repo>
  defaultHostId: ExecutionHostId
  worktreeMap: Map<string, Worktree>
  worktreeLineageById: Record<string, WorktreeLineage>
  workspaceLineageByChildKey: Record<string, WorkspaceLineage>
  allRepoIds: string[]
  onReorderHostSections: (orderedHostIds: ExecutionHostId[]) => void
  onHostDragActiveChange: (active: boolean) => void
  prCache: AppState['prCache'] | null
  hostedReviewCache: AppState['hostedReviewCache'] | null
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  projectGrouping?: ProjectGroupingModel
  projectGroups?: readonly ProjectGroup[]
  onMoveWorktreeToStatus: (worktreeId: string, status: WorkspaceStatus) => void
  onMoveWorktreesToStatus: (worktreeIds: readonly string[], status: WorkspaceStatus) => void
  onMoveWorktreesToStatusAtIndex: (args: {
    worktreeIds: readonly string[]
    status: WorkspaceStatus
    dropIndex: number
    groups: readonly WorktreeDragGroup[]
  }) => void
  onPinWorktree: (worktreeId: string) => void
  onPinWorktrees: (worktreeIds: readonly string[]) => void
  onDropWorktreesOnWorkspaceBoard: (args: {
    worktreeIds: readonly string[]
    status: WorkspaceStatus
    dropIndex: number
    groups: readonly WorktreeDragGroup[]
  }) => void
  workspaceBoardOpen: boolean
  onWorkspaceBoardDragPreviewStart: () => void
  onWorkspaceBoardDragPreviewCommit: () => void
  onWorkspaceBoardDragPreviewCancel: () => void
  shouldShowWorkspaceBoardDropIndicator: (
    worktreeIds: readonly string[],
    status: WorkspaceStatus
  ) => boolean
  onReorderWorktrees: (args: {
    groups: readonly WorktreeDragGroup[]
    sourceGroupKey: string
    draggedIds: readonly string[]
    dropIndex: number
  }) => void
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

export type WorktreeItemRow = Extract<HostSectionRow, { type: 'item' }>
export type FolderWorkspaceItemRow = Extract<HostSectionRow, { type: 'folder-workspace' }>

export type WorktreeRowDragState = {
  draggingWorktreeId: string | null
  sourceGroupKey: string | null
  dropIndex: number | null
  dropIndicatorY: number | null
  previewOffsetsByWorktreeId: ReadonlyMap<string, number>
  pointerY: number | null
}

export type WorktreePointerDrag = {
  pointerId: number
  sourceRow: HTMLElement
  startX: number
  startY: number
  currentX: number
  currentY: number
  worktreeId: string
  draggedIds: readonly string[]
  reorderDraggedIds: readonly string[]
  reorderUnitDraggedIds: readonly string[]
  sourceGroupKey: string
  rects: readonly WorktreeSidebarDragRect[]
  active: boolean
  preview: HTMLElement | null
  previewOffsetX: number
  previewOffsetY: number
  workspaceBoardDragPreviewRequested: boolean
  frameId: number | null
  latestBoardDropTarget: WorkspaceKanbanCardTrackedDropTarget | null
  latestStatusDropTarget: WorktreeSidebarTrackedStatusDropTarget | null
}

export type WorktreeListProps = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
  workspaceBoardOpen?: boolean
  onWorkspaceBoardDragPreviewStart?: () => void
  onWorkspaceBoardDragPreviewCommit?: () => void
  onWorkspaceBoardDragPreviewCancel?: () => void
}

export type WorktreeListContentRowProps = {
  itemKey: React.Key
  index: number
  start: number
  measureRef: React.RefCallback<HTMLElement>
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export type WorktreeListCardRowProps = {
  itemRow: Extract<HostSectionRow, { type: 'item' }>
  nested: boolean
  lineageChildren?: React.ReactNode
  forceActiveSurface?: boolean
  groupBy: WorktreeGroupBy
  activeWorktreeId: string | null
  currentWorktreeId: string | null
  selectedWorktreeIds: ReadonlySet<string>
  selectedWorktrees: readonly Worktree[]
  agentSendTargetWorktreeId: string | null
  highlightedRevealRowKey?: string
  folderBackedProjectGroupIds: ReadonlySet<string>
  experimentalNewWorktreeCardStyle: boolean
  worktreeDragState: WorktreeRowDragState
  worktreeDragGroupKey?: string
  worktreeDragGroupIndex?: number
  nativeLineageDropTargetId: string | null
  getActiveSurfaceVariant: (row: Extract<HostSectionRow, { type: 'item' }>) => string
  getLineageNestedRowGeometry: (args: {
    experimentalNewWorktreeCardStyle: boolean
    inheritedCardContentIndent: number
    lineageDepth: number
  }) => { surfaceInset: number; cardContentIndent: number; lineageChildrenInlineOffset: number }
  getWorktreeCardContentIndent: (args: {
    isGrouped: boolean
    groupDepth: number
    lineageDepth: number
  }) => number
  getFolderBackedRepoWorktreeCardContentIndent: (args: {
    groupDepth: number
    lineageDepth: number
  }) => number
  getWorktreeCardSurfaceInset: (args: { isGrouped: boolean; groupDepth: number }) => number
  getFolderBackedRepoWorktreeCardSurfaceInset: (args: {
    groupDepth: number
    lineageDepth: number
  }) => number
  getLineageChildrenInlineStyle: (offset: number) => React.CSSProperties
  getLineageToggleHandler: (groupKey: string) => () => void
  handleWorktreeRowClickCapture: React.MouseEventHandler<HTMLElement>
  handleWorktreeRowPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    id: string,
    rowKey: string
  ) => void
  stopNestedWorktreeCardBubble: React.EventHandler<React.SyntheticEvent<HTMLElement>>
  handleImmediateWorktreeRowActivate: (worktreeId: string, rowKey?: string) => void
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, worktreeId: string) => boolean
  onContextMenuSelect: (
    event: React.MouseEvent<HTMLElement>,
    worktree: Worktree
  ) => readonly Worktree[]
  handleWorktreeCardDragStart: (event: React.DragEvent<HTMLElement>, worktreeId: string) => void
  clearWorktreeDrag: () => void
}

export type WorktreeListHeaderActionsProps = {
  row: GroupHeaderRow
  groupBy: WorktreeGroupBy
  folderWorkspaceCreateDisabled: boolean
  projectGroupPathStatus: FolderWorkspacePathStatus | null
  handleOpenRepoSettings: (projectId: string, sectionId?: string) => void
  handleOpenWorktreeVisibility: (projectId: string) => void
  handleCreateGroupFromRepo: (repo: Repo) => void
  handleMoveProjectToGroup: (repo: Repo, groupId: string) => void
  handleRemoveProjectFromGroup: (repo: Repo) => void
  handleRemoveProject: (repo: Repo) => void
  handleCreateForRepo: (projectId: string) => void
  handleCreateFolderWorkspace: (projectGroup: ProjectGroup) => void
  handleRenameProjectGroup: (groupId: string, currentName: string) => void
  handleDeleteProjectGroup: (groupId: string, groupName: string) => void
  canShowFolderWorkspaceCreate: boolean
  stopRepoHeaderKeyboardToggle: React.KeyboardEventHandler<HTMLElement>
  handleRepoHeaderActionPointerDown: React.PointerEventHandler<HTMLElement>
  stopRepoHeaderMenuEvent: React.EventHandler<React.SyntheticEvent<HTMLElement>>
}

export type WorktreeListHeaderRowProps = {
  row: GroupHeaderRow
  itemKey: React.Key
  index: number
  start: number
  measureRef: React.RefCallback<HTMLElement>
  groupBy: WorktreeGroupBy
  isActiveStickyHeader: boolean
  stickyTopClass: string
  hasHeaderTopSpacing: boolean
  isDraggableRepoHeader: boolean
  isDraggableProjectGroupHeader: boolean
  isDraggingThis: boolean
  isDraggingThisProjectGroup: boolean
  headerWorkspaceStatus: WorkspaceStatus | null
  isPinnedHeader: boolean
  repoHeaderColor?: string
  projectGroupPathStatus: FolderWorkspacePathStatus | null
  folderWorkspaceCreateDisabled: boolean
  projectGroupDepth: number
  isHeaderCollapsed: boolean
  showHeaderCollapseAffordance: boolean
  headerPaddingLeft: number
  projectIdForHeader?: string
  projectGroupIdForHeader?: string
  repoHeaderIndex?: number
  repoHeaderBucketKey?: string
  projectGroupHeaderIndex?: number
  projectGroupHeaderBucketKey?: string
  repoHeaderSectionEnd?: number
  projectGroupHeaderSectionEnd?: number
  highlighted: boolean
  pinDragOver: boolean
  dragOverStatus: WorkspaceStatus | null
  projectGroups: readonly ProjectGroup[]
  createState: { disabled: boolean; tooltip: string; ariaLabel: string } | null
  headerActions: WorktreeListHeaderActionsProps
  toggleGroup: () => void
  onRepoHeaderPointerDown?: React.PointerEventHandler<HTMLElement>
  onProjectGroupHeaderPointerDown?: React.PointerEventHandler<HTMLElement>
  onDragOver?: React.DragEventHandler<HTMLElement>
  onDragLeave?: React.DragEventHandler<HTMLElement>
  onDrop?: React.DragEventHandler<HTMLElement>
  onCollapseAffordancePointerDown: React.PointerEventHandler<HTMLElement>
  onIgnoreToggle: (event: React.SyntheticEvent) => boolean
}
