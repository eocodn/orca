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


import { DaemonPtyAdapterFoundation,type PendingDaemonSpawnOperation,
  type HistoryRecoveryContext,
  takeRecoveryFreeze,
  providerSequenceForSpawn,
  type DaemonPtyAdapterOptions,
  type DaemonRespawnReason,
  type DaemonIdentityChangeEvent,
  MAX_TOMBSTONES,
  MAX_CONCURRENT_CHECKPOINTS,
  remainingRequestTimeoutMs,
  TerminalKilledError } from './daemon-pty-adapter-foundation'

export class DaemonPtyAdapterPhase1 extends DaemonPtyAdapterFoundation {
  protected async doSpawn(
    opts: PtySpawnOptions,
    operation: PendingDaemonSpawnOperation,
    historyRecovery: HistoryRecoveryContext
  ): Promise<PtySpawnResult> {
    if (
      opts.agentSessionEnsure &&
      this.protocolVersion < AGENT_SESSION_CLAIM_DAEMON_PROTOCOL_VERSION
    ) {
      throw new Error('agent_session_claim_unavailable')
    }
    const requestedSessionId = opts.sessionId!
    let sessionId = requestedSessionId
    let wslDistro = resolveWslSessionContext({
      cwd: opts.cwd,
      sessionId,
      shellOverride: opts.shellOverride,
      terminalWindowsWslDistro: opts.terminalWindowsWslDistro
    })?.distro
    const freezeHistory = async (): Promise<void> => {
      if (!this.historyManager) {
        return
      }
      if (historyRecovery.freeze?.sessionId === sessionId) {
        return
      }
      if (historyRecovery.freeze) {
        this.historyManager.abandonRecoveryFreeze(historyRecovery.freeze)
      }
      historyRecovery.freeze = await this.historyManager.freezeForRecovery(sessionId)
      historyRecovery.unreadableSessionId = null
    }
    const detectColdRestore = async (options?: {
      ignoreCleanEnd?: boolean
    }): Promise<ColdRestoreInfo | null> => {
      if (!this.historyReader) {
        return null
      }
      await freezeHistory()
      const detection = await this.historyReader.detectColdRestoreState(sessionId, {
        ...options,
        wslDistro
      })
      if (detection.status === 'unreadable') {
        historyRecovery.unreadableSessionId = detection.sessionId
        return null
      }
      const restoreInfo = detection.status === 'restored' ? detection.restoreInfo : null
      if (detection.status === 'restored' && detection.hasUnreadableRecovery) {
        historyRecovery.unreadableSessionId = detection.sessionId
      }
      if (!restoreInfo) {
        return null
      }
      return {
        ...restoreInfo,
        cwd:
          normalizeWslColdRestoreCwd({
            recoveredCwd: restoreInfo.cwd,
            requestedCwd: opts.cwd ?? resolveSafePtyDefaultCwd(),
            wslDistro
          }) ?? ''
      }
    }

    if (this.killedSessionTombstones.has(sessionId)) {
      throw new TerminalKilledError(sessionId)
    }

    if (opts.isNewSession) {
      await this.replaceUnhealthyMacResolverDaemonBeforeNewPty()
    }

    await this.ensureConnected()
    // Why before createOrAttach: a preserved daemon may still think this session is backgrounded — from
    // a v19 that thins without a recoverable seq, or (#9993) from a pre-v29 that a previous desktop
    // handed 2031 scan authority to and can never retract it. Clear it before any bytes are attached.
    if (!this.canDelegateBackgroundToDaemon) {
      this.setPtyBackgrounded(sessionId, false)
    }

    // Why detect crash-recovery history before spawning: the revived shell should inherit the recovered cwd/dims, not the renderer's mount-time request.
    // Why probe aliveness first: detectColdRestore replays up to ~5MB on the main process, but a live session's snapshot supersedes disk, so the replay would be wasted.
    let restoreInfo: ColdRestoreInfo | null = null
    let restoreSkippedForLiveSession = false
    const historyProbe = this.historyReader?.probeRestorableHistory(sessionId)
    if (historyProbe && historyProbe.status !== 'none') {
      if ((await this.readAppliedSize(sessionId, true)) !== null) {
        restoreSkippedForLiveSession = true
        if (this.historyManager && !this.historyManager.hasWriter(sessionId)) {
          await detectColdRestore()
          restoreInfo = null
        }
      } else {
        restoreInfo = await detectColdRestore()
      }
    }
    let effectiveCwd = restoreInfo?.cwd ?? opts.cwd
    let effectiveCols = restoreInfo?.cols ?? opts.cols
    let effectiveRows = restoreInfo?.rows ?? opts.rows

    const shellReadySupported = opts.command ? supportsPtyStartupBarrier(opts.env ?? {}) : false
    const isCodexStartupCommand =
      recognizeAgentProcessFromCommandLine(opts.command)?.agent === 'codex'
    const shouldWaitForShellReady =
      isCodexStartupCommand &&
      shouldUseShellReadyStartupDelivery({
        command: opts.command,
        startupCommandDelivery: opts.startupCommandDelivery
      })
    const shellReadyTimeoutMs =
      shellReadySupported && isCodexStartupCommand && !shouldWaitForShellReady
        ? CODEX_SHELL_READY_TIMEOUT_MS
        : undefined

    const requestCreateOrAttach = (
      historySeed: string | undefined,
      historySeedTransferId: string | undefined
    ) => {
      if (opts.signal?.aborted) {
        throw new Error('client_disconnected')
      }
      return this.client.request<CreateOrAttachResult>('createOrAttach', {
        sessionId,
        cols: effectiveCols,
        rows: effectiveRows,
        cwd: effectiveCwd,
        env: opts.env,
        envToDelete: opts.envToDelete,
        command: opts.command,
        startupCommandDelivery: opts.startupCommandDelivery,
        launchAgent: opts.launchAgent,
        // Why: without forwarding the override, the daemon falls back to cmd.exe/PowerShell, ignoring the shell the renderer chose; this matches LocalPtyProvider.
        shellOverride: opts.shellOverride,
        terminalWindowsWslDistro: opts.terminalWindowsWslDistro,
        terminalWindowsPowerShellImplementation: opts.terminalWindowsPowerShellImplementation,
        shellReadySupported,
        ...(shellReadyTimeoutMs !== undefined ? { shellReadyTimeoutMs } : {}),
        ...(historySeed ? { historySeed } : {}),
        ...(historySeedTransferId ? { historySeedTransferId } : {}),
        ...(this.supportsStartupIngress && opts.startupIngress
          ? { startupIngress: opts.startupIngress }
          : {}),
        ...(opts.agentSessionEnsure ? { agentSessionEnsure: opts.agentSessionEnsure } : {})
      })
    }

    const createOrAttach = async (
      historySeedSegments: readonly string[] | null
    ): Promise<CreateOrAttachResult> => {
      // Why scoped per call: the aliveness-probe retry re-runs this with its own seed, so a first-call
      // delivery failure must not force historySeeded=false on a retry that seeded successfully.
      let historySeedUnavailable = false
      const deliverSeedAndCreate = async (): Promise<CreateOrAttachResult> => {
        if (!historySeedSegments || historySeedSegments.length === 0) {
          return requestCreateOrAttach(undefined, undefined)
        }
        const metrics = measureTerminalHistorySeed(historySeedSegments)
        if (metrics.codeUnits <= TERMINAL_HISTORY_INLINE_SEED_CODE_UNITS) {
          try {
            return await requestCreateOrAttach(historySeedSegments.join(''), undefined)
          } catch (error) {
            if (!(error instanceof NdjsonLineTooLongError)) {
              throw error
            }
            historySeedUnavailable = true
            return requestCreateOrAttach(undefined, undefined)
          }
        }
        if (this.protocolVersion < HISTORY_SEED_TRANSFER_PROTOCOL_VERSION) {
          historySeedUnavailable = true
          return requestCreateOrAttach(undefined, undefined)
        }

        let transferId: string | undefined
        try {
          const started = await this.client.request<{ transferId: string }>(
            'startHistorySeedTransfer',
            metrics
          )
          transferId = started.transferId
          let index = 0
          for (const data of iterateTerminalHistorySeedChunks(historySeedSegments)) {
            await this.client.request('appendHistorySeedTransfer', { transferId, index, data })
            index += 1
          }
          await this.client.request('finishHistorySeedTransfer', { transferId })
        } catch (error) {
          if (transferId) {
            await this.client.request('abortHistorySeedTransfer', { transferId }).catch(() => {})
          }
          if (isDaemonGoneError(error)) {
            throw error
          }
          historySeedUnavailable = true
          return requestCreateOrAttach(undefined, undefined)
        }
        return requestCreateOrAttach(undefined, transferId)
      }
      const result = await deliverSeedAndCreate()
      return historySeedUnavailable && result.historySeeded === undefined
        ? { ...result, historySeeded: false }
        : result
    }

    let historySeedSegments = restoreInfo ? getRecoveredHistorySeedSegments(restoreInfo) : null
    const adoptSpawnResultSession = async (spawnResult: CreateOrAttachResult): Promise<void> => {
      const requestedSessionId = sessionId
      if (
        opts.agentSessionEnsure &&
        !isAgentSessionClaimedSpawnResult(spawnResult.agentSessionEnsure)
      ) {
        // Why: a claim-incapable owner may already have spawned before returning
        // a malformed response; retire only this requested session before failing closed.
        await this.client.request('kill', { sessionId: requestedSessionId }).catch(() => {})
        throw new Error('agent_session_claim_unavailable')
      }
      sessionId = spawnResult.agentSessionEnsure?.owner.ptyId ?? requestedSessionId
      if (requestedSessionId === sessionId) {
        return
      }
      if (historyRecovery.freeze) {
        this.historyManager?.abandonRecoveryFreeze(historyRecovery.freeze)
        historyRecovery.freeze = null
      }
      historyRecovery.unreadableSessionId = null
      historyRecovery.identityChanged = true
      restoreInfo = null
      historySeedSegments = null
    }
    let result = await createOrAttach(historySeedSegments)
    await adoptSpawnResultSession(result)
    // Both ids: adoptSpawnResultSession may have rewritten sessionId to the claim owner.
    this.clearSessionAwaitingDaemonRecovery(requestedSessionId)
    this.clearSessionAwaitingDaemonRecovery(sessionId)
    const exitedResult = this.resultForExitBeforeSpawnReply(sessionId, result, operation)
    if (exitedResult) {
      return exitedResult
    }
    if (result.incarnationId) {
      this.sessionIncarnations.set(sessionId, result.incarnationId)
    }
    const claimResult = (): Pick<PtySpawnResult, 'agentSessionEnsure'> | Record<string, never> =>
      result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}
    const incarnationResult = (): Pick<PtySpawnResult, 'incarnationId'> | Record<string, never> =>
      result.incarnationId ? { incarnationId: result.incarnationId } : {}
    let providerWslDistro = result.wslDistro === undefined ? wslDistro : result.wslDistro
    // Why: explicit null from a current daemon overrides the caller's WSL preference; undefined keeps compatibility with older daemons.
    wslDistro = providerWslDistro ?? undefined
    if (wslDistro) {
      this.wslDistrosBySessionId.set(sessionId, wslDistro)
    } else if (providerWslDistro === null || result.isNew) {
      this.wslDistrosBySessionId.delete(sessionId)
    }
    const launchIdentity = (): { launchAgent?: NonNullable<typeof result.launchAgent> } =>
      result.launchAgent ? { launchAgent: result.launchAgent } : {}

    if (effectiveCwd) {
      this.initialCwds.set(sessionId, effectiveCwd)
    }

    // Why: surface the daemon's shell pid via PtySpawnResult so ipc/pty registers with the memory collector without a provider-specific accessor.
    let pid = typeof result.pid === 'number' && result.pid > 0 ? result.pid : null

    // Why: check sticky cache first — StrictMode double-mounts call spawn twice; the second call (isNew=false) must still return cached cold restore data.
    const cachedRestore = this.coldRestoreCache.get(sessionId)
    if (cachedRestore) {
      // Why: wake-after-sleep lands here too; sleep dropped active tracking + the history writer, so re-register both or the next sleep/wake restores a blank terminal.
      this.activeSessionIds.add(sessionId)
      if (this.historyManager && !historyRecovery.identityChanged) {
        const recoveryFreeze = takeRecoveryFreeze(historyRecovery, sessionId)
        if (historyRecovery.unreadableSessionId === sessionId) {
          this.historyManager.suspendSession(sessionId, recoveryFreeze)
        } else {
          this.historyManager.reopenSession(sessionId, recoveryFreeze)
        }
      }
      return {
        id: sessionId,
        ...incarnationResult(),
        pid,
        ...claimResult(),
        ...launchIdentity(),
        coldRestore: cachedRestore,
        ...(providerWslDistro !== undefined ? { wslDistro: providerWslDistro } : {}),
        ...(!result.isNew ? { isReattach: true } : {})
      }
    }

    // Why: the probe→createOrAttach gap is racy — the session can exit in between, so re-detect to match the unprobed restore path.
    // Why ignoreCleanEnd: the raced exit event can write endedAt before the reply; nulling the restore here would delete the checkpoint instead of restoring it.
    if (!historyRecovery.identityChanged && result.isNew && restoreSkippedForLiveSession) {
      restoreInfo = await detectColdRestore({ ignoreCleanEnd: true })
      historySeedSegments = restoreInfo ? getRecoveredHistorySeedSegments(restoreInfo) : null
      if (restoreInfo && historySeedSegments && historySeedSegments.length > 0) {
        // Why: the aliveness probe raced with session death, so the first
        // create lacked recovery bytes. Replace it before exposing the PTY.
        if (result.incarnationId) {
          operation.ignoredExitIncarnationIds.add(result.incarnationId)
        }
        operation.ignoreNextExit = true
        await this.client.request('kill', { sessionId, immediate: true })
        effectiveCwd = restoreInfo.cwd
        effectiveCols = restoreInfo.cols
        effectiveRows = restoreInfo.rows
        result = await createOrAttach(historySeedSegments)
        await adoptSpawnResultSession(result)
        const exitedRetryResult = this.resultForExitBeforeSpawnReply(sessionId, result, operation)
        if (exitedRetryResult) {
          return exitedRetryResult
        }
        if (result.incarnationId) {
          this.sessionIncarnations.set(sessionId, result.incarnationId)
        }
        providerWslDistro = result.wslDistro === undefined ? wslDistro : result.wslDistro
        wslDistro = providerWslDistro ?? undefined
        if (wslDistro) {
          this.wslDistrosBySessionId.set(sessionId, wslDistro)
        } else if (providerWslDistro === null || result.isNew) {
          this.wslDistrosBySessionId.delete(sessionId)
        }
        pid = typeof result.pid === 'number' && result.pid > 0 ? result.pid : null
        this.initialCwds.set(sessionId, effectiveCwd)
      }
    } else if (
      !historyRecovery.identityChanged &&
      !result.isNew &&
      result.historySeeded === false
    ) {
      restoreInfo = await detectColdRestore()
      historySeedSegments = restoreInfo ? getRecoveredHistorySeedSegments(restoreInfo) : null
    }

    const wasAlreadyManaged = this.activeSessionIds.has(sessionId)
    this.activeSessionIds.add(sessionId)
    const providerSequence = providerSequenceForSpawn(result)

    // Cold restore: daemon made a new session but disk history shows an unclean shutdown → return saved scrollback.
    if (restoreInfo && (result.isNew || result.historySeeded === false)) {
      const coldRestore = this.buildColdRestorePayload(restoreInfo)
      const canReanchorHistory =
        !historySeedSegments || historySeedSegments.length === 0 || result.historySeeded === true
      // Why: registerWriter (not openSession) avoids deleting checkpoint.json — the only recovery data if the revived daemon crashes before the next tick.
      if (this.historyManager && !historyRecovery.identityChanged) {
        const recoveryFreeze = takeRecoveryFreeze(historyRecovery, sessionId)
        if (historyRecovery.unreadableSessionId === sessionId) {
          await this.historyManager.openSession(sessionId, {
            cwd: effectiveCwd ?? '',
            cols: effectiveCols,
            rows: effectiveRows,
            ...(recoveryFreeze ? { recoveryFreeze } : {}),
            quarantineUnreadableRecovery: true
          })
          if (this.historyManager.hasWriter(sessionId)) {
            this.sessionsNeedingFullCheckpoint.add(sessionId)
            this.lastFullCheckpointAt.delete(sessionId)
          }
        } else if (canReanchorHistory) {
          this.historyManager.registerWriter(sessionId, recoveryFreeze)
          this.sessionsNeedingFullCheckpoint.add(sessionId)
          // Why: the revived generation has no valid checkpoint yet; a cooldown inherited from the pre-crash generation must not defer this re-anchor.
          this.lastFullCheckpointAt.delete(sessionId)
        } else {
          // Preserve old recovery files when the new daemon can't include them; a fresh-only checkpoint would make the data loss permanent.
          this.historyManager.suspendSession(sessionId, recoveryFreeze)
        }
      }
      if (coldRestore) {
        this.coldRestoreCache.set(sessionId, coldRestore)
        return {
          id: sessionId,
          ...incarnationResult(),
          pid,
          ...claimResult(),
          ...launchIdentity(),
          coldRestore,
          ...(providerWslDistro !== undefined ? { wslDistro: providerWslDistro } : {}),
          ...(providerSequence ? { providerSequence } : {}),
          ...(!result.isNew ? { isReattach: true } : {})
        }
      }
      return {
        id: sessionId,
        ...incarnationResult(),
        pid,
        ...claimResult(),
        ...launchIdentity(),
        ...(providerWslDistro !== undefined ? { wslDistro: providerWslDistro } : {}),
        ...(providerSequence ? { providerSequence } : {})
      }
    }

    if (this.historyManager && !historyRecovery.identityChanged && result.isNew) {
      const recoveryFreeze = takeRecoveryFreeze(historyRecovery, sessionId)
      await this.historyManager.openSession(sessionId, {
        cwd: effectiveCwd ?? '',
        cols: effectiveCols,
        rows: effectiveRows,
        ...(recoveryFreeze ? { recoveryFreeze } : {}),
        ...(historyRecovery.unreadableSessionId === sessionId
          ? { quarantineUnreadableRecovery: true }
          : {})
      })
    } else if (
      this.historyManager &&
      !historyRecovery.identityChanged &&
      (result.historySeeded === false || historyRecovery.unreadableSessionId === sessionId)
    ) {
      // Why: the daemon keeps this failure bit with the live session, so a new adapter can't promote its fresh-only snapshot after restart.
      this.historyManager.suspendSession(sessionId, takeRecoveryFreeze(historyRecovery, sessionId))
    } else if (this.historyManager && !historyRecovery.identityChanged) {
      // Why: on warm reattach after relaunch the HistoryManager is fresh; registerWriter adds a writer without deleting the still-only-valid checkpoint.
      this.historyManager.registerWriter(sessionId, takeRecoveryFreeze(historyRecovery, sessionId))
      if (!wasAlreadyManaged) {
        // Why: a previous adapter may have drained records it never persisted, so appending would leave a seq gap the reader rejects; force a full snapshot to re-anchor.
        this.sessionsNeedingFullCheckpoint.add(sessionId)
        this.lastFullCheckpointAt.delete(sessionId)
      }
    }

    const isReattach = !result.isNew
    if (!isReattach || !result.snapshot) {
      return {
        id: sessionId,
        ...incarnationResult(),
        pid,
        ...claimResult(),
        ...launchIdentity(),
        ...(providerWslDistro !== undefined ? { wslDistro: providerWslDistro } : {}),
        ...(providerSequence ? { providerSequence } : {}),
        ...(isReattach ? { isReattach: true } : {})
      }
    }

    const isAltScreen = result.snapshot.modes.alternateScreen
    const snapshotPayload =
      result.snapshot.scrollbackAnsi +
      result.snapshot.rehydrateSequences +
      result.snapshot.snapshotAnsi
    // Why kitty flags ride beside the payload, not inside it: the snapshot reaches renderer xterms where POST_REPLAY_REATTACH_RESET's kitty reset must win (terminal-query-authority.md §kitty).
    const kittyKeyboardFlags = result.snapshot.modes.kittyKeyboardFlags
    return {
      id: sessionId,
      ...incarnationResult(),
      pid,
      ...claimResult(),
      ...launchIdentity(),
      ...(providerWslDistro !== undefined ? { wslDistro: providerWslDistro } : {}),
      snapshot: snapshotPayload,
      snapshotCols: result.snapshot.cols,
      snapshotRows: result.snapshot.rows,
      ...(providerSequence ? { providerSequence } : {}),
      ...(typeof kittyKeyboardFlags === 'number' && kittyKeyboardFlags > 0
        ? { snapshotKittyKeyboardFlags: kittyKeyboardFlags }
        : {}),
      isReattach: true,
      isAlternateScreen: isAltScreen,
      // Why: carry the mid-escape tail so the renderer writes it after the reattach reset, else a split escape renders literally (#7329).
      ...(result.snapshot.pendingEscapeTailAnsi
        ? { pendingEscapeTailAnsi: result.snapshot.pendingEscapeTailAnsi }
        : {})
    }
  }


}
