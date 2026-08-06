import React from 'react'
import type { MemorySnapshot } from '../../../../shared/types'
import { AlertTriangle, ChevronRight, MemoryStick, RotateCw, Trash2 } from 'lucide-react'
import { PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DaemonActionsApi } from '../shared/useDaemonActions'
import { WorkspaceSpaceCompactPanel } from './WorkspaceSpaceCompactPanel'
import { AppSection, ResourceTree } from './resource-usage-status-rows'
import { formatCpu, formatMemory } from './resource-usage-metrics'
import type { ResourceMemoryMetricCopy } from './resource-memory-metric-copy'
import type { UnifiedProjectGroup, UnifiedSessionRow } from './resource-usage-merge-types'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'
import { translate } from '@/i18n/i18n'

export type ResourceUsageStatusContentProps = {
  daemonUnreachable: boolean
  resourceManagerAriaLabel: string
  spaceScanReady: boolean
  daemonActions: DaemonActionsApi
  sessionsOnlyError: boolean
  resourceSnapshot: MemorySnapshot | null
  totalCpu: number
  totalMemory: number
  memoryMetricCopy: ResourceMemoryMetricCopy
  setPopoverBodyNode: (node: HTMLDivElement | null) => void
  sortOption: 'memory' | 'cpu' | 'name'
  setSortOption: React.Dispatch<React.SetStateAction<'memory' | 'cpu' | 'name'>>
  METRIC_COLUMNS_CLS: string
  CPU_COLUMN_CLS: string
  MEM_COLUMN_CLS: string
  ROW_TRAILING_GUTTER_CLS: string
  unifiedRepos: UnifiedProjectGroup[]
  collapsedRepos: Set<string>
  toggleRepo: (repoId: string) => void
  collapsedWorktrees: Set<string>
  activeWorktreeId: string | null
  toggleWorktree: (worktreeId: string) => void
  navigateToWorktree: (worktreeId: string) => void
  navigateToTab: (tabId: string, paneKey: string | null) => void
  deleteWorktree: (worktreeId: string) => void
  handleKillSession: (session: UnifiedSessionRow) => void
  appCollapsed: boolean
  setAppCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  handleOpenWorkspaceCleanup: () => void
  openSpaceResults: () => void
  handleKillOrphans: () => Promise<void>
  oldWorkspaceCount: number
  orphanCount: number
}

export function ResourceUsageStatusContent({
  daemonUnreachable,
  daemonActions,
  sessionsOnlyError,
  resourceSnapshot,
  totalCpu,
  totalMemory,
  memoryMetricCopy,
  setPopoverBodyNode,
  sortOption,
  setSortOption,
  METRIC_COLUMNS_CLS,
  CPU_COLUMN_CLS,
  MEM_COLUMN_CLS,
  ROW_TRAILING_GUTTER_CLS,
  unifiedRepos,
  collapsedRepos,
  toggleRepo,
  collapsedWorktrees,
  activeWorktreeId,
  toggleWorktree,
  navigateToWorktree,
  navigateToTab,
  deleteWorktree,
  handleKillSession,
  appCollapsed,
  setAppCollapsed,
  handleOpenWorkspaceCleanup,
  openSpaceResults,
  handleKillOrphans,
  oldWorkspaceCount,
  orphanCount
}: ResourceUsageStatusContentProps): React.JSX.Element {
  return (
    <PopoverContent
      side="top"
      align="end"
      sideOffset={8}
      {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
      className="w-[26rem] max-w-[calc(100vw-2rem)] p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onFocusOutside={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-foreground">
          <MemoryStick className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {translate('auto.components.status.bar.StatusBar.d1e1a7a6bf', 'Resource Manager')}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => daemonActions.setPending('restart')}
                disabled={daemonActions.isBusy}
                aria-label={translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.c9382662bb',
                  'Restart daemon'
                )}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent disabled:opacity-40"
              >
                <RotateCw className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.c9382662bb',
                'Restart daemon'
              )}
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => daemonActions.setPending('killAll')}
                disabled={daemonActions.isBusy}
                aria-label={translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.bd19fd7a59',
                  'Kill all sessions'
                )}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 disabled:opacity-40"
              >
                <Trash2 className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.bd19fd7a59',
                'Kill all sessions'
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {daemonUnreachable && (
        <div className="flex items-start gap-2 border-b border-border bg-yellow-500/10 px-3 py-2 text-[11px]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-yellow-500" />
          <div className="flex-1">
            <div className="font-medium">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.f8e0d794b4',
                'Daemon is not responding'
              )}
            </div>
            <div className="text-muted-foreground">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.f85af9cda6',
                'Resource snapshots and terminal sessions are unavailable.'
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => daemonActions.setPending('restart')}
            disabled={daemonActions.isBusy}
          >
            <RotateCw className="mr-1 size-3" />
            {translate(
              'auto.components.status.bar.ResourceUsageStatusSegment.93b0de3c21',
              'Restart'
            )}
          </Button>
        </div>
      )}
      {!daemonUnreachable && sessionsOnlyError && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"
          role="status"
        >
          <AlertTriangle className="size-3 text-yellow-500" />
          {translate(
            'auto.components.status.bar.ResourceUsageStatusSegment.e7cf14ec78',
            'Terminal sessions unavailable. The list may be stale.'
          )}
        </div>
      )}
      {resourceSnapshot && (
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 text-xs tabular-nums">
          <div className="flex items-baseline gap-3">
            <span className="font-medium">{formatCpu(totalCpu)}</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-medium">
              {formatMemory(totalMemory)}{' '}
              <span className="font-normal text-muted-foreground">
                {memoryMetricCopy.summaryLabel}
              </span>
            </span>
          </div>
          {orphanCount > 0 && (
            <span className="shrink-0 text-yellow-500" aria-live="polite">
              {orphanCount === 1
                ? translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.30ff2c3c31',
                    '{{value0}} orphan',
                    { value0: orphanCount }
                  )
                : translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.b8f4a2c1d0e3',
                    '{{value0}} orphans',
                    { value0: orphanCount }
                  )}
            </span>
          )}
        </div>
      )}
      <div ref={setPopoverBodyNode} tabIndex={-1} className="flex h-[420px] flex-col outline-none">
        {(unifiedRepos.length > 0 || resourceSnapshot) && (
          <div className="flex shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-3 py-1 text-[10px] uppercase tracking-wide">
            <button
              type="button"
              onClick={() => setSortOption('name')}
              className={cn(
                'transition-colors hover:text-foreground',
                sortOption === 'name' ? 'font-semibold text-foreground' : 'text-muted-foreground/80'
              )}
            >
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.2aa2de6cb9',
                'Name'
              )}
            </button>
            <div className="flex items-center gap-2">
              <div className={cn(METRIC_COLUMNS_CLS, 'text-[10px]')}>
                <button
                  type="button"
                  onClick={() => setSortOption('cpu')}
                  className={cn(CPU_COLUMN_CLS, 'hover:text-foreground')}
                >
                  {translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.298f4be7f2',
                    'CPU'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSortOption('memory')}
                  className={cn(MEM_COLUMN_CLS, 'hover:text-foreground')}
                >
                  {memoryMetricCopy.columnLabel}
                </button>
              </div>
              <span className={ROW_TRAILING_GUTTER_CLS} aria-hidden />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto scrollbar-sleek">
          {unifiedRepos.length > 0 && (
            <ResourceTree
              repos={unifiedRepos}
              sortOption={sortOption}
              collapsedRepos={collapsedRepos}
              toggleRepo={toggleRepo}
              collapsedWorktrees={collapsedWorktrees}
              activeWorktreeId={activeWorktreeId}
              toggleWorktree={toggleWorktree}
              navigateToWorktree={navigateToWorktree}
              navigateToTab={navigateToTab}
              onDelete={deleteWorktree}
              onKillSession={handleKillSession}
            />
          )}
          {unifiedRepos.length === 0 && resourceSnapshot && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.27a74f91f0',
                'Nothing running right now'
              )}
            </div>
          )}
          {resourceSnapshot && (
            <AppSection
              app={resourceSnapshot.app}
              isCollapsed={appCollapsed}
              onToggle={() => setAppCollapsed((value) => !value)}
            />
          )}
          {!resourceSnapshot && !daemonUnreachable && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.888dad8c55',
                'Loading…'
              )}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-border/50 px-3 py-2">
        <button
          type="button"
          onClick={handleOpenWorkspaceCleanup}
          className="relative inline-flex w-full items-center justify-center rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium hover:bg-accent/60"
        >
          <span className="truncate px-4">
            {translate(
              'auto.components.status.bar.ResourceUsageStatusSegment.92924a14e3',
              'Review inactive workspaces ({{value0}})',
              { value0: oldWorkspaceCount }
            )}
          </span>
          <ChevronRight className="absolute right-2.5 size-3.5 text-muted-foreground" />
        </button>
        {orphanCount > 0 && (
          <button
            type="button"
            onClick={() => void handleKillOrphans()}
            className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium hover:bg-accent/60"
          >
            {orphanCount === 1
              ? translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.c7e3b1a0d9f2',
                  'Kill {{value0}} orphan terminal',
                  { value0: orphanCount }
                )
              : translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.d8f4c2b1e0a3',
                  'Kill {{value0}} orphan terminals',
                  { value0: orphanCount }
                )}
          </button>
        )}
      </div>
      <WorkspaceSpaceCompactPanel onOpenFullPage={openSpaceResults} />
    </PopoverContent>
  )
}
