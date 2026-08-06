import type React from 'react'
import WorktreeCard, { type ActiveSurfaceVariant } from './WorktreeCard'
import type { WorktreeListCardRowProps } from './worktree-list-types'
import { PINNED_GROUP_KEY } from './worktree-list-groups'

export function WorktreeListCardRow({
  itemRow,
  nested,
  lineageChildren,
  forceActiveSurface = false,
  groupBy,
  activeWorktreeId,
  currentWorktreeId,
  selectedWorktreeIds,
  selectedWorktrees,
  agentSendTargetWorktreeId,
  highlightedRevealRowKey,
  folderBackedProjectGroupIds,
  experimentalNewWorktreeCardStyle,
  worktreeDragState,
  worktreeDragGroupKey,
  worktreeDragGroupIndex,
  nativeLineageDropTargetId,
  getActiveSurfaceVariant,
  getLineageNestedRowGeometry,
  getWorktreeCardContentIndent,
  getFolderBackedRepoWorktreeCardContentIndent,
  getWorktreeCardSurfaceInset,
  getFolderBackedRepoWorktreeCardSurfaceInset,
  getLineageChildrenInlineStyle,
  getLineageToggleHandler,
  handleWorktreeRowClickCapture,
  handleWorktreeRowPointerDown,
  stopNestedWorktreeCardBubble,
  handleImmediateWorktreeRowActivate,
  onSelectionGesture,
  onContextMenuSelect,
  handleWorktreeCardDragStart,
  clearWorktreeDrag
}: WorktreeListCardRowProps): React.JSX.Element {
  const lineageToggleGroupKey = itemRow.lineageGroupKey
  const projectGroupId = itemRow.repo?.projectGroupId
  const isFolderBackedRepoChild =
    groupBy === 'repo' && Boolean(projectGroupId && folderBackedProjectGroupIds.has(projectGroupId))
  const paddingDepth = nested ? Math.max(0, itemRow.depth - 1) : itemRow.depth
  const getCardContentIndent = (lineageDepth: number): number =>
    isFolderBackedRepoChild
      ? getFolderBackedRepoWorktreeCardContentIndent({
          groupDepth: itemRow.groupDepth,
          lineageDepth
        })
      : getWorktreeCardContentIndent({
          isGrouped: groupBy !== 'none',
          groupDepth: itemRow.groupDepth,
          lineageDepth
        })
  const inheritedCardContentIndent = getCardContentIndent(0)
  const nestedLineageGeometry = nested
    ? getLineageNestedRowGeometry({
        experimentalNewWorktreeCardStyle,
        inheritedCardContentIndent,
        lineageDepth: itemRow.depth
      })
    : null
  const paddingLeft =
    nested && groupBy !== 'none'
      ? getWorktreeCardContentIndent({
          isGrouped: false,
          groupDepth: itemRow.groupDepth,
          lineageDepth: paddingDepth
        })
      : getCardContentIndent(paddingDepth)
  const surfaceInset = nested
    ? nestedLineageGeometry!.surfaceInset
    : isFolderBackedRepoChild
      ? getFolderBackedRepoWorktreeCardSurfaceInset({
          groupDepth: itemRow.groupDepth,
          lineageDepth: paddingDepth
        })
      : getWorktreeCardSurfaceInset({
          isGrouped: groupBy !== 'none',
          groupDepth: itemRow.groupDepth
        })
  const cardContentIndent = nested
    ? nestedLineageGeometry!.cardContentIndent
    : Math.max(0, paddingLeft - surfaceInset)
  const lineageChildrenStyle = lineageChildren
    ? getLineageChildrenInlineStyle(nestedLineageGeometry?.lineageChildrenInlineOffset ?? 0)
    : undefined
  const revealHighlightTone = agentSendTargetWorktreeId === itemRow.worktree.id ? 'ai' : 'default'
  const isLineageDropTarget =
    Boolean(worktreeDragState.draggingWorktreeId) &&
    nativeLineageDropTargetId === itemRow.worktree.id
  const isPinnedOverlayRow = itemRow.sectionKey === PINNED_GROUP_KEY
  const isActiveWorktree = activeWorktreeId === itemRow.worktree.id
  const activeSurfaceVariant = getActiveSurfaceVariant(itemRow) as ActiveSurfaceVariant

  return (
    <div
      key={itemRow.rowKey}
      id={`worktree-option-${itemRow.rowKey}`}
      role="option"
      aria-selected={selectedWorktreeIds.has(itemRow.worktree.id)}
      aria-current={isActiveWorktree ? 'page' : undefined}
      data-worktree-id={itemRow.worktree.id}
      data-worktree-row-key={itemRow.rowKey}
      data-worktree-section-key={itemRow.sectionKey}
      data-worktree-drag-id={worktreeDragGroupKey ? itemRow.worktree.id : undefined}
      data-worktree-drag-group-key={worktreeDragGroupKey}
      data-worktree-drag-group-index={worktreeDragGroupIndex}
      className={`relative transition-[opacity,filter] duration-150 ease-out${
        worktreeDragState.draggingWorktreeId === itemRow.worktree.id
          ? ' pointer-events-none opacity-0'
          : ''
      }`}
      data-scroll-reveal-highlight={highlightedRevealRowKey === itemRow.rowKey ? 'true' : undefined}
      onClick={nested ? stopNestedWorktreeCardBubble : undefined}
      onClickCapture={handleWorktreeRowClickCapture}
      onDoubleClick={nested ? stopNestedWorktreeCardBubble : undefined}
      onDragStart={nested ? stopNestedWorktreeCardBubble : undefined}
      onPointerDown={(event) => {
        if (nested) {
          event.stopPropagation()
        }
        handleWorktreeRowPointerDown(event, itemRow.worktree.id, itemRow.rowKey)
      }}
      style={{ paddingLeft: surfaceInset > 0 ? `${surfaceInset}px` : undefined }}
    >
      <WorktreeCard
        worktree={itemRow.worktree}
        repo={itemRow.repo}
        isActive={isActiveWorktree}
        isCurrentWorktree={currentWorktreeId === itemRow.worktree.id}
        isActiveSurface={forceActiveSurface || isActiveWorktree}
        activeSurfaceVariant={
          isActiveWorktree && !forceActiveSurface ? activeSurfaceVariant : 'primary'
        }
        isMultiSelected={selectedWorktreeIds.has(itemRow.worktree.id)}
        revealHighlight={highlightedRevealRowKey === itemRow.rowKey}
        revealHighlightTone={revealHighlightTone}
        selectedWorktrees={selectedWorktrees}
        nativeDragEnabled={false}
        isLineageDropTarget={isLineageDropTarget}
        contentIndent={cardContentIndent}
        flushSurface
        activationRowKey={itemRow.rowKey}
        onImmediateActivate={handleImmediateWorktreeRowActivate}
        onSelectionGesture={onSelectionGesture}
        onContextMenuSelect={onContextMenuSelect}
        onCardDragStart={handleWorktreeCardDragStart}
        onCardDragEnd={clearWorktreeDrag}
        hideRepoBadge={groupBy === 'repo'}
        hostContextLabel={itemRow.hostContextLabel}
        inPinnedSection={isPinnedOverlayRow}
        renameRowKey={itemRow.rowKey}
        lineageChildCount={itemRow.lineageChildCount}
        lineageCollapsed={itemRow.lineageCollapsed}
        lineageChildren={lineageChildren}
        lineageChildrenStyle={lineageChildrenStyle}
        onLineageToggle={
          lineageToggleGroupKey ? getLineageToggleHandler(lineageToggleGroupKey) : undefined
        }
      />
    </div>
  )
}

export function renderWorktreeLineageDescendants(
  parent: WorktreeListCardRowProps['itemRow'],
  descendants: readonly WorktreeListCardRowProps['itemRow'][],
  renderRow: (
    row: WorktreeListCardRowProps['itemRow'],
    nested: boolean,
    children?: React.ReactNode
  ) => React.ReactNode
): React.ReactNode | undefined {
  const childNodes: React.ReactNode[] = []
  let cursor = 0
  while (cursor < descendants.length) {
    const child = descendants[cursor]
    if (!child || child.depth !== parent.depth + 1) {
      cursor++
      continue
    }
    let nextSiblingIndex = cursor + 1
    while (
      nextSiblingIndex < descendants.length &&
      descendants[nextSiblingIndex]!.depth > child.depth
    ) {
      nextSiblingIndex++
    }
    const childLineageChildren = renderWorktreeLineageDescendants(
      child,
      descendants.slice(cursor + 1, nextSiblingIndex),
      renderRow
    )
    childNodes.push(renderRow(child, true, childLineageChildren))
    cursor = nextSiblingIndex
  }
  return childNodes.length > 0 ? childNodes : undefined
}
