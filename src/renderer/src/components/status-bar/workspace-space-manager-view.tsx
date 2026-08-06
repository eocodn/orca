import React from 'react'
import {
  AlertTriangle,
  Check,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { formatBytes } from './workspace-space-format'
import {
  BreakdownList,
  CheckButton,
  Metric,
  SortIndicator,
  UpdatedMetric,
  WorkspaceRow,
  WorkspaceTreemap
} from './workspace-space-manager-rows'
import { getWorkspaceDecisionDetails } from './workspace-space-manager-decision-model'

export function WorkspaceSpaceManagerView(props: Record<string, any>): React.JSX.Element {
  const {
    analysis,
    isScanning,
    progressLabel,
    progress,
    cancelScan,
    refresh,
    scanError,
    repoErrors,
    hasRows,
    isInitialScan,
    sourceRows,
    inspectedWorktree,
    zoomedWorktree,
    setInspectedWorktreeId,
    setTreemapZoomWorktreeId,
    selectedDeletableIds,
    selectedReclaimableBytes,
    setSelectedIds,
    deleteSelected,
    query,
    setQuery,
    sortKey,
    selectSortKey,
    onlyDeletable,
    setOnlyDeletable,
    toggleVisibleSelection,
    visibleDeletableIds,
    allVisibleSelected,
    visibleSelectionState,
    toggleSort,
    sortDirection,
    rows,
    maxSize,
    nextSelectedIds,
    decisionDetailsByWorktreeId,
    repoMap,
    worktreeMap,
    tabsByWorktree,
    ptyIdsByTabId,
    agentStatusByPaneKey,
    migrationUnsupportedByPtyId,
    runtimePaneTitlesByTabId,
    retainedAgentsByPaneKey,
    openFiles,
    editorDrafts,
    browserTabsByWorktree,
    gitStatusByWorktree,
    remoteStatusesByWorktree,
    hostedReviewCache,
    issueCache,
    linearIssueCache,
    settings,
    activeWorktreeId,
    gitRefreshStateByWorktreeId,
    deleteStateByWorktreeId,
    toggleSelection,
    activateAndRevealWorktree,
    deleteWorktrees,
    forceDeleteWorktree
  } = props
  return (
    <div className="space-y-5">
      <div className="grid overflow-hidden rounded-lg border border-border/65 bg-background/35 md:grid-cols-4 md:divide-x md:divide-border/60">
        <Metric
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.09960d86bd',
            'Scanned'
          )}
          value={analysis ? formatBytes(analysis.totalSizeBytes) : '—'}
        />
        <Metric
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.83f1a0a932',
            'Reclaimable'
          )}
          value={analysis ? formatBytes(analysis.reclaimableBytes) : '—'}
        />
        <Metric
          label={translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.43171f3e60',
            'Workspaces'
          )}
          value={
            analysis
              ? analysis.unavailableWorktreeCount > 0
                ? `${analysis.scannedWorktreeCount}/${analysis.worktreeCount}`
                : String(analysis.scannedWorktreeCount)
              : '—'
          }
        />
        <UpdatedMetric scannedAt={analysis?.scannedAt ?? null} isScanning={isScanning} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {isScanning ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : (
            <HardDrive className="size-4 shrink-0" />
          )}
          <span className="truncate">
            {analysis
              ? isScanning
                ? translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.34174bd83d',
                    '{{value0}}. You can leave this page; the last result stays visible.',
                    { value0: progressLabel ?? 'Scanning workspace sizes' }
                  )
                : translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.d595295d7d',
                    '{{value0}} can be reclaimed from linked worktrees.',
                    { value0: formatBytes(analysis.reclaimableBytes) }
                  )
              : isScanning
                ? translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.265d956765',
                    '{{value0}}. You can leave this page.',
                    { value0: progressLabel ?? 'Scanning workspace sizes' }
                  )
                : translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.e91dd2a9ae',
                    'Run a scan to inspect workspace sizes.'
                  )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={isScanning ? cancelScan : refresh}
          disabled={progress?.state === 'cancelling'}
          className="w-28 gap-1.5"
        >
          {isScanning ? (
            progress?.state === 'cancelling' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <X className="size-3.5" />
            )
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {isScanning
            ? progress?.state === 'cancelling'
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.1fce91d1b9',
                  'Stopping'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.8dc9ddac8a',
                  'Cancel'
                )
            : analysis
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.508673bac0',
                  'Refresh'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.8c7c57fbf8',
                  'Scan'
                )}
        </Button>
      </div>

      {scanError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/35 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {scanError}
            {analysis
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.20a4204dce',
                  'Last successful results remain visible.'
                )
              : ''}
          </span>
        </div>
      ) : null}

      {repoErrors.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {repoErrors.map((repo) => (
            <div key={repo.repoId} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {repo.displayName}: {repo.error}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {hasRows || isInitialScan ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
          <WorkspaceTreemap
            rows={sourceRows}
            isScanning={isInitialScan}
            selectedWorktreeId={inspectedWorktree?.worktreeId ?? null}
            zoomedWorktree={zoomedWorktree}
            onSelect={setInspectedWorktreeId}
            onZoomChange={setTreemapZoomWorktreeId}
          />
          <BreakdownList worktree={inspectedWorktree} isScanning={isInitialScan} />
        </div>
      ) : null}

      {hasRows ? (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-xs backdrop-blur">
          <div className="min-w-0 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {selectedDeletableIds.length}{' '}
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.65402b7192',
                'selected'
              )}
            </span>
            <span className="mx-1.5">·</span>
            <span>
              {formatBytes(selectedReclaimableBytes)}{' '}
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.0cb1501ccf',
                'reclaimable'
              )}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set<string>())}
              disabled={selectedDeletableIds.length === 0}
              className="!px-3"
            >
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.e4a12c455b',
                'Clear'
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteSelected}
              disabled={selectedDeletableIds.length === 0}
              className="min-w-[9.5rem] gap-1.5 !px-3.5"
            >
              <Trash2 className="size-3.5" />
              {translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.5caccea440',
                'Delete selected'
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {hasRows ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.6f8f6a6b04',
                'Filter workspaces'
              )}
              className="pl-9"
            />
          </div>

          <Select
            value={sortKey}
            onValueChange={(value) => selectSortKey(value as WorkspaceSpaceSortKey)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="size">
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.33aef3e9cc',
                  'Size'
                )}
              </SelectItem>
              <SelectItem value="name">
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.243287ac60',
                  'Name'
                )}
              </SelectItem>
              <SelectItem value="repo">
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.81f14d9924',
                  'Repository'
                )}
              </SelectItem>
              <SelectItem value="activity">
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.d7ac56452e',
                  'Activity'
                )}
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={onlyDeletable ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setOnlyDeletable((current) => !current)}
            className="w-32"
            aria-label={translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.81aaf1de65',
              'Show only deletable workspaces'
            )}
          >
            {onlyDeletable
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.b2f82ed5ae',
                  'Deletable'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.ef890d31b9',
                  'All'
                )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={toggleVisibleSelection}
            disabled={visibleDeletableIds.length === 0}
            className="w-32 gap-1.5"
            aria-label={
              allVisibleSelected
                ? translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.697d60c456',
                    'Clear visible selection'
                  )
                : translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.1d0f8300d1',
                    'Select visible deletable workspaces'
                  )
            }
          >
            <Check className="size-3.5" />
            {allVisibleSelected
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.e4a12c455b',
                  'Clear'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.f39d291997',
                  'Select'
                )}
          </Button>
        </div>
      ) : null}

      {hasRows || isInitialScan ? (
        <div className="overflow-x-auto rounded-lg border border-border/70 bg-background/30">
          <div className="min-w-[46rem]">
            <div className="grid grid-cols-[1.75rem_minmax(0,1.25fr)_minmax(9rem,0.55fr)_8rem_9.5rem] gap-3 border-b border-border/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <div className="flex items-center">
                <CheckButton
                  checked={visibleSelectionState}
                  disabled={visibleDeletableIds.length === 0}
                  label={
                    allVisibleSelected
                      ? translate(
                          'auto.components.status.bar.WorkspaceSpaceManagerPanel.697d60c456',
                          'Clear visible selection'
                        )
                      : translate(
                          'auto.components.status.bar.WorkspaceSpaceManagerPanel.1d0f8300d1',
                          'Select visible deletable workspaces'
                        )
                  }
                  onClick={toggleVisibleSelection}
                />
              </div>
              <button
                type="button"
                onClick={() => toggleSort('name')}
                className="flex items-center gap-1 text-left"
              >
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.e4aebea158',
                  'Workspace'
                )}
                <SortIndicator sortKey="name" activeKey={sortKey} direction={sortDirection} />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('repo')}
                className="flex items-center gap-1 text-left"
              >
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.81f14d9924',
                  'Repository'
                )}
                <SortIndicator sortKey="repo" activeKey={sortKey} direction={sortDirection} />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('size')}
                className="flex items-center justify-end gap-1 text-right"
              >
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.33aef3e9cc',
                  'Size'
                )}
                <SortIndicator sortKey="size" activeKey={sortKey} direction={sortDirection} />
              </button>
              <div className="text-right">
                {translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.be37293b10',
                  'State'
                )}
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto scrollbar-sleek">
              {isInitialScan ? (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.a02d84d2d2',
                    'Scanning workspaces. You can leave this page.'
                  )}
                </div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {translate(
                    'auto.components.status.bar.WorkspaceSpaceManagerPanel.e031e93219',
                    'No matching workspaces.'
                  )}
                </div>
              ) : (
                rows.map((worktree) => (
                  <WorkspaceRow
                    key={worktree.worktreeId}
                    worktree={worktree}
                    maxSize={maxSize}
                    selected={nextSelectedIds.has(worktree.worktreeId)}
                    inspected={inspectedWorktree?.worktreeId === worktree.worktreeId}
                    decisionDetails={
                      decisionDetailsByWorktreeId.get(worktree.worktreeId) ??
                      getWorkspaceDecisionDetails(worktree, {
                        repoMap,
                        worktreeMap,
                        tabsByWorktree,
                        ptyIdsByTabId,
                        agentStatusByPaneKey,
                        migrationUnsupportedByPtyId,
                        runtimePaneTitlesByTabId,
                        retainedAgentsByPaneKey,
                        openFiles,
                        editorDrafts,
                        browserTabsByWorktree,
                        gitStatusByWorktree,
                        remoteStatusesByWorktree,
                        hostedReviewCache,
                        issueCache,
                        linearIssueCache,
                        settings,
                        activeWorktreeId,
                        now: Date.now()
                      })
                    }
                    gitRefreshState={gitRefreshStateByWorktreeId[worktree.worktreeId]}
                    deleteState={deleteStateByWorktreeId[worktree.worktreeId]}
                    onToggleSelected={() => toggleSelection(worktree.worktreeId)}
                    onInspect={() => setInspectedWorktreeId(worktree.worktreeId)}
                    onOpenWorkspace={() => activateAndRevealWorktree(worktree.worktreeId)}
                    onDelete={() => deleteWorktrees([worktree.worktreeId])}
                    onForceDelete={() => forceDeleteWorktree(worktree)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/70 bg-background/30 px-4 py-10 text-center text-sm text-muted-foreground">
          {scanError
            ? translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.8194a4fb29',
                'Scan failed before any workspace sizes were collected.'
              )
            : analysis
              ? translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.61e25239da',
                  'No workspace rows were available from the scan.'
                )
              : translate(
                  'auto.components.status.bar.WorkspaceSpaceManagerPanel.e91dd2a9ae',
                  'Run a scan to inspect workspace sizes.'
                )}
        </div>
      )}
    </div>
  )
}
