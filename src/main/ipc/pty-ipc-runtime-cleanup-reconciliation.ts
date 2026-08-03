import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'
import { clearProviderPtyState } from './pty-ipc-runtime-provider-lifecycle-state'
import { ptyRuntimeState, type CleanupPendingPty, type PtyPublicationSnapshot } from './pty-ipc-runtime-state'

export type PtyCleanupAuthoritySnapshot = ReadonlyMap<string | undefined, CleanupPendingPty>

export function snapshotPtyCleanupAuthority(id: string | undefined): PtyCleanupAuthoritySnapshot | null {
  if (!id) {
    return null
  }
  return new Map(ptyRuntimeState.cleanupPendingPtyById.get(id))
}

export function ptyCleanupAuthorityChanged(id: string, snapshot: PtyCleanupAuthoritySnapshot): boolean {
  const current = ptyRuntimeState.cleanupPendingPtyById.get(id)
  if (!current || current.size === 0 || current.size !== snapshot.size) {
    return current !== undefined && current.size > 0
  }
  for (const [incarnationId, pending] of current) {
    if (snapshot.get(incarnationId) !== pending) {
      return true
    }
  }
  return false
}

export function rememberSupersededPtyExit(id: string, incarnationId: string): void {
  ptyRuntimeState.supersededPtyExitEvidence.remember(id, incarnationId)
}

export function consumeSupersededPtyExit(payload: { id: string; incarnationId?: string }): boolean {
  if (payload.incarnationId === undefined) {
    return false
  }
  return ptyRuntimeState.supersededPtyExitEvidence.consume(payload.id, payload.incarnationId)
}

export function rememberProviderClearedPtyExit(id: string, incarnationId: string): void {
  ptyRuntimeState.providerClearedPtyExitEvidence.remember(id, incarnationId)
}

export function consumeProviderClearedPtyExit(payload: { id: string; incarnationId?: string }): boolean {
  if (payload.incarnationId === undefined) {
    return false
  }
  if (!ptyRuntimeState.providerClearedPtyExitEvidence.consume(payload.id, payload.incarnationId)) {
    return false
  }
  // Why: a replacement published after provider teardown owns the id, so the old local exit must stay stale.
  return (
    !ptyRuntimeState.ptyStateTokenById.has(payload.id) &&
    !ptyRuntimeState.ptyIncarnationById.has(payload.id) &&
    !ptyRuntimeState.pendingPtyIncarnationById.has(payload.id)
  )
}

export function getPendingPtyCleanupIncarnation(id: string): string | undefined {
  return ptyRuntimeState.cleanupPendingPtyById.get(id)?.values().next().value?.incarnationId
}

export function hasPendingPtyCleanupExact(id: string, incarnationId: string | undefined): boolean {
  return ptyRuntimeState.cleanupPendingPtyById.get(id)?.has(incarnationId) === true
}

export function hasPendingPtyCleanupWithoutIncarnation(id: string): boolean {
  return ptyRuntimeState.cleanupPendingPtyById.get(id)?.has(undefined) === true
}

export function consumePendingPtyCleanupIfExact(payload: {
  id: string
  incarnationId?: string
}): boolean {
  const pendingByIncarnation = ptyRuntimeState.cleanupPendingPtyById.get(payload.id)
  if (!pendingByIncarnation?.has(payload.incarnationId)) {
    return false
  }
  pendingByIncarnation.delete(payload.incarnationId)
  if (pendingByIncarnation.size === 0) {
    ptyRuntimeState.cleanupPendingPtyById.delete(payload.id)
  }
  return true
}

export function setPendingPtyCleanupForResult(
  provider: IPtyProvider,
  result: PtySpawnResult,
  snapshot: PtyPublicationSnapshot | null
): void {
  const registeredConnectionId = providerConnectionId(provider)
  const pending: CleanupPendingPty = {
    provider,
    // Why: an SSH relay can unregister before a rejected shutdown records its tombstone; the encoded app id preserves the authority namespace for the next generation.
    providerConnectionId:
      registeredConnectionId === undefined
        ? parseAppSshPtyId(result.id)?.connectionId
        : registeredConnectionId,
    providerGeneration: providerGeneration(provider),
    // Why: retain id-only authority for legacy providers; reconciliation must prove no same-id process exists before clearing it.
    incarnationId: result.incarnationId,
    publicationSnapshot: snapshot
  }
  const pendingByIncarnation = ptyRuntimeState.cleanupPendingPtyById.get(result.id)
  if (pendingByIncarnation) {
    pendingByIncarnation.set(result.incarnationId, pending)
  } else {
    ptyRuntimeState.cleanupPendingPtyById.set(result.id, new Map([[result.incarnationId, pending]]))
  }
}

export function deletePendingPtyCleanupExact(id: string, incarnationId: string | undefined): void {
  const pendingByIncarnation = ptyRuntimeState.cleanupPendingPtyById.get(id)
  pendingByIncarnation?.delete(incarnationId)
  if (pendingByIncarnation?.size === 0) {
    ptyRuntimeState.cleanupPendingPtyById.delete(id)
  }
}

function deletePendingPtyCleanupEntry(id: string, pending: CleanupPendingPty): boolean {
  const pendingByIncarnation = ptyRuntimeState.cleanupPendingPtyById.get(id)
  if (pendingByIncarnation?.get(pending.incarnationId) !== pending) {
    return false
  }
  pendingByIncarnation.delete(pending.incarnationId)
  if (pendingByIncarnation.size === 0) {
    ptyRuntimeState.cleanupPendingPtyById.delete(id)
  }
  return true
}

export function isCurrentPendingPtyCleanupEntry(id: string, pending: CleanupPendingPty): boolean {
  return ptyRuntimeState.cleanupPendingPtyById.get(id)?.get(pending.incarnationId) === pending
}

export function clearSupersededPtyLifecycle(id: string, pending: CleanupPendingPty): void {
  const stateToken = pending.publicationSnapshot?.stateToken
  const failedIncarnationStillOwnsState =
    pending.incarnationId !== undefined &&
    (ptyRuntimeState.ptyIncarnationById.get(id) === pending.incarnationId ||
      ptyRuntimeState.pendingPtyIncarnationById.get(id) === pending.incarnationId)
  if (
    (stateToken !== undefined && ptyRuntimeState.ptyStateTokenById.get(id) === stateToken) ||
    failedIncarnationStillOwnsState
  ) {
    // Why: inventory proved a replacement owns the id; remove only the failed staged lifecycle before its exit can fence the replacement.
    clearProviderPtyState(id)
    return
  }
  if (pending.incarnationId !== undefined) {
    if (ptyRuntimeState.pendingPtyIncarnationById.get(id) === pending.incarnationId) {
      ptyRuntimeState.pendingPtyIncarnationById.delete(id)
    }
    if (ptyRuntimeState.ptyIncarnationById.get(id) === pending.incarnationId) {
      ptyRuntimeState.ptyIncarnationById.delete(id)
    }
  }
}

function finalizePendingPtyCleanupEntry(id: string, pending: CleanupPendingPty): boolean {
  if (!ptyRuntimeState.pendingPtyCleanupFinalizer || !isCurrentPendingPtyCleanupEntry(id, pending)) {
    return false
  }
  if (
    !ptyRuntimeState.pendingPtyCleanupFinalizer(
      { id, incarnationId: pending.incarnationId },
      pending.publicationSnapshot
    )
  ) {
    return false
  }
  return deletePendingPtyCleanupEntry(id, pending)
}

export function finalizePendingPtyCleanupIfExact(payload: {
  id: string
  incarnationId?: string
}): boolean {
  const pending = ptyRuntimeState.cleanupPendingPtyById.get(payload.id)?.get(payload.incarnationId)
  if (!pending || !ptyRuntimeState.pendingPtyCleanupFinalizer) {
    return false
  }
  return finalizePendingPtyCleanupEntry(payload.id, pending)
}

export function providerConnectionId(provider: IPtyProvider): string | null | undefined {
  if (provider === ptyRuntimeState.localProvider) {
    return null
  }
  for (const [connectionId, registeredProvider] of ptyRuntimeState.sshProviders) {
    if (registeredProvider === provider) {
      return connectionId
    }
  }
  return undefined
}

export function providerGeneration(provider: IPtyProvider): number | undefined {
  const generation = (provider as { providerGeneration?: number }).providerGeneration
  return Number.isSafeInteger(generation) && generation! > 0 ? generation : undefined
}

function providerCanReconcileCleanup(pending: CleanupPendingPty, provider: IPtyProvider): boolean {
  if (pending.providerConnectionId === null) {
    return provider === pending.provider
  }
  if (pending.providerConnectionId !== undefined) {
    if (ptyRuntimeState.sshProviders.get(pending.providerConnectionId) !== provider) {
      return false
    }
    if (pending.provider === provider) {
      return true
    }
    const currentGeneration = providerGeneration(provider)
    if (pending.providerGeneration === undefined || currentGeneration === undefined) {
      // Why: the current connection binding is authoritative when a legacy relay cannot expose generations.
      return true
    }
    return currentGeneration > pending.providerGeneration
  }
  return pending.provider === provider
}

type PtyIncarnationAbsenceProof = Readonly<{
  absent: boolean
  superseded: boolean
  identityLessLive: boolean
}>

export async function providerProvesPtyIncarnationAbsent(
  provider: IPtyProvider,
  id: string,
  incarnationId: string | undefined
): Promise<PtyIncarnationAbsenceProof> {
  try {
    const sessions = await provider.listProcesses()
    const matchingSessions = sessions.filter((session) => session.id === id)
    if (matchingSessions.length === 0) {
      return { absent: true, superseded: false, identityLessLive: false }
    }
    if (incarnationId === undefined) {
      return { absent: false, superseded: false, identityLessLive: true }
    }
    // Why: a listing without identity proof cannot distinguish a failed PTY from a reused id.
    const identityLessLive = matchingSessions.some((session) => session.incarnationId === undefined)
    const sameIncarnationIsLive = matchingSessions.some(
      (session) => session.incarnationId === undefined || session.incarnationId === incarnationId
    )
    return {
      absent: !sameIncarnationIsLive,
      superseded: !sameIncarnationIsLive,
      identityLessLive
    }
  } catch (error) {
    if (provider.probePtyLiveness) {
      try {
        const liveness = await provider.probePtyLiveness(id)
        if (liveness === false) {
          return { absent: true, superseded: false, identityLessLive: false }
        }
        if (liveness === true) {
          return { absent: false, superseded: false, identityLessLive: true }
        }
        throw new Error('provider cleanup liveness unknown')
      } catch (probeError) {
        console.warn('[pty] pending cleanup liveness probe failed:', probeError)
        throw probeError
      }
    }
    console.warn('[pty] pending cleanup inventory unavailable:', error)
    throw error
  }
}

export function isSupersededPtyCleanup(id: string, pending: CleanupPendingPty): boolean {
  const current = ptyRuntimeState.ptyIncarnationById.get(id)
  const staged = ptyRuntimeState.pendingPtyIncarnationById.get(id)
  const currentStateToken = ptyRuntimeState.ptyStateTokenById.get(id)
  const stateTokenReplaced =
    pending.publicationSnapshot?.stateToken !== undefined &&
    currentStateToken !== undefined &&
    currentStateToken !== pending.publicationSnapshot.stateToken
  return (
    stateTokenReplaced ||
    (pending.incarnationId !== undefined &&
      ((current !== undefined && current !== pending.incarnationId) ||
        (staged !== undefined && staged !== pending.incarnationId)))
  )
}

export function isPtyStateClearedAfterPendingCleanup(id: string, pending: CleanupPendingPty): boolean {
  // Why: after teardown clears lifecycle maps, authoritative provider absence is the remaining proof that this tombstone is stale.
  return (
    pending.publicationSnapshot?.stateToken !== undefined &&
    ptyRuntimeState.ptyStateTokenById.get(id) === undefined &&
    ptyRuntimeState.ptyIncarnationById.get(id) === undefined &&
    ptyRuntimeState.pendingPtyIncarnationById.get(id) === undefined
  )
}

async function reconcilePendingPtyCleanupNow(provider: IPtyProvider, id: string): Promise<boolean> {
  const pendingByIncarnation = ptyRuntimeState.cleanupPendingPtyById.get(id)
  if (!pendingByIncarnation || !ptyRuntimeState.pendingPtyCleanupFinalizer) {
    return false
  }
  let finalized = false
  for (const pending of Array.from(pendingByIncarnation.values())) {
    if (
      !isCurrentPendingPtyCleanupEntry(id, pending) ||
      !providerCanReconcileCleanup(pending, provider)
    ) {
      continue
    }
    const absenceProof = await providerProvesPtyIncarnationAbsent(
      provider,
      id,
      pending.incarnationId
    )
    const canReconcileAfterProof = providerCanReconcileCleanup(pending, provider)
    // Why: provider registration can change while inventory I/O is pending; authorize the state transition against the current provider again.
    if (
      !absenceProof.absent ||
      !canReconcileAfterProof ||
      !isCurrentPendingPtyCleanupEntry(id, pending)
    ) {
      if (absenceProof.absent === false && canReconcileAfterProof) {
        schedulePendingPtyCleanupRetry(provider, id)
      }
      continue
    }
    if (absenceProof.superseded) {
      // Why: provider inventory proves a replacement owns this id; restoring the failed publication would erase that live lifecycle.
      if (pending.incarnationId !== undefined) {
        rememberSupersededPtyExit(id, pending.incarnationId)
      }
      if (deletePendingPtyCleanupEntry(id, pending)) {
        clearSupersededPtyLifecycle(id, pending)
        finalized = true
      }
      continue
    }
    if (
      finalizePendingPtyCleanupEntry(id, pending) ||
      ((absenceProof.superseded ||
        isSupersededPtyCleanup(id, pending) ||
        isPtyStateClearedAfterPendingCleanup(id, pending)) &&
        deletePendingPtyCleanupEntry(id, pending))
    ) {
      // Why: authoritative absence proves the failed generation is gone; a newer lifecycle must not inherit its stale spawn fence when publication restoration is intentionally rejected.
      finalized = true
    }
  }
  return finalized
}

export async function reconcilePendingPtyCleanup(
  provider: IPtyProvider,
  id: string
): Promise<boolean> {
  // Why: a replacement provider must probe immediately; each finalizer rechecks the live tombstone before mutating it.
  return reconcilePendingPtyCleanupNow(provider, id)
}

function providerCanSupersedeCleanupRetry(
  provider: IPtyProvider,
  scheduledProvider: IPtyProvider
): boolean {
  const candidateGeneration = providerGeneration(provider)
  const scheduledGeneration = providerGeneration(scheduledProvider)
  if (candidateGeneration !== undefined && scheduledGeneration !== undefined) {
    return candidateGeneration > scheduledGeneration
  }
  const connectionId = providerConnectionId(provider)
  if (connectionId !== undefined && connectionId !== null) {
    return ptyRuntimeState.sshProviders.get(connectionId) === provider
  }
  return provider === ptyRuntimeState.localProvider
}

function schedulePendingPtyCleanupRetry(provider: IPtyProvider, id: string): void {
  if (!ptyRuntimeState.cleanupPendingPtyById.has(id)) {
    return
  }
  const attempts = (ptyRuntimeState.pendingPtyCleanupRetryAttemptsById.get(id) ?? 0) + 1
  const scheduled = ptyRuntimeState.pendingPtyCleanupRetryTimersById.get(id)
  if (scheduled?.provider === provider) {
    return
  }
  if (scheduled) {
    // Why: an older provider failure must not cancel the newer provider's only retry.
    if (!providerCanSupersedeCleanupRetry(provider, scheduled.provider)) {
      return
    }
    clearTimeout(scheduled.timer)
    ptyRuntimeState.pendingPtyCleanupRetryTimersById.delete(id)
  }
  ptyRuntimeState.pendingPtyCleanupRetryAttemptsById.set(id, attempts)
  // Why: a failed finalizer retains its tombstone; retry asynchronously so a transient projection failure cannot permanently block the PTY id.
  const retryDelayMs = attempts === 1 ? 0 : Math.min(100 * 2 ** Math.min(attempts - 2, 6), 5_000)
  const retryTimer = setTimeout(() => {
    if (ptyRuntimeState.pendingPtyCleanupRetryTimersById.get(id)?.timer === retryTimer) {
      ptyRuntimeState.pendingPtyCleanupRetryTimersById.delete(id)
    }
    if (!ptyRuntimeState.cleanupPendingPtyById.has(id)) {
      ptyRuntimeState.pendingPtyCleanupRetryAttemptsById.delete(id)
      return
    }
    void reconcilePendingPtyCleanup(provider, id)
      .then(() => {
        if (!ptyRuntimeState.cleanupPendingPtyById.has(id)) {
          ptyRuntimeState.pendingPtyCleanupRetryAttemptsById.delete(id)
          return
        }
        schedulePendingPtyCleanupRetry(provider, id)
      })
      .catch((retryError) => {
        schedulePendingPtyCleanupRetry(provider, id)
        console.warn('[pty] pending cleanup reconciliation retry failed:', retryError)
      })
  }, retryDelayMs)
  ptyRuntimeState.pendingPtyCleanupRetryTimersById.set(id, { provider, timer: retryTimer })
}

export function schedulePendingPtyCleanupReconciliation(provider: IPtyProvider): void {
  for (const id of ptyRuntimeState.cleanupPendingPtyById.keys()) {
    void reconcilePendingPtyCleanup(provider, id).catch(() => {
      schedulePendingPtyCleanupRetry(provider, id)
    })
  }
}

export function scheduleCurrentPtyCleanupReconciliation(id: string): void {
  const parsed = parseAppSshPtyId(id)
  const provider = parsed ? ptyRuntimeState.sshProviders.get(parsed.connectionId) : undefined
  if (provider) {
    schedulePendingPtyCleanupReconciliation(provider)
  }
}

export function scheduleOriginalPtyCleanupAuthorities(): void {
  const providers = new Set<IPtyProvider>()
  for (const pendingByIncarnation of ptyRuntimeState.cleanupPendingPtyById.values()) {
    for (const pending of pendingByIncarnation.values()) {
      providers.add(pending.provider)
    }
  }
  for (const provider of providers) {
    schedulePendingPtyCleanupReconciliation(provider)
  }
}

export function snapshotPtyPublication(id: string): PtyPublicationSnapshot {
  const size = ptyRuntimeState.ptySizes.get(id)
  let stateToken = ptyRuntimeState.ptyStateTokenById.get(id)
  if (!stateToken) {
    stateToken = Symbol(id)
    ptyRuntimeState.ptyStateTokenById.set(id, stateToken)
  }
  return Object.freeze({
    id,
    ownershipPresent: ptyRuntimeState.ptyOwnership.has(id),
    ownership: ptyRuntimeState.ptyOwnership.get(id),
    incarnation: ptyRuntimeState.ptyIncarnationById.get(id),
    stateToken,
    size: size ? { ...size } : undefined
  })
}

export function restorePtyPublication(snapshot: PtyPublicationSnapshot): void {
  ptyRuntimeState.pendingPtyIncarnationById.delete(snapshot.id)
  if (snapshot.ownershipPresent) {
    ptyRuntimeState.ptyOwnership.set(snapshot.id, snapshot.ownership ?? null)
  } else {
    ptyRuntimeState.ptyOwnership.delete(snapshot.id)
  }
  if (snapshot.incarnation) {
    ptyRuntimeState.ptyIncarnationById.set(snapshot.id, snapshot.incarnation)
  } else {
    ptyRuntimeState.ptyIncarnationById.delete(snapshot.id)
  }
  if (snapshot.stateToken) {
    ptyRuntimeState.ptyStateTokenById.set(snapshot.id, snapshot.stateToken)
  } else {
    ptyRuntimeState.ptyStateTokenById.delete(snapshot.id)
  }
  if (snapshot.size) {
    ptyRuntimeState.ptySizes.set(snapshot.id, snapshot.size)
  } else {
    ptyRuntimeState.ptySizes.delete(snapshot.id)
  }
}
