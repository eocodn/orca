// Concrete surface implementation for ResourceUsageStatusSegment.tsx
import React, { useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import { useDaemonActions } from '../shared/useDaemonActions'
import {
  getResourceManagerAriaLabel,
  getResourceManagerTooltipLines
} from './resource-manager-terminal-copy'
import { getResourceMemoryMetricCopy } from './resource-memory-metric-copy'
import { useResourceUsageStatusActions } from './resource-usage-status-actions'
import { useResourceUsageStatusInventory } from './resource-usage-status-inventory'
import {
  resolveResourceUsageSpaceScanReady,
  type ResourceUsageSpaceScanSnapshot
} from './resource-usage-space-scan-ready'
import { ResourceUsageStatusView } from './resource-usage-status-view'

const POLL_MS = 2_000
type SortOption = 'memory' | 'cpu' | 'name'
const METRIC_COLUMNS_CLS = 'flex items-center shrink-0 tabular-nums'
const CPU_COLUMN_CLS = 'w-12 text-right'
const MEM_COLUMN_CLS = 'w-16 text-right'
// Why: every row and the header reserve this trailing gutter so CPU/Memory columns align whether or not the row has a kill-X.
const ROW_TRAILING_GUTTER_CLS = 'w-5 shrink-0 flex items-center justify-end'

export { SessionRow, WorktreeRow } from './resource-usage-status-rows'

export function ResourceUsageStatusSegment({
  iconOnly
}: {
  compact?: boolean
  iconOnly: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [sortOption, setSortOption] = useState<SortOption>('memory')
  const workspaceSpaceScannedAt = useAppStore(
    (state) => state.workspaceSpaceAnalysis?.scannedAt ?? null
  )
  const workspaceSpaceScanning = useAppStore((state) => state.workspaceSpaceScanning)
  const [spaceScanSnapshot, setSpaceScanSnapshot] = useState<ResourceUsageSpaceScanSnapshot>(
    () => ({
      ready: false,
      previousScanning: workspaceSpaceScanning,
      lastSeenScannedAt: workspaceSpaceScannedAt
    })
  )
  const activeView = useAppStore((state) => state.activeView)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const openModal = useAppStore((state) => state.openModal)
  const openSpacePage = useAppStore((state) => state.openSpacePage)
  const recordFeatureInteraction = useAppStore((state) => state.recordFeatureInteraction)
  const inventory = useResourceUsageStatusInventory(open)
  const {
    snapshot,
    fetchSnapshot,
    workspaceSessionReady,
    sessions,
    sessionInventory,
    refreshSessions,
    clearSessionsError,
    removeSession,
    removeSessions,
    tabsByWorktree,
    resourceSessionBindings,
    unifiedRepos,
    orphanCount,
    oldWorkspaceCount,
    totalCpu,
    totalMemory,
    memBadgeLabel,
    daemonUnreachable,
    sessionsOnlyError
  } = inventory
  const actions = useResourceUsageStatusActions({
    tabsByWorktree,
    setOpen,
    setActiveView,
    openModal,
    openSpacePage,
    workspaceSessionReady,
    sessions,
    resourceSessionBindings,
    removeSession,
    removeSessions,
    refreshSessions
  })
  const daemonActions = useDaemonActions({
    onRestartSettled: () => {
      clearSessionsError()
      void fetchSnapshot()
      void refreshSessions()
    },
    onKillAllSettled: () => {
      void refreshSessions()
    }
  })
  const nextSpaceScanSnapshot = resolveResourceUsageSpaceScanReady({
    snapshot: spaceScanSnapshot,
    open,
    activeView,
    scannedAt: workspaceSpaceScannedAt,
    scanning: workspaceSpaceScanning
  })
  if (
    nextSpaceScanSnapshot.ready !== spaceScanSnapshot.ready ||
    nextSpaceScanSnapshot.previousScanning !== spaceScanSnapshot.previousScanning ||
    nextSpaceScanSnapshot.lastSeenScannedAt !== spaceScanSnapshot.lastSeenScannedAt
  ) {
    setSpaceScanSnapshot(nextSpaceScanSnapshot)
  }
  const spaceScanReady = nextSpaceScanSnapshot.ready
  useEffect(() => {
    if (workspaceSessionReady) {
      void fetchSnapshot()
    }
  }, [fetchSnapshot, workspaceSessionReady])
  useEffect(() => {
    if (!open) {
      return
    }
    void fetchSnapshot()
    void refreshSessions()
    const memoryTimer = window.setInterval(() => void fetchSnapshot(), POLL_MS)
    return () => window.clearInterval(memoryTimer)
  }, [fetchSnapshot, open, refreshSessions])
  useEffect(() => {
    if (!open) {
      clearSessionsError()
    }
  }, [clearSessionsError, open])
  const memoryMetricCopy = getResourceMemoryMetricCopy(snapshot?.processMemoryMetric ?? 'rss')
  const resourceManagerTooltipLines = getResourceManagerTooltipLines({
    memoryLabel: snapshot ? `${memBadgeLabel} · ${memoryMetricCopy.summaryLabel}` : memBadgeLabel,
    sessionCount: sessionInventory.count,
    spaceScanReady
  })
  const resourceManagerAriaLabel = getResourceManagerAriaLabel({
    sessionCount: sessionInventory.count,
    spaceScanReady
  })
  return (
    <ResourceUsageStatusView
      open={open}
      setOpen={setOpen}
      recordFeatureInteraction={recordFeatureInteraction}
      daemonUnreachable={daemonUnreachable}
      resourceManagerAriaLabel={resourceManagerAriaLabel}
      spaceScanReady={spaceScanReady}
      iconOnly={iconOnly}
      memBadgeLabel={memBadgeLabel}
      triggerSessionCount={sessionInventory.count}
      orphanCount={orphanCount}
      resourceManagerTooltipLines={resourceManagerTooltipLines}
      daemonActions={daemonActions}
      sessionsOnlyError={sessionsOnlyError}
      resourceSnapshot={snapshot}
      totalCpu={totalCpu}
      totalMemory={totalMemory}
      memoryMetricCopy={memoryMetricCopy}
      setPopoverBodyNode={actions.setPopoverBodyNode}
      sortOption={sortOption}
      setSortOption={setSortOption}
      METRIC_COLUMNS_CLS={METRIC_COLUMNS_CLS}
      CPU_COLUMN_CLS={CPU_COLUMN_CLS}
      MEM_COLUMN_CLS={MEM_COLUMN_CLS}
      ROW_TRAILING_GUTTER_CLS={ROW_TRAILING_GUTTER_CLS}
      unifiedRepos={unifiedRepos}
      collapsedRepos={actions.collapsedRepos}
      toggleRepo={actions.toggleRepo}
      collapsedWorktrees={actions.collapsedWorktrees}
      activeWorktreeId={activeWorktreeId}
      toggleWorktree={actions.toggleWorktree}
      navigateToWorktree={actions.navigateToWorktree}
      navigateToTab={actions.navigateToTab}
      deleteWorktree={actions.deleteWorktree}
      handleKillSession={actions.handleKillSession}
      appCollapsed={actions.appCollapsed}
      setAppCollapsed={actions.setAppCollapsed}
      handleOpenWorkspaceCleanup={actions.handleOpenWorkspaceCleanup}
      openSpaceResults={actions.openSpaceResults}
      handleKillOrphans={actions.handleKillOrphans}
      oldWorkspaceCount={oldWorkspaceCount}
      killConfirm={actions.killConfirm}
      killing={actions.killing}
      setKillConfirm={actions.setKillConfirm}
      runKillConfirmed={actions.runKillConfirmed}
    />
  )
}
