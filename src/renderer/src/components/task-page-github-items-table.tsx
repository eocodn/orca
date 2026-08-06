import type React from 'react'
import { LoaderCircle } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PaginationBar } from './task-page-pagination'
import {
  TaskPageGitHubItemRows,
  type TaskPageGitHubItemRowsProps
} from './task-page-github-item-rows'
import type { GitHubWorkItem } from '../../../shared/types'
import type {
  TaskPageRepoSourceState,
  TaskPageUnresolvedSourceRepo
} from './task-page-cache-selectors'

type GithubEmptyState = { title: string; description: string }
export type TaskPageGitHubItemsTableProps = {
  tasksError: string | null
  githubUnavailable: boolean
  failedCount: number
  selectedRepoCount: number
  perRepoSourceState: readonly TaskPageRepoSourceState[]
  unresolvedSourceRepos: readonly TaskPageUnresolvedSourceRepo[]
  retryingSourceKeys: ReadonlySet<string>
  tasksLoading: boolean
  handleRetryIssuesFetch: (sourceKey: string) => void
  showGitHubTaskSkeletons: boolean
  filteredWorkItems: readonly GitHubWorkItem[]
  githubEmptyState: GithubEmptyState
  githubTaskGridClass: string
  activeGithubTaskKind: 'issues' | 'prs'
  showPRManagementColumns: boolean
  rows: TaskPageGitHubItemRowsProps
  currentPage: number
  totalPages: number
  loadingTargetPage: number | null
  pages: readonly (GitHubWorkItem[] | null)[]
  setCurrentPage: (page: number) => void
  handleLoadNextPage: (page: number) => Promise<void>
}

const GITHUB_TASK_ROW_SURFACE_CLASS =
  '[background:color-mix(in_srgb,var(--muted)_50%,var(--background))]'
const GITHUB_TASK_STICKY_ID_HEADER_CLASS = cn(
  'sticky left-3 z-30 before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS
)
const GITHUB_TASK_STICKY_TITLE_HEADER_CLASS = cn(
  'sticky left-[92px] z-30 border-r border-border/50 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS
)
const GITHUB_TASK_STICKY_ID_CELL_CLASS = cn(
  'sticky left-3 z-20 flex items-center before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS
)
const GITHUB_TASK_STICKY_TITLE_CELL_CLASS = cn(
  'sticky left-[92px] z-20 min-w-0 border-r border-border/50 pr-2 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit',
  GITHUB_TASK_ROW_SURFACE_CLASS
)

export function TaskPageGitHubItemsTable({
  tasksError,
  githubUnavailable,
  failedCount,
  selectedRepoCount,
  perRepoSourceState,
  unresolvedSourceRepos,
  retryingSourceKeys,
  tasksLoading,
  handleRetryIssuesFetch,
  showGitHubTaskSkeletons,
  filteredWorkItems,
  githubEmptyState,
  githubTaskGridClass,
  activeGithubTaskKind,
  showPRManagementColumns,
  rows,
  currentPage,
  totalPages,
  loadingTargetPage,
  pages,
  setCurrentPage,
  handleLoadNextPage
}: TaskPageGitHubItemsTableProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-muted/50 shadow-sm">
      <div
        className="min-h-0 flex-initial overflow-auto scrollbar-sleek scrollbar-sleek-lg"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div
          // Why: z-40 must beat the rows' sticky left cells (z-20); this stacking context's z sets the whole header's level.
          className={cn(
            'sticky top-0 z-40 grid gap-2 border-b border-border/50 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground',
            GITHUB_TASK_ROW_SURFACE_CLASS,
            githubTaskGridClass
          )}
        >
          <span className={GITHUB_TASK_STICKY_ID_HEADER_CLASS}>
            {translate('auto.components.TaskPage.eb10c32872', 'ID')}
          </span>
          <span className={GITHUB_TASK_STICKY_TITLE_HEADER_CLASS}>
            {translate('auto.components.TaskPage.5eccb3c841', 'Title / Context')}
          </span>
          {activeGithubTaskKind === 'issues' ? (
            <span>{translate('auto.components.TaskPage.8aba10579d', 'Assignees')}</span>
          ) : null}
          {showPRManagementColumns ? (
            <>
              <span>{translate('auto.components.TaskPage.f6fa3c97d0', 'Reviewers')}</span>
              <span>{translate('auto.components.TaskPage.a7396b05c6', 'Checks')}</span>
              <span>{translate('auto.components.TaskPage.443f7dd928', 'Merge')}</span>
            </>
          ) : (
            <span>{translate('auto.components.TaskPage.154b0fa623', 'Status')}</span>
          )}
          <span>{translate('auto.components.TaskPage.f362667d55', 'Updated')}</span>
          <span />
        </div>

        {tasksError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {tasksError}
          </div>
        ) : null}

        {!tasksError && githubUnavailable ? (
          // Why: name the GitHub outage explicitly so an empty list isn't misread as an Orca bug; takes priority over the count banner.
          <div
            role="alert"
            className="border-b border-border/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {translate(
              'auto.components.TaskPage.75a38d7df8',
              'GitHub data is temporarily unavailable. Its API may be down, rate-limited, or unreachable. Please try again shortly.'
            )}
          </div>
        ) : null}

        {!tasksError && !githubUnavailable && failedCount > 0 ? (
          // Why: per-repo partial-failure signal, distinct from a hard IPC reject (tasksError); the two are mutually exclusive.
          <div className="border-b border-border/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
            {failedCount} {translate('auto.components.TaskPage.7762f4b03a', 'of')}{' '}
            {selectedRepoCount}{' '}
            {translate('auto.components.TaskPage.d1766fd62d', 'projects failed to load')}
          </div>
        ) : null}

        {perRepoSourceState
          .filter((s) => s.error)
          .map((s) => {
            const err = s.error!
            // Why: Retry re-fetches force=true via the shared refresh nonce, invalidating any still-failing in-flight request first.
            return (
              <div
                key={`source-err-${s.repoId}`}
                role="alert"
                // Why: aria-atomic re-announces the whole banner on a new same-repo error SRs would otherwise miss (stable key → text-only diff).
                aria-atomic="true"
                className="flex items-center justify-between gap-3 border-b border-border/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                <span>
                  {translate('auto.components.TaskPage.0c0de0fc0e', "Couldn't load issues from")}{' '}
                  <span className="font-mono">
                    {err.source.owner}/{err.source.repo}
                  </span>{' '}
                  — {err.message}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRetryIssuesFetch(s.sourceKey)}
                  disabled={tasksLoading || retryingSourceKeys.has(s.sourceKey)}
                >
                  {retryingSourceKeys.has(s.sourceKey) ? (
                    <span className="flex items-center gap-1">
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      {translate('auto.components.TaskPage.5b6b2af943', 'Retrying…')}
                    </span>
                  ) : (
                    translate('auto.components.TaskPage.0bfbf62f75', 'Retry')
                  )}
                </Button>
              </div>
            )
          })}

        {unresolvedSourceRepos.map((r) => (
          // Why: null-source repos (#9660) render empty like genuine zero — name the repo and offer Retry so a transient resolve blip is recoverable.
          <div
            key={`source-unresolved-${r.repoId}`}
            role="status"
            aria-atomic="true"
            className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          >
            <span>
              {translate(
                'auto.components.TaskPage.noGithubSourceDetected',
                'No GitHub source detected for'
              )}{' '}
              <span className="font-mono">{r.label}</span> —{' '}
              {translate(
                'auto.components.TaskPage.noGithubSourceDetectedHint',
                'it may have no GitHub remote, or the source could not be resolved.'
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRetryIssuesFetch(r.sourceKey)}
              disabled={tasksLoading || retryingSourceKeys.has(r.sourceKey)}
            >
              {retryingSourceKeys.has(r.sourceKey) ? (
                <span className="flex items-center gap-1">
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                  {translate('auto.components.TaskPage.5b6b2af943', 'Retrying…')}
                </span>
              ) : (
                translate('auto.components.TaskPage.0bfbf62f75', 'Retry')
              )}
            </Button>
          </div>
        ))}

        {showGitHubTaskSkeletons ? (
          // Why: fill a typical viewport with shimmer rows so the table doesn't jump in height when results land.
          <div className="divide-y divide-border/50">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={cn('grid gap-2 px-3 py-2', githubTaskGridClass)}>
                <div className={GITHUB_TASK_STICKY_ID_CELL_CLASS}>
                  <div className="h-7 w-16 animate-pulse rounded-lg bg-muted/70" />
                </div>
                <div className={GITHUB_TASK_STICKY_TITLE_CELL_CLASS}>
                  <div className="h-4 w-3/5 animate-pulse rounded bg-muted/70" />
                  <div className="mt-2 h-3 w-2/5 animate-pulse rounded bg-muted/60" />
                </div>
                {!showPRManagementColumns ? (
                  <div className="flex items-center">
                    <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
                  </div>
                ) : null}
                {showPRManagementColumns ? (
                  <>
                    <div className="flex items-center">
                      <div className="h-5 w-20 animate-pulse rounded-full bg-muted/70" />
                    </div>
                    <div className="flex items-center">
                      <div className="h-5 w-20 animate-pulse rounded-full bg-muted/70" />
                    </div>
                    <div className="flex items-center">
                      <div className="h-5 w-20 animate-pulse rounded-full bg-muted/70" />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center">
                    <div className="h-5 w-14 animate-pulse rounded-full bg-muted/70" />
                  </div>
                )}
                <div className="flex items-center">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="flex items-center justify-start lg:justify-end">
                  <div className="h-7 w-16 animate-pulse rounded-xl bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Why: hide the empty state while any error banner shows, so "No matching work" doesn't contradict "Couldn't load issues". */}
        {!showGitHubTaskSkeletons &&
        filteredWorkItems.length === 0 &&
        !tasksError &&
        !githubUnavailable &&
        failedCount === 0 &&
        unresolvedSourceRepos.length === 0 &&
        perRepoSourceState.every((s) => !s.error) ? (
          <div className="px-4 py-10 text-center">
            <p className="text-base font-medium text-foreground">{githubEmptyState.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">{githubEmptyState.description}</p>
          </div>
        ) : null}

        <div className="divide-y divide-border/50">
          {!showGitHubTaskSkeletons ? <TaskPageGitHubItemRows {...rows} /> : null}
        </div>
      </div>
      {filteredWorkItems.length > 0 && !showGitHubTaskSkeletons && totalPages > 1 ? (
        <div className="flex-none border-t border-border/50 bg-muted/50">
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            loadingTarget={loadingTargetPage}
            onPageChange={(page) => {
              if (pages[page] !== null && pages[page] !== undefined) {
                setCurrentPage(page)
              } else {
                void handleLoadNextPage(page)
              }
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
