import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'
import type { WebContents } from 'electron'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { parsePaneKey } from '../../shared/stable-pane-id'
import {
  getProviderGeneration,
  isCurrentProvider,
  tryGetProviderForAgentSessionOwner
} from './pty-ipc-runtime-provider-routing'
import { ptyRuntimeState, type PaneSpawnReservation, type PaneSpawnReservationResult } from './pty-ipc-runtime-state'

export function getPtyIdForPaneKey(paneKey: string): string | undefined {
  return ptyRuntimeState.paneKeyPtyId.get(paneKey)
}

// Why: let consumers tear down paneKey-scoped state on PTY exit so their timers can't leak; a callback registry keeps the cross-module dependency narrow.
type PaneKeyTeardownListener = (paneKey: string) => void

export function registerPaneKeyTeardownListener(listener: PaneKeyTeardownListener): () => void {
  ptyRuntimeState.paneKeyTeardownListeners.add(listener)
  return () => ptyRuntimeState.paneKeyTeardownListeners.delete(listener)
}

// Why: renderer pre-declares serializer ownership before pty:spawn to suppress the daemon-snapshot seed; gen tokens prevent paneKey-reuse races on teardown. See docs/mobile-prefer-renderer-scrollback.md.
// Why: mobile materialization and a newly-focused pane can race to spawn the same leaf; key by paneKey so the loser adopts the winner's PTY.
// Why: one main process can route the same remote provider namespace through
// multiple SSH relays; coordinate claims above every provider boundary too.

export function assertSpawnReplyWasLive(result: PtySpawnResult): void {
  if (!result.exitedBeforeSpawnReply) {
    return
  }
  // Why: lower owners can resolve a different canonical id, so controller-local pending ids cannot prove this exit.
  throw Object.assign(new Error('agent_session_exited_during_start'), {
    agentSessionOperationOutcome: 'unknown' as const
  })
}

export async function reconcileAgentSessionOwnerListings(): Promise<void> {
  if (ptyRuntimeState.agentSessionOwnerReconciliation) {
    return await ptyRuntimeState.agentSessionOwnerReconciliation
  }
  const reconciliation = (async () => {
    const providers: {
      provider: IPtyProvider
      connectionId: string | null
      generation: ReturnType<typeof getProviderGeneration>
    }[] = [
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
    const listings = await Promise.all(
      providers.map(async ({ provider, connectionId, generation }) => ({
        provider,
        connectionId,
        generation,
        sessions: await provider.listProcesses()
      }))
    )
    // Why: provider listings are awaited across reconnects; an old generation's
    // inventory cannot be authoritative for the replacement connection.
    if (
      listings.some(
        ({ provider, connectionId, generation }) =>
          !isCurrentProvider(provider, connectionId, generation)
      )
    ) {
      return
    }
    const advertisedOwners: AgentSessionOwnerBinding[] = []
    const advertisedOwnerSessions: {
      id: string
      connectionId: string | null
      incarnationId: string
    }[] = []
    for (const { connectionId, sessions } of listings) {
      for (const session of sessions) {
        const incarnationId = session.incarnationId
        let hasAdvertisedOwner = false
        for (const owner of session.agentSessionOwners ?? []) {
          if (owner.ptyId !== session.id || !isPtyIncarnationId(incarnationId)) {
            // Why: a recovered claim without process-incarnation proof cannot safely reject a delayed exit.
            throw new Error('agent_session_ownership_unknown')
          }
          advertisedOwners.push(owner)
          hasAdvertisedOwner = true
        }
        if (hasAdvertisedOwner && isPtyIncarnationId(incarnationId)) {
          advertisedOwnerSessions.push({ id: session.id, connectionId, incarnationId })
        }
      }
    }
    ptyRuntimeState.agentSessionOwners.reconcileAuthoritative(advertisedOwners, {
      // Why: an unregistered relay can still own a live PTY during reconnect;
      // only providers that serialize claims may make listing absence authoritative.
      isInAuthoritativeScope: (owner) => {
        const provider = tryGetProviderForAgentSessionOwner(owner.ptyId)
        return provider?.providesAgentSessionOwnerListings?.(owner.ptyId) === true
      }
    })
    for (const session of advertisedOwnerSessions) {
      const sameLifecycle = ptyRuntimeState.ptyIncarnationById.get(session.id) === session.incarnationId
      ptyRuntimeState.ptyOwnership.set(session.id, session.connectionId)
      ptyRuntimeState.ptyIncarnationById.set(session.id, session.incarnationId)
      if (!sameLifecycle) {
        ptyRuntimeState.ptyStateTokenById.set(session.id, Symbol(session.id))
      }
    }
  })()
  ptyRuntimeState.agentSessionOwnerReconciliation = reconciliation
  try {
    await reconciliation
  } finally {
    if (ptyRuntimeState.agentSessionOwnerReconciliation === reconciliation) {
      ptyRuntimeState.agentSessionOwnerReconciliation = null
    }
  }
}
// Why: bind the declaration generation directly to its spawn result. PTY ids
// are reusable and teardown callbacks carry no incarnation token, so teardown
// must never guess which pending renderer generation it owns.
// Serializer generation state is shared with the registration handlers.

export function parseValidPaneKey(paneKey: unknown): ReturnType<typeof parsePaneKey> {
  if (typeof paneKey !== 'string' || paneKey.length > 256) {
    return null
  }
  return parsePaneKey(paneKey)
}

export function isValidPaneKey(paneKey: unknown): paneKey is string {
  return parseValidPaneKey(paneKey) !== null
}

export function shouldRefreshNativeClaudeAgentTeamsEnv(args: {
  command?: string
  launchConfig?: SleepingAgentLaunchConfig
}): boolean {
  const capturedCommand = args.launchConfig?.agentCommand?.trim() || args.command?.trim() || ''
  const capturedArgs = args.launchConfig?.agentArgs?.trim() ?? ''
  const capturedLaunch = `${capturedCommand} ${capturedArgs}`.trim()
  return /(^|\s)--teammate-mode(?:=|\s+)auto(?:\s|$)/.test(capturedLaunch)
}

export function rememberPaneKeyForPty(ptyId: string, paneKey: unknown): string | null {
  const normalizedPaneKey = typeof paneKey === 'string' ? paneKey.trim() : ''
  if (!isValidPaneKey(normalizedPaneKey)) {
    return null
  }
  // Why: retire only this PTY's old edge; another PTY's reverse edge is the pane authority.
  const previousPaneKey = ptyRuntimeState.ptyPaneKey.get(ptyId)
  if (previousPaneKey && previousPaneKey !== normalizedPaneKey) {
    if (ptyRuntimeState.paneKeyPtyId.get(previousPaneKey) === ptyId) {
      ptyRuntimeState.paneKeyPtyId.delete(previousPaneKey)
    }
  }
  ptyRuntimeState.ptyPaneKey.set(ptyId, normalizedPaneKey)
  ptyRuntimeState.paneKeyPtyId.set(normalizedPaneKey, ptyId)
  return normalizedPaneKey
}

export function cleanupPendingPaneSerializersForSender(ownerWebContentsId: number): void {
  ptyRuntimeState.pendingPaneSerializerCleanupRegistered.delete(ownerWebContentsId)
  for (const [paneKey, pending] of ptyRuntimeState.pendingByPaneKey) {
    if (pending.ownerWebContentsId === ownerWebContentsId) {
      ptyRuntimeState.pendingByPaneKey.delete(paneKey)
      ptyRuntimeState.pendingPtyIdBySerializerGeneration.delete(pending.gen)
    }
  }
}

export function registerPendingPaneSerializerCleanup(sender: WebContents | undefined): void {
  if (!sender || ptyRuntimeState.pendingPaneSerializerCleanupRegistered.has(sender.id)) {
    return
  }
  ptyRuntimeState.pendingPaneSerializerCleanupRegistered.add(sender.id)
  sender.once('destroyed', () => cleanupPendingPaneSerializersForSender(sender.id))
}

export function declarePendingPaneSerializer(paneKey: string, sender: WebContents | undefined): number {
  const gen = ++ptyRuntimeState.pendingSerializerGenSeq
  registerPendingPaneSerializerCleanup(sender)
  const replaced = ptyRuntimeState.pendingByPaneKey.get(paneKey)
  if (replaced) {
    ptyRuntimeState.pendingPtyIdBySerializerGeneration.delete(replaced.gen)
  }
  ptyRuntimeState.pendingByPaneKey.set(paneKey, { gen, ownerWebContentsId: sender?.id ?? null })
  const existingPtyId = ptyRuntimeState.paneKeyPtyId.get(paneKey)
  if (existingPtyId) {
    ptyRuntimeState.pendingPtyIdBySerializerGeneration.set(gen, existingPtyId)
  }
  return gen
}

export function reservePaneSpawn(paneKey: string): PaneSpawnReservation {
  let resolve!: (result: PaneSpawnReservationResult) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<PaneSpawnReservationResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  promise.catch(() => {})
  const reservation = { promise, resolve, reject }
  ptyRuntimeState.paneSpawnReservationsByPaneKey.set(paneKey, reservation)
  return reservation
}

export function clearPaneSpawnReservation(paneKey: string, reservation: PaneSpawnReservation): void {
  if (ptyRuntimeState.paneSpawnReservationsByPaneKey.get(paneKey) === reservation) {
    ptyRuntimeState.paneSpawnReservationsByPaneKey.delete(paneKey)
  }
}

export function rejectPaneSpawnReservation(
  paneKey: string | null | undefined,
  reservation: PaneSpawnReservation | null | undefined,
  error: unknown
): void {
  if (!reservation) {
    return
  }
  reservation.reject(error)
  if (paneKey) {
    clearPaneSpawnReservation(paneKey, reservation)
  }
}

export function resolvePaneSpawnReservation<T extends PaneSpawnReservationResult>(
  paneKey: string | null | undefined,
  reservation: PaneSpawnReservation | null | undefined,
  response: T
): T {
  if (!reservation) {
    return response
  }
  reservation.resolve(response)
  if (paneKey) {
    clearPaneSpawnReservation(paneKey, reservation)
  }
  return response
}

export function settlePendingPaneSerializer(paneKey: string, gen: number): boolean {
  if (ptyRuntimeState.pendingByPaneKey.get(paneKey)?.gen !== gen) {
    return false
  }
  ptyRuntimeState.pendingByPaneKey.delete(paneKey)
  return true
}

export function hasPendingRendererSerializerForPaneKey(paneKey: string): boolean {
  return isValidPaneKey(paneKey) && ptyRuntimeState.pendingByPaneKey.has(paneKey)
}
