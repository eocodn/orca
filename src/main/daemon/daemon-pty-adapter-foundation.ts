import { basename } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { DaemonClient } from './client'
import { parseDaemonResizeIfCurrentResponse } from './daemon-pty-resize-response'
import type { PtyDataEvent } from '../providers/pty-provider-events'
import {
  getMacDaemonSystemResolverHealth,
  parseDaemonPidFile,
  type ParsedDaemonPid
} from './daemon-health'
import {
  HistoryManager,
  type HistoryCheckpointResult,
  type HistoryRecoveryFreeze
} from './history-manager'
import { HistoryReader, type ColdRestoreInfo } from './history-reader'
import { getRecoveredHistorySeedSegments } from './terminal-history-seed-segments'
import { mintPtySessionId, parsePtySessionId } from './pty-session-id'
import { supportsPtyStartupBarrier } from './shell-ready'
import { CODEX_SHELL_READY_TIMEOUT_MS } from './session'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION,
  GET_FOREGROUND_PROCESS_PROTOCOL_VERSION,
  AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION,
  AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION,
  GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  supportsMode2031UnsubscribeFact,
  supportsPtyStartupIngress,
  type CreateOrAttachResult,
  type DaemonEvent,
  type GetSnapshotResult,
  type ListSessionsResult,
  type SessionInfo,
  type TakePendingOutputResult
} from './types'
import { HISTORY_SEED_TRANSFER_PROTOCOL_VERSION } from './daemon-protocol-version'
import {
  isAgentSessionClaimedSpawnResult,
  isAgentSessionOwnerBinding,
  type AgentSessionOwnerBinding
} from '../../shared/agent-session-host-authority'
import { MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES } from '../../shared/claimed-agent-pty-owner'
import { cloneAgentSessionOwnerBinding } from '../../shared/claimed-agent-pty-owner-snapshot'
import type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyProviderBufferSnapshot,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import { isShellProcess } from '../../shared/agent-detection'
import { resolveWslSessionContext } from './wsl-session-context'
import { normalizeWslColdRestoreCwd } from './wsl-cold-restore-cwd'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { shouldUseShellReadyStartupDelivery } from '../../shared/codex-startup-delivery'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'
import { resolveSafePtyDefaultCwd } from '../providers/pty-default-cwd'
import { PtyWriteUnavailableError } from '../providers/pty-write-unavailable-error'
import { areValidTerminalDimensions } from '../../shared/terminal-dimensions'
import { ColdRestorePayloadCache, type ColdRestorePayload } from './cold-restore-payload-cache'
import { PtyProcessListAdmission } from '../providers/pty-process-list-admission'
import {
  iterateTerminalHistorySeedChunks,
  measureTerminalHistorySeed,
  TERMINAL_HISTORY_INLINE_SEED_CODE_UNITS
} from './terminal-history-seed-chunks'
import { NdjsonLineTooLongError } from './ndjson'
import type { DaemonEndpointIdentity } from './daemon-hello-protocol'
import {
  classifyDaemonAuditFailure,
  recordAuthenticatedInventory,
  type DaemonAuditContext,
  type DaemonAuditObservation,
  type DaemonAuditTrigger
} from './daemon-audit-classifier'
import type { DaemonEvidenceSource, ExactDaemonIncarnation } from './daemon-incarnation-evidence'
import { createDaemonAuditEligibilityTracker } from './daemon-audit-eligibility-event'

export type PendingDaemonSpawnOperation = {
  exitsBySessionId: Map<string, { incarnationId?: string }[]>
  ignoredExitIncarnationIds: Set<string>
  ignoreNextExit: boolean
}

export type HistoryRecoveryContext = {
  freeze: HistoryRecoveryFreeze | null
  unreadableSessionId: string | null
  identityChanged: boolean
}

// Why take-and-clear together: every consuming branch must reset the field, so pairing them stops one from forgetting.
export function takeRecoveryFreeze(
  historyRecovery: HistoryRecoveryContext,
  sessionId: string
): HistoryRecoveryFreeze | undefined {
  const freeze =
    historyRecovery.freeze?.sessionId === sessionId ? historyRecovery.freeze : undefined
  historyRecovery.freeze = null
  return freeze
}
export function providerSequenceForSpawn(
  result: CreateOrAttachResult
): PtySpawnResult['providerSequence'] {
  if (result.isNew) {
    return { value: 0, generation: 'reset' }
  }
  return typeof result.snapshot?.outputSequence === 'number'
    ? { value: result.snapshot.outputSequence, generation: 'continued' }
    : undefined
}

export type DaemonPtyAdapterOptions = {
  socketPath: string
  tokenPath: string
  pidPath?: string
  profileScope?: string
  protocolVersion?: number
  /** Directory for disk-based terminal history; when set, raw PTY output is written to disk for cold restore on daemon crash. */
  historyPath?: string
  /** Forks a fresh daemon after endpoint death or a confirmed resolver-health replacement. */
  respawn?: (reason: DaemonRespawnReason) => Promise<void | (() => void)>
}

export type DaemonRespawnReason = 'daemon_died' | 'unhealthy_resolver'

export type DaemonIdentityChangeEvent = {
  previous: DaemonEndpointIdentity
  current: DaemonEndpointIdentity
}

export const MAX_TOMBSTONES = 1000
export const MAX_CONCURRENT_CHECKPOINTS = 4

// Why: providers take an absolute teardown deadline, but the client RPC takes a
// relative timeout — convert only here, at the request itself, so sequential RPCs
// naturally share the remaining budget (undefined keeps the client's 30s default).
export function remainingRequestTimeoutMs(deadlineMs: number | undefined): number | undefined {
  return deadlineMs === undefined ? undefined : Math.max(1, deadlineMs - Date.now())
}

export class TerminalKilledError extends Error {
  constructor(sessionId: string) {
    super(`Session "${sessionId}" was explicitly killed`)
    this.name = 'TerminalKilledError'
  }
}


export class DaemonPtyAdapterFoundation implements IPtyProvider {
  [key: string]: any

  readonly protocolVersion: number
  protected socketPath: string
  protected tokenPath: string
  protected pidPath: string | null
  protected pidRecord: ParsedDaemonPid | null
  protected client: DaemonClient
  protected auditContext: DaemonAuditContext
  protected lastAuthenticatedIdentity: DaemonEndpointIdentity | null = null
  protected exactDaemonIncarnation: ExactDaemonIncarnation | null = null
  protected lastAuditObservation: DaemonAuditObservation | null = null
  // Why: every listProcesses call republishes the same observation; unthrottled it drains the shared per-session telemetry ceiling.
  protected readonly trackAuditEligibility = createDaemonAuditEligibilityTracker()
  protected auditObservationListeners: ((observation: DaemonAuditObservation) => void)[] = []
  protected identityChangeListeners: ((event: DaemonIdentityChangeEvent) => void)[] = []
  protected historyManager: HistoryManager | null
  protected historyReader: HistoryReader | null
  protected respawnFn: DaemonPtyAdapterOptions['respawn'] | null
  protected pendingRespawnAdoptionRelease: (() => void) | null = null
  protected respawnAdoptionClosed = false
  // Why: concurrent spawn() calls hitting a dead daemon would each fork their own; this promise coalesces respawns so only the first forks and the rest await it.
  protected respawnPromise: Promise<void> | null = null
  protected writeRecoveryPromise: Promise<void> | null = null
  protected writeRecoveryAttempted = false
  protected dataListeners: ((payload: {
    id: string
    incarnationId: string
    data: string
    sequenceChars?: number
    transformed?: boolean
    seq?: number
  }) => void)[] = []
  protected exitListeners: ((payload: {
    id: string
    code: number
    incarnationId?: PtyIncarnationId
  }) => void)[] = []
  protected backgroundStreamListeners: ((payload: PtyBackgroundStreamEvent) => void)[] = []
  // Why: lets main fan a dead-endpoint signal to every affected pane, not just the written one (STA-2373 sibling-freeze).
  protected writeUnavailableListeners: ((payload: { id: string }) => void)[] = []
  protected removeEventListener: (() => void) | null = null
  protected initialCwds = new Map<string, string>()
  protected wslDistrosBySessionId = new Map<string, string>()
  // Why: StrictMode/re-render remounts can call createOrAttach for a just-killed session; tombstones stop the daemon resurrecting it (Map evicts oldest-first, per terminal-host.ts).
  protected killedSessionTombstones = new Map<string, number>()
  // Why: React StrictMode double-mounts; this sticky cache returns the same cold restore data on remount until the renderer acknowledges it.
  protected sleepRestoreSessionIds = new Set<string>()
  protected coldRestoreCache = new ColdRestorePayloadCache(undefined, (sessionId) => {
    this.sleepRestoreSessionIds.delete(sessionId)
  })
  protected activeSessionIds = new Set<string>()
  // A replacement daemon has none of the old PTYs; only createOrAttach can make their bindings writable again.
  protected sessionsAwaitingDaemonRecovery = new Set<string>()
  protected sessionIncarnations = new Map<string, string>()
  protected pendingSpawnOperationsBySessionId = new Map<string, Set<PendingDaemonSpawnOperation>>()
  protected pendingClaimSpawnOperations = new Set<PendingDaemonSpawnOperation>()
  protected historySpawnLocks = new Map<string, Promise<void>>()
  protected dirtySessionVersions = new Map<string, number>()
  // Why: a cold-restored session is a fresh shell atop a pre-crash log; incremental appends would be rejected on restore, so the first tick re-anchors with a full snapshot.
  protected sessionsNeedingFullCheckpoint = new Set<string>()
  protected checkpointTimer: ReturnType<typeof setTimeout> | null = null
  protected checkpointInFlight: Promise<void> | null = null
  protected keepHistoryShutdowns = new Set<Promise<void>>()
  protected disconnectOnlyPromise: Promise<void> | null = null
  // Why: checkpoint persistence needs the getSnapshot RPC (v4+); legacy daemons reject it, spamming logs every 5s.
  protected supportsCheckpoints: boolean
  // Why: incremental checkpoints need the takePendingOutput RPC (v13+); older daemons fall back to full-snapshot checkpoints.
  protected supportsIncrementalCheckpoints: boolean
  // Why: producer pause/resume notifications require v19+; gate them to silent no-ops on legacy daemons.
  protected supportsProducerFlowControl: boolean
  protected supportsAuthoritativeBufferSnapshots: boolean
  protected supportsStartupIngress: boolean
  protected pausedProducerSessionIds = new Set<string>()
  // Why tracked here: the daemon's background set dies with the daemon process/socket; re-sync on a fresh connection so hidden panes stay thinned.
  protected backgroundedSessionIds = new Set<string>()
  // Why: a daemon surviving a socket drop can hold a pause whose resume died with the connection; owe a resume on reconnect (daemon's 5s failsafe covers the gap).
  protected producerResumesOwedOnReconnect = new Set<string>()
  protected static CHECKPOINT_INTERVAL_MS = 5_000
  // Why: streaming sessions re-trigger full multi-MB checkpoints every tick; this cooldown caps cap/overflow snapshots per session (~9x less writes, bounded cold-crash staleness).
  protected static FULL_CHECKPOINT_COOLDOWN_MS = 45_000
  protected lastFullCheckpointAt = new Map<string, number>()

  protected checkpointIntervalMs(): number {
    return (this.constructor as typeof DaemonPtyAdapterFoundation).CHECKPOINT_INTERVAL_MS
  }

  protected fullCheckpointCooldownMs(): number {
    return (this.constructor as typeof DaemonPtyAdapterFoundation).FULL_CHECKPOINT_COOLDOWN_MS
  }

  supportsGitCredentialGuardHost(): boolean {
    return this.protocolVersion >= GIT_CREDENTIAL_GUARD_HOST_PROTOCOL_VERSION
  }

  canProvideAuthoritativeBufferSnapshot(_id: string): boolean {
    return this.supportsAuthoritativeBufferSnapshots
  }

  // Why one predicate (#9993): the attach-time clear and setPtyBackgrounded must agree on
  // which daemons may hold a background hint. Daemons outlive the desktop that set it, so
  // if these two drift a preserved daemon keeps a hint this process would never grant.
  protected get canDelegateBackgroundToDaemon(): boolean {
    return (
      this.supportsAuthoritativeBufferSnapshots &&
      supportsMode2031UnsubscribeFact(this.protocolVersion)
    )
  }

  constructor(opts: DaemonPtyAdapterOptions) {
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION
    this.socketPath = opts.socketPath
    this.tokenPath = opts.tokenPath
    this.pidPath = opts.pidPath ?? null
    this.pidRecord = readDaemonPidRecord(this.pidPath)
    this.auditContext = {
      protocolGeneration: this.protocolVersion,
      provider: 'local-daemon',
      endpoint: opts.socketPath,
      tokenPath: opts.tokenPath,
      endpointKind: process.platform === 'win32' ? 'windows-named-pipe' : 'unix-socket',
      profileScope: opts.profileScope ?? ''
    }
    this.client = new DaemonClient({
      socketPath: opts.socketPath,
      tokenPath: opts.tokenPath,
      protocolVersion: opts.protocolVersion
    })
    this.historyManager = opts.historyPath ? new HistoryManager(opts.historyPath) : null
    this.historyReader = opts.historyPath ? new HistoryReader(opts.historyPath) : null
    this.respawnFn = opts.respawn ?? null
    this.supportsCheckpoints = this.protocolVersion >= 4
    this.supportsIncrementalCheckpoints = this.protocolVersion >= 13
    this.supportsProducerFlowControl = this.protocolVersion >= 19
    this.supportsAuthoritativeBufferSnapshots = this.protocolVersion >= 20
    this.supportsStartupIngress = supportsPtyStartupIngress(this.protocolVersion)
    this.client.onDisconnected(() => {
      if (!this.respawnAdoptionClosed) {
        // Why re-arm here: the latch is otherwise only cleared when every awaiting
        // session rebinds, and background sessions (no mounted pane, so nothing ever
        // calls createOrAttach for them) never do — which would leave the fan-out
        // permanently latched off after the first death. Fires once per connection.
        this.writeRecoveryAttempted = false
        for (const id of this.activeSessionIds) {
          this.sessionsAwaitingDaemonRecovery.add(id)
        }
      }
      for (const id of this.pausedProducerSessionIds) {
        this.producerResumesOwedOnReconnect.add(id)
      }
      this.pausedProducerSessionIds.clear()
      this.observeAuditFailure('transport_closed')
    })
  }

  getHistoryManager(): HistoryManager | null {
    return this.historyManager
  }

  getLastAuthenticatedDaemonIdentity(): DaemonEndpointIdentity | null {
    return this.lastAuthenticatedIdentity ? { ...this.lastAuthenticatedIdentity } : null
  }

  getLastAuditObservation(): DaemonAuditObservation | null {
    return this.lastAuditObservation
  }

  onDaemonIdentityChanged(listener: (event: DaemonIdentityChangeEvent) => void): () => void {
    this.identityChangeListeners.push(listener)
    return () => removeListener(this.identityChangeListeners, listener)
  }

  onAuditEligibilityObservation(
    listener: (observation: DaemonAuditObservation) => void
  ): () => void {
    this.auditObservationListeners.push(listener)
    return () => removeListener(this.auditObservationListeners, listener)
  }

  supportsAgentSessionClaims(): boolean {
    return this.protocolVersion >= AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION
  }

  providesAgentSessionOwnerListings(_ptyId: string): boolean {
    return this.supportsAgentSessionClaims()
  }

  supportsAgentSessionCreateOperations(): boolean {
    // Why: old daemons never advertised the lower-owner protocol, so preserve their legacy launch.
    return this.protocolVersion >= AGENT_SESSION_CREATE_OPERATION_DAEMON_PROTOCOL_VERSION
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const sessionId = opts.sessionId ?? mintPtySessionId(opts.worktreeId)
    const operation = {
      exitsBySessionId: new Map<string, { incarnationId?: string }[]>(),
      ignoredExitIncarnationIds: new Set<string>(),
      ignoreNextExit: false
    }
    const operations = this.pendingSpawnOperationsBySessionId.get(sessionId) ?? new Set()
    operations.add(operation)
    this.pendingSpawnOperationsBySessionId.set(sessionId, operations)
    if (opts.agentSessionEnsure) {
      this.pendingClaimSpawnOperations.add(operation)
    }
    const historyRecovery: HistoryRecoveryContext = {
      freeze: null,
      unreadableSessionId: null,
      identityChanged: false
    }
    try {
      return await this.withHistorySpawnLock(sessionId, () =>
        this.withDaemonRetry(() => this.doSpawn({ ...opts, sessionId }, operation, historyRecovery))
      )
    } finally {
      if (historyRecovery.freeze) {
        this.historyManager?.abandonRecoveryFreeze(historyRecovery.freeze)
      }
      this.pendingClaimSpawnOperations.delete(operation)
      operations.delete(operation)
      if (operations.size === 0) {
        this.pendingSpawnOperationsBySessionId.delete(sessionId)
      }
    }
  }


}

function sameEndpointIdentity(
  left: DaemonEndpointIdentity,
  right: DaemonEndpointIdentity
): boolean {
  return (
    left.pid === right.pid &&
    left.startedAtMs === right.startedAtMs &&
    left.launchNonce === right.launchNonce
  )
}

export function exactDaemonIncarnationForPidRecord(
  identity: DaemonEndpointIdentity,
  pidRecord: ParsedDaemonPid | null
): ExactDaemonIncarnation {
  return {
    identity: { ...identity },
    ...(process.platform === 'linux' &&
    pidRecord?.pid === identity.pid &&
    pidRecord.startedAtMs === identity.startedAtMs &&
    pidRecord.launchNonce === identity.launchNonce &&
    pidRecord.linuxStartTicks &&
    pidRecord.bootId
      ? {
          linuxStartTicks: pidRecord.linuxStartTicks,
          bootId: pidRecord.bootId
        }
      : {})
  }
}

function readDaemonPidRecord(pidPath: string | null): ParsedDaemonPid | null {
  if (!pidPath) {
    return null
  }
  try {
    return parseDaemonPidFile(readFileSync(pidPath, 'utf8'))
  } catch {
    return null
  }
}

function removeListener<T>(listeners: T[], listener: T): void {
  const index = listeners.indexOf(listener)
  if (index !== -1) {
    listeners.splice(index, 1)
  }
}

export function notifyAuditListeners<T>(
  listeners: readonly ((value: T) => void)[],
  value: T
): void {
  for (const listener of listeners.slice()) {
    try {
      listener(value)
    } catch {
      // Audit observers cannot affect daemon operations.
    }
  }
}

// Why: syscall='connect' distinguishes a dead-socket ENOENT/ECONNREFUSED from token-file ENOENT (no syscall);
// message strings incl. wedged-daemon "Hello response timed out" (#8689) also warrant a respawn.
export function isDaemonGoneError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }
  const errno = err as NodeJS.ErrnoException
  if ((errno.code === 'ENOENT' || errno.code === 'ECONNREFUSED') && errno.syscall === 'connect') {
    return true
  }
  const msg = err.message
  return (
    msg === 'Connection lost' ||
    msg === 'Not connected' ||
    msg === 'Hello response timed out' ||
    msg === 'Daemon temporarily unavailable; reconnect'
  )
}

export function isMissingTokenFileError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }
  const errno = err as NodeJS.ErrnoException
  return errno.code === 'ENOENT' && errno.syscall === 'open'
}

export function isMissingWindowsNamedPipeError(err: unknown): boolean {
  if (process.platform !== 'win32' || !(err instanceof Error)) {
    return false
  }
  const errno = err as NodeJS.ErrnoException
  return errno.code === 'ENOENT' && errno.syscall === 'connect'
}
