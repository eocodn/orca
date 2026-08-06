import { useMemo } from 'react'
import { AlertTriangle, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import type {
  WorkspaceSpaceItem,
  WorkspaceSpaceWorktree
} from '../../../../shared/workspace-space-types'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { formatBytes, formatCompactCount } from './workspace-space-format'
import { buildTreemapLayout } from './workspace-space-layout'
import { getLargestWorkspaceSpaceItemSize } from './workspace-space-presentation'
import { translate } from '@/i18n/i18n'

export {
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

export function SizeBar({ value, max }: { value: number; max: number }): React.JSX.Element {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-foreground/65" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function BreakdownList({
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

export function BreakdownRow({
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

export { WorkspaceRow } from './workspace-space-manager-workspace-row'
