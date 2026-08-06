import React from 'react'
import type { MemorySnapshot } from '../../../../shared/types'
import type { AppState } from '../../store'
import {
  AlertTriangle,
  ChevronRight,
  LoaderCircle,
  MemoryStick,
  RotateCw,
  Terminal,
  Trash2
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { DaemonActionsApi } from '../shared/useDaemonActions'
import { DaemonActionDialog } from '../shared/useDaemonActions'
import { WorkspaceSpaceCompactPanel } from './WorkspaceSpaceCompactPanel'
import { AppSection, ResourceTree } from './resource-usage-status-rows'
import { formatCpu, formatMemory } from './resource-usage-metrics'
import type { ResourceMemoryMetricCopy } from './resource-memory-metric-copy'
import type { UnifiedProjectGroup, UnifiedSessionRow } from './resource-usage-merge-types'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'
import { translate } from '@/i18n/i18n'

export type ResourceUsageStatusViewProps = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  recordFeatureInteraction: AppState['recordFeatureInteraction']
  daemonUnreachable: boolean
  resourceManagerAriaLabel: string
  spaceScanReady: boolean
  iconOnly: boolean
  memBadgeLabel: string
  triggerSessionCount: number
  orphanCount: number
  resourceManagerTooltipLines: string[]
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
  killConfirm: UnifiedSessionRow | null
  killing: boolean
  setKillConfirm: React.Dispatch<React.SetStateAction<UnifiedSessionRow | null>>
  runKillConfirmed: () => Promise<void>
}

export function ResourceUsageStatusView({
  open,
  setOpen,
  recordFeatureInteraction,
  daemonUnreachable,
  resourceManagerAriaLabel,
  spaceScanReady,
  iconOnly,
  memBadgeLabel,
  triggerSessionCount,
  orphanCount,
  resourceManagerTooltipLines,
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
  killConfirm,
  killing,
  setKillConfirm,
  runKillConfirmed
}: ResourceUsageStatusViewProps): React.JSX.Element {
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          recordFeatureInteraction('resource-manager')
        }
        setOpen(nextOpen)
      }}
    >
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
              className="relative inline-flex items-center gap-1.5 cursor-pointer rounded px-1 py-0.5 hover:bg-accent/70"
              aria-label={
                daemonUnreachable
                  ? translate(
                      'auto.components.status.bar.ResourceUsageStatusSegment.59f178fe11',
                      '{{value0}}, daemon unreachable',
                      { value0: resourceManagerAriaLabel }
                    )
                  : resourceManagerAriaLabel
              }
            >
              {spaceScanReady ? (
                <span
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              ) : null}
              <MemoryStick className="size-3 text-muted-foreground" />
              {!iconOnly && (
                <>
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {memBadgeLabel}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <Terminal className="size-3 text-muted-foreground" />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {triggerSessionCount}
                    {orphanCount > 0 && (
                      <span className="text-yellow-500 ml-0.5">({orphanCount})</span>
                    )}
                  </span>
                </>
              )}
              {iconOnly && triggerSessionCount > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {triggerSessionCount}
                </span>
              )}
              {daemonUnreachable && (
                <AlertTriangle
                  className="size-3 text-yellow-500"
                  aria-label={translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.ca95d077db',
                    'Daemon unreachable'
                  )}
                />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          <div className="space-y-0.5">
            {resourceManagerTooltipLines.map((line, index) => (
              <div
                key={`${index}:${line}`}
                className={line === 'Space scan ready' ? 'text-primary' : ''}
              >
                {line}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        className="w-[26rem] max-w-[calc(100vw-2rem)] p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        // Why: activating a tab focuses xterm's DOM node; Radix would read that as focus-outside and close. Outside-click and Escape still close.
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
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <RotateCw className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
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
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.bd19fd7a59',
                  'Kill all sessions'
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {daemonUnreachable && (
          <div className="flex items-start gap-2 border-b border-border bg-yellow-500/10 px-3 py-2 text-[11px] text-foreground">
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
              className="shrink-0"
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
            <AlertTriangle className="size-3 shrink-0 text-yellow-500" />
            <span>
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.e7cf14ec78',
                'Terminal sessions unavailable. The list may be stale.'
              )}
            </span>
          </div>
        )}

        {resourceSnapshot && (
          <div className="px-3 py-2 border-b border-border flex items-baseline justify-between gap-3 text-xs tabular-nums">
            <div className="flex items-baseline gap-3 min-w-0">
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:rounded"
                  >
                    {formatCpu(totalCpu)}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="z-[70] max-w-xs">
                  {translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.1fedf94eae',
                    'Combined CPU load. Values above 100% mean more than one core is working at once.'
                  )}
                </TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground/50">·</span>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:rounded"
                  >
                    {formatMemory(totalMemory)}{' '}
                    <span className="font-normal text-muted-foreground">
                      {memoryMetricCopy.summaryLabel}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="z-[70] max-w-xs">
                  {memoryMetricCopy.description}
                </TooltipContent>
              </Tooltip>
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

        {/* Why: fixed 420px height so the popover doesn't jump as worktrees expand/collapse or sessions change; inner tree owns its scroll. */}
        <div
          ref={setPopoverBodyNode}
          tabIndex={-1}
          className="flex h-[420px] flex-col outline-none"
        >
          {(unifiedRepos.length > 0 || resourceSnapshot) && (
            <div className="flex items-center justify-between px-3 py-1 bg-muted/30 border-b border-border/50 text-[10px] uppercase tracking-wide shrink-0">
              <button
                type="button"
                onClick={() => setSortOption('name')}
                className={cn(
                  'hover:text-foreground transition-colors',
                  sortOption === 'name'
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground/80'
                )}
                aria-pressed={sortOption === 'name'}
              >
                {translate(
                  'auto.components.status.bar.ResourceUsageStatusSegment.2aa2de6cb9',
                  'Name'
                )}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <div className={cn(METRIC_COLUMNS_CLS, 'text-[10px]')}>
                  <button
                    type="button"
                    onClick={() => setSortOption('cpu')}
                    className={cn(
                      CPU_COLUMN_CLS,
                      'hover:text-foreground transition-colors',
                      sortOption === 'cpu'
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground/80'
                    )}
                    aria-pressed={sortOption === 'cpu'}
                  >
                    {translate(
                      'auto.components.status.bar.ResourceUsageStatusSegment.298f4be7f2',
                      'CPU'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortOption('memory')}
                    className={cn(
                      MEM_COLUMN_CLS,
                      'hover:text-foreground transition-colors',
                      sortOption === 'memory'
                        ? 'font-semibold text-foreground'
                        : 'text-muted-foreground/80'
                    )}
                    aria-pressed={sortOption === 'memory'}
                  >
                    {memoryMetricCopy.columnLabel}
                  </button>
                </div>
                {/* Why: empty trailing gutter keeps CPU/Memory header cells aligned with rows that reserve this width for the kill-X. */}
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
                onToggle={() => setAppCollapsed((v) => !v)}
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

        <div className="border-t border-border/50 px-3 py-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenWorkspaceCleanup}
            className="relative inline-flex w-full items-center justify-center rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
          >
            <span className="min-w-0 truncate px-4 text-center">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.92924a14e3',
                'Review inactive workspaces ({{value0}})',
                { value0: oldWorkspaceCount }
              )}
            </span>
            <ChevronRight
              className="absolute right-2.5 size-3.5 text-muted-foreground"
              aria-hidden
            />
          </button>
          {orphanCount > 0 ? (
            <button
              type="button"
              onClick={() => void handleKillOrphans()}
              className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
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
          ) : null}
        </div>

        <WorkspaceSpaceCompactPanel onOpenFullPage={openSpaceResults} />
      </PopoverContent>
      {/* Why: hoisted to a sibling of PopoverContent — nested, the Dialog unmounts with the popover mid-interaction and the kill-confirm flow disappears. */}
      <Dialog
        open={killConfirm !== null}
        onOpenChange={(next) => {
          if (next) {
            return
          }
          if (killing) {
            return
          }
          setKillConfirm(null)
        }}
      >
        <DialogContent
          className="max-w-md"
          showCloseButton={!killing}
          onPointerDownOutside={(e) => {
            if (killing) {
              e.preventDefault()
            }
          }}
          onEscapeKeyDown={(e) => {
            if (killing) {
              e.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.e9a5d3c2b1f0',
                'Kill {{value0}}?',
                {
                  value0:
                    killConfirm?.label ??
                    translate(
                      'auto.components.status.bar.ResourceUsageStatusSegment.138b99bd80',
                      'this session'
                    )
                }
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.67c4ecda49',
                "Force-quits this terminal. Any unsaved work in the pane is lost. This can't be undone."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKillConfirm(null)} disabled={killing}>
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.946d9f94d0',
                'Cancel'
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runKillConfirmed()}
              disabled={killing}
            >
              {killing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {killing
                ? translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.41ae4fa725',
                    'Killing…'
                  )
                : translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.b10695d6ce',
                    'Kill session'
                  )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DaemonActionDialog api={daemonActions} />
    </Popover>
  )
}
