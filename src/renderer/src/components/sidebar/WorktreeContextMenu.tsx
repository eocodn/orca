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
import { useWorktreeContextMenuController } from './use-worktree-context-menu-controller'
import type { Props } from './worktree-context-menu-model'
export {
  hasWorktreeParentLink,
  planWorkspaceStatusAssignment,
  selectMenuScopedMap,
  shouldContinueDeleteSiblingPositionRestore,
  shouldRevealWorktreeDeveloperMenu
} from './worktree-context-menu-model'
export type { WorkspaceStatusAssignmentPlan } from './worktree-context-menu-model'

const WorktreeContextMenu = React.memo(function WorktreeContextMenu(props: Props) {
  const {
    worktree,
    children,
    contentClassName,
    selectedWorktrees,
    onContextMenuSelect,
    onAssignWorkspaceStatus,
    onOpenChange
  } = props
  const {
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
  } = useWorktreeContextMenuController({
    worktree,
    children,
    contentClassName,
    selectedWorktrees,
    onContextMenuSelect,
    onAssignWorkspaceStatus,
    onOpenChange
  })
  return (
    <div
      ref={scopeRef}
      className="relative"
      {...{ [model.WORKTREE_CONTEXT_MENU_SCOPE_ATTR]: 'worktree' }}
      onContextMenuCapture={(event) => {
        if (!isEventTargetInsideCurrentTarget(event.currentTarget, event.target)) {
          return
        }
        if (model.shouldUseNativeContextMenu(event.target)) {
          return
        }
        if (model.shouldIgnoreNestedWorktreeContextMenuScope(event.currentTarget, event.target)) {
          return
        }
        event.preventDefault()
        contextMenuOpenedAtRef.current = Date.now()
        window.dispatchEvent(new Event(model.CLOSE_ALL_CONTEXT_MENUS_EVENT))
        setDeveloperMenuRevealed(event.altKey)
        setContextWorktrees(onContextMenuSelect?.(event) ?? effectiveSelectedWorktrees)
        const bounds = event.currentTarget.getBoundingClientRect()
        setMenuPoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
        setMenuOpenState(true)
      }}
      onClickCapture={(event) => {
        suppressOpeningPointerEvent(event)
      }}
    >
      {children}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpenState} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none absolute size-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className={cn('w-52', contentClassName)}
          sideOffset={0}
          align="start"
          onPointerUpCapture={suppressOpeningPointerEvent}
          onPointerDownCapture={(event) => {
            if (event.button === 0) {
              contextMenuOpenedAtRef.current = null
            }
          }}
          onMouseUpCapture={suppressOpeningPointerEvent}
          onClickCapture={suppressOpeningPointerEvent}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            {translate('auto.components.sidebar.WorktreeContextMenu.workspaceSection', 'Workspace')}
          </DropdownMenuLabel>
          {!isMultiContext && (
            <DropdownMenuItem onSelect={handleRename} disabled={isDeleting}>
              <Pencil className="size-3.5" />
              {translate('auto.components.sidebar.WorktreeContextMenu.439fa94d53', 'Update')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={deletingContext}>
              <Kanban className="size-3.5" />
              {isMultiContext
                ? translate(
                    'auto.components.sidebar.WorktreeContextMenu.56cde9e8e6',
                    'Move Statuses To'
                  )
                : translate(
                    'auto.components.sidebar.WorktreeContextMenu.84cdbb7e30',
                    'Move to Status'
                  )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuRadioGroup value={contextWorkspaceStatus}>
                {workspaceStatuses.map((status) => {
                  const meta = getWorkspaceStatusVisualMeta(status)
                  return (
                    <DropdownMenuRadioItem
                      key={status.id}
                      value={status.id}
                      onSelect={() => handleAssignWorkspaceStatus(status.id)}
                    >
                      <meta.icon className={cn('size-3.5', meta.tone)} />
                      {status.label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {!isMultiContext && (
            <>
              <WorktreeOpenInSubMenu
                worktreePath={worktree.path}
                connectionId={repo?.connectionId ?? null}
                disabled={isDeleting}
              />
              <DropdownMenuItem onSelect={handleCopyPath} disabled={isDeleting}>
                <Copy className="size-3.5" />
                {translate('auto.components.sidebar.WorktreeContextMenu.3350101edb', 'Copy Path')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleTogglePin} disabled={isDeleting}>
                {worktree.isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                {worktree.isPinned
                  ? translate('auto.components.sidebar.WorktreeContextMenu.697d0f6e1b', 'Unpin')
                  : translate('auto.components.sidebar.WorktreeContextMenu.3baa7d6507', 'Pin')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleToggleRead} disabled={isDeleting}>
                {worktree.isUnread ? (
                  <BellOff className="size-3.5" />
                ) : (
                  <Bell className="size-3.5" />
                )}
                {worktree.isUnread
                  ? translate('auto.components.sidebar.WorktreeContextMenu.8dacff1fe0', 'Mark Read')
                  : translate(
                      'auto.components.sidebar.WorktreeContextMenu.f50603c6b2',
                      'Mark Unread'
                    )}
              </DropdownMenuItem>
              {repo ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleCreateGroupFromRepo} disabled={isDeleting}>
                    <FolderPlus className="size-3.5" />
                    {translate(
                      'auto.components.sidebar.WorktreeContextMenu.503ec0f8e6',
                      'New group from project'
                    )}
                  </DropdownMenuItem>
                  {projectGroups.length > 0 ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={isDeleting}>
                        <FolderInput className="size-3.5" />
                        {translate(
                          'auto.components.sidebar.WorktreeContextMenu.76865d827f',
                          'Move to group'
                        )}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {projectGroups.map((group) => (
                          <DropdownMenuItem
                            key={group.id}
                            disabled={repo.projectGroupId === group.id}
                            onSelect={() => handleMoveProjectToGroup(group.id)}
                          >
                            <span className="max-w-48 truncate">{group.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  {repo.projectGroupId ? (
                    <DropdownMenuItem onSelect={handleRemoveProjectFromGroup} disabled={isDeleting}>
                      <CircleX className="size-3.5" />
                      {translate(
                        'auto.components.sidebar.WorktreeContextMenu.d35dfeae58',
                        'Remove from group'
                      )}
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleOpenParentPicker}
                disabled={model.isWorktreeParentPickerDisabled({ isDeleting, eligibleParentCount })}
              >
                <FolderTree className="size-3.5" />
                {model.getWorktreeParentPickerLabel(validParentWorktreeId)}
              </DropdownMenuItem>
              {(validParentWorktreeId || hasParentLink) && (
                <>
                  {validParentWorktreeId && (
                    <DropdownMenuItem onSelect={handleOpenParent} disabled={isDeleting}>
                      <Workflow className="size-3.5" />
                      {translate(
                        'auto.components.sidebar.WorktreeContextMenu.8d9cd19d09',
                        'Open Parent Worktree'
                      )}
                    </DropdownMenuItem>
                  )}
                  {hasParentLink && (
                    <DropdownMenuItem onSelect={handleRemoveParentLink} disabled={isDeleting}>
                      <Unlink className="size-3.5" />
                      {translate(
                        'auto.components.sidebar.WorktreeContextMenu.579b1a8e61',
                        'Remove from Parent'
                      )}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
            </>
          )}
          {isMultiContext && hasAnyContextLineage ? (
            <>
              <DropdownMenuItem onSelect={handleRemoveParentLink} disabled={deletingContext}>
                <Unlink className="size-3.5" />
                {translate(
                  'auto.components.sidebar.WorktreeContextMenu.579b1a8e61',
                  'Remove from Parent'
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}

          {model.shouldRevealWorktreeDeveloperMenu({ developerMenuRevealed, isMultiContext }) ? (
            <>
              <WorktreeDeveloperMenu worktreeId={worktree.id} disabled={isDeleting} />
              <DropdownMenuSeparator />
            </>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuItem
                onSelect={handleCloseTerminals}
                disabled={deletingContext || sleepableWorktrees.length === 0}
              >
                <Moon className="size-3.5" />
                {sleepLabel}
              </DropdownMenuItem>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} className="max-w-[200px] text-pretty">
              {isMultiContext
                ? translate(
                    'auto.components.sidebar.WorktreeContextMenu.7d190f7d2b',
                    'Close all active panels in the selected workspaces to free up memory and CPU.'
                  )
                : translate(
                    'auto.components.sidebar.WorktreeContextMenu.0918b35e4f',
                    'Close all active panels in this workspace to free up memory and CPU.'
                  )}
            </TooltipContent>
          </Tooltip>
          {/* Why: primary checkout rows can't be git-worktree-removed, so keep a
             disabled Delete Worktree for parity with non-primary cards and pair
             it with the enabled Remove Project action below. */}
          {!isMultiContext && removesProject ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <DropdownMenuItem variant="destructive" disabled>
                    <Trash2 className="size-3.5" />
                    {translate(
                      'auto.components.sidebar.WorktreeContextMenu.deleteWorktree',
                      'Delete Worktree'
                    )}
                  </DropdownMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8} className="max-w-[200px] text-pretty">
                {translate(
                  'auto.components.sidebar.WorktreeContextMenu.primaryDeleteDisabled',
                  "Primary worktree — can't be deleted. Remove the project instead."
                )}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {/* Why: primary checkout rows remove the project from Orca instead of
             invoking git worktree deletion. Radix forwards unknown props to the
             DOM element, so `title` works directly without a wrapper span —
             this preserves Radix's flat roving-tabindex keyboard navigation. */}
          <DropdownMenuItem
            variant="destructive"
            onSelect={handleDelete}
            disabled={
              deletingContext ||
              (!isMultiContext && worktree.isMainWorktree && !removesProject) ||
              (isMultiContext && batchDeleteWorktrees.length === 0)
            }
            title={
              !isMultiContext && worktree.isMainWorktree && !removesProject
                ? translate(
                    'auto.components.sidebar.WorktreeContextMenu.e091caab15',
                    'The project could not be found'
                  )
                : undefined
            }
          >
            <Trash2 className="size-3.5" />
            {deletingContext
              ? translate('auto.components.sidebar.WorktreeContextMenu.b42391d8bf', 'Deleting…')
              : isMultiContext
                ? deleteLabel
                : folderWorkspaceId
                  ? translate(
                      'auto.components.sidebar.WorktreeContextMenu.250de158fd',
                      'Remove Workspace'
                    )
                  : removesProject
                    ? translate(
                        'auto.components.sidebar.WorktreeContextMenu.f5ac91531d',
                        'Remove Project from Orca'
                      )
                    : translate('auto.components.sidebar.WorktreeContextMenu.f4475537d8', 'Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProjectGroupNameDialog
        open={createGroupDialogOpen}
        title={translate(
          'auto.components.sidebar.WorktreeContextMenu.6664418e98',
          'New Project Group'
        )}
        description={translate(
          'auto.components.sidebar.WorktreeContextMenu.c39c37676a',
          'Create a group and move this project into it.'
        )}
        initialName={repo ? `${repo.displayName} group` : ''}
        confirmLabel="Create"
        onOpenChange={setCreateGroupDialogOpen}
        onSubmit={handleSubmitNewProjectGroup}
      />
      <WorktreeParentPickerPopover
        open={parentPicker !== null}
        childWorktreeId={parentPicker?.childWorktreeId ?? null}
        anchorElement={parentPicker?.anchorElement ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setParentPicker(null)
          }
        }}
      />
    </div>
  )
})


export default WorktreeContextMenu
