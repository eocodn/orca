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
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import type { TerminalPaneLifecycleSetupContext } from './terminal-pane-lifecycle-contracts'
import {
  hydrateTerminalScrollbackRefs,
  resolveQueuedInitialCwd,
  resolveTerminalHomePathFromEnv
} from './terminal-pane-lifecycle-policies'
import { extractUncHost } from './terminal-pane-lifecycle-policies'
import { splitPaneWithOneShotStartup } from './terminal-pane-lifecycle-support'
import { createTerminalPaneManagerOptions } from './terminal-pane-lifecycle-manager-options'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import { getTerminalFileOpenHint, getTerminalUrlOpenHint } from './terminal-link-handlers'
import { seedRestoredPaneState } from './terminal-pane-lifecycle-restored-state'
import { registerTerminalPaneCliEvents } from './terminal-pane-lifecycle-cli-events'
import { cleanupTerminalPaneManager } from './terminal-pane-lifecycle-manager-cleanup'
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
    if (hasScrollbackRefs) {
      d.initialLayoutRef.current = layoutWithoutRestoredBuffers
    }
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
  const unregisterCliEvents = registerTerminalPaneCliEvents(mountContext, manager)

  return () =>
    cleanupTerminalPaneManager({
      context,
      manager,
      expandedStyleSnapshots,
      paneTransports,
      panePtyBindings,
      unregisterRuntimeTab: runtimeTab,
      releaseDragRef,
      unregisterCliEvents
    })
}
