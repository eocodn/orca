import type { Store } from '../persistence'
import type { IPtyProvider } from '../providers/types'
import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import { agentSessionOwnerBindingsEqual } from '../../shared/claimed-agent-pty-owner'
import { addNodePtyRecoveryHint } from '../daemon/node-pty-error-hints'
import { isSshPtyNotFoundError } from '../providers/ssh-pty-errors'
import { markClaudePtyExited } from '../claude/pty-lifecycle-gate'
import { getRelayPtyId } from './pty-ipc-runtime-provider-routing'
import { parseAppSshPtyId } from '../providers/ssh-pty-id'
import { clearProviderPtyState } from './pty-ipc-runtime-provider-lifecycle-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

const KEEP_HISTORY_STOP_SETTLE_MS = 1_000
const KEEP_HISTORY_STOP_POLL_MS = 100

export function normalizeNodePtySpawnError(err: unknown): Error {
  const rawMessage = err instanceof Error ? err.message : String(err)
  const hintedMessage = addNodePtyRecoveryHint(rawMessage)
  if (hintedMessage === rawMessage && err instanceof Error) {
    return err
  }
  if (err instanceof Error) {
    // Why: preserve the original stack/name/custom fields while adding the same recovery hint as the pty:spawn path.
    err.message = hintedMessage
    return err
  }
  return new Error(hintedMessage)
}

export function isPtyAlreadyGoneError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return isSshPtyNotFoundError(err) || /Session not found/i.test(message)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  })
}

async function isProviderPtyLive(
  provider: IPtyProvider,
  ptyId: string,
  deadlineMs?: number
): Promise<boolean> {
  // Why: bound the liveness list RPC by the teardown deadline so a wedged daemon
  // fails fast; undefined keeps the provider default for all other callers.
  return (await provider.listProcesses(deadlineMs !== undefined ? { deadlineMs } : undefined)).some(
    (session) => session.id === ptyId
  )
}

export async function isProviderAgentSessionOwnerLive(
  provider: IPtyProvider,
  owner: AgentSessionOwnerBinding
): Promise<boolean> {
  const session = (await provider.listProcesses()).find((candidate) => candidate.id === owner.ptyId)
  if (!session) {
    return false
  }
  if (provider.providesAgentSessionOwnerListings?.(owner.ptyId) !== true) {
    // Why: in-process local owners cannot serialize the controller claim; exact incarnation
    // liveness keeps that claim authoritative until the normal PTY exit releases it.
    const expectedIncarnation =
      ptyRuntimeState.pendingPtyIncarnationById.get(owner.ptyId) ?? ptyRuntimeState.ptyIncarnationById.get(owner.ptyId)
    return expectedIncarnation !== undefined && session.incarnationId === expectedIncarnation
  }
  return Boolean(
    session.agentSessionOwners?.some((candidate) =>
      agentSessionOwnerBindingsEqual(candidate, owner)
    )
  )
}

export async function verifyPtyStopped(
  provider: IPtyProvider,
  ptyId: string,
  opts: { keepHistory?: boolean; deadlineMs?: number } | undefined
): Promise<boolean> {
  if (await isProviderPtyLive(provider, ptyId, opts?.deadlineMs)) {
    return false
  }
  if (!opts?.keepHistory) {
    return true
  }
  const deadline = Date.now() + KEEP_HISTORY_STOP_SETTLE_MS
  while (Date.now() < deadline) {
    await delay(KEEP_HISTORY_STOP_POLL_MS)
    if (await isProviderPtyLive(provider, ptyId, opts?.deadlineMs)) {
      return false
    }
  }
  return true
}

export type PtyShutdownTarget = Readonly<{
  stateToken: symbol
  incarnationId: string | undefined
  /** Omitted only while a startup barrier has not selected its provider yet. */
  provider?: IPtyProvider
}>

export type PtyShutdownObservation = Readonly<{
  providerExitObserved: boolean
  identityLessExitPayload?: { id: string; code: number; incarnationId?: string }
}>

export function capturePtyShutdownTarget(id: string, provider?: IPtyProvider): PtyShutdownTarget {
  const stateToken = ptyRuntimeState.ptyStateTokenById.get(id) ?? Symbol(id)
  ptyRuntimeState.ptyStateTokenById.set(id, stateToken)
  return Object.freeze({
    stateToken,
    incarnationId: ptyRuntimeState.ptyIncarnationById.get(id),
    ...(provider !== undefined ? { provider } : {})
  })
}

function getCurrentPtyProvider(id: string): IPtyProvider | undefined {
  const connectionId = ptyRuntimeState.ptyOwnership.get(id)
  if (connectionId === null) {
    return ptyRuntimeState.localProvider
  }
  if (connectionId !== undefined) {
    return ptyRuntimeState.sshProviders.get(connectionId)
  }
  const parsedSshId = parseAppSshPtyId(id)
  return parsedSshId
    ? ptyRuntimeState.sshProviders.get(parsedSshId.connectionId)
    : ptyRuntimeState.localProvider
}

export function finishPtyShutdown(
  id: string,
  connectionId: string | null | undefined,
  store: Store | undefined,
  expectedTarget: PtyShutdownTarget
): { incarnationId: string | undefined } | undefined {
  const incarnationId = ptyRuntimeState.ptyIncarnationById.get(id)
  if (!isPtyShutdownTargetCurrent(id, expectedTarget)) {
    return undefined
  }
  if (connectionId) {
    store?.markSshRemotePtyLease(connectionId, getRelayPtyId(connectionId, id), 'terminated')
  }
  clearProviderPtyState(id)
  ptyRuntimeState.ptyOwnership.delete(id)
  markClaudePtyExited(id)
  return { incarnationId }
}

export function isPtyShutdownTargetCurrent(id: string, expectedTarget: PtyShutdownTarget): boolean {
  return (
    ptyRuntimeState.ptyStateTokenById.get(id) === expectedTarget.stateToken &&
    (expectedTarget.incarnationId === undefined ||
      ptyRuntimeState.ptyIncarnationById.get(id) === expectedTarget.incarnationId) &&
    (expectedTarget.provider === undefined || getCurrentPtyProvider(id) === expectedTarget.provider)
  )
}
