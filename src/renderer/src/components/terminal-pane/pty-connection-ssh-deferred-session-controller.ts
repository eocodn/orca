import type { ColdRestoreAgentResumeStartup, FreshSpawnOptions } from './pty-connection-e2e-support'
import type { ReattachAttemptOptions } from './pty-connection-reattach-attempt-controller'
import { runPtyConnectionDeferredSshConnect } from './pty-connection-deferred-ssh-connect-controller'
import { createPtyConnectionReattachFallbackController } from './pty-connection-reattach-fallback-controller'
import { runPtyConnectionSavedSshReattach } from './pty-connection-saved-ssh-reattach-controller'
import { runPtyConnectionSshConnectSettlement } from './pty-connection-ssh-connect-settlement-controller'
import { runPtyConnectionSshPromptAdmission } from './pty-connection-ssh-prompt-admission-controller'
import { waitForUserInitiatedSshConnect } from './pty-connection-ssh-prompt-wait-controller'

type SshConnectionResult = { connected: true } | { connected: false; error: string }
type SshPromptConnectOutcome = 'connected' | 'cancelled' | 'failed'

type PtyConnectionSshDeferredSessionArgs = {
  tabId: string
  pendingSessionId: string | null
  needsPassphrasePrompt: () => Promise<boolean>
  getSshStatus: () => string | undefined
  subscribeSshStatus: (listener: () => void) => () => void
  outcomeForStatus: (
    status: string | undefined,
    sawNonDisconnected: boolean
  ) => SshPromptConnectOutcome | null
  isCurrentAuthority: () => boolean
  isDisposed: () => boolean
  waitTeardowns: (() => void)[]
  waitForConnection: () => Promise<SshConnectionResult>
  removeDeferredReconnectTarget: () => void
  reportError: (message: string) => void
  legacyWorkerAutomaticResumeBlocked: () => boolean
  attachRetainedLegacyPty: (sessionId: string) => boolean
  removeDeferredSession: () => void
  scheduleRuntimeGraphSync: () => void
  startFreshColdRestore: (
    startup?: ColdRestoreAgentResumeStartup | null,
    options?: FreshSpawnOptions
  ) => Promise<string | null> | void
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  clearPaneMode2031State: () => void
  clearHiddenOutputRestoreState: () => void
  getTransportStreamGeneration: () => number
  isCurrentReattachAuthority: (sessionId: string) => boolean
  rejectObsoleteReattachAuthority: (sessionId: string) => boolean
  isSessionExpiredError: (error: unknown) => boolean
  clearBindings: (sessionId: string) => void
  attemptReattach: (options: ReattachAttemptOptions) => Promise<void>
  logWarning: (...args: unknown[]) => void
}

// Why: deferred SSH recovery spans several strict owners whose ordering and
// saved-session handoff must remain one observable transaction.
export function runPtyConnectionSshDeferredSession({
  tabId,
  pendingSessionId,
  needsPassphrasePrompt,
  getSshStatus,
  subscribeSshStatus,
  outcomeForStatus,
  isCurrentAuthority,
  isDisposed,
  waitTeardowns,
  waitForConnection,
  removeDeferredReconnectTarget,
  reportError,
  legacyWorkerAutomaticResumeBlocked,
  attachRetainedLegacyPty,
  removeDeferredSession,
  scheduleRuntimeGraphSync,
  startFreshColdRestore,
  buildColdRestoreStartup,
  clearPaneMode2031State,
  clearHiddenOutputRestoreState,
  getTransportStreamGeneration,
  isCurrentReattachAuthority,
  rejectObsoleteReattachAuthority,
  isSessionExpiredError,
  clearBindings,
  attemptReattach,
  logWarning
}: PtyConnectionSshDeferredSessionArgs) {
  return runPtyConnectionDeferredSshConnect({
    runPromptAdmission: () =>
      runPtyConnectionSshPromptAdmission({
        needsPassphrasePrompt,
        isCurrentAuthority,
        isAlreadyConnected: () => getSshStatus() === 'connected',
        waitForUserConnect: () =>
          waitForUserInitiatedSshConnect({
            getStatus: getSshStatus,
            subscribe: subscribeSshStatus,
            isDisposed,
            waitTeardowns,
            outcomeForStatus
          }),
        warnProbeFailure: (error) =>
          logWarning('[pty-connection] needsPassphrasePrompt probe failed:', error),
        reportError
      }),
    runSettlement: () =>
      runPtyConnectionSshConnectSettlement({
        waitForConnection,
        isCurrentAuthority,
        isDisposed,
        removeDeferredReconnectTarget,
        reportError,
        onConnected: () =>
          runPtyConnectionSavedSshReattach({
            pendingSessionId,
            legacyWorkerAutomaticResumeBlocked: legacyWorkerAutomaticResumeBlocked(),
            attachRetainedLegacyPty,
            removeDeferredSession,
            scheduleRuntimeGraphSync,
            startFreshColdRestore: () => startFreshColdRestore(),
            buildColdRestoreStartup,
            clearPaneMode2031State,
            clearHiddenOutputRestoreState,
            createFallbackHandlers: (sessionId, coldRestoreStartup) =>
              createPtyConnectionReattachFallbackController({
                sessionId,
                isDisposed,
                rejectRejectedWhenDisposed: true,
                getTransportStreamGeneration,
                isCurrentAuthority: isCurrentReattachAuthority,
                rejectObsoleteAuthority: rejectObsoleteReattachAuthority,
                isRejectedSessionExpired: isSessionExpiredError,
                clearBindings: () => clearBindings(sessionId),
                clearBindingsOnRejectedError: false,
                startFreshColdRestore: () =>
                  startFreshColdRestore(coldRestoreStartup, {
                    forceBlankRestoredViewport: true
                  }),
                reportError,
                warnRejected: () => {},
                reportRejectedError: false,
                warnRejectedError: false
              }),
            attemptReattach,
            logAttempt: (sessionId) =>
              logWarning(
                `[pty-connection] Attempting reattach for tab=${tabId} sessionId=${sessionId}`
              ),
            logResult: (result) =>
              logWarning(
                `[pty-connection] Reattach result for tab=${tabId}:`,
                result
                  ? {
                      sessionExpired: (result as Record<string, unknown>).sessionExpired,
                      replay: Boolean((result as Record<string, unknown>).replay)
                    }
                  : 'undefined'
              ),
            logRejected: (error) =>
              logWarning(`[pty-connection] Reattach FAILED for tab=${tabId}:`, error)
          })
      })
  })
}
