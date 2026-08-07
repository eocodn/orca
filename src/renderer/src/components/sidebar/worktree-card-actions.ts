import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type React from 'react'
import type { WorktreeCardProps } from './worktree-card-model'
import type { WorktreeCardRuntime } from './worktree-card-runtime'
import { useWorktreeCardReviewActions } from './worktree-card-review-actions'
import { useWorktreeCardPointerActions } from './worktree-card-pointer-actions'
import { activateWorktreeFromSidebar } from '@/lib/sidebar-worktree-activation'
import { isEventTargetInsideCurrentTarget } from './worktree-card-dom-events'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-diagnostics'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { runWorktreeDelete } from './delete-worktree-flow'

export type WorktreeCardActions = {
  handleEditIssue: (event: React.MouseEvent) => void
  handleEditComment: (event: React.MouseEvent) => void
  handleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleRenameTitle: (displayName: string) => void
  handleOpenRenameErrorDialog: (event: React.MouseEvent<HTMLButtonElement>) => void
  handleDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleToggleUnreadQuick: (event: React.MouseEvent<HTMLButtonElement>) => void
  handleWorkspaceQuickAction: (event: React.MouseEvent<HTMLButtonElement>) => void
  handleDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  handleDragEnd: (event: React.DragEvent<HTMLDivElement>) => void
  handleContextMenuSelect: (
    event: React.MouseEvent<HTMLElement>
  ) => readonly WorktreeCardProps['worktree'][]
  stopQuickActionPointerPropagation: (event: React.PointerEvent<HTMLButtonElement>) => void
  handleOpenGitHubIssueInOrca: (event: React.MouseEvent) => void
  handleOpenReviewInOrca: (event: React.MouseEvent) => void
  handleUnlinkReview: () => void
  handleOpenLinearIssueInOrca: (event: React.MouseEvent) => void
}

export function useWorktreeCardActions(
  props: WorktreeCardProps,
  runtime: WorktreeCardRuntime,
  showDeleteQuickAction: boolean
): WorktreeCardActions {
  const {
    worktree,
    repo,
    isActive,
    onActivate,
    onImmediateActivate,
    onSelectionGesture,
    activationRowKey,
    affiliateListMode = false
  } = props
  const openModal = useAppStore((s) => s.openModal)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const deleteFolderWorkspace = useAppStore((s) => s.deleteFolderWorkspace)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)

  const handleEditIssue = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment,
        focus: 'issue'
      })
    },
    [openModal, worktree]
  )
  const handleEditComment = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment,
        focus: 'comment'
      })
    },
    [openModal, worktree]
  )
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
        return
      }
      const selection = window.getSelection()
      if (selection && selection.toString().length > 0) {
        const card = event.currentTarget
        if (
          (selection.anchorNode instanceof Node && card.contains(selection.anchorNode)) ||
          (selection.focusNode instanceof Node && card.contains(selection.focusNode))
        ) {
          return
        }
      }
      const selectionOnly = affiliateListMode
        ? false
        : (onSelectionGesture?.(event, worktree.id) ?? false)
      if (selectionOnly || runtime.isDeleting) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      recordRendererCrashBreadcrumb('sidebar_worktree_activate', {
        worktreeId: worktree.id,
        repoId: worktree.repoId,
        wasActive: isActive,
        sshDisconnected: runtime.isSshDisconnected
      })
      onImmediateActivate?.(worktree.id, activationRowKey)
      void activateWorktreeFromSidebar(
        worktree.id,
        worktree.hostId ?? (repo ? getRepoExecutionHostId(repo) : undefined)
      )
      if (runtime.isSshDisconnected && !runtime.activeViewIsTerminal) {
        runtime.setShowDisconnectedDialog(true)
      }
      onActivate?.()
    },
    [
      activationRowKey,
      affiliateListMode,
      isActive,
      onActivate,
      onImmediateActivate,
      onSelectionGesture,
      repo,
      runtime,
      worktree.hostId,
      worktree.id,
      worktree.repoId
    ]
  )
  const handleRenameTitle = useCallback(
    (displayName: string) => updateWorktreeMeta(worktree.id, { displayName }),
    [updateWorktreeMeta, worktree.id]
  )
  const handleOpenRenameErrorDialog = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      runtime.setShowRenameErrorDialog(true)
    },
    [runtime]
  )
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (
        affiliateListMode ||
        !isEventTargetInsideCurrentTarget(event.currentTarget, event.target)
      ) {
        return
      }
      openModal('edit-meta', {
        worktreeId: worktree.id,
        currentDisplayName: worktree.displayName,
        currentIssue: worktree.linkedIssue,
        currentPR: worktree.linkedPR,
        currentComment: worktree.comment
      })
    },
    [affiliateListMode, openModal, worktree]
  )
  const handleToggleUnreadQuick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      updateWorktreeMeta(worktree.id, { isUnread: !worktree.isUnread })
    },
    [updateWorktreeMeta, worktree.id, worktree.isUnread]
  )
  const handleWorkspaceQuickAction = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!showDeleteQuickAction) {
        return
      }
      if (runtime.folderWorkspaceId) {
        void deleteFolderWorkspace(runtime.folderWorkspaceId).then((deleted) => {
          if (
            deleted &&
            useAppStore.getState().activeWorktreeId ===
              folderWorkspaceKey(runtime.folderWorkspaceId as string)
          ) {
            setActiveWorktree(null)
          }
        })
        return
      }
      runWorktreeDelete(worktree.id)
    },
    [
      deleteFolderWorkspace,
      runtime.folderWorkspaceId,
      setActiveWorktree,
      showDeleteQuickAction,
      worktree.id
    ]
  )
  const pointerActions = useWorktreeCardPointerActions(props, runtime)
  const reviewActions = useWorktreeCardReviewActions(worktree, repo, runtime)
  return {
    handleEditIssue,
    handleEditComment,
    handleClick,
    handleRenameTitle,
    handleOpenRenameErrorDialog,
    handleDoubleClick,
    handleToggleUnreadQuick,
    handleWorkspaceQuickAction,
    ...pointerActions,
    ...reviewActions
  }
}
