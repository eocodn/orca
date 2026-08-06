import type React from 'react'
import {
  CircleX,
  Ellipsis,
  Eye,
  FolderInput,
  FolderPlus,
  Plus,
  Shapes,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorktreeListHeaderActionsProps } from './worktree-list-types'
import {
  REPO_HEADER_ACTION_BUTTON_CLASS,
  REPO_HEADER_ACTION_REVEAL_CLASS
} from './repo-header-action-button-class'
import { getRepositoryIconSectionId } from '@/components/settings/repository-settings-targets'
import { getFolderWorkspacePathStatusDescription } from '@/lib/folder-workspace-path-status'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../shared/worktree-ownership'

export function WorktreeListHeaderActions({
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
  canShowFolderWorkspaceCreate,
  stopRepoHeaderKeyboardToggle,
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderMenuEvent
}: WorktreeListHeaderActionsProps): React.JSX.Element {
  const repo = row.repo
  const projectGroup =
    row.projectGroup && 'parentPath' in row.projectGroup ? row.projectGroup : null
  return (
    <>
      {row.count > 0 && (repo || row.projectGroup) ? null : null}
      {projectGroup && !repo && projectGroup.id ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={REPO_HEADER_ACTION_BUTTON_CLASS}
              data-repo-header-action=""
              aria-label={translate(
                'auto.components.sidebar.WorktreeList.79465e9034',
                'Group actions for {{value0}}',
                { value0: row.label }
              )}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={stopRepoHeaderKeyboardToggle}
              onPointerDown={handleRepoHeaderActionPointerDown}
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            onPointerDown={stopRepoHeaderMenuEvent}
            onMouseDown={stopRepoHeaderMenuEvent}
            onPointerUp={stopRepoHeaderMenuEvent}
            onMouseUp={stopRepoHeaderMenuEvent}
            onClick={stopRepoHeaderMenuEvent}
            onKeyDown={stopRepoHeaderMenuEvent}
          >
            <DropdownMenuItem onSelect={() => handleRenameProjectGroup(projectGroup.id, row.label)}>
              {translate('auto.components.sidebar.WorktreeList.4d7b73658c', 'Rename group')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => handleDeleteProjectGroup(projectGroup.id, row.label)}
            >
              {translate('auto.components.sidebar.WorktreeList.902115cdbe', 'Delete group')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canShowFolderWorkspaceCreate && projectGroup?.parentPath ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-repo-header-action=""
              className={cn(
                REPO_HEADER_ACTION_BUTTON_CLASS,
                folderWorkspaceCreateDisabled &&
                  'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground/60'
              )}
              aria-label={translate(
                'auto.components.sidebar.WorktreeList.bd37a57ac8',
                'Create workspace for {{value0}}',
                { value0: row.label }
              )}
              aria-disabled={folderWorkspaceCreateDisabled}
              onKeyDown={stopRepoHeaderKeyboardToggle}
              onPointerDown={handleRepoHeaderActionPointerDown}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!folderWorkspaceCreateDisabled) {
                  handleCreateFolderWorkspace(projectGroup)
                }
              }}
            >
              <Plus className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {projectGroupPathStatus?.exists === false
              ? getFolderWorkspacePathStatusDescription(projectGroupPathStatus)
              : translate(
                  'auto.components.sidebar.WorktreeList.bd37a57ac8',
                  'Create workspace for {{value0}}',
                  { value0: row.label }
                )}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {repo && groupBy === 'repo' ? (
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={REPO_HEADER_ACTION_BUTTON_CLASS}
                  data-repo-header-action=""
                  aria-label={translate(
                    'auto.components.sidebar.WorktreeList.609633a9e6',
                    'Project actions for {{value0}}',
                    { value0: row.label }
                  )}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={stopRepoHeaderKeyboardToggle}
                  onPointerDown={handleRepoHeaderActionPointerDown}
                >
                  <Ellipsis className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.sidebar.WorktreeList.2ef41bf9a7', 'Project actions')}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={6}
            onPointerDown={stopRepoHeaderMenuEvent}
            onMouseDown={stopRepoHeaderMenuEvent}
            onPointerUp={stopRepoHeaderMenuEvent}
            onMouseUp={stopRepoHeaderMenuEvent}
            onClick={stopRepoHeaderMenuEvent}
            onKeyDown={stopRepoHeaderMenuEvent}
          >
            <DropdownMenuItem onSelect={() => handleOpenRepoSettings(repo.id)}>
              <SlidersHorizontal className="size-3.5" />
              {translate('auto.components.sidebar.WorktreeList.2cdffbc728', 'Project Settings')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleOpenRepoSettings(repo.id, getRepositoryIconSectionId(repo.id))}
            >
              <Shapes className="size-3.5" />
              {translate('auto.components.sidebar.WorktreeList.e82d3589a1', 'Change Project Icon')}
            </DropdownMenuItem>
            {isGitRepoKind(repo) ? (
              <DropdownMenuItem onSelect={() => handleOpenWorktreeVisibility(repo.id)}>
                <Eye className="size-3.5" />
                {effectiveExternalWorktreeVisibility(
                  repo,
                  isLegacyRepoForExternalWorktreeVisibility(repo)
                ) === 'show'
                  ? 'Hide non-Orca worktrees'
                  : 'Show hidden worktrees'}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => handleCreateGroupFromRepo(repo)}>
              <FolderPlus className="size-3.5" />
              {translate(
                'auto.components.sidebar.WorktreeList.cbfd565f83',
                'New group from project'
              )}
            </DropdownMenuItem>
            {projectGroups.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="size-3.5" />
                  {translate('auto.components.sidebar.WorktreeList.4a08fb55f2', 'Move to group')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {projectGroups.map((group) => (
                    <DropdownMenuItem
                      key={group.id}
                      disabled={repo.projectGroupId === group.id}
                      onSelect={() => handleMoveProjectToGroup(repo, group.id)}
                    >
                      <span className="max-w-48 truncate">{group.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {repo.projectGroupId ? (
              <DropdownMenuItem onSelect={() => handleRemoveProjectFromGroup(repo)}>
                <CircleX className="size-3.5" />
                {translate('auto.components.sidebar.WorktreeList.64e55f7f01', 'Remove from group')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => handleRemoveProject(repo)}>
              <Trash2 className="size-3.5" />
              {translate('auto.components.sidebar.WorktreeList.c83968f87f', 'Remove Project')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {repo && groupBy === 'repo' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {createState?.disabled ? (
              <span
                className={cn(
                  'inline-flex cursor-not-allowed transition-[margin,max-width,opacity]',
                  REPO_HEADER_ACTION_REVEAL_CLASS
                )}
                data-repo-header-action=""
                tabIndex={0}
                aria-label={createState.ariaLabel}
                onKeyDown={stopRepoHeaderKeyboardToggle}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={handleRepoHeaderActionPointerDown}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="pointer-events-none size-5 shrink-0 rounded-md text-muted-foreground transition-opacity opacity-60"
                  aria-label={createState.ariaLabel}
                  disabled
                >
                  <Plus className="size-3" />
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className={REPO_HEADER_ACTION_BUTTON_CLASS}
                data-repo-header-action=""
                aria-label={
                  createState?.ariaLabel ??
                  translate(
                    'auto.components.sidebar.WorktreeList.bb85cd86ba',
                    'Create workspace for {{value0}}',
                    { value0: row.label }
                  )
                }
                onKeyDown={stopRepoHeaderKeyboardToggle}
                onPointerDown={handleRepoHeaderActionPointerDown}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  handleCreateForRepo(repo.id)
                }}
              >
                <Plus className="size-3" />
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {createState?.tooltip ??
              translate(
                'auto.components.sidebar.WorktreeList.bb85cd86ba',
                'Create workspace for {{value0}}',
                { value0: row.label }
              )}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  )
}
