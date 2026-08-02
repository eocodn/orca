// Concrete surface implementation for WorkspaceSpaceManagerPanel.tsx
   breakdown, and table pieces share one scan state and should evolve as one resource-manager surface. */
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: the relative time clock advances from a wall-clock interval, which is an external timer rather than render-derived state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Circle,
  ExternalLink,
  FileWarning,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Loader2,
  Minus,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  ZoomIn,
  ZoomOut,
  X
} from 'lucide-react'
import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import type { GitStatusResult, Repo, TerminalTab, Worktree } from '../../../../shared/types'
import type {
  WorkspaceSpaceItem,
  WorkspaceSpaceWorktree
} from '../../../../shared/workspace-space-types'
import { cn } from '@/lib/utils'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { toast } from 'sonner'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '../../store'
import { getRepoMapFromState, getWorktreeMapFromState } from '../../store/selectors'
import { getHostedReviewCacheKey } from '../../store/slices/hosted-review'
import { issueCacheKey as getIssueCacheKey } from '../../store/slices/github'
import { refreshGitStatusForWorktree } from '../right-sidebar/git-status-refresh'
import { runWorktreeBatchDelete } from '../sidebar/delete-worktree-flow'
import { prepareActiveWorktreeFocusAfterDelete } from '../sidebar/active-worktree-focus-after-delete'
import { branchDisplayName } from '../sidebar/WorktreeCardHelpers'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../ui/context-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  formatBytes,
  formatCompactCount,
  getWorkspaceSpaceBranchLabel,
  getWorkspaceSpaceProgressLabel,
  getWorkspaceSpaceScanDateTimeLabel,
  getWorkspaceSpaceScanTimeLabel,
  getWorkspaceSpaceStatusLabel
} from './workspace-space-format'
import { buildTreemapLayout, type TreemapRect } from './workspace-space-layout'
import {
  filterWorkspaceSpaceRows,
  countWorkspaceSpaceActiveAgents,
  getLargestWorkspaceSpaceItemSize,
  getLargestWorkspaceSpaceRowSize,
  getSelectedDeletableWorkspaceIds,
  getVisibleDeletableWorkspaceIds,
  getWorkspaceSpaceGitStatusRefreshCandidates,
  isWorkspaceSpaceRowReadyToDelete,
  pruneWorkspaceSpaceSelectedIds,
  resolveWorkspaceSpaceInspectedWorktreeId,
  resolveWorkspaceSpaceTreemapZoomWorktreeId,
  sortWorkspaceSpaceRows,
  type WorkspaceSpaceSortDirection,
  type WorkspaceSpaceSortKey
} from './workspace-space-presentation'
import { translate } from '@/i18n/i18n'
import type { WorktreeForceDeleteReason } from '../../../../shared/worktree-removal'

import type { WorkspaceDecisionDetails } from './workspace-space-manager-decision-model'

const TREEMAP_FILLS = [
  'color-mix(in srgb, var(--chart-2) 34%, var(--card))',
  'color-mix(in srgb, var(--foreground) 20%, var(--card))',
  'color-mix(in srgb, var(--chart-4) 28%, var(--card))',
  'color-mix(in srgb, var(--primary) 24%, var(--card))',
  'color-mix(in srgb, var(--chart-1) 38%, var(--card))'
]

export import {
  BreakdownRow,
  DecisionLine,
  getAgentDecisionLabel,
  getDeleteDecisionLabel,
  getEditorDecisionLabel,
  getGitDecisionLabel,
  getTerminalDecisionLabel,
  Metric,
  StatusBadge,
  WorkspaceDecisionHoverCard,
  getTreemapFill
} from './workspace-space-manager-decision'

export function WorkspaceTreemap({
  rows,
  isScanning,
  selectedWorktreeId,
  zoomedWorktree,
  onSelect,
  onZoomChange
}: {
  rows: WorkspaceSpaceWorktree[]
  isScanning: boolean
  selectedWorktreeId: string | null
  zoomedWorktree: WorkspaceSpaceWorktree | null
  onSelect: (worktreeId: string) => void
  onZoomChange: (worktreeId: string | null) => void
}): React.JSX.Element {
  const selectedWorktree = rows.find((row) => row.worktreeId === selectedWorktreeId) ?? null
  const canZoomSelected =
    !!selectedWorktree &&
    selectedWorktree.status === 'ok' &&
    selectedWorktree.topLevelItems.length > 0
  const isZoomed = !!zoomedWorktree
  const rects = useMemo(
    () =>
      buildTreemapLayout(
        zoomedWorktree
          ? zoomedWorktree.topLevelItems
              .filter((item) => item.sizeBytes > 0)
              .map((item) => ({
                id: item.path,
                label: item.name,
                sizeBytes: item.sizeBytes
              }))
          : rows
              .filter((row) => row.status === 'ok' && row.sizeBytes > 0)
              .map((row) => ({
                id: row.worktreeId,
                label: row.displayName,
                sizeBytes: row.sizeBytes
              }))
      ),
    [rows, zoomedWorktree]
  )

  if (rects.length === 0) {
    return (
      <div className="relative flex h-72 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
        {zoomedWorktree ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onZoomChange(null)}
            className="absolute right-2 top-2 gap-1.5 bg-background/90 px-2.5 backdrop-blur"
          >
            <ZoomOut className="size-3" />
            {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.ef890d31b9', 'All')}
          </Button>
        ) : null}
        <span className="flex items-center gap-2">
          {isScanning ? <Loader2 className="size-4 animate-spin" /> : null}
          {isScanning
            ? translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.c5135e7e4a',
                'Scanning workspace sizes. You can leave this page.'
              )
            : isZoomed
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.977bdf9a36',
                  'No top-level items to show.'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.0990a63160',
                  'No scanned workspace sizes yet.'
                )}
        </span>
      </div>
    )
  }

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border border-border/70 bg-muted/20">
      <div className="absolute right-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-2">
        {zoomedWorktree ? (
          <>
            <div className="max-w-56 truncate rounded-md border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium shadow-xs backdrop-blur">
              {zoomedWorktree.displayName}
            </div>
            <Button
              variant="outline"
              size="xs"
              onClick={() => onZoomChange(null)}
              className="gap-1.5 bg-background/90 px-2.5 backdrop-blur"
            >
              <ZoomOut className="size-3" />
              {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.ef890d31b9', 'All')}
            </Button>
          </>
        ) : canZoomSelected ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onZoomChange(selectedWorktree.worktreeId)}
            className="gap-1.5 bg-background/90 px-2.5 backdrop-blur"
          >
            <ZoomIn className="size-3" />
            {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.d3f9c69ddc', 'Zoom')}
          </Button>
        ) : null}
      </div>
      {rects.map((rect) => {
        const area = rect.width * rect.height
        const selected = !isZoomed && rect.id === selectedWorktreeId
        const rectStyle = {
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
          background: getTreemapFill(rect, selected)
        }
        const rectContent =
          area >= 80 ? (
            <span className="block min-w-0 text-[11px] font-medium leading-tight text-foreground">
              <span className="block truncate">{rect.label}</span>
              {area >= 180 ? (
                <span className="mt-0.5 block truncate text-muted-foreground">
                  {formatBytes(rect.sizeBytes)}
                </span>
              ) : null}
            </span>
          ) : null

        if (isZoomed) {
          return (
            <div
              key={rect.id}
              title={`${rect.label} • ${formatBytes(rect.sizeBytes)}`}
              className="absolute overflow-hidden border border-background/80 p-2 text-left"
              style={rectStyle}
            >
              {rectContent}
            </div>
          )
        }

        return (
          <button
            key={rect.id}
            type="button"
            aria-label={`${rect.label}, ${formatBytes(rect.sizeBytes)}`}
            title={`${rect.label} • ${formatBytes(rect.sizeBytes)}`}
            onClick={() => onSelect(rect.id)}
            className={cn(
              'absolute overflow-hidden border border-background/80 p-2 text-left transition-[filter,outline] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'ring-2 ring-ring ring-offset-1 ring-offset-background'
            )}
            style={rectStyle}
          >
            {rectContent}
          </button>
        )
      })}
    </div>
  )
}

export export function SizeBar({ value, max }: { value: number; max: number }): React.JSX.Element {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-foreground/65" style={{ width: `${pct}%` }} />
    </div>
  )
}

export export function BreakdownList({
  worktree,
  isScanning
}: {
  worktree: WorkspaceSpaceWorktree | null
  isScanning: boolean
}): React.JSX.Element {
  if (!worktree) {
    return (
      <div className="flex h-full min-h-72 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/15 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          {isScanning ? <Loader2 className="size-4 animate-spin" /> : null}
          {isScanning
            ? translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.c5135e7e4a',
                'Scanning workspace sizes. You can leave this page.'
              )
            : translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.5c6d25720c',
                'Select a workspace to inspect.'
              )}
        </span>
      </div>
    )
  }

  const maxChildSize = getLargestWorkspaceSpaceItemSize(worktree.topLevelItems)
  const topLevelItemCount = worktree.topLevelItems.length + worktree.omittedTopLevelItemCount
  return (
    <div className="min-h-72 rounded-lg border border-border/70 bg-background/35">
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{worktree.displayName}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {worktree.repoDisplayName}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold tabular-nums">
              {formatBytes(worktree.sizeBytes)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {formatCompactCount(topLevelItemCount)}{' '}
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.b25c2c1086',
                'top-level items'
              )}
            </div>
          </div>
        </div>
      </div>

      {worktree.status !== 'ok' ? (
        <div className="flex items-start gap-2 px-4 py-4 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {worktree.error ??
              translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.0ba046fbc5',
                'Scan failed.'
              )}
          </span>
        </div>
      ) : worktree.topLevelItems.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.16988df079',
            'No files found.'
          )}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto scrollbar-sleek px-3 py-3">
          <div className="space-y-2">
            {worktree.topLevelItems.slice(0, 12).map((item) => (
              <BreakdownRow key={`${item.path}:${item.name}`} item={item} maxSize={maxChildSize} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export export function BreakdownRow({
  item,
  maxSize
}: {
  item: WorkspaceSpaceItem
  maxSize: number
}): React.JSX.Element {
  return (
    <div className="space-y-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium">{item.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatBytes(item.sizeBytes)}
        </span>
      </div>
      <SizeBar value={item.sizeBytes} max={maxSize} />
    </div>
  )
}

export export function WorkspaceRow({
  worktree,
  maxSize,
  selected,
  inspected,
  decisionDetails,
  gitRefreshState,
  deleteState,
  onToggleSelected,
  onInspect,
  onOpenWorkspace,
  onDelete,
  onForceDelete
}: {
  worktree: WorkspaceSpaceWorktree
  maxSize: number
  selected: boolean
  inspected: boolean
  decisionDetails: WorkspaceDecisionDetails
  gitRefreshState?: WorkspaceGitRefreshState
  deleteState?: WorkspaceSpaceDeleteState
  onToggleSelected: () => void
  onInspect: () => void
  onOpenWorkspace: () => void
  onDelete: () => void
  onForceDelete: () => void
}): React.JSX.Element {
  const isDeleting = deleteState?.isDeleting ?? false
  const deleteError = deleteState?.error ?? null
  const canForceDelete = deleteState?.canForceDelete ?? false
  const canDelete = isWorkspaceSpaceRowReadyToDelete(worktree, decisionDetails) && !isDeleting
  const handleForceDelete = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    onForceDelete()
  }
  const row = (
    <div
      role="button"
      tabIndex={0}
      aria-busy={isDeleting}
      onClick={onInspect}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        event.preventDefault()
        onInspect()
      }}
      className={cn(
        'grid w-full cursor-pointer grid-cols-[1.75rem_minmax(0,1.25fr)_minmax(9rem,0.55fr)_8rem_9.5rem] items-center gap-3 border-b border-border/45 px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        inspected && 'bg-accent/55',
        isDeleting && 'cursor-wait opacity-50 grayscale hover:bg-transparent'
      )}
    >
      <CheckButton
        checked={canDelete && selected}
        disabled={!canDelete}
        label={translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.0d1c78d749',
          'Select {{value0}}',
          { value0: worktree.displayName }
        )}
        onClick={onToggleSelected}
      />

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium">{worktree.displayName}</span>
          {worktree.isRemote ? (
            <Server className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {worktree.isSparse ? (
            <Badge variant="outline">
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.9155381019',
                'Sparse'
              )}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{getWorkspaceSpaceBranchLabel(worktree)}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {worktree.path}
        </div>
        {deleteError ? (
          <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border border-destructive/35 bg-destructive/8 px-2 py-1.5 text-[11px] text-destructive">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span className="min-w-0 flex-1 break-words" title={deleteError}>
              {deleteError}
            </span>
            {canForceDelete ? (
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={handleForceDelete}
                className="h-6 shrink-0 gap-1 px-2"
              >
                <Trash2 className="size-3" />
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.a998501630',
                  'Force'
                )}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 text-xs">
        <div className="truncate font-medium">{worktree.repoDisplayName}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {worktree.repoPath}
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <div className="text-right text-sm font-medium tabular-nums">
          {worktree.status === 'ok' ? formatBytes(worktree.sizeBytes) : '—'}
        </div>
        <SizeBar value={worktree.sizeBytes} max={maxSize} />
      </div>

      <div className="flex justify-end">
        <HoverCard openDelay={250} closeDelay={120}>
          <HoverCardTrigger asChild>
            <span
              className="inline-flex"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <StatusBadge
                worktree={worktree}
                decisionDetails={decisionDetails}
                deleteState={deleteState}
              />
            </span>
          </HoverCardTrigger>
          <WorkspaceDecisionHoverCard
            worktree={worktree}
            details={decisionDetails}
            gitRefreshState={gitRefreshState}
            onOpenWorkspace={onOpenWorkspace}
          />
        </HoverCard>
      </div>
    </div>
  )

  if (!canDelete) {
    return row
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="size-3.5" />
          {translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.792a214457',
            'Delete workspace'
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}


