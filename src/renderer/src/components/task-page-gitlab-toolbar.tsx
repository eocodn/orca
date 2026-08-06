import type { ComponentProps } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'

import TaskProjectSourceCombobox from '@/components/task-project-source-combobox'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GitLabIssueFilter, GitLabTaskFilter } from './task-page-localized-options'

type GitLabView = 'issues' | 'mrs' | 'todos'
type FilterId = GitLabIssueFilter | GitLabTaskFilter
type PickerProps = ComponentProps<typeof TaskProjectSourceCombobox>

type TaskPageGitLabToolbarProps = {
  gitlabView: GitLabView
  onViewChange: (view: GitLabView) => void
  gitLabIssueFilters: readonly { id: GitLabIssueFilter; label: string }[]
  gitLabMRFilters: readonly { id: GitLabTaskFilter; label: string }[]
  activeGitlabFilter: FilterId
  onFilterChange: (filter: FilterId) => void
  groups: PickerProps['groups']
  selected: PickerProps['selected']
  getRepoHostLabel: PickerProps['getRepoHostLabel']
  onRepoSelectionChange: PickerProps['onChange']
  onSelectAll: PickerProps['onSelectAll']
  gitlabLoading: boolean
  gitlabTodosLoading: boolean
  onRefresh: () => void
}

export function TaskPageGitLabToolbar({
  gitlabView,
  onViewChange,
  gitLabIssueFilters,
  gitLabMRFilters,
  activeGitlabFilter,
  onFilterChange,
  groups,
  selected,
  getRepoHostLabel,
  onRepoSelectionChange,
  onSelectAll,
  gitlabLoading,
  gitlabTodosLoading,
  onRefresh
}: TaskPageGitLabToolbarProps): React.JSX.Element {
  const filters = gitlabView === 'issues' ? gitLabIssueFilters : gitLabMRFilters
  const loading = gitlabLoading || gitlabTodosLoading

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          {(['issues', 'mrs', 'todos'] as const).map((view) => {
            const active = gitlabView === view
            const label = view === 'issues' ? 'Issues' : view === 'mrs' ? 'MRs' : 'My Todos'
            return (
              <button
                key={view}
                type="button"
                onClick={() => onViewChange(view)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition',
                  active
                    ? 'border-foreground/40 bg-foreground/90 text-background'
                    : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="min-w-0 w-full sm:w-[200px]">
          <TaskProjectSourceCombobox
            groups={groups}
            selected={selected}
            getRepoHostLabel={getRepoHostLabel}
            onChange={onRepoSelectionChange}
            onSelectAll={onSelectAll}
            triggerClassName="h-8 w-full rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
          />
        </div>
      </div>
      <div
        className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
        data-contextual-tour-target="tasks-search-presets"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {gitlabView === 'issues' || gitlabView === 'mrs'
                ? filters.map(({ id, label }) => {
                    const active = activeGitlabFilter === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onFilterChange(id)}
                        className={cn(
                          'rounded-md border px-2 py-1 text-xs transition',
                          active
                            ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                            : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                        )}
                      >
                        {label}
                      </button>
                    )
                  })
                : null}
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-2"
            data-contextual-tour-target="tasks-actions"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label={
                    gitlabView === 'todos'
                      ? translate('auto.components.TaskPage.c679af7ad9', 'Refresh My Todos')
                      : translate(
                          'auto.components.TaskPage.d4c2830063',
                          'Refresh GitLab work items'
                        )
                  }
                  className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                >
                  {loading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {gitlabView === 'todos'
                  ? translate('auto.components.TaskPage.c679af7ad9', 'Refresh My Todos')
                  : translate('auto.components.TaskPage.d4c2830063', 'Refresh GitLab work items')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  )
}
