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


import { type PendingDaemonSpawnOperation,
  type HistoryRecoveryContext,
  takeRecoveryFreeze,
  providerSequenceForSpawn,
  type DaemonPtyAdapterOptions,
  type DaemonRespawnReason,
  type DaemonIdentityChangeEvent,
  MAX_TOMBSTONES,
  MAX_CONCURRENT_CHECKPOINTS,
  remainingRequestTimeoutMs,
  TerminalKilledError,
  exactDaemonIncarnationForPidRecord,
  notifyAuditListeners,
  sameEndpointIdentity
} from './daemon-pty-adapter-foundation'
import { DaemonPtyAdapterPhase3 } from './daemon-pty-adapter-checkpoint'

export class DaemonPtyAdapterPhase4 extends DaemonPtyAdapterPhase3 {
  async listSessions(): Promise<SessionInfo[]> {
    await this.ensureConnected()
    const result = await this.client.request<ListSessionsResult>('listSessions', undefined)
    return result.sessions
      .filter((s) => s.isAlive)
      .map((session) => ({
        ...session,
        ...this.validatedAgentSessionOwners(session.agentSessionOwners)
      }))
  }

  getActiveSessionIds(): string[] {
    return [...this.activeSessionIds]
  }

  // Why: the daemon's kill-all-and-shutdown path suppresses onExit fanout (session.ts:246-252), so synthesize pty:exit
  // for every live session before teardown or renderer panes black-hole writes to a disposed adapter forever.
  fanoutSyntheticExits(code: number): void {
    const ids = [...this.activeSessionIds]
    this.activeSessionIds.clear()
    this.sessionsAwaitingDaemonRecovery.clear()
    this.writeRecoveryAttempted = false
    this.dirtySessionVersions.clear()
    this.lastFullCheckpointAt.clear()
    this.sessionsNeedingFullCheckpoint.clear()
    this.pausedProducerSessionIds.clear()
    this.producerResumesOwedOnReconnect.clear()
    this.stopCheckpointTimer()
    for (const id of ids) {
      this.coldRestoreCache.delete(id)
      // Why: don't catch listener throws — matches the natural onExit fanout so synthetic exits keep the same error semantics.
      // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
      for (const listener of [...this.exitListeners]) {
        listener({
          id,
          code,
          ...(this.sessionIncarnations.get(id)
            ? { incarnationId: this.sessionIncarnations.get(id) }
            : {})
        })
      }
      this.sessionIncarnations.delete(id)
    }
  }

  async getDefaultShell(): Promise<string> {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/zsh'
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    if (process.platform === 'win32') {
      return [
        { name: 'PowerShell', path: 'powershell.exe' },
        { name: 'Command Prompt', path: 'cmd.exe' }
      ]
    }
    const shells = ['/bin/zsh', '/bin/bash', '/bin/sh']
    return shells.filter((s) => existsSync(s)).map((s) => ({ name: basename(s), path: s }))
  }

  onData(callback: (payload: PtyDataEvent) => void): () => void {
    this.dataListeners.push(callback)
    return () => {
      const idx = this.dataListeners.indexOf(callback)
      if (idx !== -1) {
        this.dataListeners.splice(idx, 1)
      }
    }
  }

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    this.backgroundStreamListeners.push(callback)
    return () => {
      const idx = this.backgroundStreamListeners.indexOf(callback)
      if (idx !== -1) {
        this.backgroundStreamListeners.splice(idx, 1)
      }
    }
  }

  onReplay(_callback: (payload: { id: string; data: string }) => void): () => void {
    return () => {}
  }

  onExit(
    callback: (payload: { id: string; code: number; incarnationId?: PtyIncarnationId }) => void
  ): () => void {
    this.exitListeners.push(callback)
    return () => {
      const idx = this.exitListeners.indexOf(callback)
      if (idx !== -1) {
        this.exitListeners.splice(idx, 1)
      }
    }
  }

  onWriteUnavailable(callback: (payload: { id: string }) => void): () => void {
    this.writeUnavailableListeners.push(callback)
    return () => {
      const idx = this.writeUnavailableListeners.indexOf(callback)
      if (idx !== -1) {
        this.writeUnavailableListeners.splice(idx, 1)
      }
    }
  }

  protected emitWriteUnavailable(id: string): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
    for (const listener of [...this.writeUnavailableListeners]) {
      listener({ id })
    }
  }

  dispose(): void {
    this.respawnAdoptionClosed = true
    this.sessionsAwaitingDaemonRecovery.clear()
    this.writeRecoveryAttempted = false
    this.releasePendingRespawnAdoptionLease()
    this.stopCheckpointTimer()
    this.dirtySessionVersions.clear()
    this.lastFullCheckpointAt.clear()
    this.coldRestoreCache.clear()
    this.wslDistrosBySessionId.clear()
    this.pausedProducerSessionIds.clear()
    this.producerResumesOwedOnReconnect.clear()
    this.auditObservationListeners.length = 0
    this.identityChangeListeners.length = 0
    this.removeEventListener?.()
    this.removeEventListener = null
    // Why: final checkpoints are written daemon-side (TerminalHost.dispose); here the adapter only marks sessions
    // cleanly ended so they don't trigger false cold restores.
    if (this.historyManager) {
      void this.historyManager
        .dispose()
        .catch((err) => console.warn('[history] dispose failed:', err))
    }
    this.client.disconnect()
  }

  async establishLifecycleLease(): Promise<void> {
    if (this.protocolVersion < CLEAN_DISCONNECT_PROTOCOL_VERSION) {
      return
    }
    // Why: an authenticated pair cancels the adoption watchdog and lets a never-used adapter retire its empty daemon on quit.
    await this.client.ensureConnected()
    this.recordAuthenticatedIdentity()
  }

  // Why: unlike dispose(), leave history files unclean (no endedAt) so the next launch treats them as crash-recoverable,
  // but still write a final checkpoint so a daemon crash while Orca is closed has recovery data.
  async disconnectOnly(): Promise<void> {
    if (!this.disconnectOnlyPromise) {
      this.respawnAdoptionClosed = true
      this.sessionsAwaitingDaemonRecovery.clear()
      this.writeRecoveryAttempted = false
      this.releasePendingRespawnAdoptionLease()
      this.disconnectOnlyPromise = this.finishDisconnectOnly([...this.keepHistoryShutdowns])
    }
    await this.disconnectOnlyPromise
  }

  protected async finishDisconnectOnly(keepHistoryShutdowns: Promise<void>[]): Promise<void> {
    // Why: sleep shutdowns still detect recovery and kill after checkpointing; disconnecting first rejects those admitted operations.
    await Promise.allSettled(keepHistoryShutdowns)
    this.respawnAdoptionClosed = true
    // Why: a final checkpoint covers sessions opened since the last tick (else cold restore finds nothing if the daemon
    // later dies). Await it — fire-and-forget would race client.disconnect() and reject the pending getSnapshot RPCs.
    await this.runExclusiveCheckpoint(() => this.checkpointAllSessions(), {
      rescheduleDirty: false
    })
    this.dirtySessionVersions.clear()
    this.lastFullCheckpointAt.clear()
    this.coldRestoreCache.clear()
    this.wslDistrosBySessionId.clear()
    // Why: the detached daemon keeps these PTYs alive for warm reattach; a leftover pause would stall shells for a failsafe window.
    for (const id of this.pausedProducerSessionIds) {
      this.client.notify('resumePty', { sessionId: id })
    }
    this.pausedProducerSessionIds.clear()
    this.producerResumesOwedOnReconnect.clear()
    this.removeEventListener?.()
    this.removeEventListener = null
    if (this.protocolVersion >= CLEAN_DISCONNECT_PROTOCOL_VERSION) {
      try {
        // Why: only the authenticated daemon can atomically prove it's empty; a shared budget keeps this off quit's critical path.
        const deadlineMs = Date.now() + 250
        if (!this.client.isConnected()) {
          await this.client.ensureConnectedWithin(Math.max(1, deadlineMs - Date.now()))
        }
        await this.client.request('shutdownIfIdle', undefined, Math.max(1, deadlineMs - Date.now()))
      } catch {
        // An unreachable daemon falls back to event-driven retirement once its auth sockets close and it proves itself empty.
      }
    }
    this.client.disconnect()
  }

  protected async ensureConnected(deadlineMs?: number): Promise<void> {
    try {
      // Why: destructive teardown bounds the handshake by its deadline so a wedged
      // connect fails fast; undefined keeps the default connect behavior.
      await (deadlineMs !== undefined
        ? this.client.ensureConnectedWithin(Math.max(1, deadlineMs - Date.now()))
        : this.client.ensureConnected())
    } finally {
      // Why: a respawn launcher holds a temporary pair until this adapter's permanent reconnect, preventing both gaps and leaks.
      this.releasePendingRespawnAdoptionLease()
    }
    this.recordAuthenticatedIdentity()
    // Why sampled before setupEventRouting: "no listener yet" identifies a fresh connect — the only time the
    // daemon-side backgrounded set (process state lost with the old daemon) needs a resync.
    const isFreshConnection = this.removeEventListener === null
    this.setupEventRouting()
    this.scheduleCheckpointTimer()
    this.flushOwedProducerResumes()
    if (isFreshConnection) {
      this.resyncBackgroundedSessions()
    }
  }

  protected recordAuthenticatedIdentity(): void {
    const current = this.client.getDaemonIdentity()
    if (!current) {
      return
    }
    const previous = this.lastAuthenticatedIdentity
    if (previous && sameEndpointIdentity(previous, current)) {
      return
    }
    this.lastAuthenticatedIdentity = { ...current }
    this.exactDaemonIncarnation = exactDaemonIncarnationForPidRecord(current, this.pidRecord)
    if (!previous) {
      return
    }
    const event = { previous: { ...previous }, current: { ...current } }
    notifyAuditListeners(this.identityChangeListeners, event)
  }

  protected async resolveExactDaemonIncarnation(
    exactIncarnation: ExactDaemonIncarnation | null
  ): Promise<ExactDaemonIncarnation | null> {
    if (
      !exactIncarnation ||
      process.platform !== 'linux' ||
      (exactIncarnation.linuxStartTicks && exactIncarnation.bootId)
    ) {
      return exactIncarnation
    }
    const cachedIncarnation = exactDaemonIncarnationForPidRecord(
      exactIncarnation.identity,
      this.pidRecord
    )
    if (cachedIncarnation.linuxStartTicks && cachedIncarnation.bootId) {
      return cachedIncarnation
    }
    const pidRecord = await this.readMatchingPidRecord(exactIncarnation.identity)
    this.pidRecord = pidRecord ?? this.pidRecord
    return pidRecord?.linuxStartTicks && pidRecord.bootId
      ? {
          identity: { ...exactIncarnation.identity },
          linuxStartTicks: pidRecord.linuxStartTicks,
          bootId: pidRecord.bootId
        }
      : exactIncarnation
  }

  protected cacheExactDaemonIncarnation(exactIncarnation: ExactDaemonIncarnation | null): void {
    if (
      exactIncarnation &&
      this.lastAuthenticatedIdentity &&
      sameEndpointIdentity(exactIncarnation.identity, this.lastAuthenticatedIdentity)
    ) {
      this.exactDaemonIncarnation = exactIncarnation
    }
  }

  protected async readMatchingPidRecord(
    identity: DaemonEndpointIdentity
  ): Promise<ParsedDaemonPid | null> {
    if (!this.pidPath) {
      return null
    }
    try {
      const parsed = parseDaemonPidFile(await readFile(this.pidPath, 'utf8'))
      return parsed?.pid === identity.pid &&
        parsed.startedAtMs === identity.startedAtMs &&
        parsed.launchNonce === identity.launchNonce
        ? parsed
        : null
    } catch {
      return null
    }
  }

  protected observeAuditFailure(
    trigger: Exclude<DaemonAuditTrigger, 'inventory_answered'>,
    exactIncarnation = this.exactDaemonIncarnation,
    additionalEvidenceSources: readonly DaemonEvidenceSource[] = [],
    endpointGoneProof?: 'windows_named_pipe_missing'
  ): void {
    void this.resolveExactDaemonIncarnation(exactIncarnation)
      .then((resolvedIncarnation) => {
        this.cacheExactDaemonIncarnation(resolvedIncarnation)
        return classifyDaemonAuditFailure(this.auditContext, trigger, resolvedIncarnation, {
          additionalEvidenceSources,
          endpointGoneProof
        })
      })
      .then((observation) => this.publishAuditObservation(observation))
      .catch(() => {})
  }

  protected publishAuditObservation(observation: DaemonAuditObservation): void {
    this.lastAuditObservation = observation
    this.trackAuditEligibility(observation)
    notifyAuditListeners(this.auditObservationListeners, observation)
  }

  protected resyncBackgroundedSessions(): void {
    for (const id of this.backgroundedSessionIds) {
      // Harmless no-op for sessions the daemon doesn't know (yet).
      this.client.notify('setSessionBackground', { sessionId: id, background: true })
    }
  }


}
