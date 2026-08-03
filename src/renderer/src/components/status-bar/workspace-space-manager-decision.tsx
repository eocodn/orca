// Concrete surface implementation for WorkspaceSpaceManagerPanel.tsx
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

export function getTreemapFill(rect: TreemapRect, selected: boolean): string {
  if (selected) {
    return 'color-mix(in srgb, var(--ring) 40%, var(--card))'
  }
  return TREEMAP_FILLS[rect.index % TREEMAP_FILLS.length]
}

export function Metric({
  label,
  value,
  title
}: {
  label: string
  value: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums" title={title}>
        {value}
      </div>
    </div>
  )
}

export function UpdatedMetric({
  scannedAt,
  isScanning
}: {
  scannedAt: number | null
  isScanning: boolean
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (scannedAt === null) {
      return
    }
    // Refresh once immediately (unconditional, as before) so a rescan that lands
    // while hidden isn't shown stale, then pause the ongoing 60s tick while the
    // window is hidden — same visibility-gated pattern as useNow.
    setNow(Date.now())
    return installWindowVisibilityInterval({ run: () => setNow(Date.now()), intervalMs: 60_000 })
  }, [scannedAt])

  return (
    <Metric
      label={translate(
        'auto.components.status.bar.WorkspaceSpaceManagerPanel.52b629eb84',
        'Updated'
      )}
      title={scannedAt === null ? undefined : getWorkspaceSpaceScanDateTimeLabel(scannedAt)}
      value={
        scannedAt === null
          ? isScanning
            ? 'Scanning'
            : '—'
          : getWorkspaceSpaceScanTimeLabel(scannedAt, now)
      }
    />
  )
}

export function CheckButton({
  checked,
  disabled,
  label,
  onClick
}: {
  checked: boolean | 'mixed'
  disabled?: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  const isChecked = checked === true
  const isMixed = checked === 'mixed'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-default opacity-35'
      )}
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded-sm border transition-colors',
          isChecked || isMixed
            ? 'border-foreground bg-foreground text-background'
            : 'border-muted-foreground/50 bg-background/40 text-transparent'
        )}
      >
        {isChecked ? <Check className="size-3" strokeWidth={3} /> : null}
        {isMixed ? <Minus className="size-3" strokeWidth={3} /> : null}
      </span>
    </button>
  )
}

export function SortIndicator({
  sortKey,
  activeKey,
  direction
}: {
  sortKey: WorkspaceSpaceSortKey
  activeKey: WorkspaceSpaceSortKey
  direction: WorkspaceSpaceSortDirection
}): React.JSX.Element {
  if (sortKey !== activeKey) {
    return <Circle className="size-3 opacity-0" />
  }
  return direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
}

export function StatusBadge({
  worktree,
  decisionDetails,
  deleteState
}: {
  worktree: WorkspaceSpaceWorktree
  decisionDetails?: WorkspaceDecisionDetails
  deleteState?: WorkspaceSpaceDeleteState
}): React.JSX.Element {
  if (deleteState?.isDeleting) {
    return (
      <Badge variant="outline" className="gap-1.5 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.33653dbac2', 'Deleting')}
      </Badge>
    )
  }
  if (deleteState?.error) {
    return (
      <Badge variant="outline" className="border-destructive/30 text-destructive">
        {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.39801484e0', 'Failed')}
      </Badge>
    )
  }
  if (worktree.status !== 'ok') {
    return (
      <Badge variant="outline" className="border-destructive/30 text-destructive">
        {getWorkspaceSpaceStatusLabel(worktree.status)}
      </Badge>
    )
  }
  if (worktree.isMainWorktree) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.2b501ee391',
          'Keep: main'
        )}
      </Badge>
    )
  }
  if (decisionDetails?.isActive) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.7f7895514e',
          'Keep: active'
        )}
      </Badge>
    )
  }
  if ((decisionDetails?.changedFileCount ?? 0) > 0) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.7ab8d7e2d7',
          'Keep: changed files'
        )}
      </Badge>
    )
  }
  if (decisionDetails?.changedFileCount === null) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.ec7b076a75',
          'Keep: git not checked'
        )}
      </Badge>
    )
  }
  if ((decisionDetails?.dirtyEditorBufferCount ?? 0) > 0) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.2055bc6a5a',
          'Keep: unsaved edits'
        )}
      </Badge>
    )
  }
  if (
    (decisionDetails?.activeAgentCount ?? 0) > 0 ||
    (decisionDetails?.liveTerminalCount ?? 0) > 0 ||
    (decisionDetails?.browserTabCount ?? 0) > 0
  ) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.cbc343a7a8',
          'Keep: in use'
        )}
      </Badge>
    )
  }
  if (
    decisionDetails?.reviewLabel ||
    decisionDetails?.issueLabel ||
    decisionDetails?.linearIssueLabel
  ) {
    return (
      <Badge variant="outline">
        {translate(
          'auto.components.status.bar.WorkspaceSpaceManagerPanel.720870a18e',
          'Keep: linked'
        )}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    >
      {translate('auto.components.status.bar.WorkspaceSpaceManagerPanel.7d7745bb8f', 'Can delete')}
    </Badge>
  )
}

export function DecisionLine({
  icon,
  label,
  value,
  tone = 'default'
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground [&>svg]:size-3',
          tone === 'warning' && 'border-destructive/25 bg-destructive/8 text-destructive'
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 truncate text-xs" title={value}>
          {value}
        </div>
      </div>
    </div>
  )
}

export function getAgentDecisionLabel(details: WorkspaceDecisionDetails): string {
  if (details.activeAgentCount > 0 && details.completedAgentCount > 0) {
    return `${pluralize(details.activeAgentCount, 'active agent')}, ${pluralize(
      details.completedAgentCount,
      'completed agent'
    )}`
  }
  if (details.activeAgentCount > 0) {
    return pluralize(details.activeAgentCount, 'active agent')
  }
  if (details.completedAgentCount > 0) {
    return `${pluralize(details.completedAgentCount, 'completed agent')} retained`
  }
  return 'No tracked agents running'
}

export function getTerminalDecisionLabel(details: WorkspaceDecisionDetails): string {
  if (details.terminalTabCount === 0) {
    return 'No terminal tabs'
  }
  return `${details.liveTerminalCount} live of ${pluralize(details.terminalTabCount, 'terminal tab')}`
}

export function getGitDecisionLabel(
  details: WorkspaceDecisionDetails,
  gitRefreshState?: WorkspaceGitRefreshState
): string {
  if (details.changedFileCount === null) {
    if (gitRefreshState?.error) {
      return `Git status unavailable: ${gitRefreshState.error}`
    }
    return 'Git status has not loaded yet'
  }
  if (details.changedFileCount === 0) {
    return 'No uncommitted files'
  }
  return pluralize(details.changedFileCount, 'changed file')
}

export function getEditorDecisionLabel(details: WorkspaceDecisionDetails): string {
  if (details.openEditorFileCount === 0) {
    return 'No editor files open'
  }
  if (details.dirtyEditorBufferCount === 0) {
    return `${pluralize(details.openEditorFileCount, 'editor file')} open`
  }
  return `${pluralize(details.dirtyEditorBufferCount, 'dirty editor buffer')} of ${pluralize(
    details.openEditorFileCount,
    'open file'
  )}`
}

export function getDeleteDecisionLabel(
  worktree: WorkspaceSpaceWorktree,
  details: WorkspaceDecisionDetails
): string {
  if (details.isActive) {
    return 'This is the active workspace'
  }
  if (worktree.status !== 'ok') {
    return worktree.error ?? getWorkspaceSpaceStatusLabel(worktree.status)
  }
  if (worktree.isMainWorktree) {
    return 'Main worktree is protected'
  }
  if (!worktree.canDelete) {
    return 'Workspace is protected'
  }
  return 'Can be deleted after review'
}

export function WorkspaceDecisionHoverCard({
  worktree,
  details,
  gitRefreshState,
  onOpenWorkspace
}: {
  worktree: WorkspaceSpaceWorktree
  details: WorkspaceDecisionDetails
  gitRefreshState?: WorkspaceGitRefreshState
  onOpenWorkspace: () => void
}): React.JSX.Element {
  const deleteDecision = getDeleteDecisionLabel(worktree, details)
  const issueLabel =
    [details.issueLabel, details.linearIssueLabel].filter(Boolean).join(' · ') || 'No linked issue'
  return (
    <HoverCardContent
      align="end"
      side="bottom"
      sideOffset={8}
      collisionPadding={12}
      className="max-h-[min(34rem,calc(100vh-1.5rem))] w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto p-0 scrollbar-sleek"
    >
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{worktree.displayName}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {worktree.repoDisplayName} · {formatBytes(worktree.sizeBytes)}
            </div>
          </div>
          <StatusBadge worktree={worktree} decisionDetails={details} />
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <DecisionLine
          icon={<Trash2 />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.d384a4ce9f',
            'Delete decision'
          )}
          value={deleteDecision}
          tone={worktree.canDelete && worktree.status === 'ok' ? 'default' : 'warning'}
        />
        <DecisionLine
          icon={<Bot />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.a8d9e0de79',
            'Agents'
          )}
          value={getAgentDecisionLabel(details)}
        />
        <DecisionLine
          icon={<Terminal />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.e9528a89b3',
            'Terminals'
          )}
          value={getTerminalDecisionLabel(details)}
        />
        <DecisionLine
          icon={<FileWarning />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.0bc756efaf',
            'Git changes'
          )}
          value={getGitDecisionLabel(details, gitRefreshState)}
          tone={
            (details.changedFileCount ?? 0) > 0 || gitRefreshState?.error ? 'warning' : 'default'
          }
        />
        <DecisionLine
          icon={<FileWarning />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.c432278ec7',
            'Editor buffers'
          )}
          value={getEditorDecisionLabel(details)}
          tone={details.dirtyEditorBufferCount > 0 ? 'warning' : 'default'}
        />
        <DecisionLine
          icon={<GitBranch />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.b9b4a3a25d',
            'Branch'
          )}
          value={details.branchStatus ?? getWorkspaceSpaceBranchLabel(worktree)}
        />
        <DecisionLine
          icon={<GitPullRequest />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.fb2069acb7',
            'Review'
          )}
          value={details.reviewLabel ?? 'No linked PR'}
        />
        <DecisionLine
          icon={<ExternalLink />}
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.66870929fb',
            'Issue'
          )}
          value={issueLabel}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {details.browserTabCount > 0
            ? translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.131662ac65',
                '{{value0}} open',
                { value0: pluralize(details.browserTabCount, 'browser tab') }
              )
            : worktree.path}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenWorkspace()
          }}
          disabled={!details.canOpenWorkspace}
          className="shrink-0 gap-1.5"
        >
          <ExternalLink className="size-3.5" />
          {translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.c28643d3da',
            'Go to workspace'
          )}
        </Button>
      </div>
    </HoverCardContent>
  )
}
