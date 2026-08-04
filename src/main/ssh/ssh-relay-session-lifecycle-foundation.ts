// Why: single authority for all relay lifecycle state per SSH target (previously scattered across module Maps/Sets with duplicated paths).

import { randomUUID } from 'node:crypto'
import { type ExecutionHostId } from '../../shared/execution-host'
import type {
  PtySourceRecoveryComplete,
  PtySourceRecoveryPending
} from '../../shared/pty-source-recovery-contract'
import {
  DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  MAX_SSH_RELAY_GRACE_PERIOD_SECONDS,
  MIN_SSH_RELAY_GRACE_PERIOD_SECONDS
} from '../../shared/ssh-types'
import { isTerminalLeafId,makePaneKey } from '../../shared/stable-pane-id'
import { isValidTerminalTabId } from '../../shared/terminal-tab-id'
import type { SshPtyOutputMigrationResult } from '../ipc/ssh-pty-output-model-migration'
import type { SshPtyAcceptedSourceCheckpoint } from '../ipc/ssh-pty-output-source-obligations'
import type { Store } from '../persistence'
import type { SshPtyDataCallback,SshPtyExitCallback } from '../providers/ssh-pty-provider-contract'
import type { SshChannelMultiplexer } from './ssh-channel-multiplexer'
import {
  type SshPtyConsumerOwnerState
} from './ssh-pty-consumer-session'
import { type RemoteHostPlatform } from './ssh-remote-platform'

export type RelaySessionState = 'idle' | 'deploying' | 'ready' | 'reconnecting' | 'disposed'

type SshPtyExitPayload = Parameters<SshPtyExitCallback>[0]
type SshPtyDataPayload = Parameters<SshPtyDataCallback>[0]
type SshPtyLease = ReturnType<Store['getSshRemotePtyLeases']>[number]
const SSH_PTY_REATTACH_MAX_CONCURRENCY = 8
const SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS = 10_000
const SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS = 50
const SSH_PTY_REATTACH_RETRY_JITTER_MS = 200
const SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS = 3
const SSH_SOURCE_RECOVERY_CANCELLATION_FAILED = 'ssh_source_recovery_cancellation_failed'
const SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE = 1024
type PendingPtyReattach = {
  mux: SshChannelMultiplexer
  providerGeneration: number
  retentionKey: string
  exits: SshPtyExitPayload[]
  queuedData: SshPtyDataPayload[]
  recoveryData: SshPtyDataPayload[]
  liveData: SshPtyDataPayload[]
  recovery?: PtySourceRecoveryPending
  recoveryComplete?: PtySourceRecoveryComplete
  nextRecoverySourceSu?: number
  highestRecoverySourceEndSu?: number
  replacementDeliveryToken?: string
  restoreRequired?: string
  recoveryWaiters: Set<() => void>
  livePassthrough: boolean
  activated: boolean
  incarnationIdAtStart?: string
  stateTokenAtStart?: symbol
}

type RemoteCliBridgeEnv = {
  remoteHome: string
  binDir: string
  relayDir: string
  nodePath: string
  sockPath: string
  credentialFile?: string
  hostPlatform: RemoteHostPlatform
  pathDelimiter?: ':' | ';'
}

type ExpectedPtyIdentity = { paneKey?: string; tabId?: string }

function expectedIdentityForLease(lease: {
  tabId?: string
  leafId?: string
}): ExpectedPtyIdentity | null {
  if (typeof lease.tabId !== 'string' || lease.tabId.length === 0) {
    return null
  }
  const paneKey =
    isValidTerminalTabId(lease.tabId) &&
    typeof lease.leafId === 'string' &&
    isTerminalLeafId(lease.leafId)
      ? makePaneKey(lease.tabId, lease.leafId)
      : undefined
  return {
    ...(paneKey ? { paneKey } : {}),
    tabId: lease.tabId
  }
}

function parseRecoveryComplete(params: Record<string, unknown>): PtySourceRecoveryComplete | null {
  if (
    typeof params.id !== 'string' ||
    typeof params.deliveryToken !== 'string' ||
    params.deliveryToken.length === 0 ||
    typeof params.ptyIncarnation !== 'string' ||
    params.ptyIncarnation.length === 0 ||
    !positiveSafeInteger(params.clientGeneration) ||
    !positiveSafeInteger(params.ownerGeneration) ||
    !nonNegativeSafeInteger(params.checkpointSourceEndSu) ||
    !nonNegativeSafeInteger(params.recoveryEndSu) ||
    Number(params.recoveryEndSu) < Number(params.checkpointSourceEndSu)
  ) {
    return null
  }
  return Object.freeze({
    id: params.id,
    deliveryToken: params.deliveryToken,
    ptyIncarnation: params.ptyIncarnation,
    clientGeneration: Number(params.clientGeneration),
    ownerGeneration: Number(params.ownerGeneration),
    checkpointSourceEndSu: Number(params.checkpointSourceEndSu),
    recoveryEndSu: Number(params.recoveryEndSu)
  })
}

function positiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function nonNegativeSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function sourceRecoveryCancellationError(cause: unknown): Error {
  return Object.assign(new Error(SSH_SOURCE_RECOVERY_CANCELLATION_FAILED), {
    code: SSH_SOURCE_RECOVERY_CANCELLATION_FAILED,
    cause
  })
}

function isSourceRecoveryCancellationError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === SSH_SOURCE_RECOVERY_CANCELLATION_FAILED
}

export type SshRelayAiVaultHostInfo = {
  targetId: string
  executionHostId: ExecutionHostId
  remoteHome: string
  hostPlatform: RemoteHostPlatform
}

function normalizeRelayGracePeriodSeconds(graceTimeSeconds: number | undefined): number {
  const raw = graceTimeSeconds ?? DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS
  const requested = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS
  return requested === 0
    ? 0
    : Math.max(
        MIN_SSH_RELAY_GRACE_PERIOD_SECONDS,
        Math.min(MAX_SSH_RELAY_GRACE_PERIOD_SECONDS, requested)
      )
}

type PtyConsumerRecovery = {
  clientInstanceId: string
  detached: boolean
  serverBuildId?: string
  owner?: SshPtyConsumerOwnerState
  checkpointsByAppPtyId: Map<string, SshPtyAcceptedSourceCheckpoint>
  modelMigrationsByAppPtyId: Map<string, Promise<SshPtyOutputMigrationResult>>
}

const ptyConsumerRecoveryByTarget = new Map<string, PtyConsumerRecovery>()

function ptyConsumerRecoveryForTarget(targetId: string): PtyConsumerRecovery {
  const current = ptyConsumerRecoveryByTarget.get(targetId)
  if (current?.detached) {
    current.detached = false
    return current
  }
  const created = {
    clientInstanceId: randomUUID(),
    detached: false,
    checkpointsByAppPtyId: new Map<string, SshPtyAcceptedSourceCheckpoint>(),
    modelMigrationsByAppPtyId: new Map<string, Promise<SshPtyOutputMigrationResult>>()
  }
  ptyConsumerRecoveryByTarget.set(targetId, created)
  return created
}


export { expectedIdentityForLease,isSourceRecoveryCancellationError,nonNegativeSafeInteger,normalizeRelayGracePeriodSeconds,parseRecoveryComplete,positiveSafeInteger,ptyConsumerRecoveryByTarget,ptyConsumerRecoveryForTarget,sourceRecoveryCancellationError,SSH_PTY_EXIT_RETIREMENT_MAX_EVIDENCE,SSH_PTY_EXIT_RETRY_MAX_ATTEMPTS,SSH_PTY_REATTACH_ATTEMPT_TIMEOUT_MS,SSH_PTY_REATTACH_MAX_CONCURRENCY,SSH_PTY_REATTACH_RETRY_JITTER_MS,SSH_PTY_REATTACH_RETRY_MIN_DELAY_MS,SSH_SOURCE_RECOVERY_CANCELLATION_FAILED,type ExpectedPtyIdentity,type PendingPtyReattach,type PtyConsumerRecovery,type RemoteCliBridgeEnv,type SshPtyDataPayload,type SshPtyExitPayload,type SshPtyLease }
