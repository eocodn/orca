import type { ComponentProps } from 'react'
import { LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'

import LinearIssueAttributeFilterDropdowns from '@/components/linear-issue-attribute-filter-dropdowns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shouldSuppressEnterSubmit } from '@/lib/new-workspace-enter-guard'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { LinearIssueAttributeFilter } from '../../../shared/linear-issue-attribute-filter'
import type { LinearProjectSummary, LinearTeam } from '../../../shared/types'
import type { LinearMode } from './task-page-localized-options'

type FilterProps = ComponentProps<typeof LinearIssueAttributeFilterDropdowns>

type TaskPageLinearToolbarProps = {
  linearModeOptions: readonly { id: LinearMode; label: string }[]
  linearMode: LinearMode
  onModeChange: (mode: LinearMode) => void
  onCreate: () => void
  onRefresh: () => void
  availableTeams: readonly LinearTeam[]
  selectedLinearProject: LinearProjectSummary | null
  linearLoading: boolean
  linearProjectsLoading: boolean
  linearProjectDetailLoading: boolean
  linearCustomViewsLoading: boolean
  linearCustomViewContentsLoading: boolean
  showAttributeFilters: boolean
  attributeFilter: LinearIssueAttributeFilter
  onAttributeFilterChange: (next: LinearIssueAttributeFilter) => void
  workspaceId: string | null
  isAllWorkspaces: boolean
  primaryTeam: FilterProps['primaryTeam']
  selectedTeamIds: readonly string[]
  settings: FilterProps['settings']
  linearSearchInput: string
  onLinearSearchChange: (value: string) => void
  onLinearSearchSubmit: () => void
  onLinearSearchClear: () => void
  linearProjectSearchInput: string
  onLinearProjectSearchChange: (value: string) => void
  onLinearProjectSearchClear: () => void
}

export function TaskPageLinearToolbar({
  linearModeOptions,
  linearMode,
  onModeChange,
  onCreate,
  onRefresh,
  availableTeams,
  selectedLinearProject,
  linearLoading,
  linearProjectsLoading,
  linearProjectDetailLoading,
  linearCustomViewsLoading,
  linearCustomViewContentsLoading,
  showAttributeFilters,
  attributeFilter,
  onAttributeFilterChange,
  workspaceId,
  isAllWorkspaces,
  primaryTeam,
  selectedTeamIds,
  settings,
  linearSearchInput,
  onLinearSearchChange,
  onLinearSearchSubmit,
  onLinearSearchClear,
  linearProjectSearchInput,
  onLinearProjectSearchChange,
  onLinearProjectSearchClear
}: TaskPageLinearToolbarProps): React.JSX.Element {
  const refreshLoading =
    linearMode === 'issues'
      ? linearLoading
      : linearMode === 'projects'
        ? linearProjectsLoading || linearProjectDetailLoading
        : linearCustomViewsLoading || linearCustomViewContentsLoading

  return (
    <div
      className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
      data-contextual-tour-target="tasks-search-presets"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div
          className="flex items-center gap-1 text-xs"
          role="group"
          aria-label={translate('auto.components.TaskPage.0cbf7e5cf3', 'Linear task mode')}
        >
          {linearModeOptions.map((mode) => {
            const active = linearMode === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={active}
                onClick={() => onModeChange(mode.id)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition',
                  active
                    ? 'border-border/50 bg-foreground/90 text-background'
                    : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                )}
              >
                {mode.label}
              </button>
            )
          })}
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
                onClick={onCreate}
                disabled={availableTeams.length === 0}
                aria-label={
                  linearMode === 'projects' && !selectedLinearProject
                    ? translate('auto.components.TaskPage.1361275ec3', 'New Linear project')
                    : translate('auto.components.TaskPage.3feb524d42', 'New Linear issue')
                }
                className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {linearMode === 'projects' && !selectedLinearProject
                ? translate('auto.components.TaskPage.1361275ec3', 'New Linear project')
                : translate('auto.components.TaskPage.3feb524d42', 'New Linear issue')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={refreshLoading}
                aria-label={translate('auto.components.TaskPage.8964184a8b', 'Refresh Linear')}
                className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                {refreshLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.8964184a8b', 'Refresh Linear')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {linearMode === 'issues' ? (
        <div className="mt-3 flex min-w-0 items-center gap-2">
          {showAttributeFilters ? (
            <LinearIssueAttributeFilterDropdowns
              value={attributeFilter}
              onChange={onAttributeFilterChange}
              workspaceId={workspaceId}
              isAllWorkspaces={isAllWorkspaces}
              primaryTeam={primaryTeam}
              selectedTeamIds={selectedTeamIds}
              availableTeams={availableTeams}
              settings={settings}
            />
          ) : null}
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={linearSearchInput}
              onChange={(event) => onLinearSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (
                    shouldSuppressEnterSubmit(
                      {
                        isComposing: event.nativeEvent.isComposing,
                        shiftKey: event.shiftKey
                      },
                      false
                    )
                  ) {
                    return
                  }
                  event.preventDefault()
                  onLinearSearchSubmit()
                }
              }}
              placeholder={translate(
                'auto.components.TaskPage.eec0c5c079',
                'Search Linear issues...'
              )}
              className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
            />
            {linearSearchInput ? (
              <button
                type="button"
                aria-label={translate('auto.components.TaskPage.b797bdd7c3', 'Clear search')}
                onClick={onLinearSearchClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : linearMode === 'projects' && !selectedLinearProject ? (
        <div className="mt-3 flex min-w-0 items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={linearProjectSearchInput}
              onChange={(event) => onLinearProjectSearchChange(event.target.value)}
              placeholder={translate(
                'auto.components.TaskPage.0b65d3fb2c',
                'Search Linear projects...'
              )}
              className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
            />
            {linearProjectSearchInput ? (
              <button
                type="button"
                aria-label={translate('auto.components.TaskPage.b797bdd7c3', 'Clear search')}
                onClick={onLinearProjectSearchClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
