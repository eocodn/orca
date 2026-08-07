import type { ColdRestoreAgentResumeStartup, FreshSpawnOptions } from './pty-connection-e2e-support'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import { runPtyConnectionDeferredReattach } from './pty-connection-deferred-reattach-controller'
import { createPtyConnectionRestoredReattachFallback } from './pty-connection-restored-reattach-fallback'

type TerminalLifecycleDetails = {
  tabId: string
  worktreeId: string
  leafId: string | null
  paneId: number
  ptyId: string
  reason: string
}

export type PtyConnectionRestoredReattachSessionArgs = {
  paneId: number
  tabId: string
  worktreeId: string
  leafId: string | null
  sessionId: string
  setAllowInitialIdleCacheSeed: (value: boolean) => void
  recordDiagnostic: (message: string) => void
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  isDisposed: () => boolean
  getTransportStreamGeneration: () => number
  isCurrentAuthority: (sessionId: string) => boolean
  rejectObsoleteAuthority: (sessionId: string) => boolean
  isRejectedSessionExpired: (error: unknown) => boolean
  clearPaneBinding: (sessionId: string) => void
  clearTabBinding: (sessionId: string) => void
  startFreshColdRestore: (
    startup: ColdRestoreAgentResumeStartup | null,
    options: FreshSpawnOptions
  ) => Promise<string | null> | void
  reportError: (message: string) => void
  warnLifecycleAnomaly: (event: string, details: TerminalLifecycleDetails) => void
  attemptReattach: (options: ReattachAttemptOptions) => Promise<void>
}

export function runPtyConnectionRestoredReattachSession({
  paneId,
  tabId,
  worktreeId,
  leafId,
  sessionId,
  setAllowInitialIdleCacheSeed,
  recordDiagnostic,
  buildColdRestoreStartup,
  isDisposed,
  getTransportStreamGeneration,
  isCurrentAuthority,
  rejectObsoleteAuthority,
  isRejectedSessionExpired,
  clearPaneBinding,
  clearTabBinding,
  startFreshColdRestore,
  reportError,
  warnLifecycleAnomaly,
  attemptReattach
}: PtyConnectionRestoredReattachSessionArgs): void {
  runPtyConnectionDeferredReattach({
    paneId,
    sessionId,
    setAllowInitialIdleCacheSeed,
    recordDiagnostic,
    buildColdRestoreStartup,
    createFallbackHandlers: (fallbackSessionId, coldRestoreStartup) =>
      createPtyConnectionRestoredReattachFallback({
        sessionId: fallbackSessionId,
        coldRestoreStartup,
        paneId,
        tabId,
        worktreeId,
        leafId,
        isDisposed,
        getTransportStreamGeneration,
        isCurrentAuthority,
        rejectObsoleteAuthority,
        isRejectedSessionExpired,
        clearPaneBinding: () => clearPaneBinding(fallbackSessionId),
        clearTabBinding: () => clearTabBinding(fallbackSessionId),
        startFreshColdRestore: (startup, options) => {
          void startFreshColdRestore(startup, options)
        },
        reportError,
        warnLifecycleAnomaly
      }),
    attemptReattach
  })
}
