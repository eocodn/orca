/* eslint-disable max-lines -- Why: project/view tables and project overview
   share compact Linear metadata presentation rules for the Tasks Linear surface. */
import React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  FileText,
  FolderKanban,
  Layers3,
  LoaderCircle,
  RefreshCw,
  UserRound
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  LinearCustomViewSummary,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearWorkspaceError
} from '../../../shared/types'
import { translate } from '@/i18n/i18n'

type LinearProjectLike = LinearProjectSummary & {
  content?: string
  summary?: string
  description?: string
  status?: unknown
  health?: unknown
  lead?: unknown
  members?: unknown[]
  teams?: unknown[]
  labels?: unknown[]
  milestones?: unknown[]
  resources?: unknown[]
  latestUpdate?: unknown
  lastUpdate?: unknown
}

type LinearProjectTableProps = {
  projects: LinearProjectSummary[]
  loading: boolean
  hasError?: boolean
  selectedProjectId?: string | null
  workspaceSelection?: string | null
  onSelectProject: (project: LinearProjectSummary) => void
  onOpenProject: (project: LinearProjectSummary) => void
  onUseProjectIssues?: (project: LinearProjectSummary) => void
}

type LinearCustomViewTableProps = {
  views: LinearCustomViewSummary[]
  loading: boolean
  hasError?: boolean
  selectedViewId?: string | null
  workspaceSelection?: string | null
  onSelectView: (view: LinearCustomViewSummary) => void
  onOpenView: (view: LinearCustomViewSummary) => void
}

type LinearProjectOverviewProps = {
  project: LinearProjectDetail | LinearProjectSummary | null
  loading: boolean
  error?: string | null
  onBack: () => void
  onOpenProject: (project: LinearProjectSummary) => void
  onRefresh: () => void
  onOpenIssues?: () => void
}

type LinearCollectionNoticeProps = {
  errors?: LinearWorkspaceError[]
  hasMore?: boolean
  count: number
  label: string
  onLoadMore?: () => void
  loading?: boolean
  loadMoreLabel?: string
}

import {
  textFromUnknown,
  dateLabel,
  priorityLabel,
  projectProgress,
  listLabels,
  workspaceLabel,
  ProjectColorMark,
  ProjectStatusBadge,
} from './linear-project-view-model'

export function LinearProjectTable({
  projects,
  loading,
  hasError,
  selectedProjectId,
  workspaceSelection,
  onSelectProject,
  onOpenProject,
  onUseProjectIssues
}: LinearProjectTableProps): React.JSX.Element {
  if (loading && projects.length === 0) {
    return (
      <div className="divide-y divide-border/50">
        {Array.from({ length: 10 }).map((_, index) => (
          <div
            key={index}
            className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(180px,1.5fr)_110px_100px_90px_120px_110px_80px_70px]"
          >
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-10 animate-pulse rounded bg-muted/60" />
            <div />
          </div>
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">
          {hasError
            ? translate(
                'auto.components.linear.project.view.surfaces.c9b6e9f90d',
                'Unable to load Linear projects'
              )
            : translate(
                'auto.components.linear.project.view.surfaces.a2f31c4cd6',
                'No Linear projects found'
              )}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasError
            ? translate(
                'auto.components.linear.project.view.surfaces.f4c79cff5f',
                'Review the workspace error below, then refresh.'
              )
            : translate(
                'auto.components.linear.project.view.surfaces.30402d2c6e',
                'Try search or refresh.'
              )}
        </p>
      </div>
    )
  }

  return (
    <div className="min-w-[820px] divide-y divide-border/50">
      {projects.map((project) => {
        const projectLike = project as LinearProjectLike
        const selected = project.id === selectedProjectId
        const labels = listLabels(projectLike.labels, 2)
        const workspace = workspaceLabel(workspaceSelection, project.workspaceName)
        const progress = projectProgress(projectLike)
        return (
          <div
            key={`${project.workspaceId ?? 'workspace'}-${project.id}`}
            role="button"
            tabIndex={0}
            aria-current={selected ? 'true' : undefined}
            data-current={selected ? 'true' : undefined}
            onClick={() => onSelectProject(project)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) {
                return
              }
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectProject(project)
              }
            }}
            className={cn(
              'group/row grid min-h-12 cursor-pointer grid-cols-[minmax(180px,1.5fr)_110px_100px_90px_120px_110px_80px_70px] items-center gap-3 px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              selected && 'bg-accent'
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <ProjectColorMark project={project} />
                <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                  {project.name}
                </span>
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                {workspace ? <span className="truncate">{workspace}</span> : null}
                {labels.map((label) => (
                  <Badge key={label} variant="outline" className="px-1.5 py-0 text-[10px]">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <ProjectStatusBadge project={projectLike} />
            </div>
            <span className="truncate text-[12px] text-muted-foreground">
              {textFromUnknown(projectLike.health) ??
                translate('auto.components.linear.project.view.surfaces.8bbecb2510', 'None')}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {priorityLabel(projectLike.priority, projectLike.priorityLabel)}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {textFromUnknown(projectLike.lead) ??
                translate('auto.components.linear.project.view.surfaces.df4bd63c1d', 'Unassigned')}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {dateLabel(project.targetDate)}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {typeof project.issueCount === 'number'
                ? project.issueCount
                : typeof project.scope === 'number'
                  ? project.scope
                  : progress !== null
                    ? `${progress}%`
                    : '-'}
            </span>
            <div className="flex items-center justify-end gap-1 md:opacity-0 md:transition-opacity md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100">
              {onUseProjectIssues ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        onUseProjectIssues(project)
                      }}
                      aria-label={translate(
                        'auto.components.linear.project.view.surfaces.7616c986c6',
                        'Open {{value0}} issues',
                        { value0: project.name }
                      )}
                    >
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate('auto.components.linear.project.view.surfaces.ee3d2caabd', 'Issues')}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenProject(project)
                    }}
                    aria-label={translate(
                      'auto.components.linear.project.view.surfaces.7616c986c6',
                      'Open {{value0}} in Linear',
                      { value0: project.name }
                    )}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate(
                    'auto.components.linear.project.view.surfaces.aac9a4afc6',
                    'Open in Linear'
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )
      })}
    </div>
  )
}


