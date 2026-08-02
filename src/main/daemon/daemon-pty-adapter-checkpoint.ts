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
  isMissingTokenFileError,
  isMissingWindowsNamedPipeError
} from './daemon-pty-adapter-foundation'
import { DaemonPtyAdapterPhase2 } from './daemon-pty-adapter-session'

export class DaemonPtyAdapterPhase3 extends DaemonPtyAdapterPhase2 {
  protected async readAppliedSize(
    id: string,
    missingAsNull: boolean
  ): Promise<{ cols: number; rows: number } | null> {
    try {
      const result = await this.client.request<{ status?: unknown; size?: unknown }>('getSize', {
        sessionId: id
      })
      if (result.status === 'session-not-found') {
        if (missingAsNull) {
          return null
        }
        throw new Error('terminal_session_not_found')
      }
      const size = result.size as { cols?: unknown; rows?: unknown } | null | undefined
      if (
        typeof size !== 'object' ||
        size === null ||
        typeof size.cols !== 'number' ||
        typeof size.rows !== 'number' ||
        !areValidTerminalDimensions(size.cols, size.rows)
      ) {
        throw new Error('invalid_daemon_terminal_size')
      }
      return { cols: size.cols, rows: size.rows }
    } catch (error) {
      if (
        error instanceof Error &&
        /^(?:Unknown request type|Unknown request type: getSize)$/.test(error.message)
      ) {
        return null
      }
      throw error
    }
  }

  async getBufferSnapshot(
    id: string,
    opts: { scrollbackRows?: number } = {}
  ): Promise<PtyProviderBufferSnapshot | null> {
    if (!this.supportsAuthoritativeBufferSnapshots) {
      return null
    }
    try {
      const result = await this.client.request<GetSnapshotResult>('getSnapshot', {
        sessionId: id,
        ...(typeof opts.scrollbackRows === 'number' ? { scrollbackRows: opts.scrollbackRows } : {})
      })
      const snapshot = result.snapshot
      // Why: older v19 daemons lack an absolute output sequence, so their snapshot can't reconcile bytes queued on the other socket.
      if (!snapshot || typeof snapshot.outputSequence !== 'number') {
        return null
      }
      return {
        data: snapshot.rehydrateSequences + snapshot.snapshotAnsi,
        scrollbackAnsi: snapshot.scrollbackAnsi,
        cols: snapshot.cols,
        rows: snapshot.rows,
        cwd: snapshot.cwd,
        lastTitle: snapshot.lastTitle,
        seq: snapshot.outputSequence,
        source: 'headless',
        oscLinks: snapshot.oscLinks,
        alternateScreen: snapshot.modes.alternateScreen,
        ...(snapshot.pendingEscapeTailAnsi
          ? { pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi }
          : {})
      }
    } catch {
      return null
    }
  }

  async clearBuffer(id: string): Promise<void> {
    await this.client.request('clearScrollback', { sessionId: id })
    this.markSessionDirty(id)
  }

  acknowledgeDataEvent(_id: string, _charCount: number): void {
    // No flow control for daemon-backed terminals
  }

  // Why: daemon-backed PTYs can host long-lived agents while detached; cleanup prompts must not treat them as idle shells.
  protected hasChildProcessesFromForeground(foregroundProcess: string | null): boolean {
    return foregroundProcess !== null && !isShellProcess(foregroundProcess)
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    if (this.protocolVersion < GET_FOREGROUND_PROCESS_PROTOCOL_VERSION) {
      return true
    }
    return this.hasChildProcessesFromForeground(await this.getForegroundProcess(id))
  }

  async inspectProcess(id: string): Promise<PtyProcessInspection> {
    if (this.protocolVersion < GET_FOREGROUND_PROCESS_PROTOCOL_VERSION) {
      return { foregroundProcess: null, hasChildProcesses: true, unavailable: true }
    }
    if (this.protocolVersion < COMPLETION_PROCESS_INSPECTION_PROTOCOL_VERSION) {
      // Why: pre-v27 daemons survive an in-place app update; compose the inspection client-side from the
      // one call they do support instead of throwing, or completion detection stays dead until recreate.
      // Requests directly (not via getForegroundProcess) so a dead socket still rejects rather than
      // reading as an idle foreground and dispatching a false completion.
      const { foregroundProcess } = await this.client.request<{
        foregroundProcess: string | null
      }>('getForegroundProcess', { sessionId: id })
      return {
        foregroundProcess,
        hasChildProcesses: this.hasChildProcessesFromForeground(foregroundProcess)
      }
    }
    return this.client.request<{
      foregroundProcess: string | null
      hasChildProcesses: boolean
    }>('inspectProcess', { sessionId: id })
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    if (this.protocolVersion < GET_FOREGROUND_PROCESS_PROTOCOL_VERSION) {
      return null
    }
    try {
      const result = await this.client.request<{ foregroundProcess: string | null }>(
        'getForegroundProcess',
        { sessionId: id }
      )
      return result.foregroundProcess
    } catch {
      return null
    }
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    try {
      const result = await this.client.request<{ foregroundProcess: string | null }>(
        'confirmForegroundProcess',
        { sessionId: id }
      )
      return result.foregroundProcess
    } catch {
      return null
    }
  }

  async serialize(ids: string[]): Promise<string> {
    const sessions: Record<string, { initialCwd?: string }> = {}
    for (const id of ids) {
      sessions[id] = { initialCwd: this.initialCwds.get(id) }
    }
    return JSON.stringify(sessions)
  }

  async revive(_state: string): Promise<void> {
    // Sessions already live in the daemon — no revival needed
  }

  /** Called on app launch. Lists daemon sessions, kills orphans whose workspaceId
   *  no longer exists, and caches alive session IDs.
   *
   *  IMPORTANT: a session id embeds the worktree's path at spawn time, so a renamed
   *  worktree keeps its old id. Callers MUST seed `validWorktreeIds` with each live
   *  worktree's `WorktreeMeta.priorWorktreeIds` or those sessions get reaped as false
   *  orphans. No production caller yet; wire the alias in when it gains one. */
  async reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{
    alive: string[]
    killed: string[]
  }> {
    await this.ensureConnected()
    const result = await this.client.request<ListSessionsResult>('listSessions', undefined)

    const alive: string[] = []
    const killed: string[] = []

    for (const session of result.sessions) {
      if (!session.isAlive) {
        continue
      }
      // Why: an unminted session id (worktreeId === null) can't be tied to a live worktree, so it's treated as an orphan.
      const { worktreeId } = parsePtySessionId(session.sessionId)

      if (worktreeId === null || !validWorktreeIds.has(worktreeId)) {
        try {
          await this.client.request('kill', { sessionId: session.sessionId })
        } catch {
          /* already dead */
        }
        killed.push(session.sessionId)
      } else {
        alive.push(session.sessionId)
        // Why: track background sessions in the checkpoint set so disconnectOnly's final checkpoint doesn't leave stale recovery data.
        this.activeSessionIds.add(session.sessionId)
        await this.reconcileLiveSessionHistory(session).catch((err) =>
          console.warn('[history] live-session reconciliation failed:', session.sessionId, err)
        )
      }
    }

    return { alive, killed }
  }

  protected async reconcileLiveSessionHistory(session: SessionInfo): Promise<void> {
    const historyManager = this.historyManager
    const historyReader = this.historyReader
    if (!historyManager || !historyReader) {
      return
    }
    await this.withHistorySpawnLock(session.sessionId, async () => {
      if (historyManager.hasWriter(session.sessionId)) {
        return
      }
      const probe = historyReader.probeRestorableHistory(session.sessionId)
      if (probe.status === 'unreadable') {
        return
      }
      if (probe.status === 'none') {
        await historyManager.openSession(session.sessionId, {
          cwd: session.cwd ?? '',
          cols: session.cols,
          rows: session.rows
        })
      } else {
        const recoveryFreeze = await historyManager.freezeForRecovery(session.sessionId)
        try {
          const detection = await historyReader.detectColdRestoreState(session.sessionId, {
            wslDistro: session.wslDistro ?? undefined
          })
          if (
            detection.status === 'unreadable' ||
            (detection.status === 'restored' && detection.hasUnreadableRecovery)
          ) {
            historyManager.suspendSession(session.sessionId, recoveryFreeze)
            return
          }
          historyManager.reopenSession(session.sessionId, recoveryFreeze)
        } finally {
          historyManager.abandonRecoveryFreeze(recoveryFreeze)
        }
      }
      if (historyManager.hasWriter(session.sessionId)) {
        this.sessionsNeedingFullCheckpoint.add(session.sessionId)
        this.lastFullCheckpointAt.delete(session.sessionId)
        this.markSessionDirty(session.sessionId)
      }
    })
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    try {
      // Why: connect + listSessions share the caller's one absolute deadline so a
      // wedged handshake cannot burn the whole teardown budget before the list issues.
      await this.ensureConnected(opts?.deadlineMs)
      const result = await this.client.request<ListSessionsResult>(
        'listSessions',
        undefined,
        remainingRequestTimeoutMs(opts?.deadlineMs)
      )
      const admission = new PtyProcessListAdmission()
      const processes: PtyProcessInfo[] = []
      for (const session of result.sessions) {
        if (!session.isAlive) {
          continue
        }
        const { worktreeId } = parsePtySessionId(session.sessionId)
        processes.push(
          admission.admit({
            id: session.sessionId,
            ...(session.incarnationId ? { incarnationId: session.incarnationId } : {}),
            // Why: OSC 7 may not arrive before cleanup; spawn cwd is authoritative until the daemon reports a live cwd.
            cwd: session.cwd ?? this.initialCwds.get(session.sessionId) ?? '',
            title: 'shell',
            ...(worktreeId ? { worktreeId } : {}),
            ...(session.terminalHandle ? { terminalHandle: session.terminalHandle } : {}),
            ...(session.wslDistro !== undefined ? { wslDistro: session.wslDistro } : {}),
            ...this.validatedAgentSessionOwners(session.agentSessionOwners)
          })
        )
      }
      this.publishAuditObservation(
        recordAuthenticatedInventory(this.auditContext, this.exactDaemonIncarnation)
      )
      return processes
    } catch (error) {
      const missingAuthenticatedToken =
        isMissingTokenFileError(error) && this.client.hasObservedAuthenticatedDisconnect()
      const missingNamedPipe = isMissingWindowsNamedPipeError(error)
      this.observeAuditFailure(
        missingAuthenticatedToken
          ? 'token_missing_after_authenticated_disconnect'
          : 'inventory_failed',
        this.exactDaemonIncarnation,
        [
          ...(missingAuthenticatedToken ? (['token_file'] as const) : []),
          ...(missingNamedPipe ? (['windows_named_pipe'] as const) : [])
        ],
        missingNamedPipe ? 'windows_named_pipe_missing' : undefined
      )
      throw error
    }
  }

  protected validatedAgentSessionOwners(
    owners: unknown
  ): { agentSessionOwners: AgentSessionOwnerBinding[] } | Record<string, never> {
    if (owners === undefined) {
      return {}
    }
    if (
      !Array.isArray(owners) ||
      owners.length > MAX_CLAIMED_AGENT_PTY_OWNER_ENTRIES ||
      !owners.every((owner) => isAgentSessionOwnerBinding(owner) && owner.phase === 'live')
    ) {
      throw new Error('agent_session_ownership_unknown')
    }
    return owners.length > 0
      ? { agentSessionOwners: owners.map(cloneAgentSessionOwnerBinding) }
      : {}
  }

  // Why: the Manage Sessions panel needs the full SessionInfo (pid, state,
  // createdAt) per session for display; listProcesses drops that detail for
  // the IPtyProvider contract. Keep both in parallel rather than widening
  // the provider surface.

}
