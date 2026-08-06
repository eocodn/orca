import type { WorkspaceStatus, WorkspaceStatusDefinition } from '../../../../shared/types'
import { getWorkspaceStatusFromGroupKey } from './workspace-status'
import { getWorktreeLineageDropTargetId } from './worktree-lineage-drag-drop'

import type { WorktreeSidebarStatusDropTarget } from './worktree-sidebar-drop-preview'

export function getPointerDropStatusTarget(args: {
  container: HTMLElement
  x: number
  y: number
}): WorktreeSidebarStatusDropTarget & { lineageParentId: string | null } {
  const target = document.elementFromPoint(args.x, args.y)
  if (!(target instanceof Element) || !args.container.contains(target)) {
    return { status: null, isPinDrop: false, lineageParentId: null }
  }
  const pinTarget = target.closest<HTMLElement>('[data-workspace-pin-drop-target]')
  if (pinTarget && args.container.contains(pinTarget)) {
    return { status: null, isPinDrop: true, lineageParentId: null }
  }
  const lineageParentId = getWorktreeLineageDropTargetId({
    container: args.container,
    target,
    pointerY: args.y
  })
  const statusTarget = target.closest<HTMLElement>('[data-workspace-status-drop-target]')
  return {
    status:
      statusTarget && args.container.contains(statusTarget)
        ? ((statusTarget.dataset.workspaceStatus as WorkspaceStatus | undefined) ?? null)
        : null,
    isPinDrop: false,
    lineageParentId
  }
}

export function shouldPreferSidebarStatusDropTarget(args: {
  sourceGroupKey: string
  target: WorktreeSidebarStatusDropTarget
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
}): boolean {
  if (args.target.isPinDrop) {
    return true
  }
  if (!args.target.status) {
    return false
  }
  const sourceStatus = getWorkspaceStatusFromGroupKey(args.sourceGroupKey, args.workspaceStatuses)
  // Overlapping edge zones: the destination lane wins so guide and drop agree.
  return sourceStatus !== null && args.target.status !== sourceStatus
}
