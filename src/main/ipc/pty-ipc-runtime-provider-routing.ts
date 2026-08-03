import { toAppSshPtyId, toRelaySshPtyId, parseAppSshPtyId } from '../providers/ssh-pty-id'
import { resolvePtyIncarnationState } from '../runtime/pty-runtime-lifecycle'
import type { IPtyProvider, PtyProviderGeneration } from '../providers/types'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function getProviderGeneration(
  provider: IPtyProvider | undefined
): PtyProviderGeneration | undefined {
  if (!provider) {
    return undefined
  }
  const generation = provider.providerGeneration
  return Number.isSafeInteger(generation) && generation > 0 ? generation : undefined
}

export function isCurrentProvider(
  provider: IPtyProvider,
  connectionId: string | null,
  generation: PtyProviderGeneration | undefined
): boolean {
  const currentProvider =
    connectionId === null
      ? ptyRuntimeState.localProvider
      : ptyRuntimeState.sshProviders.get(connectionId)
  return currentProvider === provider && getProviderGeneration(currentProvider) === generation
}

export type PtyProviderListingTarget = Readonly<{
  provider: IPtyProvider
  connectionId: string | null
  generation: PtyProviderGeneration | undefined
}>

export function capturePtyProviderListingTargets(): PtyProviderListingTarget[] {
  return [
    {
      provider: ptyRuntimeState.localProvider,
      connectionId: null,
      generation: getProviderGeneration(ptyRuntimeState.localProvider)
    },
    ...Array.from(ptyRuntimeState.sshProviders, ([connectionId, provider]) => ({
      provider,
      connectionId,
      generation: getProviderGeneration(provider)
    }))
  ]
}

export function isCurrentPtyProviderListingTargetSet(
  targets: readonly PtyProviderListingTarget[]
): boolean {
  const currentTargets = capturePtyProviderListingTargets()
  return (
    currentTargets.length === targets.length &&
    targets.every(({ provider, connectionId, generation }) =>
      isCurrentProvider(provider, connectionId, generation)
    )
  )
}

export function hasOnlyAddedPtyProviderListingTargets(
  previousTargets: readonly PtyProviderListingTarget[],
  currentTargets: readonly PtyProviderListingTarget[]
): boolean {
  return (
    currentTargets.length > previousTargets.length &&
    previousTargets.every(({ provider, connectionId, generation }) =>
      isCurrentProvider(provider, connectionId, generation)
    )
  )
}

export type PtyLifecycleTarget = Readonly<{
  ownershipPresent: boolean
  ownership: string | null | undefined
  incarnationId: string | undefined
  pendingIncarnationId: string | undefined
  stateToken: symbol | undefined
  cleared: boolean
}>

export function capturePtyLifecycleTarget(id: string): PtyLifecycleTarget {
  return Object.freeze({
    ownershipPresent: ptyRuntimeState.ptyOwnership.has(id),
    ownership: ptyRuntimeState.ptyOwnership.get(id),
    incarnationId: ptyRuntimeState.ptyIncarnationById.get(id),
    pendingIncarnationId: ptyRuntimeState.pendingPtyIncarnationById.get(id),
    stateToken: ptyRuntimeState.ptyStateTokenById.get(id),
    cleared: ptyRuntimeState.clearedPtyLifecycleIds.has(id)
  })
}

export function isCurrentPtyLifecycleTarget(id: string, target: PtyLifecycleTarget): boolean {
  return (
    ptyRuntimeState.ptyOwnership.has(id) === target.ownershipPresent &&
    ptyRuntimeState.ptyOwnership.get(id) === target.ownership &&
    ptyRuntimeState.ptyIncarnationById.get(id) === target.incarnationId &&
    ptyRuntimeState.pendingPtyIncarnationById.get(id) === target.pendingIncarnationId &&
    ptyRuntimeState.ptyStateTokenById.get(id) === target.stateToken &&
    ptyRuntimeState.clearedPtyLifecycleIds.has(id) === target.cleared
  )
}

export function isCurrentPtyListing(
  id: string,
  incarnationId: string | undefined,
  target: PtyLifecycleTarget
): boolean {
  if (!isCurrentPtyLifecycleTarget(id, target)) {
    return false
  }
  const expectedIncarnationId = target.incarnationId ?? target.pendingIncarnationId
  return expectedIncarnationId === undefined || incarnationId === expectedIncarnationId
}

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
  const ownedConnectionId = ptyRuntimeState.ptyOwnership.get(ptyId)
  if (ownedConnectionId !== undefined) {
    return ownedConnectionId === null || ptyRuntimeState.sshProviders.has(ownedConnectionId)
  }
  const parsedSshId = parseAppSshPtyId(ptyId)
  return parsedSshId ? ptyRuntimeState.sshProviders.has(parsedSshId.connectionId) : true
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
