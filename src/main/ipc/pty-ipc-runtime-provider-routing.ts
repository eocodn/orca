import { toAppSshPtyId, toRelaySshPtyId, parseAppSshPtyId } from '../providers/ssh-pty-id'
import { resolvePtyIncarnationState } from '../runtime/pty-runtime-lifecycle'
import type { IPtyProvider } from '../providers/types'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

const PTY_EXIT_EVIDENCE_MAX_PER_ID = 128

export function rememberSshPtyExitFinalization(id: string, ptyIncarnation: string): void {
  const byIncarnation =
    finalizedSshPtyExitById().get(id) ?? new Map<string, ReturnType<typeof setTimeout>>()
  const previousTimer = byIncarnation.get(ptyIncarnation)
  if (previousTimer) {
    clearTimeout(previousTimer)
  } else if (byIncarnation.size >= PTY_EXIT_EVIDENCE_MAX_PER_ID) {
    const oldest = byIncarnation.entries().next().value
    if (oldest) {
      clearTimeout(oldest[1])
      byIncarnation.delete(oldest[0])
    }
  }
  const cleanupTimer = setTimeout(() => {
    const current = finalizedSshPtyExitById().get(id)
    if (current?.get(ptyIncarnation) === cleanupTimer) {
      current.delete(ptyIncarnation)
      if (current.size === 0) {
        finalizedSshPtyExitById().delete(id)
      }
    }
  }, 30_000)
  cleanupTimer.unref?.()
  byIncarnation.set(ptyIncarnation, cleanupTimer)
  finalizedSshPtyExitById().set(id, byIncarnation)
}

function finalizedSshPtyExitById(): Map<string, Map<string, ReturnType<typeof setTimeout>>> {
  const state = ptyRuntimeState as typeof ptyRuntimeState & {
    finalizedSshPtyExitById?: Map<string, Map<string, ReturnType<typeof setTimeout>>>
  }
  return (state.finalizedSshPtyExitById ??= new Map())
}

export function consumeSshPtyExitFinalization(payload: {
  id: string
  ptyIncarnation: string
}): boolean {
  const byIncarnation = finalizedSshPtyExitById().get(payload.id)
  const cleanupTimer = byIncarnation?.get(payload.ptyIncarnation)
  if (!cleanupTimer) {
    return false
  }
  clearTimeout(cleanupTimer)
  byIncarnation!.delete(payload.ptyIncarnation)
  if (byIncarnation!.size === 0) {
    finalizedSshPtyExitById().delete(payload.id)
  }
  return true
}

export function isCurrentPtyExit(payload: {
  id: string
  incarnationId?: string
  ptyIncarnation?: string
}): boolean {
  const incarnationId = payload.incarnationId ?? payload.ptyIncarnation
  const current = ptyRuntimeState.ptyIncarnationById.get(payload.id)
  const pending = ptyRuntimeState.pendingPtyIncarnationById.get(payload.id)
  const cleanupPending = (ptyRuntimeState.cleanupPendingPtyById.get(payload.id)?.size ?? 0) > 0
  const lifecycleState = resolvePtyIncarnationState({ current, pending, cleanupPending })
  if (current) {
    return incarnationId === current
  }
  if (pending) {
    return incarnationId === pending
  }
  if (lifecycleState === 'cleanup_pending') {
    return false
  }
  if (ptyRuntimeState.clearedPtyLifecycleIds.has(payload.id)) {
    return false
  }
  const cleanupPendingIncarnation = ptyRuntimeState.cleanupPendingPtyById
    .get(payload.id)
    ?.values()
    .next().value?.incarnationId
  if (cleanupPendingIncarnation !== undefined) {
    return incarnationId === cleanupPendingIncarnation
  }
  return incarnationId === undefined && ptyRuntimeState.ptyStateTokenById.has(payload.id)
}

export function getProvider(connectionId: string | null | undefined): IPtyProvider {
  if (!connectionId) {
    return ptyRuntimeState.localProvider
  }
  const provider = ptyRuntimeState.sshProviders.get(connectionId)
  if (!provider) {
    throw new Error(`No PTY provider for connection "${connectionId}"`)
  }
  return provider
}

export function getProviderForPty(ptyId: string): IPtyProvider {
  const connectionId = ptyRuntimeState.ptyOwnership.get(ptyId)
  if (connectionId === undefined) {
    const parsedSshId = parseAppSshPtyId(ptyId)
    if (parsedSshId) {
      return getProvider(parsedSshId.connectionId)
    }
    return ptyRuntimeState.localProvider
  }
  return getProvider(connectionId)
}

export function hasPtyProviderForInspection(ptyId: string): boolean {
  const connectionId = ptyRuntimeState.ptyOwnership.get(ptyId)
  return connectionId == null || ptyRuntimeState.sshProviders.has(connectionId)
}

export function getAppPtyId(connectionId: string | null | undefined, ptyId: string): string {
  return connectionId ? toAppSshPtyId(connectionId, ptyId) : ptyId
}

export function getRelayPtyId(connectionId: string | null | undefined, ptyId: string): string {
  return connectionId ? toRelaySshPtyId(connectionId, ptyId) : ptyId
}

export function tryGetProviderForPty(ptyId: string): IPtyProvider | undefined {
  try {
    return getProviderForPty(ptyId)
  } catch {
    return undefined
  }
}

export function tryGetProviderForAgentSessionOwner(ptyId: string): IPtyProvider | undefined {
  const ownedConnectionId = ptyRuntimeState.ptyOwnership.get(ptyId)
  const parsedSshId = ownedConnectionId === undefined ? parseAppSshPtyId(ptyId) : null
  try {
    return getProvider(parsedSshId?.connectionId ?? ownedConnectionId)
  } catch {
    return undefined
  }
}

export function closeStartupQueryAuthorityForPty(ptyId: string): void {
  try {
    void Promise.resolve(tryGetProviderForPty(ptyId)?.closeStartupQueryAuthority?.(ptyId)).catch(
      () => {}
    )
  } catch {
    // Best-effort handoff; the bounded source deadline remains the fallback.
  }
}
