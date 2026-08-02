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

export function LinearProjectOverview({
  project,
  loading,
  error,
  onBack,
  onOpenProject,
  onRefresh,
  onOpenIssues
}: LinearProjectOverviewProps): React.JSX.Element {
  const projectLike = project as LinearProjectLike | null
  const progress = projectLike ? projectProgress(projectLike) : null
  const teams = listLabels(projectLike?.teams, 4)
  const labels = listLabels(projectLike?.labels, 4)
  const members = listLabels(projectLike?.members, 4)
  const milestones = listLabels(projectLike?.milestones, 4)
  const resources = listLabels(projectLike?.resources, 4)
  const latestUpdate = textFromUnknown(projectLike?.latestUpdate ?? projectLike?.lastUpdate)
  const body = projectLike?.content || projectLike?.description || projectLike?.summary || ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onBack}
            aria-label={translate(
              'auto.components.linear.project.view.surfaces.5f79bc76b0',
              'Back to projects'
            )}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">
              {project?.name ??
                translate('auto.components.linear.project.view.surfaces.85607ff793', 'Project')}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {project?.workspaceName
                ? translate(
                    'auto.components.linear.project.view.surfaces.906b5e4cb8',
                    'Linear / Projects / {{value0}}',
                    { value0: project.workspaceName }
                  )
                : translate(
                    'auto.components.linear.project.view.surfaces.f2cc1e0ff6',
                    'Linear / Projects'
                  )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenIssues ? (
            <Button
              variant="outline"
              size="xs"
              onClick={onOpenIssues}
              className="gap-1 border-border/50 bg-background/70"
            >
              <Layers3 className="size-3.5" />
              {translate('auto.components.linear.project.view.surfaces.ee3d2caabd', 'Issues')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={onRefresh}
            disabled={loading}
            className="gap-1 border-border/50 bg-background/70"
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {translate('auto.components.linear.project.view.surfaces.a9785c7158', 'Refresh')}
          </Button>
          {project ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onOpenProject(project)}
              className="gap-1 border-border/50 bg-background/70"
            >
              <ExternalLink className="size-3.5" />
              {translate('auto.components.linear.project.view.surfaces.7b147907dc', 'Linear')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-sleek">
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {loading && !project ? (
          <div className="space-y-3">
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted/70" />
            <div className="h-24 animate-pulse rounded-md bg-muted/50" />
            <div className="h-40 animate-pulse rounded-md bg-muted/50" />
          </div>
        ) : projectLike ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-4">
              <section className="rounded-md border border-border/50 bg-muted/20 p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <ProjectColorMark project={projectLike} />
                  <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
                    {projectLike.name}
                  </h2>
                </div>
                {body ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {translate(
                      'auto.components.linear.project.view.surfaces.bb5664d456',
                      'No project description.'
                    )}
                  </p>
                )}
              </section>

              {progress !== null ? (
                <section className="rounded-md border border-border/50 bg-muted/20 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {translate(
                        'auto.components.linear.project.view.surfaces.563501f191',
                        'Progress'
                      )}
                    </span>
                    <span className="text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={Math.max(0, Math.min(100, progress))} />
                  {typeof projectLike.scope === 'number' ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {projectLike.scope}{' '}
                      {translate(
                        'auto.components.linear.project.view.surfaces.3ad562bdf4',
                        'scoped issues'
                      )}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {milestones.length > 0 || resources.length > 0 || latestUpdate ? (
                <section className="rounded-md border border-border/50 bg-muted/20 p-4">
                  <h3 className="text-sm font-medium text-foreground">
                    {translate(
                      'auto.components.linear.project.view.surfaces.5d99315fb8',
                      'Planning'
                    )}
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <MetadataList
                      icon={<FolderKanban className="size-3.5" />}
                      label={translate(
                        'auto.components.linear.project.view.surfaces.bb1405eff8',
                        'Milestones'
                      )}
                      items={milestones}
                    />
                    <MetadataList
                      icon={<FileText className="size-3.5" />}
                      label={translate(
                        'auto.components.linear.project.view.surfaces.c8db98b73b',
                        'Resources'
                      )}
                      items={resources}
                    />
                    <MetadataList
                      icon={<RefreshCw className="size-3.5" />}
                      label={translate(
                        'auto.components.linear.project.view.surfaces.0a6a5a7dd6',
                        'Latest update'
                      )}
                      items={latestUpdate ? [latestUpdate] : []}
                    />
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="min-w-0 space-y-3">
              <PropertyRow
                label={translate(
                  'auto.components.linear.project.view.surfaces.9ddb58edbd',
                  'Status'
                )}
                value={textFromUnknown(projectLike.status) ?? 'Backlog'}
              />
              <PropertyRow
                label={translate(
                  'auto.components.linear.project.view.surfaces.f5ef24cf46',
                  'Health'
                )}
                value={textFromUnknown(projectLike.health) ?? 'None'}
              />
              <PropertyRow
                label={translate(
                  'auto.components.linear.project.view.surfaces.3be47aed6f',
                  'Priority'
                )}
                value={priorityLabel(projectLike.priority, projectLike.priorityLabel)}
              />
              <PropertyRow
                label={translate('auto.components.linear.project.view.surfaces.111bef9aa8', 'Lead')}
                value={textFromUnknown(projectLike.lead) ?? 'Unassigned'}
                icon={<UserRound className="size-3.5" />}
              />
              <PropertyRow
                label={translate(
                  'auto.components.linear.project.view.surfaces.3fb6473111',
                  'Start'
                )}
                value={dateLabel(projectLike.startDate)}
                icon={<CalendarDays className="size-3.5" />}
              />
              <PropertyRow
                label={translate(
                  'auto.components.linear.project.view.surfaces.25a2196732',
                  'Target'
                )}
                value={dateLabel(projectLike.targetDate)}
                icon={<CalendarDays className="size-3.5" />}
              />
              <MetadataList
                label={translate(
                  'auto.components.linear.project.view.surfaces.c5f79616c3',
                  'Teams'
                )}
                items={teams}
              />
              <MetadataList
                label={translate(
                  'auto.components.linear.project.view.surfaces.65bda65159',
                  'Members'
                )}
                items={members}
              />
              <MetadataList
                label={translate(
                  'auto.components.linear.project.view.surfaces.1748d3b9af',
                  'Labels'
                )}
                items={labels}
              />
            </aside>
          </div>
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {translate(
              'auto.components.linear.project.view.surfaces.e1fa97d21d',
              'Select a project to view its overview.'
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyRow({
  label,
  value,
  icon
}: {
  label: string
  value: string
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm text-foreground">{value}</div>
    </div>
  )
}

function MetadataList({
  icon,
  label,
  items
}: {
  icon?: React.ReactNode
  label: string
  items: string[]
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
      </div>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <Badge key={item} variant="outline" className="max-w-full truncate">
              {item}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted-foreground">
          {translate('auto.components.linear.project.view.surfaces.8bbecb2510', 'None')}
        </div>
      )}
    </div>
  )
}

