import type React from 'react'
import { CircleDot, Files, FolderKanban, GitPullRequest, GitPullRequestDraft } from 'lucide-react'
import { TaskPageGitHubItemActions } from './task-page-github-item-actions'
import { TaskPageGitHubWorkItemStateBadge } from './task-page-github-work-item-status-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import {
  findGithubWorkItemWorkspaceAttachment,
  getGithubWorkItemWorkspaceAttachmentLabel
} from '@/lib/github-work-item-workspace-attachment'
import {
  isTaskPageGitHubDraftPR,
  getTaskPageGitHubPRIconTone
} from './task-page-github-work-item-status'
import type { ItemDialogTab } from '@/components/GitHubItemDialog'
import type { GitHubWorkItem, Repo, Worktree } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'

type CellSourceProps = {
  item: GitHubWorkItem
  repo: Repo | null
  sourceContext?: TaskSourceContext | null
}
type ChecksCellProps = {
  item: GitHubWorkItem
  onOpen: () => void
  onLoadChecks: () => void
}

export type TaskPageGitHubItemRowsProps = {
  filteredWorkItems: readonly GitHubWorkItem[]
  repoMap: ReadonlyMap<string, Repo>
  allWorktrees: readonly Worktree[]
  selectedRepoCount: number
  showPRManagementColumns: boolean
  githubTaskGridClass: string
  formatRelativeTime: (date: string) => string
  openGitHubDetailPage: (item: GitHubWorkItem, initialTab?: ItemDialogTab) => void
  ensurePRChecksLoaded: (item: GitHubWorkItem) => void
  handleOpenOrUseGitHubWorkItem: (item: GitHubWorkItem) => void
  handleUseWorkItem: (item: GitHubWorkItem) => void
  onRefresh: () => void
  GHAssigneesCell: React.ComponentType<CellSourceProps>
  PRReviewCell: React.ComponentType<CellSourceProps>
  PRChecksCell: React.ComponentType<ChecksCellProps>
  PRMergeCell: React.ComponentType<CellSourceProps & { onRefresh: () => void }>
  GHStatusCell: React.ComponentType<CellSourceProps>
}

const GITHUB_TASK_ROW_SURFACE_CLASS =
  '[background:color-mix(in_srgb,var(--muted)_50%,var(--background))]'
const GITHUB_TASK_ROW_HOVER_SURFACE_CLASS =
  'group-hover/github-task-row:[background:color-mix(in_srgb,var(--muted)_70%,var(--background))]'
const GITHUB_TASK_STICKY_ID_CELL_CLASS = cn(
  'sticky left-3 z-20 flex items-center before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS,
  GITHUB_TASK_ROW_HOVER_SURFACE_CLASS
)
const GITHUB_TASK_STICKY_TITLE_CELL_CLASS = cn(
  'sticky left-[92px] z-20 min-w-0 border-r border-border/50 pr-2 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS,
  GITHUB_TASK_ROW_HOVER_SURFACE_CLASS
)

function formatPRDelta(item: GitHubWorkItem): string | null {
  const parts: string[] = []
  if (typeof item.additions === 'number') {
    parts.push(`+${item.additions}`)
  }
  if (typeof item.deletions === 'number') {
    parts.push(`-${item.deletions}`)
  }
  if (typeof item.changedFiles === 'number') {
    parts.push(`${item.changedFiles} ${item.changedFiles === 1 ? 'file' : 'files'}`)
  }
  return parts.length > 0 ? parts.join(' ') : null
}
export function TaskPageGitHubItemRows({
  filteredWorkItems,
  repoMap,
  allWorktrees,
  selectedRepoCount,
  showPRManagementColumns,
  githubTaskGridClass,
  formatRelativeTime,
  openGitHubDetailPage,
  ensurePRChecksLoaded,
  handleOpenOrUseGitHubWorkItem,
  handleUseWorkItem,
  onRefresh,
  GHAssigneesCell,
  PRReviewCell,
  PRChecksCell,
  PRMergeCell,
  GHStatusCell
}: TaskPageGitHubItemRowsProps): React.JSX.Element {
  return (
    <div className="divide-y divide-border/50">
      {filteredWorkItems.map((item) => {
        const itemRepo = repoMap.get(item.repoId) ?? null
        const attachedWorkspace = findGithubWorkItemWorkspaceAttachment(
          allWorktrees,
          item.repoId,
          item.type,
          item.number
        )
        const attachedWorkspaceLabel = attachedWorkspace
          ? getGithubWorkItemWorkspaceAttachmentLabel(attachedWorkspace)
          : null
        const githubTaskIdPill = (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-muted-foreground"
            aria-label={`${item.type === 'pr' ? (isTaskPageGitHubDraftPR(item) ? 'Draft pull request' : 'Pull request') : 'Issue'} #${item.number}`}
          >
            {item.type === 'pr' ? (
              isTaskPageGitHubDraftPR(item) ? (
                <GitPullRequestDraft
                  className={cn('size-3', getTaskPageGitHubPRIconTone(item))}
                  aria-hidden="true"
                />
              ) : (
                <GitPullRequest
                  className={cn('size-3', getTaskPageGitHubPRIconTone(item))}
                  aria-hidden="true"
                />
              )
            ) : (
              <CircleDot className="size-3" aria-hidden="true" />
            )}
            <span className="font-mono text-[11px] font-normal">#{item.number}</span>
          </span>
        )
        return (
          // Why: clickable div not a <button> — it nests buttons, and button-in-button is invalid HTML that breaks hydration.
          <div
            // Why: key on repoId+item.id — repos sharing an upstream reuse item.id, so a bare key collides and React silently drops rows.
            key={`${item.repoId}:${item.id}`}
            role="button"
            tabIndex={0}
            onClick={() => openGitHubDetailPage(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openGitHubDetailPage(item)
              }
            }}
            className={cn(
              // Why: hover uses the same opaque muted-70% mix as the sticky ID/Title cells so the left columns match the rest of the row.
              'group/github-task-row grid cursor-pointer gap-2 px-3 py-2 text-left transition-colors hover:[background:color-mix(in_srgb,var(--muted)_70%,var(--background))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              githubTaskGridClass
            )}
          >
            <div className={GITHUB_TASK_STICKY_ID_CELL_CLASS}>
              {isTaskPageGitHubDraftPR(item) ? (
                <Tooltip>
                  <TooltipTrigger asChild>{githubTaskIdPill}</TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate('auto.components.TaskPage.054bf695cc', 'Draft')}
                  </TooltipContent>
                </Tooltip>
              ) : (
                githubTaskIdPill
              )}
            </div>

            <div className={GITHUB_TASK_STICKY_TITLE_CELL_CLASS}>
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{item.title}</h3>
                {item.type === 'pr' && item.state !== 'open' && item.state !== 'draft' ? (
                  <TaskPageGitHubWorkItemStateBadge item={item} className="shrink-0 px-1.5 py-0" />
                ) : null}
                {selectedRepoCount > 1 && itemRepo ? (
                  // Why: disambiguate rows in the merged multi-repo list; a single-repo view doesn't need it.
                  <RepoBadgeLabel
                    name={itemRepo.displayName}
                    color={itemRepo.badgeColor}
                    badgeClassName="size-1.5"
                    className="shrink-0 text-[11px] text-muted-foreground"
                  />
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {item.author ??
                    translate('auto.components.TaskPage.6430594b18', 'unknown author')}
                </span>
                {selectedRepoCount === 1 && itemRepo ? <span>{itemRepo.displayName}</span> : null}
                {item.type === 'pr' && item.state === 'draft' ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{translate('auto.components.TaskPage.054bf695cc', 'Draft')}</span>
                  </>
                ) : null}
                {item.type === 'pr' && formatPRDelta(item) ? (
                  <span className="inline-flex items-center gap-1">
                    <Files className="size-3" />
                    {formatPRDelta(item)}
                  </span>
                ) : null}
                {attachedWorkspaceLabel ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <FolderKanban className="size-3 shrink-0" />
                    <span className="truncate">{attachedWorkspaceLabel}</span>
                  </span>
                ) : null}
                {item.labels.slice(0, 3).map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border/50 bg-background/80 px-1.5 py-0 text-[10px] text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {!showPRManagementColumns ? (
              <div className="min-w-0 flex items-center text-xs text-muted-foreground">
                <GHAssigneesCell
                  item={item}
                  repo={itemRepo ?? null}
                  sourceContext={getTaskPageRepoSourceContext(itemRepo, 'github')}
                />
              </div>
            ) : null}

            {showPRManagementColumns ? (
              <>
                <div className="flex min-w-0 items-center">
                  <PRReviewCell
                    item={item}
                    repo={itemRepo ?? null}
                    sourceContext={getTaskPageRepoSourceContext(itemRepo, 'github')}
                  />
                </div>

                <div className="flex min-w-0 items-center">
                  <PRChecksCell
                    item={item}
                    onOpen={() => openGitHubDetailPage(item, 'checks')}
                    onLoadChecks={() => ensurePRChecksLoaded(item)}
                  />
                </div>

                <div className="flex min-w-0 items-center">
                  <PRMergeCell
                    item={item}
                    repo={itemRepo ?? null}
                    sourceContext={getTaskPageRepoSourceContext(itemRepo, 'github')}
                    onRefresh={onRefresh}
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center">
                <GHStatusCell
                  item={item}
                  repo={itemRepo ?? null}
                  sourceContext={getTaskPageRepoSourceContext(itemRepo, 'github')}
                />
              </div>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center text-[11px] text-muted-foreground">
                  {formatRelativeTime(item.updatedAt)}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {new Date(item.updatedAt).toLocaleString()}
              </TooltipContent>
            </Tooltip>

            <TaskPageGitHubItemActions
              item={item}
              attachedWorkspace={attachedWorkspace}
              handleOpenOrUseGitHubWorkItem={handleOpenOrUseGitHubWorkItem}
              handleUseWorkItem={handleUseWorkItem}
            />
          </div>
        )
      })}
    </div>
  )
}
