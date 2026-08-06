import type { ChangeEvent, ComponentProps, KeyboardEvent, ReactNode, RefObject } from 'react'
import { LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'

import PRFilterDropdowns from '@/components/github/PRFilterDropdowns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GitHubOwnerRepo } from '../../../shared/types'
import type { TaskViewPresetId } from '../../../shared/types'
import { getGitHubTaskKindPresets, type GitHubTaskKind } from './task-page-localized-options'

type FilterProps = ComponentProps<typeof PRFilterDropdowns>
type Preset = { id: TaskViewPresetId; label: string; query: string }

type TaskPageGitHubTaskToolbarProps = {
  activeGithubTaskKind: GitHubTaskKind
  activeTaskPreset: TaskViewPresetId | null
  onPresetSelect: (preset: Preset) => void
  onSetDefaultTaskPreset: (preset: TaskViewPresetId) => void
  parsedTaskQuery: FilterProps['parsed']
  loadedGitHubAuthorLogins: string[]
  primaryGithubFilterSlug: GitHubOwnerRepo | null
  settings: FilterProps['settings']
  onPRFilterChange: FilterProps['onChange']
  taskSearchInputRef: RefObject<HTMLInputElement | null>
  taskSearchInput: string
  appliedTaskSearch: string
  onSearchChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onResetSearch: () => void
  newIssueTargetRepo: boolean
  onCreateIssue: () => void
  githubTasksBusy: boolean
  onRefresh: () => void
  children?: ReactNode
}

export function TaskPageGitHubTaskToolbar({
  activeGithubTaskKind,
  activeTaskPreset,
  onPresetSelect,
  onSetDefaultTaskPreset,
  parsedTaskQuery,
  loadedGitHubAuthorLogins,
  primaryGithubFilterSlug,
  settings,
  onPRFilterChange,
  taskSearchInputRef,
  taskSearchInput,
  appliedTaskSearch,
  onSearchChange,
  onSearchKeyDown,
  onResetSearch,
  newIssueTargetRepo,
  onCreateIssue,
  githubTasksBusy,
  onRefresh,
  children
}: TaskPageGitHubTaskToolbarProps): React.JSX.Element {
  return (
    <div
      className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
      data-contextual-tour-target="tasks-search-presets"
    >
      <div className="mb-2 flex flex-wrap gap-2">
        {getGitHubTaskKindPresets(activeGithubTaskKind).map((option) => {
          const active = activeTaskPreset === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onPresetSelect(option)}
              onContextMenu={(event) => {
                event.preventDefault()
                onSetDefaultTaskPreset(option.id)
              }}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition',
                active
                  ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                  : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PRFilterDropdowns
          parsed={parsedTaskQuery}
          kind={activeGithubTaskKind}
          authorLogins={loadedGitHubAuthorLogins}
          primarySlug={primaryGithubFilterSlug}
          settings={settings}
          onChange={onPRFilterChange}
        />
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={taskSearchInputRef}
            data-github-items-search-input
            value={taskSearchInput}
            onChange={onSearchChange}
            onKeyDown={onSearchKeyDown}
            placeholder={
              activeGithubTaskKind === 'prs'
                ? translate('auto.components.TaskPage.eee4df4c66', 'Search GitHub PRs...')
                : translate('auto.components.TaskPage.b15ceb409d', 'Search GitHub issues...')
            }
            className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
          />
          {taskSearchInput || appliedTaskSearch ? (
            <button
              type="button"
              aria-label={translate('auto.components.TaskPage.b797bdd7c3', 'Clear search')}
              onClick={onResetSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
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
                onClick={onCreateIssue}
                disabled={!newIssueTargetRepo}
                aria-label={translate('auto.components.TaskPage.d3d0998b7d', 'New GitHub issue')}
                className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.d3d0998b7d', 'New GitHub issue')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={githubTasksBusy}
                aria-busy={githubTasksBusy}
                aria-label={
                  githubTasksBusy
                    ? translate('auto.components.TaskPage.6ffa6be99f', 'Refreshing GitHub work')
                    : translate('auto.components.TaskPage.ff53631e6f', 'Refresh GitHub work')
                }
                className="size-8 cursor-pointer border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md disabled:pointer-events-auto disabled:cursor-wait supports-[backdrop-filter]:bg-transparent"
              >
                {githubTasksBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {githubTasksBusy
                ? translate('auto.components.TaskPage.31f81cc334', 'Refreshing GitHub work…')
                : translate('auto.components.TaskPage.ff53631e6f', 'Refresh GitHub work')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {children}
    </div>
  )
}
