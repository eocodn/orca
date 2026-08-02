import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Copy,
  Bell,
  BellOff,
  CircleX,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Kanban,
  Trash2,
  Unlink,
  Workflow,
  FolderInput,
  FolderPlus,
  FolderTree
} from 'lucide-react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { useAllWorktrees, useRepoById, useRepoMap, useWorktreeMap } from '@/store/selectors'
import { cn } from '@/lib/utils'
import type {
  Repo,
  Worktree,
  WorkspaceStatus,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { runWorktreeBatchDelete, runWorktreeDelete } from './delete-worktree-flow'
import { runSleepWorktrees } from './sleep-worktree-flow'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT } from '@/hooks/useVirtualizedScrollAnchor'
import {
  getCyclicProjectedWorktreeLineageIds,
  getLineageRenderInfo,
  getProjectedWorktreeLineage
} from './worktree-lineage-projection'
import { getWorkspaceStatus, getWorkspaceStatusVisualMeta } from './workspace-status'
import { WorktreeOpenInSubMenu } from './WorktreeOpenInMenu'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import { WorktreeParentPickerPopover } from './WorktreeParentPickerPopover'
import { WorktreeDeveloperMenu } from './WorktreeDeveloperMenu'
import { getEligibleWorktreeParents } from './worktree-parent-candidates'
import { isEventTargetInsideCurrentTarget } from './worktree-card-dom-events'
import { translate } from '@/i18n/i18n'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'

import * as model from './worktree-context-menu-model'

export function useWorktreeContextMenuController({
  worktree,
  children,
  contentClassName,
  selectedWorktrees,
  onContextMenuSelect,
  onAssignWorkspaceStatus,
  onOpenChange
}: model.Props) {

  const defaultSelectedWorktrees = useMemo(() => [worktree], [worktree])
  const effectiveSelectedWorktrees = selectedWorktrees ?? defaultSelectedWorktrees
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const setWorktreesPinnedAndReveal = useAppStore((s) => s.setWorktreesPinnedAndReveal)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const openModal = useAppStore((s) => s.openModal)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const createProjectGroup = useAppStore((s) => s.createProjectGroup)
  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const deleteFolderWorkspace = useAppStore((s) => s.deleteFolderWorkspace)
  const setActiveWorktree = useAppStore((s) => s.setActiveWorktree)
  const repo = useRepoById(worktree.repoId)
  const deleteState = useAppStore((s) => s.deleteStateByWorktreeId[worktree.id])
  const [menuOpen, setMenuOpen] = useState(false)
  // Why: the Developer submenu is a power-user affordance, so it is revealed by
  // holding Option/Alt at right-click — captured at open time (like the Help
  // menu's admin options) so the submenu can't appear or vanish mid-menu and
  // shift the rows under the pointer.
  const [developerMenuRevealed, setDeveloperMenuRevealed] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })
  const [contextWorktrees, setContextWorktrees] = useState<readonly Worktree[]>(
    effectiveSelectedWorktrees
  )
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false)
  const [parentPicker, setParentPicker] = useState<{
    childWorktreeId: string
    anchorElement: HTMLElement
  } | null>(null)
  const pendingParentPickerRef = useRef<{
    childWorktreeId: string
    anchorElement: HTMLElement
  } | null>(null)
  const parentPickerFallbackTimerRef = useRef<number | null>(null)
  const isDeleting = deleteState?.isDeleting ?? false
  const repoMap = useRepoMap()
  const worktreeMap = useWorktreeMap()
  const allWorktrees = useAllWorktrees()
  // Why: these maps feed only items rendered inside the OPEN dropdown, yet delete
  // teardown replaces them on every set(). Gate them behind menuOpen via stable
  // empty sentinels so the (common) closed wrapper stays inert to that churn. The
  // conditional lives INSIDE the selector so useAppStore is always called; the
  // inline arrow (not a useCallback) re-reads the live map synchronously on the
  // render where menuOpen flips true, so dependent useMemos recompute with real data.
  const worktreeLineageById = useAppStore((s) =>
    model.selectMenuScopedMap(menuOpen, s.worktreeLineageById, model.EMPTY_WORKTREE_LINEAGE_BY_ID)
  )
  const workspaceLineageByChildKey = useAppStore((s) =>
    model.selectMenuScopedMap(
      menuOpen,
      s.workspaceLineageByChildKey,
      model.EMPTY_WORKSPACE_LINEAGE_BY_CHILD_KEY
    )
  )
  const updateWorktreeLineage = useAppStore((s) => s.updateWorktreeLineage)
  const tabsByWorktree = useAppStore((s) =>
    model.selectMenuScopedMap(menuOpen, s.tabsByWorktree, model.EMPTY_TABS_BY_WORKTREE)
  )
  const ptyIdsByTabId = useAppStore((s) =>
    model.selectMenuScopedMap(menuOpen, s.ptyIdsByTabId, model.EMPTY_PTY_IDS_BY_TAB_ID)
  )
  const browserTabsByWorktree = useAppStore((s) =>
    model.selectMenuScopedMap(menuOpen, s.browserTabsByWorktree, model.EMPTY_BROWSER_TABS_BY_WORKTREE)
  )
  const deleteStateByWorktreeId = useAppStore((s) =>
    model.selectMenuScopedMap(menuOpen, s.deleteStateByWorktreeId, model.EMPTY_DELETE_STATE_BY_WORKTREE_ID)
  )
  const scopeRef = useRef<HTMLDivElement>(null)
  const contextMenuOpenedAtRef = useRef<number | null>(null)
  const activeContextWorktrees = menuOpen ? contextWorktrees : effectiveSelectedWorktrees
  const isMultiContext = activeContextWorktrees.length > 1
  const workspaceScope = parseWorkspaceKey(worktree.id)
  const folderWorkspaceId =
    workspaceScope?.type === 'folder' ? workspaceScope.folderWorkspaceId : null
  const sleepableWorktrees = useMemo(
    () =>
      activeContextWorktrees.filter((item) =>
        model.hasSleepableWorkspaceActivity(item.id, tabsByWorktree, ptyIdsByTabId, browserTabsByWorktree)
      ),
    [activeContextWorktrees, browserTabsByWorktree, ptyIdsByTabId, tabsByWorktree]
  )
  const deletingContext = useMemo(
    () => activeContextWorktrees.some((item) => deleteStateByWorktreeId[item.id]?.isDeleting),
    [activeContextWorktrees, deleteStateByWorktreeId]
  )
  const contextWorkspaceStatus = useMemo(() => {
    const [first, ...rest] = activeContextWorktrees
    if (!first) {
      return ''
    }
    const status = getWorkspaceStatus(first, workspaceStatuses)
    return rest.every((item) => getWorkspaceStatus(item, workspaceStatuses) === status)
      ? status
      : ''
  }, [activeContextWorktrees, workspaceStatuses])
  const batchDeleteWorktrees = useMemo(
    () =>
      activeContextWorktrees.filter((item) => {
        const itemRepo = repoMap.get(item.repoId)
        return model.isContextWorktreeDeletable(item, itemRepo)
      }),
    [activeContextWorktrees, repoMap]
  )
  const removesProject = model.shouldRemoveProjectFromContextMenu(repo, worktree)
  const sleepLabel =
    isMultiContext && sleepableWorktrees.length > 0
      ? `Sleep ${sleepableWorktrees.length} Workspace${sleepableWorktrees.length === 1 ? '' : 's'}`
      : 'Sleep'
  const deleteLabel =
    isMultiContext && batchDeleteWorktrees.length > 0
      ? `Delete ${batchDeleteWorktrees.length} Workspace${batchDeleteWorktrees.length === 1 ? '' : 's'}`
      : 'Delete Selected'
  const hasParentLink = model.hasWorktreeParentLink(
    worktree,
    worktreeLineageById,
    workspaceLineageByChildKey
  )
  const cyclicLineageIds = useMemo(
    () =>
      menuOpen
        ? getCyclicProjectedWorktreeLineageIds(worktreeLineageById, worktreeMap)
        : model.EMPTY_CYCLIC_LINEAGE_IDS,
    [menuOpen, worktreeLineageById, worktreeMap]
  )
  // Why: path-derived worktree IDs can be reused. The menu must honor the same
  // instance check as grouped rows before offering navigation to a parent.
  const lineageInfo = useMemo(
    () => getLineageRenderInfo(worktree, worktreeLineageById, worktreeMap, cyclicLineageIds),
    [cyclicLineageIds, worktree, worktreeLineageById, worktreeMap]
  )
  const validParentWorktreeId = lineageInfo.state === 'valid' ? lineageInfo.parent.id : null
  const hasAnyContextLineage = activeContextWorktrees.some((item) =>
    model.hasWorktreeParentLink(item, worktreeLineageById, workspaceLineageByChildKey)
  )
  const eligibleParentCount = useMemo(
    () =>
      menuOpen
        ? getEligibleWorktreeParents({
            child: worktree,
            worktrees: allWorktrees,
            lineageById: worktreeLineageById,
            worktreeMap,
            repoMap,
            cyclicLineageIds
          }).length
        : 0,
    [allWorktrees, cyclicLineageIds, menuOpen, repoMap, worktree, worktreeLineageById, worktreeMap]
  )

  const setMenuOpenState = useCallback(
    (open: boolean) => {
      setMenuOpen(open)
      if (!open) {
        // Why: the reveal is per-open, so a later plain right-click can't inherit it.
        setDeveloperMenuRevealed(false)
      }
      onOpenChange?.(open)
    },
    [onOpenChange]
  )

  useEffect(() => {
    const closeMenu = (): void => setMenuOpenState(false)
    window.addEventListener(model.CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(model.CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [setMenuOpenState])

  useEffect(
    () => () => {
      if (parentPickerFallbackTimerRef.current != null) {
        window.clearTimeout(parentPickerFallbackTimerRef.current)
      }
    },
    []
  )

  const handleCopyPath = useCallback(() => {
    window.api.ui.writeClipboardText(worktree.path)
  }, [worktree.path])

  const handleToggleRead = useCallback(() => {
    updateWorktreeMeta(worktree.id, { isUnread: !worktree.isUnread })
  }, [worktree.id, worktree.isUnread, updateWorktreeMeta])

  const handleTogglePin = useCallback(() => {
    setWorktreesPinnedAndReveal([worktree.id], !worktree.isPinned)
  }, [worktree.id, worktree.isPinned, setWorktreesPinnedAndReveal])

  const handleCreateGroupFromRepo = useCallback(() => {
    if (!repo) {
      return
    }
    setCreateGroupDialogOpen(true)
  }, [repo])

  const handleSubmitNewProjectGroup = useCallback(
    async (name: string) => {
      if (!repo) {
        return
      }
      const group = await createProjectGroup(name)
      if (group) {
        await moveProjectToGroup(repo.id, group.id)
      }
    },
    [createProjectGroup, moveProjectToGroup, repo]
  )

  const handleMoveProjectToGroup = useCallback(
    (groupId: string) => {
      if (!repo || repo.projectGroupId === groupId) {
        return
      }
      void moveProjectToGroup(repo.id, groupId)
    },
    [moveProjectToGroup, repo]
  )

  const handleRemoveProjectFromGroup = useCallback(() => {
    if (!repo) {
      return
    }
    void moveProjectToGroup(repo.id, null)
  }, [moveProjectToGroup, repo])

  const handleAssignWorkspaceStatus = useCallback(
    (status: string) => {
      setMenuOpenState(false)
      const plan = model.planWorkspaceStatusAssignment(
        activeContextWorktrees,
        status,
        workspaceStatuses,
        Boolean(onAssignWorkspaceStatus)
      )
      if (plan.kind === 'board-sync') {
        onAssignWorkspaceStatus?.(plan.worktreeIds, status)
        return
      }
      // Why: outside the workspace board (e.g. the sidebar list) status changes
      // are local-only; Linear sync is scoped to board moves like drag-and-drop.
      void Promise.all(
        plan.localWriteIds.map((id) => updateWorktreeMeta(id, { workspaceStatus: status }))
      )
    },
    [
      activeContextWorktrees,
      onAssignWorkspaceStatus,
      setMenuOpenState,
      updateWorktreeMeta,
      workspaceStatuses
    ]
  )

  const handleRename = useCallback(() => {
    openModal('edit-meta', {
      worktreeId: worktree.id,
      currentDisplayName: worktree.displayName,
      currentIssue: worktree.linkedIssue,
      currentPR: worktree.linkedPR,
      currentComment: worktree.comment,
      focus: 'displayName'
    })
  }, [
    worktree.id,
    worktree.displayName,
    worktree.linkedIssue,
    worktree.linkedPR,
    worktree.comment,
    openModal
  ])

  const handleCloseTerminals = useCallback(() => {
    const worktreeIds = sleepableWorktrees.map((item) => item.id)
    setMenuOpenState(false)
    // Why: Sleep can remount the sidebar when it clears the active workspace.
    // Let Radix finish closing the menu first so its focus/portal teardown
    // cannot scroll the virtualized list during that remount.
    window.setTimeout(() => {
      void runSleepWorktrees(worktreeIds)
    }, 50)
  }, [setMenuOpenState, sleepableWorktrees])

  const handleDelete = useCallback(() => {
    // Folder mode handled inline because it routes to a different modal;
    // standard delete delegates to the shared runWorktreeDelete helper.
    const restoreSidebarPosition = model.preserveDeleteSiblingPosition(scopeRef.current)
    scopeRef.current
      ?.closest('[data-worktree-sidebar]')
      ?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT))
    setMenuOpenState(false)
    // Why: Delete can remove the active row and remount the sidebar. Run it
    // after menu close for the same reason as Sleep above.
    window.setTimeout(() => {
      if (isMultiContext) {
        runWorktreeBatchDelete(batchDeleteWorktrees.map((item) => item.id))
        restoreSidebarPosition()
        return
      }
      if (folderWorkspaceId) {
        void deleteFolderWorkspace(folderWorkspaceId).then((deleted) => {
          if (
            deleted &&
            useAppStore.getState().activeWorktreeId === folderWorkspaceKey(folderWorkspaceId)
          ) {
            setActiveWorktree(null)
          }
        })
        restoreSidebarPosition()
        return
      }
      // Why delegate to runWorktreeDelete: keeps the delete-vs-project-removal
      // decision tree (and its rationale) in one place shared with command
      // surfaces and the memory popover's inline Delete action.
      runWorktreeDelete(worktree.id)
      restoreSidebarPosition()
    }, 50)
  }, [
    batchDeleteWorktrees,
    deleteFolderWorkspace,
    folderWorkspaceId,
    isMultiContext,
    setActiveWorktree,
    setMenuOpenState,
    worktree.id
  ])

  const handleOpenParent = useCallback(() => {
    if (validParentWorktreeId) {
      activateAndRevealWorktree(validParentWorktreeId)
    }
  }, [validParentWorktreeId])

  const openPendingParentPicker = useCallback(() => {
    const pendingParentPicker = pendingParentPickerRef.current
    if (!pendingParentPicker) {
      return
    }
    pendingParentPickerRef.current = null
    if (parentPickerFallbackTimerRef.current != null) {
      window.clearTimeout(parentPickerFallbackTimerRef.current)
      parentPickerFallbackTimerRef.current = null
    }
    setParentPicker(pendingParentPicker)
  }, [])

  const handleOpenParentPicker = useCallback(
    (event?: { preventDefault: () => void }) => {
      event?.preventDefault()
      const anchorElement = model.getWorktreeParentPickerAnchor(scopeRef.current, worktree.id)
      if (!anchorElement) {
        return
      }
      pendingParentPickerRef.current = { childWorktreeId: worktree.id, anchorElement }
      setMenuOpenState(false)
      // Why: the picker should open from Radix's close-auto-focus callback, but
      // this keeps keyboard activation working if that callback is skipped.
      parentPickerFallbackTimerRef.current = window.setTimeout(openPendingParentPicker, 50)
    },
    [openPendingParentPicker, setMenuOpenState, worktree.id]
  )

  const handleRemoveParentLink = useCallback(() => {
    void Promise.all(
      activeContextWorktrees.map((item) => updateWorktreeLineage(item.id, { noParent: true }))
    )
  }, [activeContextWorktrees, updateWorktreeLineage])

  const suppressOpeningPointerEvent = useCallback((event: React.SyntheticEvent) => {
    const contextMenuOpenedAt = contextMenuOpenedAtRef.current
    if (
      contextMenuOpenedAt == null ||
      !model.shouldSuppressContextMenuFollowUpClick(contextMenuOpenedAt, Date.now())
    ) {
      if (contextMenuOpenedAt != null) {
        contextMenuOpenedAtRef.current = null
      }
      return
    }
    // Why: macOS ctrl-click can release over the just-opened menu, selecting
    // the item under the cursor unless the opening pointer sequence is ignored.
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'click') {
      contextMenuOpenedAtRef.current = null
    }
  }, [])

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      // Why: Radix otherwise restores focus to the hidden context-menu trigger.
      // When Sleep/Delete clears the active workspace and remounts the sidebar,
      // that focus restore can scroll the virtual list away from the row the
      // user just acted on.
      event.preventDefault()
      if (pendingParentPickerRef.current) {
        window.setTimeout(openPendingParentPicker, 0)
        return
      }
      const sidebar = scopeRef.current?.closest('[data-worktree-sidebar]')
      if (sidebar instanceof HTMLElement) {
        sidebar.focus({ preventScroll: true })
      }
    },
    [openPendingParentPicker]
  )

  return {
    defaultSelectedWorktrees,
    effectiveSelectedWorktrees,
    updateWorktreeMeta,
    setWorktreesPinnedAndReveal,
    workspaceStatuses,
    openModal,
    projectGroups,
    createProjectGroup,
    moveProjectToGroup,
    deleteFolderWorkspace,
    setActiveWorktree,
    repo,
    deleteState,
    pendingParentPickerRef,
    parentPickerFallbackTimerRef,
    isDeleting,
    repoMap,
    worktreeMap,
    allWorktrees,
    worktreeLineageById,
    workspaceLineageByChildKey,
    updateWorktreeLineage,
    tabsByWorktree,
    ptyIdsByTabId,
    browserTabsByWorktree,
    deleteStateByWorktreeId,
    scopeRef,
    contextMenuOpenedAtRef,
    activeContextWorktrees,
    isMultiContext,
    workspaceScope,
    folderWorkspaceId,
    sleepableWorktrees,
    deletingContext,
    contextWorkspaceStatus,
    batchDeleteWorktrees,
    removesProject,
    sleepLabel,
    deleteLabel,
    hasParentLink,
    cyclicLineageIds,
    lineageInfo,
    validParentWorktreeId,
    hasAnyContextLineage,
    eligibleParentCount,
    setMenuOpenState,
    handleCopyPath,
    handleToggleRead,
    handleTogglePin,
    handleCreateGroupFromRepo,
    handleSubmitNewProjectGroup,
    handleMoveProjectToGroup,
    handleRemoveProjectFromGroup,
    handleAssignWorkspaceStatus,
    handleRename,
    handleCloseTerminals,
    handleDelete,
    handleOpenParent,
    openPendingParentPicker,
    handleOpenParentPicker,
    handleRemoveParentLink,
    suppressOpeningPointerEvent,
    handleCloseAutoFocus,
    menuOpen,
    setMenuOpen,
    developerMenuRevealed,
    setDeveloperMenuRevealed,
    menuPoint,
    setMenuPoint,
    contextWorktrees,
    setContextWorktrees,
    createGroupDialogOpen,
    setCreateGroupDialogOpen,
    parentPicker,
    setParentPicker,
  }
}
