import type { IDisposable } from '@xterm/xterm'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { e2eConfig } from '@/lib/e2e-config'
import { registerRuntimeTerminalTab } from '@/runtime/sync-runtime-graph'
import {
  normalizeTerminalLayoutSnapshot,
  replayTerminalLayout,
  restoreScrollbackBuffers
} from './layout-serialization'
import { canReleaseReplayedScrollbackFromStore } from './replayed-scrollback-store-release'
import { applyExpandedLayoutTo, restoreExpandedLayoutFrom } from './expand-collapse'
import { captureParkedTerminalPaneCandidates } from './terminal-parked-tab-watchers'
import {
  CLOSE_TERMINAL_PANE_EVENT,
  SPLIT_TERMINAL_PANE_EVENT,
  type CloseTerminalPaneDetail,
  type SplitTerminalPaneDetail
} from '@/constants/terminal'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import type {
  TerminalPaneLifecycleContext,
  TerminalPaneLifecycleSetupContext
} from './terminal-pane-lifecycle-contracts'
import {
  hydrateTerminalScrollbackRefs,
  resolveQueuedInitialCwd,
  resolveTerminalHomePathFromEnv
} from './terminal-pane-lifecycle-policies'
import { extractUncHost } from './terminal-pane-lifecycle-policies'
import {
  applyTerminalPaneCloseRequest,
  mapRestoredPaneTitlesByPaneId,
  recordRuntimeCreatedTerminalPaneSplit,
  splitPaneWithOneShotStartup,
  shouldDetachPaneTransportOnUnmount
} from './terminal-pane-lifecycle-support'
import { createTerminalPaneManagerOptions } from './terminal-pane-lifecycle-manager-options'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import { getTerminalFileOpenHint, getTerminalUrlOpenHint } from './terminal-link-handlers'
import { terminalUrlOpenHintOptionsFor } from './terminal-link-open-hints'

export function mountTerminalPaneManager(context: TerminalPaneLifecycleSetupContext): () => void {
  const { deps: d, refs } = context
  const container = d.containerRef.current
  if (!container) {
    return () => undefined
  }
  const expandedStyleSnapshots = d.expandedStyleSnapshotRef.current
  const paneTransports = d.paneTransportsRef.current
  const panePtyBindings = d.panePtyBindingsRef.current
  const worktreePath =
    useAppStore
      .getState()
      .allWorktrees()
      .find((candidate) => candidate.id === d.worktreeId)?.path ??
    d.cwd ??
    ''
  const defaultTabCwd = d.cwd ?? worktreePath
  const initialCwdResolution = resolveQueuedInitialCwd(
    refs.queuedInitialCwdRef.current,
    () => useAppStore.getState().consumeTabInitialCwd(d.tabId),
    defaultTabCwd
  )
  refs.queuedInitialCwdRef.current = initialCwdResolution.queuedInitialCwd
  const startupCwd = initialCwdResolution.startupCwd
  const terminalHomePath = resolveTerminalHomePathFromEnv(d.startup?.env)
  const pathExistsCache = new Map<string, boolean>()
  const linkDeps = {
    worktreeId: d.worktreeId,
    worktreePath,
    startupCwd,
    getPaneLinkCwd: (paneId: number) => d.paneCwdRef.current.get(paneId)?.cwd ?? startupCwd,
    terminalHomePath,
    managerRef: d.managerRef,
    linkProviderDisposablesRef: refs.linkProviderDisposablesRef,
    pathExistsCache,
    getRuntimeEnvironmentIdForPane: (paneId: number) => {
      const ptyId = d.paneTransportsRef.current.get(paneId)?.getPtyId()
      return ptyId ? getRemoteRuntimePtyEnvironmentId(ptyId) : null
    }
  }
  const normalizedInitialLayout = normalizeTerminalLayoutSnapshot(d.initialLayoutRef.current)
  if (normalizedInitialLayout.changed) {
    d.initialLayoutRef.current = normalizedInitialLayout.snapshot
    useAppStore.getState().setTabLayout(d.tabId, normalizedInitialLayout.snapshot)
  }
  const initialLayoutHadBuffers = Boolean(d.initialLayoutRef.current.buffersByLeafId)
  const hydratedInitialScrollback = hydrateTerminalScrollbackRefs(d.initialLayoutRef.current)
  if (hydratedInitialScrollback.hydrated) {
    d.initialLayoutRef.current = hydratedInitialScrollback.layout
  }
  const startupWithSetupSplitWait =
    d.startup && d.setupSplit
      ? { ...d.startup, waitForSetupSplitDirection: d.setupSplit.direction }
      : d.startup
  const ptyDeps = {
    tabId: d.tabId,
    worktreeId: d.worktreeId,
    cwd: startupCwd,
    startup: startupWithSetupSplitWait,
    paneTransportsRef: d.paneTransportsRef,
    paneMode2031Ref: d.paneMode2031Ref,
    paneKittyKeyboardModesRef: d.paneKittyKeyboardModesRef,
    paneLastThemeModeRef: d.paneLastThemeModeRef,
    replayingPanesRef: d.replayingPanesRef,
    restoredViewportBlankingPanesRef: refs.restoredViewportBlankingPanesRef,
    isActiveRef: d.isActiveRef,
    isVisibleRef: d.isVisibleRef,
    onPtyExitRef: d.onPtyExitRef,
    onAgentExitedRef: d.onAgentExitedRef,
    onPtyErrorRef: d.onPtyErrorRef,
    onPtyRecoveryStateRef: d.onPtyRecoveryStateRef,
    clearTabPtyId: d.clearTabPtyId,
    consumeSuppressedPtyExit: d.consumeSuppressedPtyExit,
    isPtyShutdownPending: d.isPtyShutdownPending,
    updateTabTitle: d.updateTabTitle,
    setRuntimePaneTitle: d.setRuntimePaneTitle,
    clearRuntimePaneTitle: d.clearRuntimePaneTitle,
    updateTabPtyId: d.updateTabPtyId,
    markWorktreeUnread: d.markWorktreeUnread,
    markTerminalTabUnread: d.markTerminalTabUnread,
    markTerminalPaneUnread: d.markTerminalPaneUnread,
    clearWorktreeUnread: d.clearWorktreeUnread,
    clearTerminalTabUnread: d.clearTerminalTabUnread,
    clearTerminalPaneUnread: d.clearTerminalPaneUnread,
    onShowSessionRestoredBanner: d.onShowSessionRestoredBanner,
    dispatchNotification: d.dispatchNotification,
    setCacheTimerStartedAt: d.setCacheTimerStartedAt,
    syncPanePtyLayoutBinding: d.syncPanePtyLayoutBinding,
    clearExitedPanePtyLayoutBinding: d.clearExitedPanePtyLayoutBinding,
    recordPaneMode2031Subscription: (paneId: number, repliedMode: 'dark' | 'light') => {
      d.paneMode2031Ref.current.set(paneId, true)
      d.paneLastThemeModeRef.current.set(paneId, repliedMode)
    },
    restoredPtyIdByLeafId: d.initialLayoutRef.current.ptyIdsByLeafId ?? {}
  }
  const mountContext = {
    ...context,
    startupCwd,
    defaultTabCwd,
    worktreePath,
    terminalHomePath,
    getPaneLinkCwd: (paneId: number) => d.paneCwdRef.current.get(paneId)?.cwd ?? startupCwd,
    linkDeps,
    ptyDeps,
    fileOpenLinkHint: getTerminalFileOpenHint(),
    getUrlOpenLinkHint: () =>
      getTerminalUrlOpenHint(terminalUrlOpenHintOptionsFor(d.settingsRef.current)),
    osc7UncHost: extractUncHost(startupCwd)
  }
  const releaseDragRef: { current: (() => void) | null } = { current: null }
  const runtimeTab = registerRuntimeTerminalTab({
    tabId: d.tabId,
    worktreeId: d.worktreeId,
    getManager: () => d.managerRef.current,
    getContainer: () => d.containerRef.current,
    getPtyIdForPane: (paneId) => d.paneTransportsRef.current.get(paneId)?.getPtyId() ?? null
  })
  let manager: PaneManager
  manager = new PaneManager(
    container,
    createTerminalPaneManagerOptions(mountContext, releaseDragRef)
  )
  d.managerRef.current = manager
  if (e2eConfig.exposeStore) {
    window.__paneManagers = window.__paneManagers ?? new Map()
    window.__paneManagers.set(d.tabId, manager)
  }
  const restoredPaneByLeafId = replayTerminalLayout(manager, d.initialLayoutRef.current, d.isActive)
  restoreScrollbackBuffers(
    manager,
    d.initialLayoutRef.current.buffersByLeafId,
    restoredPaneByLeafId,
    d.replayingPanesRef,
    refs.restoredViewportBlankingPanesRef
  )
  const hasScrollbackRefs = Boolean(d.initialLayoutRef.current.scrollbackRefsByLeafId)
  if (
    d.initialLayoutRef.current.buffersByLeafId &&
    canReleaseReplayedScrollbackFromStore({
      hasScrollbackRefs,
      worktreeId: d.worktreeId,
      repos: useAppStore.getState().repos
    })
  ) {
    const layoutWithoutRestoredBuffers = { ...d.initialLayoutRef.current }
    delete layoutWithoutRestoredBuffers.buffersByLeafId
    if (hasScrollbackRefs) d.initialLayoutRef.current = layoutWithoutRestoredBuffers
    if (initialLayoutHadBuffers) {
      useAppStore.getState().setTabLayout(d.tabId, layoutWithoutRestoredBuffers)
    }
  }
  seedRestoredPaneState(mountContext, manager, restoredPaneByLeafId)
  let issueAutomationAnchorPaneId: number | null = null
  const initialPane = manager.getActivePane() ?? manager.getPanes()[0]
  if (d.setupSplit && initialPane) {
    const setupPane = splitPaneWithOneShotStartup(
      ptyDeps,
      { command: d.setupSplit.command, env: d.setupSplit.env },
      () => manager.splitPane(initialPane.id, d.setupSplit!.direction)
    )
    issueAutomationAnchorPaneId = setupPane?.id ?? null
    manager.setActivePane(initialPane.id, { focus: d.isActive })
  }
  if (d.issueCommandSplit) {
    let targetPane = manager.getActivePane() ?? manager.getPanes()[0] ?? null
    if (issueAutomationAnchorPaneId !== null) {
      targetPane =
        manager.getPanes().find((pane) => pane.id === issueAutomationAnchorPaneId) ?? targetPane
    }
    if (targetPane) {
      splitPaneWithOneShotStartup(
        ptyDeps,
        { command: d.issueCommandSplit.command, env: d.issueCommandSplit.env },
        () => manager.splitPane(targetPane!.id, 'vertical')
      )
      manager.setActivePane(
        issueAutomationAnchorPaneId !== null ? (initialPane?.id ?? targetPane.id) : targetPane.id,
        { focus: d.isActive }
      )
    }
  }
  mountContext.shouldPersistLayout.value = true
  mountContext.syncCanExpandState()
  mountContext.syncPaneCount()
  mountContext.applyAppearance(manager)
  mountContext.queueResizeAll(d.isActive)
  d.persistLayoutSnapshot()
  scheduleRuntimeGraphSync()
  const onCliSplitPane = (event: Event): void => {
    const detail = (event as CustomEvent<SplitTerminalPaneDetail>).detail
    if (!detail?.tabId || detail.tabId !== d.tabId) return
    const mgr = d.managerRef.current
    if (!mgr || (detail.newLeafId && mgr.getNumericIdForLeaf(detail.newLeafId) !== null)) return
    const sourcePaneId = detail.sourceLeafId
      ? (mgr.getNumericIdForLeaf(detail.sourceLeafId) ?? detail.paneRuntimeId)
      : detail.paneRuntimeId
    if (sourcePaneId < 0) return
    const splitOptions = {
      ...(detail.newLeafId ? { leafId: detail.newLeafId } : {}),
      ...(detail.ptyId ? { ptyId: detail.ptyId } : {})
    }
    if (detail.command) {
      const createdPane = splitPaneWithOneShotStartup(ptyDeps, { command: detail.command }, () =>
        mgr.splitPane(sourcePaneId, detail.direction, splitOptions)
      )
      recordRuntimeCreatedTerminalPaneSplit(createdPane, {
        source: detail.telemetrySource ?? 'command',
        direction: detail.direction
      })
    } else {
      const createdPane = mgr.splitPane(sourcePaneId, detail.direction, splitOptions)
      recordRuntimeCreatedTerminalPaneSplit(createdPane, {
        source: detail.telemetrySource ?? 'command',
        direction: detail.direction
      })
    }
  }
  const onCliClosePane = (event: Event): void => {
    const detail = (event as CustomEvent<CloseTerminalPaneDetail>).detail
    if (!detail?.tabId || detail.tabId !== d.tabId) return
    const mgr = d.managerRef.current
    if (!mgr) return
    const result = applyTerminalPaneCloseRequest({
      detail,
      manager: mgr,
      getPtyIdForLeaf: (leafId) =>
        useAppStore.getState().terminalLayoutsByTabId[d.tabId]?.ptyIdsByLeafId?.[leafId],
      closeTab: () => closeTerminalTab(d.tabId),
      closeTabPreservingPty: () => {
        const store = useAppStore.getState()
        if (detail.retireSurface && detail.leafId) {
          store.retireAgentPaneAuthority(makePaneKey(d.tabId, detail.leafId), {
            preserveSleepingAgentSession: true
          })
        }
        store.closeTab(d.tabId, { reason: 'pty-exit', captureRecentlyClosed: false })
      }
    })
    if (result !== 'pane') return
    scheduleRuntimeGraphSync()
    mountContext.syncCanExpandState()
    mountContext.queueResizeAll(d.isActive)
    d.persistLayoutSnapshot()
  }
  window.addEventListener(SPLIT_TERMINAL_PANE_EVENT, onCliSplitPane)
  window.addEventListener(CLOSE_TERMINAL_PANE_EVENT, onCliClosePane)

  return () => {
    window.removeEventListener(SPLIT_TERMINAL_PANE_EVENT, onCliSplitPane)
    window.removeEventListener(CLOSE_TERMINAL_PANE_EVENT, onCliClosePane)
    const currentWorktreeTabs = useAppStore.getState().tabsByWorktree[d.worktreeId]
    const tabStillExists = Boolean(
      currentWorktreeTabs?.some((candidate) => candidate.id === d.tabId)
    )
    runtimeTab()
    context.cancelResizeAll()
    restoreExpandedLayoutFrom(expandedStyleSnapshots)
    disposeAll(refs.linkProviderDisposablesRef.current)
    disposeAll(refs.terminalHandleLinkDisposablesRef.current)
    disposeAll(refs.linkifierClickPrimingDisposablesRef.current)
    disposeAll(refs.fileLinkClickFallbackDisposablesRef.current)
    disposeAll(refs.httpLinkClickFallbackDisposablesRef.current)
    disposeAll(refs.selectionDisposablesRef.current)
    for (const timer of refs.selectionCaptureTimersRef.current.values()) window.clearTimeout(timer)
    refs.selectionCaptureTimersRef.current.clear()
    disposeAll(refs.mouseHideDisposablesRef.current)
    disposeAll(refs.imeCompositionDisposablesRef.current)
    disposeAll(refs.imeNativeTextForwarderDisposablesRef.current)
    disposeAll(refs.osc52DisposablesRef.current)
    disposeAll(refs.osc7DisposablesRef.current)
    captureParkedTerminalPaneCandidates(
      d.tabId,
      d.worktreeId,
      manager.getPanes().map((pane) => ({
        ptyId: paneTransports.get(pane.id)?.getPtyId() ?? null,
        paneId: pane.id,
        leafId: pane.leafId,
        drivesTabTitle: manager.getActivePane()?.id === pane.id
      }))
    )
    for (const transport of paneTransports.values()) {
      const ptyId = transport.getPtyId()
      if (
        shouldDetachPaneTransportOnUnmount({
          tabStillExists,
          tabId: d.tabId,
          ptyId,
          worktreeTabs: currentWorktreeTabs
        })
      ) {
        transport.detach?.()
      } else {
        transport.destroy?.()
      }
    }
    for (const binding of panePtyBindings.values()) binding.dispose()
    panePtyBindings.clear()
    paneTransports.clear()
    manager.destroy()
    releaseDragRef.current?.()
    releaseDragRef.current = null
    d.managerRef.current = null
    if (e2eConfig.exposeStore && window.__paneManagers?.get(d.tabId) === manager) {
      window.__paneManagers.delete(d.tabId)
    }
    d.setTabPaneExpanded(d.tabId, false)
    d.setTabCanExpandPane(d.tabId, false)
  }
}

function seedRestoredPaneState(
  context: TerminalPaneLifecycleContext,
  manager: PaneManager,
  restoredPaneByLeafId: ReadonlyMap<string, number>
): void {
  const { deps: d } = context
  const restoredTitles = mapRestoredPaneTitlesByPaneId(
    d.initialLayoutRef.current.titlesByLeafId,
    restoredPaneByLeafId
  )
  if (Object.keys(restoredTitles).length > 0) {
    d.setPaneTitles((previous) => ({ ...previous, ...restoredTitles }))
    d.paneTitlesRef.current = { ...d.paneTitlesRef.current, ...restoredTitles }
  }
  const restoredActivePaneId =
    (d.initialLayoutRef.current.activeLeafId
      ? restoredPaneByLeafId.get(d.initialLayoutRef.current.activeLeafId)
      : null) ??
    manager.getActivePane()?.id ??
    manager.getPanes()[0]?.id ??
    null
  if (restoredActivePaneId !== null)
    manager.setActivePane(restoredActivePaneId, { focus: d.isActive })
  const restoredExpandedPaneId = d.initialLayoutRef.current.expandedLeafId
    ? (restoredPaneByLeafId.get(d.initialLayoutRef.current.expandedLeafId) ?? null)
    : null
  if (restoredExpandedPaneId !== null && manager.getPanes().length > 1) {
    d.setExpandedPane(restoredExpandedPaneId)
    applyExpandedLayoutTo(restoredExpandedPaneId, {
      managerRef: d.managerRef,
      containerRef: d.containerRef,
      expandedStyleSnapshotRef: d.expandedStyleSnapshotRef
    })
  } else {
    d.setExpandedPane(null)
  }
}

function disposeAll(map: Map<number, IDisposable>): void {
  for (const disposable of map.values()) disposable.dispose()
  map.clear()
}
