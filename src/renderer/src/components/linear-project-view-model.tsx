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

export function textFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  for (const key of ['name', 'label', 'displayName', 'title', 'status', 'body']) {
    const text = record[key]
    if (typeof text === 'string' && text.trim()) {
      return text.trim()
    }
  }
  return null
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) {
    return 'None'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export function priorityLabel(priority: unknown, fallback: unknown): string {
  const fromFallback = textFromUnknown(fallback)
  if (fromFallback) {
    return fromFallback
  }
  if (typeof priority === 'number') {
    return priority === 0 ? 'None' : `P${priority}`
  }
  return textFromUnknown(priority) ?? 'None'
}

export function projectProgress(project: LinearProjectLike): number | null {
  const progress = typeof project.progress === 'number' ? project.progress : null
  if (progress === null || !Number.isFinite(progress)) {
    return null
  }
  return progress <= 1 ? Math.round(progress * 100) : Math.round(progress)
}

export function listLabels(values: unknown[] | undefined, limit: number): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .map((value) => textFromUnknown(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, limit)
}

export function workspaceLabel(
  workspaceSelection: string | null | undefined,
  workspaceName?: string
): string | null {
  return workspaceSelection === 'all' && workspaceName ? workspaceName : null
}

export function ProjectColorMark({ project }: { project: LinearProjectSummary }): React.JSX.Element {
  return (
    <span
      className="size-2.5 shrink-0 rounded-sm border border-border/50 bg-muted"
      style={project.color ? { backgroundColor: project.color } : undefined}
      aria-hidden
    />
  )
}

export function ProjectStatusBadge({ project }: { project: LinearProjectLike }): React.JSX.Element {
  const label = textFromUnknown(project.status) ?? 'Backlog'
  return (
    <Badge variant="outline" className="max-w-full truncate text-[11px] font-medium">
      {label}
    </Badge>
  )
}


