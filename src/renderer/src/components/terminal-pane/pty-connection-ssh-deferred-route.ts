import { isRuntimeOwnedSshTargetId } from '../../../../shared/execution-host'
import { resolveSshPaneConnectGate } from './ssh-pane-connect-gate'

type PtyConnectionSshDeferredRouteArgs = {
  connectionId: string
  tabId: string
  sshStatus: string | undefined
  sshTargetLabels: unknown
  isDeferredTarget: boolean
  restoredLeafSessionId: string | null
  deferredTabSessionId: string | undefined
  tabPtyId: string | null | undefined
  hasLeafSessionMap: boolean
  legacyWorkerAutomaticResumeBlocked: boolean
  recordRouteDiagnostic: (message: string) => void
  dispatchDeferredFlow: (pendingSessionId: string | null) => void
}

// Why: the SSH provider must be ready before normal PTY routing, but runtime-owned
// targets and legacy automatic-resume panes have different ownership rules.
export function runPtyConnectionSshDeferredRoute({
  connectionId,
  tabId,
  sshStatus,
  sshTargetLabels,
  isDeferredTarget,
  restoredLeafSessionId,
  deferredTabSessionId,
  tabPtyId,
  hasLeafSessionMap,
  legacyWorkerAutomaticResumeBlocked,
  recordRouteDiagnostic,
  dispatchDeferredFlow
}: PtyConnectionSshDeferredRouteArgs): boolean {
  if (
    !isRuntimeOwnedSshTargetId(connectionId) &&
    sshTargetLabels instanceof Map &&
    !sshTargetLabels.has(connectionId)
  ) {
    return true
  }

  const gate = resolveSshPaneConnectGate({
    connectionId,
    sshStatus,
    isDeferredTarget,
    restoredLeafSessionId,
    deferredTabSessionId,
    tabPtyId,
    hasLeafSessionMap
  })
  const pendingSessionId = gate.pendingSessionId
  recordRouteDiagnostic(
    `[pty-connection] SSH tab=${tabId} connectionId=${connectionId} pendingSessionId=${pendingSessionId} sshConnected=${gate.sshConnected}`
  )

  if (gate.enterDeferredFlow && (!legacyWorkerAutomaticResumeBlocked || !gate.sshConnected)) {
    dispatchDeferredFlow(pendingSessionId)
    return true
  }
  return false
}
