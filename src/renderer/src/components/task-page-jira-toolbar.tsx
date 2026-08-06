import { LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { shouldSuppressEnterSubmit } from '@/lib/new-workspace-enter-guard'
import { cn } from '@/lib/utils'
import type { JiraProject } from '../../../shared/types'
import type { JiraPresetId } from './task-page-localized-options'

type JiraPreset = { id: JiraPresetId; label: string }

type TaskPageJiraToolbarProps = {
  jiraPresets: readonly JiraPreset[]
  activeJiraPreset: JiraPresetId
  onPresetChange: (preset: JiraPresetId) => void
  onCreate: () => void
  sortedAvailableJiraProjects: readonly JiraProject[]
  jiraProjectsLoading: boolean
  onRefresh: () => void
  jiraLoading: boolean
  jiraSearchInput: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  onSearchClear: () => void
}

export function TaskPageJiraToolbar({
  jiraPresets,
  activeJiraPreset,
  onPresetChange,
  onCreate,
  sortedAvailableJiraProjects,
  jiraProjectsLoading,
  onRefresh,
  jiraLoading,
  jiraSearchInput,
  onSearchChange,
  onSearchSubmit,
  onSearchClear
}: TaskPageJiraToolbarProps): React.JSX.Element {
  return (
    <div className="rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {jiraPresets.map((preset) => {
            const active = !jiraSearchInput && activeJiraPreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPresetChange(preset.id)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition',
                  active
                    ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                    : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onCreate}
                disabled={sortedAvailableJiraProjects.length === 0 || jiraProjectsLoading}
                aria-label={translate('auto.components.TaskPage.0c11ca0b6d', 'New Jira issue')}
                className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                {jiraProjectsLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.0c11ca0b6d', 'New Jira issue')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onRefresh}
                disabled={jiraLoading}
                aria-label={translate('auto.components.TaskPage.2ff9fd71fd', 'Refresh Jira issues')}
                className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                {jiraLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.TaskPage.2ff9fd71fd', 'Refresh Jira issues')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative min-w-[320px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={jiraSearchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return
              }
              if (
                shouldSuppressEnterSubmit(
                  { isComposing: event.nativeEvent.isComposing, shiftKey: event.shiftKey },
                  false
                )
              ) {
                return
              }
              event.preventDefault()
              onSearchSubmit()
            }}
            placeholder={translate(
              'auto.components.TaskPage.99c2755218',
              'Jira JQL, e.g. project = ABC AND statusCategory != Done'
            )}
            className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
          />
          {jiraSearchInput ? (
            <button
              type="button"
              aria-label={translate('auto.components.TaskPage.b797bdd7c3', 'Clear search')}
              onClick={onSearchClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
