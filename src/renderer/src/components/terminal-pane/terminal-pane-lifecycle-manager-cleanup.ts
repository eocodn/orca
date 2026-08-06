import type { IDisposable } from '@xterm/xterm'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { e2eConfig } from '@/lib/e2e-config'
import { restoreExpandedLayoutFrom } from './expand-collapse'
import { captureParkedTerminalPaneCandidates } from './terminal-parked-tab-watchers'
import type { TerminalPaneLifecycleSetupContext } from './terminal-pane-lifecycle-contracts'
import { shouldDetachPaneTransportOnUnmount } from './terminal-pane-lifecycle-policies'

type CleanupArgs = {
  context: TerminalPaneLifecycleSetupContext
  manager: PaneManager
  expandedStyleSnapshots: Parameters<typeof restoreExpandedLayoutFrom>[0]
  paneTransports: TerminalPaneLifecycleSetupContext['deps']['paneTransportsRef']['current']
  panePtyBindings: TerminalPaneLifecycleSetupContext['deps']['panePtyBindingsRef']['current']
  unregisterRuntimeTab: () => void
  releaseDragRef: { current: (() => void) | null }
  unregisterCliEvents: () => void
}

export function cleanupTerminalPaneManager({
  context,
  manager,
  expandedStyleSnapshots,
  paneTransports,
  panePtyBindings,
  unregisterRuntimeTab,
  releaseDragRef,
  unregisterCliEvents
}: CleanupArgs): void {
  const { deps: d, refs } = context
  unregisterCliEvents()
  const currentWorktreeTabs = useAppStore.getState().tabsByWorktree[d.worktreeId]
  const tabStillExists = Boolean(currentWorktreeTabs?.some((candidate) => candidate.id === d.tabId))
  unregisterRuntimeTab()
  context.cancelResizeAll()
  restoreExpandedLayoutFrom(expandedStyleSnapshots)
  disposeAll(refs.linkProviderDisposablesRef.current)
  disposeAll(refs.terminalHandleLinkDisposablesRef.current)
  disposeAll(refs.linkifierClickPrimingDisposablesRef.current)
  disposeAll(refs.fileLinkClickFallbackDisposablesRef.current)
  disposeAll(refs.httpLinkClickFallbackDisposablesRef.current)
  disposeAll(refs.selectionDisposablesRef.current)
  for (const timer of refs.selectionCaptureTimersRef.current.values()) {
    window.clearTimeout(timer)
  }
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
  for (const binding of panePtyBindings.values()) {
    binding.dispose()
  }
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

function disposeAll(map: Map<number, IDisposable>): void {
  for (const disposable of map.values()) {
    disposable.dispose()
  }
  map.clear()
}
