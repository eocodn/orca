import type { PtyTransport } from './pty-transport'
import {
  shouldReconcileDeadSession,
  shouldReconcileMissingSession,
  type HasPty
} from './terminal-dead-session-reconcile'
import { REMOTE_PTY_ID_PREFIX } from './pty-connection-runtime-state'

type SessionLivenessReconcileControllerArgs = {
  transport: PtyTransport
  isDisposed: () => boolean
  hasHandledExit: (ptyId: string) => boolean
  getPtyBoundAt: () => number | null
  onExit: (ptyId: string) => void
}

export function createPtyConnectionSessionLivenessReconcileController({
  transport,
  isDisposed,
  hasHandledExit,
  getPtyBoundAt,
  onExit
}: SessionLivenessReconcileControllerArgs) {
  const reconcileIfSessionDead = (
    liveSessionIds: Set<string>,
    snapshotRequestedAt?: number
  ): void => {
    if (isDisposed()) {
      return
    }
    const ptyId = transport.getPtyId()
    if (
      !ptyId ||
      hasHandledExit(ptyId) ||
      !shouldReconcileDeadSession({
        ptyId,
        connectionId: transport.getConnectionId?.(),
        liveSessionIds,
        ptyBoundAt: getPtyBoundAt(),
        snapshotRequestedAt
      })
    ) {
      return
    }
    onExit(ptyId)
  }

  const reconcileIfSessionMissing = (
    hasPty: HasPty,
    livenessRequestedAt = performance.now()
  ): void => {
    const requestedPtyId = transport.getPtyId()
    if (
      !requestedPtyId ||
      hasHandledExit(requestedPtyId) ||
      requestedPtyId.startsWith(REMOTE_PTY_ID_PREFIX) ||
      transport.getConnectionId?.() != null
    ) {
      return
    }

    let livenessPromise: Promise<boolean | null>
    try {
      livenessPromise = Promise.resolve(hasPty(requestedPtyId))
    } catch {
      return
    }

    void livenessPromise
      .then((isLive) => {
        if (isDisposed()) {
          return
        }
        const currentPtyId = transport.getPtyId()
        if (
          !currentPtyId ||
          currentPtyId !== requestedPtyId ||
          hasHandledExit(currentPtyId) ||
          !shouldReconcileMissingSession({
            ptyId: currentPtyId,
            connectionId: transport.getConnectionId?.(),
            isLive,
            ptyBoundAt: getPtyBoundAt(),
            livenessRequestedAt
          })
        ) {
          return
        }
        onExit(currentPtyId)
      })
      .catch(() => {})
  }

  return { reconcileIfSessionDead, reconcileIfSessionMissing }
}
