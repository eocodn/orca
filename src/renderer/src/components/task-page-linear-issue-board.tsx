import type { DragEvent, KeyboardEvent } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'

import { LinearPriorityIcon } from '@/components/linear-priority-icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearIssue } from '../../../shared/types'
import { formatRelativeTime } from './task-page-query-model'
import { LinearStateCell } from './task-page-linear-cells'
import type { LinearDisplayProperty } from './task-page-localized-options'
import type { LinearGroupSection } from './task-page-linear-grouping'

type TaskPageLinearIssueBoardProps = {
  sections: LinearGroupSection[]
  effectiveDisplayProperties: ReadonlySet<LinearDisplayProperty>
  selectedIssueId: string | null
  selectedWorkspaceId: string | null
  statusBoardEnabled: boolean
  dragOverKey: string | null
  draggingIssueId: string | null
  updatingIssueIds: ReadonlySet<string>
  sourceContext: TaskSourceContext | null
  onDragStart: (issue: LinearIssue, event: DragEvent<HTMLDivElement>) => void
  onDragOver: (section: LinearGroupSection, event: DragEvent<HTMLElement>) => void
  onDrop: (section: LinearGroupSection, event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onOpenIssue: (issue: LinearIssue) => void
  onUseIssue: (issue: LinearIssue) => void
}

export function TaskPageLinearIssueBoard({
  sections,
  effectiveDisplayProperties,
  selectedIssueId,
  selectedWorkspaceId,
  statusBoardEnabled,
  dragOverKey,
  draggingIssueId,
  updatingIssueIds,
  sourceContext,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onOpenIssue,
  onUseIssue
}: TaskPageLinearIssueBoardProps): React.JSX.Element {
  const handleIssueKeyDown = (event: KeyboardEvent<HTMLDivElement>, issue: LinearIssue): void => {
    if (event.target !== event.currentTarget) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpenIssue(issue)
    }
  }

  return (
    <div className="grid min-w-0 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => (
        <section
          key={section.key}
          onDragOver={(event) => onDragOver(section, event)}
          onDrop={(event) => onDrop(section, event)}
          className={cn(
            'min-h-0 rounded-md border border-border/50 bg-muted/20 transition-[border-color,box-shadow]',
            dragOverKey === section.key && 'border-ring/70 ring-1 ring-ring/70'
          )}
        >
          <div className="flex h-9 items-center justify-between border-b border-border/50 px-3">
            <span className="truncate text-xs font-medium text-foreground">{section.label}</span>
            <span className="text-[11px] text-muted-foreground">{section.issues.length}</span>
          </div>
          <div className="space-y-2 p-2">
            {section.issues.map((issue) => {
              const selected = issue.id === selectedIssueId
              const labels = issue.labels.slice(0, 2)
              const dragging = draggingIssueId === issue.id
              const updating = updatingIssueIds.has(issue.id)
              const teamLabel =
                selectedWorkspaceId === 'all' && issue.workspaceName
                  ? `${issue.workspaceName} / ${issue.team.name}`
                  : issue.team.name
              return (
                <div
                  key={issue.id}
                  role="button"
                  tabIndex={0}
                  draggable={statusBoardEnabled && !updating}
                  aria-current={selected ? 'true' : undefined}
                  data-current={selected ? 'true' : undefined}
                  aria-disabled={updating ? 'true' : undefined}
                  onDragStart={(event) => onDragStart(issue, event)}
                  onDragEnd={onDragEnd}
                  onClick={() => onOpenIssue(issue)}
                  onKeyDown={(event) => handleIssueKeyDown(event, issue)}
                  className={cn(
                    'group/row cursor-pointer rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    statusBoardEnabled && !updating && 'cursor-grab active:cursor-grabbing',
                    selected && 'bg-accent',
                    dragging && 'opacity-50',
                    updating && 'cursor-wait opacity-70'
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        {effectiveDisplayProperties.has('priority') ? (
                          <LinearPriorityIcon priority={issue.priority} className="size-3.5" />
                        ) : null}
                        <span className="truncate">{issue.identifier}</span>
                      </div>
                      <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                        {issue.title}
                      </h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        data-contextual-tour-target="tasks-start-workspace"
                        onClick={(event) => {
                          event.stopPropagation()
                          onUseIssue(issue)
                        }}
                        aria-label={translate('auto.components.TaskPage.ff90d0abc7', 'Start workspace from {{value0}}', {
                          value0: issue.identifier
                        })}
                      >
                        <ArrowRight className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          window.api.shell.openUrl(issue.url)
                        }}
                        aria-label={translate('auto.components.TaskPage.246bd64aed', 'Open {{value0}} in Linear', {
                          value0: issue.identifier
                        })}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {effectiveDisplayProperties.has('state') ? (
                      <LinearStateCell issue={issue} className="px-1.5 py-0.5" sourceContext={sourceContext} />
                    ) : null}
                    {effectiveDisplayProperties.has('assignee') ? (
                      <span>
                        {issue.assignee?.displayName ?? translate('auto.components.TaskPage.42a9160321', 'Unassigned')}
                      </span>
                    ) : null}
                    {effectiveDisplayProperties.has('team') ? <span className="truncate">{teamLabel}</span> : null}
                    {effectiveDisplayProperties.has('updated') ? <span>{formatRelativeTime(issue.updatedAt)}</span> : null}
                  </div>
                  {effectiveDisplayProperties.has('labels') && issue.labels.length > 0 ? (
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                      {labels.map((label) => (
                        <span
                          key={label}
                          className="max-w-[140px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {label}
                        </span>
                      ))}
                      {issue.labels.length > labels.length ? (
                        <span className="text-[10px] text-muted-foreground">+{issue.labels.length - labels.length}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
