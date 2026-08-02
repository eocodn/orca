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

export function LinearCollectionNotice({
  errors,
  hasMore,
  count,
  label,
  onLoadMore,
  loading = false,
  loadMoreLabel = 'Load more'
}: LinearCollectionNoticeProps): React.JSX.Element | null {
  if (!hasMore && (!errors || errors.length === 0)) {
    return null
  }

  return (
    <div className="flex flex-none flex-col gap-2 border-t border-border/50 bg-muted/50 text-xs text-muted-foreground">
      {errors && errors.length > 0 ? (
        <div className={cn('flex flex-wrap gap-2 px-3', hasMore ? 'pt-2' : 'py-2')}>
          {errors.map((error) => (
            <Badge key={`${error.workspaceId}-${error.type}`} variant="outline">
              {error.workspaceName ?? error.workspaceId}: {error.message}
            </Badge>
          ))}
        </div>
      ) : null}
      {hasMore ? (
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3">
          {onLoadMore ? null : (
            <span>
              {translate(
                'auto.components.linear.project.view.surfaces.06b887d622',
                'Showing first'
              )}{' '}
              {count} {label}
              {translate(
                'auto.components.linear.project.view.surfaces.98730088a6',
                '. Search or open Linear for the full set.'
              )}
            </span>
          )}
          {onLoadMore ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onLoadMore}
              disabled={loading}
              className="inline-flex h-auto w-24 shrink-0 items-center justify-center gap-0.5 rounded-md border-0 bg-transparent px-2 py-1 text-sm text-muted-foreground shadow-none transition hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              {loading ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {translate('auto.components.linear.project.view.surfaces.93e1f6bfca', 'Loading')}
                </>
              ) : (
                <>
                  {loadMoreLabel}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}


