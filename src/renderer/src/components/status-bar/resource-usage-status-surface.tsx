import { getClientRuntime } from '@/runtime/client-runtime'
// Concrete surface implementation for ResourceUsageStatusSegment.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Globe,
  LoaderCircle,
  MemoryStick,
  RotateCw,
  Terminal,
  Trash2,
  X
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
import { useMountedRef } from '@/hooks/useMountedRef'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { useAppStore } from '../../store'
import { useWorktreeMap } from '../../store/selectors'
import { runWorktreeDelete } from '../sidebar/delete-worktree-flow'
import { useDaemonActions, DaemonActionDialog } from '../shared/useDaemonActions'
import type { AppMemory, BrowserWorkspace, UsageValues, Worktree } from '../../../../shared/types'
import { ORPHAN_WORKTREE_ID } from '../../../../shared/constants'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { isWorkspaceOldForCleanup } from '../../../../shared/workspace-cleanup'
import { mergeSnapshotAndSessions, UNATTRIBUTED_REPO_ID } from './mergeSnapshotAndSessions'
import type {
  Metric,
  UnifiedProjectGroup,
  UnifiedSessionRow,
  UnifiedWorktreeRow
} from './resource-usage-merge-types'
import { WorkspaceSpaceCompactPanel } from './WorkspaceSpaceCompactPanel'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'
import {
  isResourceSessionActivationKey,
  navigateResourceSessionToTab
} from './resource-session-navigation'
import {
  getResourceUsageAllWorktrees,
  getResourceUsageBrowserTabsByWorktree,
  getResourceUsageDeferredSshSessionIdsByTabId,
  getResourceUsagePtyIdsByTabId,
  getResourceUsageRepos,
  getResourceUsageRuntimePaneTitlesByTabId,
  getResourceUsageTerminalLayoutsByTabId,
  getResourceUsageTabsByWorktree
} from './resource-usage-open-slices'
import {
  resolveResourceUsageSpaceScanReady,
  type ResourceUsageSpaceScanSnapshot
} from './resource-usage-space-scan-ready'
import {
  getResourceManagerAriaLabel,
  getResourceManagerTooltipLines
} from './resource-manager-terminal-copy'
import { getResourceMemoryMetricCopy } from './resource-memory-metric-copy'
import { requiresKillConfirmation } from './resource-session-kill-confirmation'
import {
  countUnboundDaemonSessions,
  selectUnboundDaemonSessions,
  type ResourceSessionBindingInputs
} from './resource-session-bindings'
import { useResourceSessionInventory } from './use-resource-session-inventory'
import { translate } from '@/i18n/i18n'

const POLL_MS = 2_000

type SortOption = 'memory' | 'cpu' | 'name'

const METRIC_COLUMNS_CLS = 'flex items-center shrink-0 tabular-nums'
const CPU_COLUMN_CLS = 'w-12 text-right'
const MEM_COLUMN_CLS = 'w-16 text-right'
// Why: every row and the header reserve this trailing gutter so CPU/Memory columns align whether or not the row has a kill-X.
const ROW_TRAILING_GUTTER_CLS = 'w-5 shrink-0 flex items-center justify-end'

import { AppSection, formatCpu, formatMemory, ResourceTree, WorktreeRow } from './resource-usage-status-rows'
import { ResourceUsageStatusView } from './resource-usage-status-view'
export { SessionRow, WorktreeRow } from './resource-usage-status-rows'
// ─── Top-level segment ──────────────────────────────────────────────

export function ResourceUsageStatusSegment({
  iconOnly
}: {
  compact?: boolean
  iconOnly: boolean
}): React.JSX.Element {
  const snapshot = useAppStore((s) => s.memorySnapshot)
  const memorySnapshotError = useAppStore((s) => s.memorySnapshotError)
  const fetchSnapshot = useAppStore((s) => s.fetchMemorySnapshot)
  const workspaceSessionReady = useAppStore((s) => s.workspaceSessionReady)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const openModal = useAppStore((s) => s.openModal)
  const openSpacePage = useAppStore((s) => s.openSpacePage)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const activeView = useAppStore((s) => s.activeView)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const workspaceSpaceScannedAt = useAppStore((s) => s.workspaceSpaceAnalysis?.scannedAt ?? null)
  const workspaceSpaceScanning = useAppStore((s) => s.workspaceSpaceScanning)

  const [open, setOpen] = useState(false)
  const [sortOption, setSortOption] = useState<SortOption>('memory')
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set())
  const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(new Set())
  const [appCollapsed, setAppCollapsed] = useState(true)
  const {
    sessionInventory,
    sessionsError,
    refreshSessions,
    clearSessionsError,
    removeSession,
    removeSessions
  } = useResourceSessionInventory(workspaceSessionReady)
  const sessions = sessionInventory.sessions
  const [killConfirm, setKillConfirm] = useState<UnifiedSessionRow | null>(null)
  const [killing, setKilling] = useState(false)
  const [spaceScanSnapshot, setSpaceScanSnapshot] = useState<ResourceUsageSpaceScanSnapshot>(
    () => ({
      ready: false,
      previousScanning: workspaceSpaceScanning,
      lastSeenScannedAt: workspaceSpaceScannedAt
    })
  )
  // Why: tab titles churn on every keystroke; subscribe to those maps only while open so closed badges don't rerender.
  const runtimePaneTitlesByTabId = useAppStore((s) =>
    getResourceUsageRuntimePaneTitlesByTabId(s, open)
  )
  const repos = useAppStore((s) => getResourceUsageRepos(s, open))
  const allWorktrees = useAppStore((s) => getResourceUsageAllWorktrees(s, open))
  const tabsByWorktree = useAppStore((s) => getResourceUsageTabsByWorktree(s, open))
  const browserTabsByWorktree = useAppStore((s) => getResourceUsageBrowserTabsByWorktree(s, open))
  // Why: full binding maps stay behind open sentinels so unchanged counts don't rerender the closed segment.
  const ptyIdsByTabId = useAppStore((s) => getResourceUsagePtyIdsByTabId(s, open))
  const terminalLayoutsByTabId = useAppStore((s) => getResourceUsageTerminalLayoutsByTabId(s, open))
  // Why: sessions awaiting SSH reattach are live on the remote host with no other binding.
  const deferredSshSessionIdsByTabId = useAppStore((s) =>
    getResourceUsageDeferredSshSessionIdsByTabId(s, open)
  )
  const resourceSnapshot = snapshot
  // Why: ptyIdsByTabId tracks mounted/live panes only; Resource Manager reads restored wake hints only for classification.
  const resourceSessionBindings = useMemo<ResourceSessionBindingInputs>(
    () => ({
      ptyIdsByTabId,
      tabsByWorktree,
      terminalLayoutsByTabId,
      deferredSshSessionIdsByTabId,
      workspaceSessionReady
    }),
    [
      ptyIdsByTabId,
      tabsByWorktree,
      terminalLayoutsByTabId,
      deferredSshSessionIdsByTabId,
      workspaceSessionReady
    ]
  )

  // Why: after a kill unmounts the session, focus would fall to <body>; park a ref on the popover body to restore it stably for keyboard users.
  const popoverBodyRef = useRef<HTMLDivElement | null>(null)
  const popoverBodyFocusFrameRef = useRef<number | null>(null)
  const mountedRef = useMountedRef()

  const cancelPopoverBodyFocusFrame = useCallback((): void => {
    if (popoverBodyFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(popoverBodyFocusFrameRef.current)
    popoverBodyFocusFrameRef.current = null
  }, [])

  const setPopoverBodyNode = useCallback(
    (node: HTMLDivElement | null): void => {
      // Why: the queued post-kill focus is only valid while the popover body exists.
      if (!node) {
        cancelPopoverBodyFocusFrame()
      }
      popoverBodyRef.current = node
    },
    [cancelPopoverBodyFocusFrame]
  )

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

  // Why: Space scans can finish after the user closes the full page/popover; the status-bar trigger becomes the handoff point.
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
    // Why: guarded render-time state update (no ref mutation during render); React can safely retry it before commit.
    setSpaceScanSnapshot(nextSpaceScanSnapshot)
  }
  const spaceScanReady = nextSpaceScanSnapshot.ready

  // Why: seed RAM after session restore so the closed chip does not require a
  // click; the session-inventory hook independently seeds daemon PTYs.
  useEffect(() => {
    if (workspaceSessionReady) {
      void fetchSnapshot()
    }
  }, [workspaceSessionReady, fetchSnapshot])

  // Poll memory only while the popover is open. Session inventory is still
  // explicit-on-open/action/seed (not a closed interval) because full
  // listSessions can pause input with large preserved-session sets.
  useEffect(() => {
    if (!open) {
      return
    }
    void fetchSnapshot()
    void refreshSessions()
    // Why: only memory polls on an interval; session inventory is explicit on open/action since it's expensive with many terminals.
    const memTimer = window.setInterval(() => {
      void fetchSnapshot()
    }, POLL_MS)
    return () => {
      window.clearInterval(memTimer)
    }
  }, [open, fetchSnapshot, refreshSessions])

  useEffect(() => {
    if (!open) {
      clearSessionsError()
    }
  }, [open, clearSessionsError])

  const repoDisplayNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const repo of repos) {
      const display = repo.displayName?.trim()
      if (display) {
        map.set(repo.id, display)
      }
    }
    return map
  }, [repos])

  // Why: non-null connectionId is the only honest "remote" signal (SSH PTYs run remote); build from the store, not a missing memory sample.
  const repoConnectionIdById = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const repo of repos) {
      map.set(repo.id, repo.connectionId ?? null)
    }
    return map
  }, [repos])

  // Why: runtime-hosted repos have no local daemon samples or killable sessions; this map drives their per-row exclusion in the merge.
  const repoRuntimeScopedById = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const repo of repos) {
      const parsed = parseExecutionHostId(getRepoExecutionHostId(repo))
      map.set(repo.id, parsed?.kind === 'runtime')
    }
    return map
  }, [repos])

  const repoById = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos])
  const worktreeById = useMemo(
    () => new Map(allWorktrees.map((worktree) => [worktree.id, worktree])),
    [allWorktrees]
  )

  const oldWorkspaceCount = useMemo(() => {
    const now = Date.now()
    let count = 0
    for (const worktree of allWorktrees) {
      const repo = repoById.get(worktree.repoId)
      if (!repo || isFolderRepo(repo) || worktree.isMainWorktree) {
        continue
      }
      if (isWorkspaceOldForCleanup(worktree, now)) {
        count += 1
      }
    }
    return count
  }, [allWorktrees, repoById])

  // Why: skip the merge when closed; the always-mounted segment recomputing on every keystroke-driven store mutation made the app laggy.
  const unifiedRepos = useMemo(
    () =>
      open
        ? mergeSnapshotAndSessions(resourceSnapshot, sessions, {
            // Why spread: the rows and the bulk selector must classify from the identical binding
            // inputs. Re-listing them here let the row path miss deferred SSH sessions, so their
            // single-row kill skipped confirmation while bulk cleanup correctly spared them (#8459).
            ...resourceSessionBindings,
            runtimePaneTitlesByTabId,
            repoDisplayNameById,
            repoConnectionIdById,
            repoRuntimeScopedById,
            browserTabsByWorktree,
            worktreeById
          })
        : [],
    [
      open,
      resourceSnapshot,
      sessions,
      resourceSessionBindings,
      runtimePaneTitlesByTabId,
      repoDisplayNameById,
      repoConnectionIdById,
      repoRuntimeScopedById,
      browserTabsByWorktree,
      worktreeById
    ]
  )

  // Why: orphan detection needs daemon inventory; keep it open-only so the closed badge never triggers a background global session scan.
  const orphanCount = useMemo(() => {
    if (!open || !workspaceSessionReady) {
      return 0
    }
    return countUnboundDaemonSessions(sessions, resourceSessionBindings)
  }, [open, sessions, resourceSessionBindings, workspaceSessionReady])

  // Why: open and closed badges share the same daemon inventory cache. The old
  // closed path used boundPtyIds (wake hints) and inflated the chip to 60+.
  const triggerSessionCount = sessionInventory.count

  const memoryMetricCopy = getResourceMemoryMetricCopy(
    resourceSnapshot?.processMemoryMetric ?? 'rss'
  )
  const { totalMemory, totalCpu, memBadgeLabel } = useMemo(() => {
    const memory = resourceSnapshot?.totalMemory ?? 0
    const cpu = resourceSnapshot?.totalCpu ?? 0
    return {
      totalMemory: memory,
      totalCpu: cpu,
      memBadgeLabel: resourceSnapshot ? formatMemory(memory) : '—'
    }
  }, [resourceSnapshot])

  // Why: memorySnapshotError null means "succeeded" OR "never fetched"; a sessions failure before any snapshot still counts as daemon-unreachable.
  const daemonUnreachable = sessionsError && (memorySnapshotError !== null || snapshot === null)
  // Why: sessions IPC can fail while snapshot IPC works; flag it so the empty session list isn't mistaken for healthy.
  const sessionsOnlyError = sessionsError && memorySnapshotError === null
  const resourceManagerTooltipLines = getResourceManagerTooltipLines({
    memoryLabel: resourceSnapshot
      ? `${memBadgeLabel} · ${memoryMetricCopy.summaryLabel}`
      : memBadgeLabel,
    sessionCount: triggerSessionCount,
    spaceScanReady
  })
  const resourceManagerAriaLabel = getResourceManagerAriaLabel({
    sessionCount: triggerSessionCount,
    spaceScanReady
  })

  const toggleRepo = useCallback((repoId: string): void => {
    setCollapsedRepos((prev) => {
      const next = new Set(prev)
      if (next.has(repoId)) {
        next.delete(repoId)
      } else {
        next.add(repoId)
      }
      return next
    })
  }, [])

  const toggleWorktree = useCallback((worktreeId: string): void => {
    setCollapsedWorktrees((prev) => {
      const next = new Set(prev)
      if (next.has(worktreeId)) {
        next.delete(worktreeId)
      } else {
        next.add(worktreeId)
      }
      return next
    })
  }, [])

  // Why: keep popover open on worktree navigation so users can browse; onFocusOutside suppresses the bound-row focus transfer.
  const navigateToWorktree = useCallback((worktreeId: string): void => {
    if (worktreeId === ORPHAN_WORKTREE_ID || worktreeId.startsWith(`${UNATTRIBUTED_REPO_ID}::`)) {
      return
    }
    activateAndRevealWorktree(worktreeId)
  }, [])

  const navigateToTab = useCallback(
    (tabId: string, paneKey: string | null) => {
      navigateResourceSessionToTab(tabId, paneKey, {
        tabsByWorktree,
        setOpen,
        setActiveView,
        activateAndRevealWorktree,
        activateTabAndFocusPane
      })
    },
    [tabsByWorktree, setActiveView]
  )

  const deleteWorktree = useCallback((worktreeId: string): void => {
    setOpen(false)
    runWorktreeDelete(worktreeId)
  }, [])

  const handleOpenWorkspaceCleanup = useCallback((): void => {
    setOpen(false)
    queueMicrotask(() => openModal('workspace-cleanup'))
  }, [openModal])

  const handleKillSession = useCallback(
    (session: UnifiedSessionRow): void => {
      if (!requiresKillConfirmation(session)) {
        removeSession(session.sessionId)
        // Why: await the kill before refreshing, else the refresh re-reads the daemon list before the kill lands and re-adds the row.
        void (async () => {
          try {
            await getClientRuntime().terminal.kill(session.sessionId)
          } catch {
            /* already dead */
          }
          await refreshSessions()
        })()
        return
      }
      setKillConfirm(session)
    },
    [refreshSessions, removeSession]
  )

  const handleKillOrphans = useCallback(async () => {
    if (!workspaceSessionReady) {
      return
    }
    // Why the shared selector: the button's count comes from the same function, so the set killed
    // is exactly the set advertised. Filtering separately here is how live sessions got killed.
    const orphans = selectUnboundDaemonSessions(sessions, resourceSessionBindings)
    if (orphans.length === 0) {
      return
    }
    // Why: optimistic removal so rows disappear immediately instead of waiting for the next daemon-side list refresh.
    const orphanIds = new Set(orphans.map((s) => s.id))
    removeSessions(orphanIds)
    await Promise.allSettled(orphans.map((s) => getClientRuntime().terminal.kill(s.id)))
    void refreshSessions()
  }, [sessions, resourceSessionBindings, workspaceSessionReady, refreshSessions, removeSessions])

  const runKillConfirmed = useCallback(async () => {
    if (!killConfirm) {
      return
    }
    const target = killConfirm
    setKilling(true)
    // Why: optimistic removal avoids a flash where the dialog closes but the killed row lingers until the next list refresh.
    removeSession(target.sessionId)
    try {
      await getClientRuntime().terminal.kill(target.sessionId)
    } catch {
      /* already dead — fall through */
    } finally {
      if (mountedRef.current) {
        setKilling(false)
        setKillConfirm(null)
        // Why: killed row unmounts and focus would drop to <body>; park it on the popover body so keyboard users stay in the list.
        cancelPopoverBodyFocusFrame()
        if (popoverBodyRef.current) {
          popoverBodyFocusFrameRef.current = requestAnimationFrame(() => {
            popoverBodyFocusFrameRef.current = null
            popoverBodyRef.current?.focus()
          })
        }
        void refreshSessions()
      }
    }
  }, [cancelPopoverBodyFocusFrame, killConfirm, mountedRef, refreshSessions, removeSession])

  const openSpaceResults = useCallback((): void => {
    setOpen(false)
    openSpacePage()
  }, [openSpacePage])

  return <ResourceUsageStatusView {...{
    open, setOpen, recordFeatureInteraction, daemonUnreachable, resourceManagerAriaLabel, spaceScanReady,
    iconOnly, memBadgeLabel, triggerSessionCount, orphanCount, resourceManagerTooltipLines, daemonActions,
    sessionsOnlyError, resourceSnapshot, totalCpu, totalMemory, memoryMetricCopy, setPopoverBodyNode,
    sortOption, setSortOption, METRIC_COLUMNS_CLS, CPU_COLUMN_CLS, MEM_COLUMN_CLS, ROW_TRAILING_GUTTER_CLS,
    unifiedRepos, collapsedRepos, toggleRepo, collapsedWorktrees, activeWorktreeId, toggleWorktree,
    navigateToWorktree, navigateToTab, deleteWorktree, handleKillSession, appCollapsed, setAppCollapsed,
    handleOpenWorkspaceCleanup, openSpaceResults, handleKillOrphans, oldWorkspaceCount, killConfirm,
    killing, setKillConfirm, runKillConfirmed
  } />
}
