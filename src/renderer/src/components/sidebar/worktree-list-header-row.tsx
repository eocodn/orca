import type React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RepoForkIndicator } from '@/components/repo/repo-fork-indicator'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { getVirtualRowTransform } from './worktree-list-virtual-rows'
import { ProjectHeaderActions } from './ProjectHeaderActions'
import { FolderPathStatusIndicator } from './worktree-list-host-header'
import { WorktreeListHeaderActions } from './worktree-list-header-actions'
import type { WorktreeListHeaderRowProps } from './worktree-list-types'

export function WorktreeListHeaderRow({
  row,
  itemKey,
  index,
  start,
  measureRef,
  isActiveStickyHeader,
  stickyTopClass,
  hasHeaderTopSpacing,
  isDraggableRepoHeader,
  isDraggableProjectGroupHeader,
  isDraggingThis,
  isDraggingThisProjectGroup,
  headerWorkspaceStatus,
  isPinnedHeader,
  repoHeaderColor,
  projectGroupPathStatus,
  isHeaderCollapsed,
  showHeaderCollapseAffordance,
  headerPaddingLeft,
  projectIdForHeader,
  projectGroupIdForHeader,
  repoHeaderIndex,
  repoHeaderBucketKey,
  projectGroupHeaderIndex,
  projectGroupHeaderBucketKey,
  repoHeaderSectionEnd,
  projectGroupHeaderSectionEnd,
  highlighted,
  pinDragOver,
  dragOverStatus,
  toggleGroup,
  onRepoHeaderPointerDown,
  onProjectGroupHeaderPointerDown,
  onDragOver,
  onDragLeave,
  onDrop,
  onCollapseAffordancePointerDown,
  onIgnoreToggle,
  headerActions
}: WorktreeListHeaderRowProps): React.JSX.Element {
  return (
    <div
      key={itemKey}
      role="presentation"
      data-worktree-virtual-row
      data-worktree-virtual-row-key={String(itemKey)}
      data-worktree-virtual-row-start={start}
      data-worktree-sticky-header=""
      data-worktree-sticky-header-active={isActiveStickyHeader ? '' : undefined}
      data-index={index}
      ref={measureRef}
      className={cn(
        'left-0 right-0',
        hasHeaderTopSpacing && !isActiveStickyHeader && 'pt-1',
        isActiveStickyHeader
          ? cn('sticky z-20 bg-worktree-sidebar', stickyTopClass)
          : 'absolute top-0'
      )}
      style={isActiveStickyHeader ? undefined : { transform: getVirtualRowTransform(start) }}
    >
      <div
        id={`worktree-option-${row.key}`}
        role="button"
        tabIndex={0}
        aria-expanded={showHeaderCollapseAffordance ? !isHeaderCollapsed : undefined}
        data-repo-header-id={projectIdForHeader}
        data-repo-header-index={repoHeaderIndex}
        data-repo-header-bucket={repoHeaderBucketKey}
        data-repo-header-section-end={repoHeaderSectionEnd}
        data-repo-header-drag-handle={isDraggableRepoHeader ? '' : undefined}
        data-project-group-header-id={projectGroupIdForHeader}
        data-project-group-header-index={projectGroupHeaderIndex}
        data-project-group-header-bucket={projectGroupHeaderBucketKey}
        data-project-group-header-section-end={projectGroupHeaderSectionEnd}
        data-project-group-header-drag-handle={isDraggableProjectGroupHeader ? '' : undefined}
        data-workspace-status-drop-target={headerWorkspaceStatus ? '' : undefined}
        data-workspace-status={headerWorkspaceStatus ?? undefined}
        data-workspace-pin-drop-target={isPinnedHeader ? '' : undefined}
        className={cn(
          'group relative flex h-7 w-full items-center gap-1.5 pr-2 text-left transition-all',
          !(isDraggableRepoHeader || isDraggableProjectGroupHeader) && 'cursor-pointer',
          highlighted &&
            'rounded-md bg-worktree-sidebar-accent ring-1 ring-worktree-sidebar-ring/50',
          (isDraggingThis || isDraggingThisProjectGroup) &&
            'bg-accent/80 ring-1 ring-ring/40 shadow-md rounded-md scale-[1.01]',
          headerWorkspaceStatus &&
            dragOverStatus === headerWorkspaceStatus &&
            'rounded-md bg-worktree-sidebar-accent ring-1 ring-worktree-sidebar-ring/40',
          isPinnedHeader &&
            pinDragOver &&
            'rounded-md bg-worktree-sidebar-accent ring-1 ring-worktree-sidebar-ring/40',
          row.repo && 'overflow-hidden'
        )}
        style={{ paddingLeft: headerPaddingLeft }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPointerDown={onRepoHeaderPointerDown ?? onProjectGroupHeaderPointerDown}
        onClick={(event) => {
          if (!onIgnoreToggle(event)) {
            toggleGroup()
          }
        }}
        onKeyDown={(event) => {
          if (!onIgnoreToggle(event) && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            toggleGroup()
          }
        }}
      >
        <div
          data-repo-header-drag-handle={isDraggableRepoHeader ? '' : undefined}
          data-project-group-header-drag-handle={isDraggableProjectGroupHeader ? '' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 self-stretch',
            (isDraggableRepoHeader || isDraggableProjectGroupHeader) &&
              'cursor-grab active:cursor-grabbing'
          )}
        >
          {row.icon ? (
            <div
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-[4px]',
                repoHeaderColor ? 'text-muted-foreground' : row.tone
              )}
            >
              {row.repo ? (
                <RepoIconGlyph
                  repoIcon={row.repo.repoIcon}
                  color={repoHeaderColor}
                  className="size-4"
                  iconClassName="size-3.5"
                />
              ) : (
                <row.icon className="size-3" />
              )}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-[13px] font-semibold leading-none">
                {row.label}
              </div>
              <RepoForkIndicator upstream={row.repo?.upstream} />
              <FolderPathStatusIndicator status={projectGroupPathStatus} />
            </div>
          </div>
        </div>
        <ProjectHeaderActions>
          {showHeaderCollapseAffordance ? (
            <div
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
              data-repo-header-collapse-affordance=""
              aria-hidden
              onPointerDown={onCollapseAffordancePointerDown}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleGroup()
              }}
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform', isHeaderCollapsed && '-rotate-90')}
              />
            </div>
          ) : null}
          <WorktreeListHeaderActions {...headerActions} />
        </ProjectHeaderActions>
      </div>
    </div>
  )
}
