import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  getAllWorktreesFromState,
  useAllWorktrees,
  useRepoMap,
  useWorktreeMap
} from '@/store/selectors'
import type { Worktree } from '../../../../shared/types'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { getActiveSidebarWorkspaceId } from '../../../../shared/workspace-scope'
import { deriveRunningAgentSendTargets } from '@/lib/running-agent-targets'
import { getVisibleWorktreeBrowserActivityTabs, getVisibleWorktreeTerminalActivityTabs } from './visible-worktree-activity-inputs'
import { selectWorktreeListReviewCacheInputs } from './worktree-list-review-cache-inputs'
import { buildWorktreeComparator, compareWorktreeSortLabel } from './smart-sort'
import { buildAttentionByWorktree, hasFreshAttributedAgentStatus, type WorktreeAttention } from './smart-attention'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { computeVisibleWorktreeIds } from './visible-worktrees'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import { getPinnedWorktreeDisplayPolicy } from './worktree-list-groups'
import { persistWorktreeSortOrderByHost } from '@/lib/worktree-sort-order-persistence'

const SORT_SETTLE_MS = 3_000
const EMPTY_AGENT_STATUS_BY_PANE_KEY: AppState['agentStatusByPaneKey'] = {}
const EMPTY_WORKTREE_ID_SET: ReadonlySet<string> = new Set()
const EMPTY_TABS_BY_WORKTREE: AppState['tabsByWorktree'] = {}
const EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID: AppState['terminalLayoutsByTabId'] = {}
const EMPTY_PTY_IDS_BY_TAB_ID: AppState['ptyIdsByTabId'] = {}
const EMPTY_RUNTIME_PANE_TITLES_BY_TAB_ID: AppState['runtimePaneTitlesByTabId'] = {}

function useReusedArrayIdentity<T>(next: T[]): T[] {
  const previousRef = useRef<T[]>(next)
  const previous = previousRef.current
  const equal = previous.length === next.length && previous.every((value, index) => value === next[index])
  const result = equal ? previous : next
  previousRef.current = result
  return result
}

/** Shared selector/sort source for the sidebar; keeping this order stable avoids row churn. */
export function useWorktreeListSource() {
  const allWorktrees = useAllWorktrees()
  const repoMap = useRepoMap()
  const worktreeMap = useWorktreeMap()
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  const workspaceLineageByChildKey = useAppStore((s) => s.workspaceLineageByChildKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const detectedWorktreesByRepo = useAppStore((s) => s.detectedWorktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const currentSidebarWorktreeId = useMemo(
    () => getActiveSidebarWorkspaceId(activeWorkspaceKey, activeWorktreeId),
    [activeWorkspaceKey, activeWorktreeId]
  )
  const groupBy = useAppStore((s) => s.groupBy)
  const setGroupBy = useAppStore((s) => s.setGroupBy)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const visibleWorkspaceHostIds = useAppStore((s) => s.visibleWorkspaceHostIds)
  const workspaceHostOrder = useAppStore((s) => s.workspaceHostOrder)
  const setWorkspaceHostOrder = useAppStore((s) => s.setWorkspaceHostOrder)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sortBy = useAppStore((s) => s.sortBy)
  const setSortBy = useAppStore((s) => s.setSortBy)
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const showSleepingWorkspaces = useAppStore((s) => s.showSleepingWorkspaces)
  const agentStatusEpoch = useAppStore((s) => (!showSleepingWorkspaces ? s.agentStatusEpoch : 0))
  const hideDefaultBranchWorkspace = useAppStore((s) => s.hideDefaultBranchWorkspace)
  const hideAutomationGeneratedWorkspaces = useAppStore((s) => s.hideAutomationGeneratedWorkspaces)
  const hideCliCreatedWorkspaces = useAppStore((s) => s.hideCliCreatedWorkspaces)
  const hideDetachedHeadWorkspaces = useAppStore((s) => s.hideDetachedHeadWorkspaces)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const openModal = useAppStore((s) => s.openModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const updateWorktreesMeta = useAppStore((s) => s.updateWorktreesMeta)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const activeView = useAppStore((s) => s.activeView)
  const activeModal = useAppStore((s) => s.activeModal)
  const pendingRevealWorktree = useAppStore((s) => s.pendingRevealWorktree)
  const pendingRevealSidebarRow = useAppStore((s) => s.pendingRevealSidebarRow)
  const revealWorktreeInSidebar = useAppStore((s) => s.revealWorktreeInSidebar)
  const revealSidebarRow = useAppStore((s) => s.revealSidebarRow)
  const setWorktreesPinnedAndReveal = useAppStore((s) => s.setWorktreesPinnedAndReveal)
  const clearPendingRevealWorktreeId = useAppStore((s) => s.clearPendingRevealWorktreeId)
  const clearPendingRevealSidebarRow = useAppStore((s) => s.clearPendingRevealSidebarRow)
  const agentSendPopoverTargetMode = useAppStore((s) => s.agentSendPopoverTargetMode)
  const agentTargetStatusByPaneKey = useAppStore((s) => agentSendPopoverTargetMode ? s.agentStatusByPaneKey : EMPTY_AGENT_STATUS_BY_PANE_KEY)
  const agentTargetStatusEpoch = useAppStore((s) => agentSendPopoverTargetMode ? s.agentStatusEpoch : 0)
  const agentTargetTabsByWorktree = useAppStore((s) => agentSendPopoverTargetMode ? s.tabsByWorktree : EMPTY_TABS_BY_WORKTREE)
  const agentTargetTerminalLayoutsByTabId = useAppStore((s) => agentSendPopoverTargetMode ? s.terminalLayoutsByTabId : EMPTY_TERMINAL_LAYOUTS_BY_TAB_ID)
  const agentTargetPtyIdsByTabId = useAppStore((s) => agentSendPopoverTargetMode ? s.ptyIdsByTabId : EMPTY_PTY_IDS_BY_TAB_ID)
  const agentTargetRuntimePaneTitlesByTabId = useAppStore((s) => agentSendPopoverTargetMode ? s.runtimePaneTitlesByTabId : EMPTY_RUNTIME_PANE_TITLES_BY_TAB_ID)
  const agentSendTargetWorktreeId = useMemo(() => {
    void agentTargetStatusEpoch
    if (!agentSendPopoverTargetMode) { return null }
    const targets = deriveRunningAgentSendTargets({
      agentStatusByPaneKey: agentTargetStatusByPaneKey,
      tabsByWorktree: agentTargetTabsByWorktree,
      terminalLayoutsByTabId: agentTargetTerminalLayoutsByTabId,
      ptyIdsByTabId: agentTargetPtyIdsByTabId,
      runtimePaneTitlesByTabId: agentTargetRuntimePaneTitlesByTabId
    }, agentSendPopoverTargetMode.worktreeId)
    return targets.some((target) => target.status === 'eligible') ? agentSendPopoverTargetMode.worktreeId : null
  }, [agentTargetPtyIdsByTabId, agentTargetRuntimePaneTitlesByTabId, agentTargetStatusByPaneKey, agentTargetStatusEpoch, agentTargetTabsByWorktree, agentTargetTerminalLayoutsByTabId, agentSendPopoverTargetMode])
  const needsActivityMaps = !showSleepingWorkspaces || sortBy === 'smart'
  const tabsByWorktree = useAppStore((s) => needsActivityMaps ? getVisibleWorktreeTerminalActivityTabs(s.tabsByWorktree) : null)
  const ptyIdsByTabId = useAppStore((s) => needsActivityMaps ? s.ptyIdsByTabId : null)
  const browserTabsByWorktree = useAppStore((s) => !showSleepingWorkspaces ? getVisibleWorktreeBrowserActivityTabs(s.browserTabsByWorktree) : null)
  const cardProps = useAppStore((s) => s.worktreeCardProperties)
  const { prCache, hostedReviewCache } = useAppStore(useShallow((s) => selectWorktreeListReviewCacheInputs(s, groupBy, cardProps)))
  const settings = useAppStore((s) => s.settings)
  const pinnedDisplayPolicy = getPinnedWorktreeDisplayPolicy(settings)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const sortEpoch = useAppStore((s) => s.sortEpoch)
  const worktreeCount = useMemo(() => allWorktrees.filter((worktree) => !worktree.isArchived).length, [allWorktrees])
  const [debouncedSortEpoch, setDebouncedSortEpoch] = useState(sortEpoch)
  const previousWorktreeCountRef = useRef(worktreeCount)
  useEffect(() => {
    if (debouncedSortEpoch === sortEpoch) { return }
    const structuralChange = worktreeCount !== previousWorktreeCountRef.current
    previousWorktreeCountRef.current = worktreeCount
    if (structuralChange || sortBy === 'manual') {
      setDebouncedSortEpoch(sortEpoch)
      return
    }
    const timer = setTimeout(() => setDebouncedSortEpoch(sortEpoch), SORT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [debouncedSortEpoch, sortBy, sortEpoch, worktreeCount])
  const sessionHasHadLiveSmartSignal = useRef(false)
  const sortedIds = useMemo(() => {
    void debouncedSortEpoch
    const state = useAppStore.getState()
    const nonArchivedWorktrees = getAllWorktreesFromState(state).filter((worktree) => !worktree.isArchived)
    const now = Date.now()
    if (sortBy === 'smart' && !sessionHasHadLiveSmartSignal.current) {
      const hasAnyLivePty = Object.values(state.tabsByWorktree).flat().some((tab) => tabHasLivePty(state.ptyIdsByTabId, tab.id))
      if (hasAnyLivePty || hasFreshAttributedAgentStatus(state.agentStatusByPaneKey, now, state.tabsByWorktree)) {
        sessionHasHadLiveSmartSignal.current = true
      } else {
        nonArchivedWorktrees.sort((a, b) => b.sortOrder - a.sortOrder || compareWorktreeSortLabel(a, b))
        return nonArchivedWorktrees.map((worktree) => worktree.id)
      }
    }
    const attentionByWorktree = sortBy === 'smart'
      ? buildAttentionByWorktree(nonArchivedWorktrees, state.tabsByWorktree, state.agentStatusByPaneKey, state.runtimePaneTitlesByTabId, state.ptyIdsByTabId, now, state.migrationUnsupportedByPtyId, state.terminalLayoutsByTabId)
      : new Map<string, WorktreeAttention>()
    nonArchivedWorktrees.sort(buildWorktreeComparator(sortBy, repoMap, now, attentionByWorktree))
    return nonArchivedWorktrees.map((worktree) => worktree.id)
  }, [debouncedSortEpoch, repoMap, sortBy])
  useEffect(() => {
    if (sortBy === 'smart' && sortedIds.length > 0 && sessionHasHadLiveSmartSignal.current) {
      persistWorktreeSortOrderByHost(useAppStore.getState(), sortedIds)
    }
  }, [sortedIds, sortBy])
  const recomputedVisibleWorktrees = useMemo(() => {
    void agentStatusEpoch
    const ids = computeVisibleWorktreeIds(worktreesByRepo, sortedIds, {
      filterRepoIds, showSleepingWorkspaces, tabsByWorktree, ptyIdsByTabId, browserTabsByWorktree,
      worktreeIdsWithLiveAgent: showSleepingWorkspaces ? EMPTY_WORKTREE_ID_SET : getWorktreeIdsWithLiveAgent(useAppStore.getState().agentStatusByPaneKey, tabsByWorktree, Date.now()),
      hideDefaultBranchWorkspace, hideAutomationGeneratedWorkspaces, hideCliCreatedWorkspaces, hideDetachedHeadWorkspaces,
      repoMap, workspaceHostScope, visibleWorkspaceHostIds, defaultHostId: getSettingsFocusedExecutionHostId(settings), worktreeLineageById,
      forcedVisibleWorktreeIds: agentSendTargetWorktreeId ? [agentSendTargetWorktreeId] : undefined
    })
    return ids.map((id) => worktreeMap.get(id)).filter((worktree): worktree is Worktree => worktree != null)
  }, [agentSendTargetWorktreeId, agentStatusEpoch, browserTabsByWorktree, filterRepoIds, hideAutomationGeneratedWorkspaces, hideCliCreatedWorkspaces, hideDefaultBranchWorkspace, hideDetachedHeadWorkspaces, repoMap, settings, showSleepingWorkspaces, sortedIds, tabsByWorktree, visibleWorkspaceHostIds, worktreeLineageById, worktreeMap, worktreesByRepo, workspaceHostScope, ptyIdsByTabId])
  const visibleWorktrees = useReusedArrayIdentity(recomputedVisibleWorktrees)
  return {
    allWorktrees, repoMap, worktreeMap, worktreeLineageById, workspaceLineageByChildKey, worktreesByRepo, detectedWorktreesByRepo,
    activeWorktreeId, currentSidebarWorktreeId, groupBy, setGroupBy, workspaceHostScope, visibleWorkspaceHostIds, workspaceHostOrder, setWorkspaceHostOrder,
    workspaceStatuses, sortBy, setSortBy, projectOrderBy, showSleepingWorkspaces, hideDefaultBranchWorkspace, hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces, hideDetachedHeadWorkspaces, filterRepoIds, openModal, openSettingsPage, openSettingsTarget, updateWorktreeMeta,
    updateWorktreesMeta, updateRepo, fetchWorktrees, activeView, activeModal, pendingRevealWorktree, pendingRevealSidebarRow, revealWorktreeInSidebar,
    revealSidebarRow, setWorktreesPinnedAndReveal, clearPendingRevealWorktreeId, clearPendingRevealSidebarRow, agentSendTargetWorktreeId,
    tabsByWorktree, ptyIdsByTabId, browserTabsByWorktree, cardProps, prCache, hostedReviewCache, settings, pinnedDisplayPolicy,
    sshTargetLabels, sshConnectionStates, runtimeEnvironments, runtimeStatusByEnvironmentId, visibleWorktrees, sortedIds
  }
}

export type WorktreeListSource = ReturnType<typeof useWorktreeListSource>
