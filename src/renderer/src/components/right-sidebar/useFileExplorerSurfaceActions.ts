import { useCallback } from 'react'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import type { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/types'
import type { TreeNode } from './file-explorer-types'
import {
  buildAddProjectFromFolderModalData,
  canShowAddAsProjectAction
} from './file-explorer-add-project-action'
import { folderRelativePathToIncludeGlob } from './file-search-include-pattern'
import { isRenameHotspotTarget, resolveDirToggleTiming } from './file-explorer-dir-toggle-timing'
import type { DirToggleTiming } from './file-explorer-dir-toggle-timing'

type SurfaceActionsParams = {
  activeWorktreeId: string | null
  activeRepo: Repo | null
  selectedPaths: Set<string>
  selectedNodes: TreeNode[]
  handleClick: (node: TreeNode, dirToggle?: DirToggleTiming) => void
  cancelPendingDirToggle: () => void
  selectRowWithModifiers: (
    node: TreeNode,
    event: React.MouseEvent<HTMLButtonElement>,
    onReplaceClick: (node: TreeNode) => void
  ) => void
  startRename: (node: TreeNode) => void
  requestDelete: (node: TreeNode) => void
  requestDeleteAll: (nodes: TreeNode[]) => void
  handleDuplicate: (node: TreeNode) => void
  collapseDirSubtree: (worktreeId: string, dirPath: string) => void
  showRightSidebarSearch: (options: { includePattern: string }) => void
  openModal: ReturnType<typeof useAppStore.getState>['openModal']
}

export function useFileExplorerSurfaceActions({
  activeWorktreeId,
  activeRepo,
  selectedPaths,
  selectedNodes,
  handleClick,
  cancelPendingDirToggle,
  selectRowWithModifiers,
  startRename,
  requestDelete,
  requestDeleteAll,
  handleDuplicate,
  collapseDirSubtree,
  showRightSidebarSearch,
  openModal
}: SurfaceActionsParams) {
  const activateNode = useCallback(
    (node: TreeNode) => {
      void handleClick(node)
    },
    [handleClick]
  )

  const handleStartRename = useCallback(
    (node: TreeNode) => {
      cancelPendingDirToggle()
      startRename(node)
    },
    [cancelPendingDirToggle, startRename]
  )

  const handleContextMenuDelete = useCallback(
    (node: TreeNode) => {
      if (selectedPaths.has(node.path) && selectedNodes.length > 1) {
        requestDeleteAll(selectedNodes)
      } else {
        requestDelete(node)
      }
    },
    [requestDelete, requestDeleteAll, selectedNodes, selectedPaths]
  )

  const handleRowClick = useCallback(
    (node: TreeNode, event: React.MouseEvent<HTMLButtonElement>) => {
      const dirToggle = resolveDirToggleTiming({
        fromRenameHotspot: isRenameHotspotTarget(event.target),
        clickCount: event.detail
      })
      selectRowWithModifiers(node, event, (target) => handleClick(target, dirToggle))
    },
    [handleClick, selectRowWithModifiers]
  )

  const handleCollapseFolderSubtree = useCallback(
    (node: TreeNode) => {
      if (activeWorktreeId && node.isDirectory) {
        collapseDirSubtree(activeWorktreeId, node.path)
      }
    },
    [activeWorktreeId, collapseDirSubtree]
  )

  const handleFindInFolder = useCallback(
    (node: TreeNode) => {
      if (activeWorktreeId && node.isDirectory) {
        showRightSidebarSearch({
          includePattern: folderRelativePathToIncludeGlob(node.relativePath)
        })
      }
    },
    [activeWorktreeId, showRightSidebarSearch]
  )

  const handleAddFolderAsProject = useCallback(
    (node: TreeNode) => {
      if (activeRepo && canShowAddAsProjectAction(node, activeRepo)) {
        openModal(
          'confirm-add-project-from-folder',
          buildAddProjectFromFolderModalData(node, activeRepo)
        )
      }
    },
    [activeRepo, openModal]
  )

  const handleOpenInTerminal = useCallback(
    (node: TreeNode) => {
      if (activeWorktreeId && node.isDirectory) {
        createNewTerminalTab(activeWorktreeId, undefined, { startupCwd: node.path })
      }
    },
    [activeWorktreeId]
  )

  return {
    activateNode,
    handleStartRename,
    handleContextMenuDelete,
    handleDuplicate,
    handleRowClick,
    handleCollapseFolderSubtree,
    handleFindInFolder,
    handleAddFolderAsProject,
    handleOpenInTerminal,
    canAddFolderAsProject: (node: TreeNode) => canShowAddAsProjectAction(node, activeRepo)
  }
}
