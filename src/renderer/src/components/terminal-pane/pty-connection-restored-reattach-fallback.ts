import type { ColdRestoreAgentResumeStartup, FreshSpawnOptions } from './pty-connection-e2e-support'
import { createPtyConnectionReattachFallbackController } from './pty-connection-reattach-fallback-controller'

type TerminalLifecycleDetails = {
  tabId: string
  worktreeId: string
  leafId: string | null
  paneId: number
  ptyId: string
  reason: string
}

type PtyConnectionRestoredReattachFallbackArgs = {
  sessionId: string
  coldRestoreStartup: ColdRestoreAgentResumeStartup | null
  paneId: number
  tabId: string
  worktreeId: string
  leafId: string | null
  isDisposed: () => boolean
  getTransportStreamGeneration: () => number
  isCurrentAuthority: (sessionId: string) => boolean
  rejectObsoleteAuthority: (sessionId: string) => boolean
  isRejectedSessionExpired: (error: unknown) => boolean
  clearPaneBinding: () => void
  clearTabBinding: () => void
  startFreshColdRestore: (
    startup: ColdRestoreAgentResumeStartup | null,
    options: FreshSpawnOptions
  ) => void
  reportError: (message: string) => void
  warnLifecycleAnomaly: (event: string, details: TerminalLifecycleDetails) => void
}

export function createPtyConnectionRestoredReattachFallback({
  sessionId,
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
  clearPaneBinding,
  clearTabBinding,
  startFreshColdRestore,
  reportError,
  warnLifecycleAnomaly
}: PtyConnectionRestoredReattachFallbackArgs) {
  return createPtyConnectionReattachFallbackController({
    sessionId,
    isDisposed,
    rejectRejectedWhenDisposed: false,
    getTransportStreamGeneration,
    isCurrentAuthority,
    rejectObsoleteAuthority,
    isRejectedSessionExpired,
    clearBindings: () => {
      clearPaneBinding()
      clearTabBinding()
    },
    clearBindingsOnRejectedError: true,
    startFreshColdRestore: () =>
      startFreshColdRestore(coldRestoreStartup, { forceBlankRestoredViewport: true }),
    reportError,
    warnRejected: (reason) =>
      warnLifecycleAnomaly('restored PTY reattach threw', {
        tabId,
        worktreeId,
        leafId,
        paneId,
        ptyId: sessionId,
        reason
      }),
    reportRejectedError: true,
    warnRejectedError: true
  })
}
