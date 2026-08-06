import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TaskSourceAvailabilityNotice } from './task-source-context-summary'
import type { getSourceOptions } from './task-page-localized-options'
import type { TaskProvider } from '../../../shared/types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'

type SourceOption = ReturnType<typeof getSourceOptions>[number]

type TaskPageSourceProviderToolbarProps = {
  taskSource: TaskProvider
  visibleSourceOptions: readonly SourceOption[]
  taskSourceAvailabilityNoticeByProvider: Partial<
    Record<TaskProvider, TaskSourceAvailabilityNotice>
  >
  taskSourceContextSummary: { label: string; title: string }
  onClose: () => void
  onSourceChange: (source: TaskProvider) => void
}

export function TaskPageSourceProviderToolbar({
  taskSource,
  visibleSourceOptions,
  taskSourceAvailabilityNoticeByProvider,
  taskSourceContextSummary,
  onClose,
  onSourceChange
}: TaskPageSourceProviderToolbarProps): React.JSX.Element {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2"
      data-contextual-tour-target="tasks-source-filters"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={onClose}
            aria-label={translate('auto.components.TaskPage.1a06219d5c', 'Close tasks')}
          >
            <X className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {translate('auto.components.TaskPage.4826fd1ad8', 'Close · Esc')}
        </TooltipContent>
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
      {visibleSourceOptions.map((source) => {
        const active = taskSource === source.id
        const availabilityNotice = taskSourceAvailabilityNoticeByProvider[source.id] ?? null
        const sourceDisabled = source.disabled || availabilityNotice?.blocking
        return (
          <Tooltip key={source.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={sourceDisabled}
                onClick={() => {
                  if (!availabilityNotice?.blocking) {
                    onSourceChange(source.id)
                  }
                }}
                data-task-source={source.id}
                aria-label={availabilityNotice?.label ?? source.label}
                aria-pressed={active}
                className={cn(
                  'group flex h-8 w-8 items-center justify-center rounded-md border transition',
                  active
                    ? 'border-foreground/40 bg-muted/70 text-foreground shadow-sm'
                    : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  sourceDisabled && 'cursor-not-allowed opacity-55'
                )}
              >
                <source.Icon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {availabilityNotice?.label ?? source.label}
            </TooltipContent>
          </Tooltip>
        )
      })}
      <div
        className="hidden min-w-0 max-w-[min(420px,40vw)] items-center rounded-md border border-border/50 bg-muted/35 px-2 py-1 text-xs text-muted-foreground sm:flex"
        title={taskSourceContextSummary.title}
      >
        <span className="truncate">{taskSourceContextSummary.label}</span>
      </div>
    </div>
  )
}
