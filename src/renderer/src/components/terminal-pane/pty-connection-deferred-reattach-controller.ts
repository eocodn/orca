import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'

type ReattachFallbackHandlers = Pick<
  ReattachAttemptOptions,
  'onTransportError' | 'onExpired' | 'onRejected'
>

type PtyConnectionDeferredReattachArgs = {
  paneId: number
  sessionId: string
  setAllowInitialIdleCacheSeed: (value: boolean) => void
  recordDiagnostic: (message: string) => void
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  createFallbackHandlers: (
    sessionId: string,
    coldRestoreStartup: ColdRestoreAgentResumeStartup | null
  ) => ReattachFallbackHandlers
  attemptReattach: (options: ReattachAttemptOptions) => Promise<void>
}

export function runPtyConnectionDeferredReattach({
  paneId,
  sessionId,
  setAllowInitialIdleCacheSeed,
  recordDiagnostic,
  buildColdRestoreStartup,
  createFallbackHandlers,
  attemptReattach
}: PtyConnectionDeferredReattachArgs): void {
  setAllowInitialIdleCacheSeed(true)
  recordDiagnostic(`pane=${paneId} -> REATTACH ${sessionId}`)
  const coldRestoreStartup = buildColdRestoreStartup()
  const fallbackHandlers = createFallbackHandlers(sessionId, coldRestoreStartup)
  void attemptReattach({
    sessionId,
    coldRestoreStartup,
    onTransportError: fallbackHandlers.onTransportError,
    onExpired: fallbackHandlers.onExpired,
    onRejected: fallbackHandlers.onRejected
  })
}
