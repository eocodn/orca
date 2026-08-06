import type React from 'react'
import { getVirtualRowTransform } from './worktree-list-virtual-rows'
import type { FolderWorkspacePathStatus } from '../../../../shared/folder-workspace-path-status'
import type {
  FolderWorkspaceRow,
  ImportedWorktreesCardRow,
  NewExternalWorktreesInboxRow
} from './worktree-list-groups'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import type { DetectedWorktree, Worktree } from '../../../../shared/types'
import type { NewExternalWorktreeInboxPreview } from './new-external-worktrees-inbox-candidates'
import { PendingWorktreeRow } from './PendingWorktreeRow'
import ImportedWorktreesVisibilityLine from './ImportedWorktreesVisibilityLine'
import NewExternalWorktreesInboxLine from './NewExternalWorktreesInboxLine'
import WorktreeCard from './WorktreeCard'
import { FolderPathStatusIndicator } from './worktree-list-host-header'
import type { ImportedWorktreeCardActionState } from './imported-worktrees-card-actions'
import type { NewExternalWorktreesInboxActionState } from './new-external-worktrees-inbox-actions'
import type { WorktreeListContentRowProps } from './worktree-list-types'

export function WorktreeListContentRow({
  itemKey,
  index,
  start,
  measureRef,
  children,
  className = 'absolute left-0 right-0 top-0',
  style
}: WorktreeListContentRowProps): React.JSX.Element {
  return (
    <div
      role="presentation"
      data-worktree-virtual-row
      data-worktree-virtual-row-key={String(itemKey)}
      data-worktree-virtual-row-start={start}
      data-index={index}
      ref={measureRef}
      className={className}
      style={{ transform: getVirtualRowTransform(start), ...style }}
    >
      {children}
    </div>
  )
}

type WorktreeListSpecialRowProps = {
  row:
    | ImportedWorktreesCardRow
    | NewExternalWorktreesInboxRow
    | { type: 'pending-creation'; creationId: string }
  itemKey: React.Key
  index: number
  start: number
  measureRef: React.RefCallback<HTMLElement>
  importedActionState?: ImportedWorktreeCardActionState
  inboxActionState?: NewExternalWorktreesInboxActionState
  canKeepImported: boolean
  onShowImported: () => void
  onKeepImported: () => void
  onImportWorktree: (worktreeId: string) => void
  onKeepInboxHidden: () => void
  onImportAll: () => void
  onSuppressInbox: () => void
  toInboxPreview: (worktree: DetectedWorktree) => NewExternalWorktreeInboxPreview
}

export function WorktreeListSpecialRow({
  row,
  itemKey,
  index,
  start,
  measureRef,
  importedActionState,
  inboxActionState,
  canKeepImported,
  onShowImported,
  onKeepImported,
  onImportWorktree,
  onKeepInboxHidden,
  onImportAll,
  onSuppressInbox,
  toInboxPreview
}: WorktreeListSpecialRowProps): React.JSX.Element {
  if (row.type === 'imported-worktrees-card') {
    return (
      <WorktreeListContentRow itemKey={itemKey} index={index} start={start} measureRef={measureRef}>
        <ImportedWorktreesVisibilityLine
          repoDisplayName={row.repo.displayName}
          hiddenWorktrees={row.hiddenWorktrees}
          placement={row.placement}
          pending={importedActionState?.pending ?? false}
          error={importedActionState?.error ?? null}
          onShow={onShowImported}
          onKeepHidden={canKeepImported ? onKeepImported : undefined}
        />
      </WorktreeListContentRow>
    )
  }
  if (row.type === 'new-external-worktrees-inbox') {
    return (
      <WorktreeListContentRow itemKey={itemKey} index={index} start={start} measureRef={measureRef}>
        <NewExternalWorktreesInboxLine
          repoDisplayName={row.repo.displayName}
          inboxWorktrees={row.inboxWorktrees.map(toInboxPreview)}
          pending={inboxActionState?.pending ?? false}
          error={inboxActionState?.error ?? null}
          onImportWorktree={onImportWorktree}
          onKeepHidden={onKeepInboxHidden}
          onImportAll={onImportAll}
          onSuppress={onSuppressInbox}
        />
      </WorktreeListContentRow>
    )
  }
  return (
    <WorktreeListContentRow
      itemKey={itemKey}
      index={index}
      start={start}
      measureRef={measureRef}
      className="absolute left-0 right-0 top-0 px-2 pb-1.5"
    >
      <PendingWorktreeRow creationId={row.creationId} />
    </WorktreeListContentRow>
  )
}

export type WorktreeListFolderRowProps = {
  row: FolderWorkspaceRow
  itemKey: React.Key
  index: number
  start: number
  measureRef: React.RefCallback<HTMLElement>
  folderWorktree: Worktree
  activeWorktreeId: string | null
  currentWorktreeId: string | null
  selectedWorktreeIds: ReadonlySet<string>
  surfaceInset: number
  cardContentIndent: number
  pathStatus: FolderWorkspacePathStatus | null
  activationDisabled: boolean
  prDisplay?: React.ComponentProps<typeof WorktreeCard>['statusPrDisplay']
  onClickCapture: React.MouseEventHandler<HTMLElement>
  onPointerDown: React.PointerEventHandler<HTMLElement>
  onImmediateActivate: (worktreeId: string, rowKey?: string) => void
  onSelectionGesture: (event: React.MouseEvent<HTMLElement>, worktreeId: string) => boolean
  onContextMenuSelect: (
    event: React.MouseEvent<HTMLElement>,
    worktree: Worktree
  ) => readonly Worktree[]
}

export function WorktreeListFolderRow({
  row: _row,
  itemKey,
  index,
  start,
  measureRef,
  folderWorktree,
  activeWorktreeId,
  currentWorktreeId,
  selectedWorktreeIds,
  surfaceInset,
  cardContentIndent,
  pathStatus,
  activationDisabled,
  prDisplay,
  onClickCapture,
  onPointerDown,
  onImmediateActivate,
  onSelectionGesture,
  onContextMenuSelect
}: WorktreeListFolderRowProps): React.JSX.Element {
  return (
    <div
      id={`worktree-option-${folderWorktree.id}`}
      role="option"
      aria-selected={selectedWorktreeIds.has(folderWorktree.id)}
      aria-current={activeWorktreeId === folderWorktree.id ? 'page' : undefined}
      data-worktree-id={folderWorktree.id}
      data-worktree-row-key={folderWorktree.id}
      data-worktree-virtual-row
      data-worktree-virtual-row-key={String(itemKey)}
      data-worktree-virtual-row-start={start}
      data-index={index}
      ref={measureRef}
      className="absolute left-0 right-0 top-0"
      style={{ transform: getVirtualRowTransform(start) }}
      onClickCapture={onClickCapture}
      onPointerDown={onPointerDown}
    >
      <div
        className="relative"
        style={surfaceInset > 0 ? { paddingLeft: surfaceInset } : undefined}
      >
        <WorktreeCard
          worktree={folderWorktree}
          repo={undefined}
          isActive={activeWorktreeId === folderWorktree.id}
          isCurrentWorktree={currentWorktreeId === folderWorktree.id}
          contentIndent={cardContentIndent}
          flushSurface
          nativeDragEnabled={false}
          onImmediateActivate={activationDisabled ? undefined : onImmediateActivate}
          activationRowKey={folderWorktree.id}
          onSelectionGesture={onSelectionGesture}
          onContextMenuSelect={onContextMenuSelect}
          statusPrDisplay={prDisplay}
        />
        <div className="pointer-events-auto absolute right-3 top-1.5">
          <FolderPathStatusIndicator status={pathStatus} />
        </div>
      </div>
    </div>
  )
}

export function folderWorktreeForRow(row: FolderWorkspaceRow): Worktree {
  return folderWorkspaceToWorktree(row.folderWorkspace)
}
