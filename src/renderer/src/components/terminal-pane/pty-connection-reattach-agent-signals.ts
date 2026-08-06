import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { detectAgentStatusFromTitle } from '@/lib/agent-status'
import { useAppStore } from '@/store'
import {
  CURSOR_AGENT_REATTACH_HEADER,
  hasCursorAgentReattachPayloadScreenSignal,
  terminalOwnsDomFocus
} from './pty-connection-screen-signals'
import { REATTACH_IDLE_AGENT_CURSOR_RESET_DELAY_MS } from './pty-connection-runtime-state'
import type { PtyConnectionDeps } from './pty-connection-types'

type ReattachAgentSignalsArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  cacheKey: string
  isDisposed: () => boolean
  queueAgentIdleTerminalModeReset: () => void
}

export function createPtyConnectionReattachAgentSignals({
  pane,
  deps,
  cacheKey,
  isDisposed,
  queueAgentIdleTerminalModeReset
}: ReattachAgentSignalsArgs) {
  let idleCursorResetTimer: ReturnType<typeof setTimeout> | null = null
  let replayPayloadHasCursorAgentSignal = false
  let replayPayloadSignalGeneration = 0

  const clearIdleCursorResetTimer = (): void => {
    if (idleCursorResetTimer !== null) {
      clearTimeout(idleCursorResetTimer)
      idleCursorResetTimer = null
    }
  }
  const getCurrentTerminalTitle = (): string | null => {
    const state = useAppStore.getState()
    const runtimeTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const tabTitle = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )?.title
    return runtimeTitle ?? tabTitle ?? null
  }
  const rememberReplayPayloadAgentSignal = (
    data: string,
    opts: { fullScreenReplay: boolean }
  ): void => {
    replayPayloadSignalGeneration += 1
    const signal = hasCursorAgentReattachPayloadScreenSignal(data)
    replayPayloadHasCursorAgentSignal = opts.fullScreenReplay
      ? signal
      : replayPayloadHasCursorAgentSignal || signal
  }
  const hasLiveStatusOrTitleSignal = (): boolean => {
    if (useAppStore.getState().agentStatusByPaneKey[cacheKey]) {
      return true
    }
    const title = getCurrentTerminalTitle() ?? ''
    return (
      detectAgentStatusFromTitle(title) !== null ||
      title.trim().toLowerCase() === CURSOR_AGENT_REATTACH_HEADER.toLowerCase()
    )
  }
  const hasLiveAgentSignal = (): boolean =>
    hasLiveStatusOrTitleSignal() || replayPayloadHasCursorAgentSignal
  const shouldPreserveModes = (): boolean => hasLiveAgentSignal()
  const shouldSendFocusedFocusIn = (): boolean =>
    terminalOwnsDomFocus(pane.terminal) && shouldPreserveModes()
  const scheduleIdleCursorReset = (): void => {
    const status = detectAgentStatusFromTitle(getCurrentTerminalTitle() ?? '')
    if (status !== 'idle' && status !== 'permission') {
      return
    }
    clearIdleCursorResetTimer()
    idleCursorResetTimer = setTimeout(() => {
      idleCursorResetTimer = null
      if (isDisposed()) {
        return
      }
      const latestStatus = detectAgentStatusFromTitle(getCurrentTerminalTitle() ?? '')
      if (latestStatus !== 'idle' && latestStatus !== 'permission') {
        return
      }
      queueAgentIdleTerminalModeReset()
    }, REATTACH_IDLE_AGENT_CURSOR_RESET_DELAY_MS)
  }

  return {
    clearIdleCursorResetTimer,
    getReplayPayloadSignalGeneration: (): number => replayPayloadSignalGeneration,
    hasReplayPayloadCursorAgentSignal: (): boolean => replayPayloadHasCursorAgentSignal,
    resetReplayPayloadCursorAgentSignal: (): void => {
      replayPayloadHasCursorAgentSignal = false
    },
    rememberReplayPayloadAgentSignal,
    hasLiveStatusOrTitleSignal,
    shouldPreserveModes,
    shouldSendFocusedFocusIn,
    scheduleIdleCursorReset
  }
}
