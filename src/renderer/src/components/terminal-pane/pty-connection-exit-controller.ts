import type { PaneManager, ManagedPane } from '@/lib/pane-manager/pane-manager'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { useAppStore } from '@/store'
import type { PtyTransport } from './pty-transport'
import type { PtyConnectionDeps } from './pty-connection-types'
import {
  consumeCommittedPtyShutdownExit,
  deferPtyShutdownExit,
  isHostPtySleepPending
} from './pty-shutdown-exit-deferral'

type PtyConnectionExitControllerArgs = {
  pane: ManagedPane
  manager: PaneManager
  deps: PtyConnectionDeps
  cacheKey: string
  getRuntimeEnvironmentId: () => string | null
  getTransport: () => PtyTransport
  resetRendererOrderedSeqForExit: (ptyId: string) => void
  releaseCurrentPaneRuntime: () => void
  onSuppressedExit: (ptyId: string) => void
  getHadExistingPaneTransportAtConnect: () => boolean
  getRestoredPtyIdForTransport: () => string | null
  getLastTerminalInputAt: () => number
  getHasReceivedPtyOutput: () => boolean
}

export function createPtyConnectionExitController({
  pane,
  manager,
  deps,
  cacheKey,
  getRuntimeEnvironmentId,
  getTransport,
  resetRendererOrderedSeqForExit,
  releaseCurrentPaneRuntime,
  onSuppressedExit,
  getHadExistingPaneTransportAtConnect,
  getRestoredPtyIdForTransport,
  getLastTerminalInputAt,
  getHasReceivedPtyOutput
}: PtyConnectionExitControllerArgs) {
  // Why: reconcile-driven and transport-driven exits can race for the same
  // PTY, while a later replacement PTY must still get its own exit handling.
  let handledExitPtyId: string | null = null
  let spawnedFreshPtyId: string | null = null

  const focusSurvivingPtyPaneAfterKeptExit = (): void => {
    if (manager.getActivePane()?.id !== pane.id) {
      return
    }
    const hasPtyBinding = (paneId: number): boolean =>
      Boolean(deps.paneTransportsRef.current.get(paneId)?.getPtyId())
    const repairedActiveLeafId =
      useAppStore.getState().terminalLayoutsByTabId[deps.tabId]?.activeLeafId ?? null
    const repairedActivePaneId = repairedActiveLeafId
      ? manager.getNumericIdForLeaf(repairedActiveLeafId)
      : null
    const targetPaneId =
      repairedActivePaneId !== null &&
      repairedActivePaneId !== pane.id &&
      hasPtyBinding(repairedActivePaneId)
        ? repairedActivePaneId
        : (manager
            .getPanes()
            .find((candidate) => candidate.id !== pane.id && hasPtyBinding(candidate.id))?.id ??
          null)
    if (targetPaneId !== null) {
      manager.setActivePane(targetPaneId, {
        focus: deps.isActiveRef.current && deps.isVisibleRef.current
      })
    }
  }

  const onExit = (ptyId: string, opts: { preserveRendererBinding?: boolean } = {}): void => {
    if (handledExitPtyId === ptyId) {
      return
    }
    const runtimeEnvironmentId = getRuntimeEnvironmentId()
    if (deps.isPtyShutdownPending(ptyId) || isHostPtySleepPending(ptyId, runtimeEnvironmentId)) {
      // Why: replay only after verified commit; rollback keeps the renderer retryable.
      deferPtyShutdownExit(ptyId, (settlement) => {
        if (settlement === 'committed') {
          onExit(ptyId, { preserveRendererBinding: true })
        }
      })
      return
    }
    const preserveRendererBinding =
      opts.preserveRendererBinding === true ||
      consumeCommittedPtyShutdownExit(ptyId, runtimeEnvironmentId)
    resetRendererOrderedSeqForExit(ptyId)
    const transport = getTransport()
    const currentPaneTransport = deps.paneTransportsRef.current.get(pane.id)
    if (currentPaneTransport && currentPaneTransport !== transport) {
      handledExitPtyId = ptyId
      if (!preserveRendererBinding) {
        deps.clearTabPtyId(deps.tabId, ptyId)
      }
      deps.consumeSuppressedPtyExit(ptyId)
      scheduleRuntimeGraphSync()
      return
    }

    handledExitPtyId = ptyId
    releaseCurrentPaneRuntime()
    const isSuppressedExit = deps.consumeSuppressedPtyExit(ptyId) || preserveRendererBinding
    if (!isSuppressedExit) {
      deps.clearExitedPanePtyLayoutBinding(pane.id, ptyId)
    }
    deps.clearRuntimePaneTitle(deps.tabId, pane.id)
    if (!preserveRendererBinding) {
      deps.clearTabPtyId(deps.tabId, ptyId)
    }
    deps.setCacheTimerStartedAt(cacheKey, null)
    useAppStore.getState().removeAgentStatus(cacheKey)
    useAppStore.getState().clearPaneForegroundAgent(cacheKey)
    scheduleRuntimeGraphSync()
    manager.setPaneGpuRendering(pane.id, true)

    if (isSuppressedExit) {
      onSuppressedExit(ptyId)
      return
    }
    const panes = manager.getPanes()
    if (panes.length <= 1) {
      if (spawnedFreshPtyId === ptyId && !Number.isFinite(getLastTerminalInputAt())) {
        return
      }
      deps.onPtyExitRef.current(ptyId)
      return
    }
    if (
      deps.isVisibleRef.current &&
      getHadExistingPaneTransportAtConnect() &&
      !getRestoredPtyIdForTransport() &&
      !Number.isFinite(getLastTerminalInputAt()) &&
      !getHasReceivedPtyOutput()
    ) {
      focusSurvivingPtyPaneAfterKeptExit()
      return
    }
    manager.closePane(pane.id)
  }

  return {
    onExit,
    noteFreshSpawn: (ptyId: string) => {
      spawnedFreshPtyId = ptyId
    },
    hasHandledExit: (ptyId: string) => handledExitPtyId === ptyId
  }
}
