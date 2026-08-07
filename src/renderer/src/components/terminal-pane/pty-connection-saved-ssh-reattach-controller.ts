import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import type { PtyConnectResult } from './pty-transport'

type ReattachFallbackHandlers = Pick<
  ReattachAttemptOptions,
  'onTransportError' | 'onExpired' | 'onRejected'
>

type PtyConnectionSavedSshReattachArgs = {
  pendingSessionId: string | null
  legacyWorkerAutomaticResumeBlocked: boolean
  attachRetainedLegacyPty: (sessionId: string) => boolean
  removeDeferredSession: () => void
  scheduleRuntimeGraphSync: () => void
  startFreshColdRestore: () => void
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  clearPaneMode2031State: () => void
  clearHiddenOutputRestoreState: () => void
  createFallbackHandlers: (
    sessionId: string,
    coldRestoreStartup: ColdRestoreAgentResumeStartup | null
  ) => ReattachFallbackHandlers
  attemptReattach: (options: ReattachAttemptOptions) => Promise<void>
  logAttempt: (sessionId: string) => void
  logResult: (result: PtyConnectResult | string | void) => void
  logRejected: (error: unknown) => void
}

export function runPtyConnectionSavedSshReattach({
  pendingSessionId,
  legacyWorkerAutomaticResumeBlocked,
  attachRetainedLegacyPty,
  removeDeferredSession,
  scheduleRuntimeGraphSync,
  startFreshColdRestore,
  buildColdRestoreStartup,
  clearPaneMode2031State,
  clearHiddenOutputRestoreState,
  createFallbackHandlers,
  attemptReattach,
  logAttempt,
  logResult,
  logRejected
}: PtyConnectionSavedSshReattachArgs): 'fresh' | 'legacy' | 'reattach' {
  if (!pendingSessionId) {
    startFreshColdRestore()
    return 'fresh'
  }
  if (legacyWorkerAutomaticResumeBlocked) {
    if (attachRetainedLegacyPty(pendingSessionId)) {
      removeDeferredSession()
      scheduleRuntimeGraphSync()
    }
    return 'legacy'
  }
  logAttempt(pendingSessionId)
  // Why: saved remote PTY ids are single-use restore metadata; remounts must not retry an expired id.
  removeDeferredSession()
  const coldRestoreStartup = buildColdRestoreStartup()
  clearPaneMode2031State()
  clearHiddenOutputRestoreState()
  const fallbackHandlers = createFallbackHandlers(pendingSessionId, coldRestoreStartup)
  void attemptReattach({
    sessionId: pendingSessionId,
    coldRestoreStartup,
    onTransportError: fallbackHandlers.onTransportError,
    onResult: logResult,
    onExpired: fallbackHandlers.onExpired,
    onRejected: (error, generation) => {
      logRejected(error)
      fallbackHandlers.onRejected(error, generation)
    }
  })
  return 'reattach'
}
