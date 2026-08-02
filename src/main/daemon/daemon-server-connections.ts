import {  createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { writeFileSync, chmodSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { encodeNdjson, createNdjsonParser } from './ndjson'
import { TerminalHost } from './terminal-host'
import { DaemonStreamDataBatcher } from './daemon-stream-data-batcher'
import {
  BackgroundTransientFactRelay,
  BACKGROUND_STREAM_DROP_ENABLED
} from './daemon-background-transient-facts'
import { extractHiddenStartupRendererQueryData } from '../../shared/terminal-reply-query-extraction'
import {
  recordDaemonStreamBacklogEvent,
  startDaemonStreamBacklogProbe
} from './daemon-stream-backlog-probe'
import { readCurrentProcessMacSystemResolverHealth } from '../network/macos-system-resolver-health'
import type { SubprocessHandle } from './session'
import { checkPtySpawnHealth } from './pty-subprocess'
import { createNoopDaemonFileLog, type DaemonFileLog } from './daemon-file-log'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { parsePtyStartupIngressIntent } from '../../shared/pty-startup-ingress'
import { unlinkOwnedDaemonPidFile, unlinkOwnedDaemonTokenFile } from './daemon-spawner'
import {
  CLEAN_DISCONNECT_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  NOTIFY_PREFIX,
  SessionNotFoundError,
  TerminalAttachCanceledError,
  type HelloMessage,
  type DaemonRequest
} from './types'
import {
  isAgentSessionExecutionClaim,
  isAgentSessionSurfaceBinding
} from '../../shared/agent-session-host-authority'
import { TerminalHistorySeedTransferRegistry } from './terminal-history-seed-transfer-registry'


import { type DaemonServerOptions,
  type ConnectedClient,
  type PendingPtySpawnPreparation,
  type PendingShutdownReply  } from './daemon-server-foundation'
import { DaemonServerPhase1 } from './daemon-server-shutdown'

export class DaemonServerPhase2 extends DaemonServerPhase1 {
  protected async routeRequest(clientId: string, request: DaemonRequest): Promise<unknown> {
    const client = this.clients.get(clientId)

    switch (request.type) {
      case 'startHistorySeedTransfer': {
        if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
          throw new Error('Daemon client connection is incomplete; reconnect')
        }
        const transferId = this.historySeedTransfers.start(clientId, request.payload)
        return { transferId }
      }

      case 'appendHistorySeedTransfer':
        this.historySeedTransfers.append(
          clientId,
          request.payload.transferId,
          request.payload.index,
          request.payload.data
        )
        return {}

      case 'finishHistorySeedTransfer':
        this.historySeedTransfers.finish(clientId, request.payload.transferId)
        return {}

      case 'abortHistorySeedTransfer':
        this.historySeedTransfers.abort(clientId, request.payload.transferId)
        return {}

      case 'createOrAttach': {
        if (this.idleShutdownState !== 'running') {
          throw new Error('Daemon temporarily unavailable; reconnect')
        }
        if (!client?.authenticatedPairEstablished || client.streamSocket === null) {
          // Why: a control-only replacement can't own terminal admission or erase the prior client's retirement request.
          throw new Error('Daemon client connection is incomplete; reconnect')
        }
        this.createOrAttachInFlight++
        const p = request.payload
        let routedSessionId = p.sessionId
        let result: Awaited<ReturnType<TerminalHost['createOrAttach']>>
        try {
          if (
            p.agentSessionEnsure !== undefined &&
            (!isAgentSessionExecutionClaim(p.agentSessionEnsure.claim) ||
              !isAgentSessionSurfaceBinding(p.agentSessionEnsure.surface))
          ) {
            throw new Error('agent_session_identity_required')
          }
          await this.preparePtySpawnUnlessCanceled(p.sessionId, clientId)
          if (p.historySeed !== undefined && p.historySeedTransferId !== undefined) {
            throw new Error('Multiple terminal history seed sources')
          }
          const historySeedChunks =
            p.historySeedTransferId !== undefined
              ? this.historySeedTransfers.take(clientId, p.historySeedTransferId)
              : p.historySeed !== undefined
                ? [p.historySeed]
                : undefined
          result = await this.host.createOrAttach({
            sessionId: p.sessionId,
            cols: p.cols,
            rows: p.rows,
            cwd: p.cwd,
            env: p.env,
            envToDelete: p.envToDelete,
            command: p.command,
            startupCommandDelivery: p.startupCommandDelivery,
            // Why: RPC payloads are untrusted JSON; persist only the allowlisted routing enum, never arbitrary identity.
            ...(isTuiAgent(p.launchAgent) ? { launchAgent: p.launchAgent } : {}),
            shellOverride: p.shellOverride,
            terminalWindowsWslDistro: p.terminalWindowsWslDistro,
            terminalWindowsPowerShellImplementation: p.terminalWindowsPowerShellImplementation,
            shellReadySupported: p.shellReadySupported,
            historySeedChunks,
            startupIngress: parsePtyStartupIngressIntent(p.startupIngress),
            ...(p.shellReadyTimeoutMs !== undefined
              ? { shellReadyTimeoutMs: p.shellReadyTimeoutMs }
              : {}),
            ...(p.agentSessionEnsure ? { agentSessionEnsure: p.agentSessionEnsure } : {}),
            onSessionResolved: (sessionId) => {
              routedSessionId = sessionId
            },
            streamClient: {
              onData: (data, rawLength = data.length, transformed = false, seq, incarnationId) => {
                // Scan BEFORE enqueue: the batcher may drop this chunk, but its facts must be captured regardless.
                this.transientFactRelay.onSessionData(routedSessionId, data)
                const lastInputAt = this.lastInputAtBySessionId.get(routedSessionId)
                const isInteractiveOutput =
                  data.length <= DaemonServer.INTERACTIVE_OUTPUT_MAX_CHARS &&
                  lastInputAt !== undefined &&
                  performance.now() - lastInputAt <= DaemonServer.INTERACTIVE_OUTPUT_WINDOW_MS
                this.streamDataBatcher.enqueue(clientId, routedSessionId, data, {
                  flushImmediately: isInteractiveOutput,
                  flushMaxChars: DaemonServer.INTERACTIVE_OUTPUT_MAX_CHARS,
                  rawLength,
                  transformed,
                  seq,
                  incarnationId
                })
              },
              onExit: (code, incarnationId) => {
                // Why: exit tears down renderer handlers, so it must ride the ordered queue behind final output.
                this.log.log('session-exited', { sessionId: routedSessionId, code })
                this.streamDataBatcher.enqueueControlEvent(clientId, routedSessionId, {
                  type: 'event',
                  event: 'exit',
                  sessionId: routedSessionId,
                  payload: { code, incarnationId }
                })
                this.streamDataBatcher.flush(clientId)
                recordDaemonStreamBacklogEvent('sessionExit', {
                  sessionIdSuffix: routedSessionId.slice(-10)
                })
                this.transientFactRelay.onSessionExit(routedSessionId)
                this.streamDataBatcher.refreshSessionDroppability(routedSessionId)
                this.streamClientIdBySessionId.delete(routedSessionId)
                this.lastInputAtBySessionId.delete(routedSessionId)
                this.reevaluateIdleShutdown()
              }
            }
          })
        } finally {
          this.createOrAttachInFlight--
          this.reevaluateIdleShutdown()
        }
        routedSessionId = result.agentSessionEnsure?.owner.ptyId ?? p.sessionId
        this.streamClientIdBySessionId.set(routedSessionId, clientId)
        this.streamDataBatcher.refreshSessionDroppability(routedSessionId)
        // Why an attach-time marker: background resync can precede this attach, so scan suppression must start at the new stream's head.
        if (this.transientFactRelay.isBackgrounded(routedSessionId)) {
          this.streamDataBatcher.enqueueControlEvent(clientId, routedSessionId, {
            type: 'event',
            event: 'sessionBackgroundMarker',
            sessionId: routedSessionId,
            payload: { background: true }
          })
        }
        this.log.log(result.isNew ? 'session-created' : 'session-attached', {
          sessionId: routedSessionId,
          pid: result.pid
        })
        return {
          isNew: result.isNew,
          snapshot: result.snapshot,
          pid: result.pid,
          shellState: result.shellState,
          incarnationId: result.incarnationId,
          ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
          wslDistro: result.wslDistro,
          ...(result.historySeeded !== undefined ? { historySeeded: result.historySeeded } : {}),
          ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {})
        }
      }

      case 'cancelCreateOrAttach':
        this.cancelPendingPtySpawnPreparations(request.payload.sessionId)
        return {}

      case 'closeStartupQueryAuthority':
        return {
          appliedSeq: this.host.closeStartupQueryAuthority(request.payload.sessionId)
        }

      case 'write':
        try {
          this.lastInputAtBySessionId.set(request.payload.sessionId, performance.now())
          this.host.write(request.payload.sessionId, request.payload.data)
        } catch (err) {
          this.lastInputAtBySessionId.delete(request.payload.sessionId)
          if (err instanceof SessionNotFoundError) {
            this.sendExitEvent(client, request.payload.sessionId, -1)
          }
          throw err
        }
        return {}

      case 'resize':
        try {
          this.host.resize(request.payload.sessionId, request.payload.cols, request.payload.rows)
        } catch (err) {
          if (err instanceof SessionNotFoundError) {
            this.sendExitEvent(client, request.payload.sessionId, -1)
          }
          throw err
        }
        return {}

      case 'resizeIfCurrent':
        return {
          applied: this.host.resizeIfCurrent(
            request.payload.sessionId,
            request.payload.expectedIncarnationId,
            request.payload.cols,
            request.payload.rows
          )
        }

      case 'pausePty':
        this.host.pauseProducer(request.payload.sessionId)
        return {}

      case 'resumePty':
        this.host.resumeProducer(request.payload.sessionId)
        return {}

      case 'setSessionBackground': {
        const sessionId = request.payload.sessionId
        const background = request.payload.background === true
        recordDaemonStreamBacklogEvent('setSessionBackground', {
          sessionIdSuffix: sessionId.slice(-10),
          background
        })
        const backgroundChanged = this.transientFactRelay.setSessionBackground(
          sessionId,
          background
        )
        this.streamDataBatcher.refreshSessionDroppability(sessionId)
        if (!backgroundChanged) {
          return {}
        }
        if (background) {
          // Seed the fresh relay tracker with the emulator's dangling escape so a handoff-split sequence still parses.
          this.transientFactRelay.seedSessionScanState(
            sessionId,
            this.host.getPartialEscapeTailAnsi(sessionId)
          )
        }
        const streamClientId = this.streamClientIdBySessionId.get(sessionId)
        if (!streamClientId) {
          // Not attached yet — the attach-time marker covers the handoff.
          return {}
        }
        // Reveal intentionally keeps the queued tail: main needs those bytes, and the normal flush/drain delivers them in order ahead of the marker.
        const mode2031State = this.transientFactRelay.getMode2031ReplyScanState(sessionId)
        const scanSeedAnsi = background
          ? ''
          : mode2031State.pendingSubscribe
            ? mode2031State.tail
            : this.host.getPartialEscapeTailAnsi(sessionId)
        this.streamDataBatcher.enqueueControlEvent(streamClientId, sessionId, {
          type: 'event',
          event: 'sessionBackgroundMarker',
          sessionId,
          payload: {
            background,
            ...(scanSeedAnsi.length > 0 ? { scanSeedAnsi } : {}),
            ...(mode2031State.pendingSubscribe ? { mode2031PendingSubscribe: true as const } : {})
          }
        })
        return {}
      }

      case 'kill': {
        const canceledPendingSpawn = this.cancelPendingPtySpawnPreparations(
          request.payload.sessionId
        )
        this.lastInputAtBySessionId.delete(request.payload.sessionId)
        this.log.log('session-killed', {
          sessionId: request.payload.sessionId,
          immediate: request.payload.immediate === true
        })
        try {
          await this.host.kill(request.payload.sessionId, { immediate: request.payload.immediate })
        } catch (error) {
          // Why: a kill that wins before session registration already canceled the pending spawn, so its intent is done.
          if (!(canceledPendingSpawn && error instanceof SessionNotFoundError)) {
            throw error
          }
        }
        return {}
      }

      case 'signal':
        this.host.signal(request.payload.sessionId, request.payload.signal)
        return {}

      case 'detach':
        // Note: detach token handling simplified — full impl would track tokens per client
        this.log.log('session-detached', { sessionId: request.payload.sessionId })
        return {}

      case 'getCwd':
        return { cwd: await this.host.getCwd(request.payload.sessionId) }

      case 'getForegroundProcess':
        return { foregroundProcess: this.host.getForegroundProcess(request.payload.sessionId) }

      case 'inspectProcess':
        return this.host.inspectProcess(request.payload.sessionId)

      case 'confirmForegroundProcess':
        return {
          foregroundProcess: await this.host.confirmForegroundProcess(request.payload.sessionId)
        }

      case 'clearScrollback':
        this.host.clearScrollback(request.payload.sessionId)
        return {}

      case 'listSessions':
        return { sessions: this.host.listSessions() }

      case 'shutdownIfIdle': {
        const authenticatedClient = this.clients.get(clientId)
        const retiring =
          authenticatedClient !== undefined &&
          authenticatedClient.streamSocket !== null &&
          this.clients.size === 1 &&
          this.createOrAttachInFlight === 0 &&
          this.host.listSessions().length === 0 &&
          [...this.transportSockets].every(
            (transport) =>
              transport === authenticatedClient.controlSocket ||
              transport === authenticatedClient.streamSocket
          )
        if (!retiring) {
          return { retiring: false }
        }
        this.idleShutdownState = 'shutting-down'
        this.initialAdoptionDeadlineMs = null
        this.retirementRequested = false
        this.cancelInitialAdoptionTimer()
        // Why: close before acknowledging retirement so no new terminal races between the empty proof and disposal.
        const serverClose = this.beginServerClose()
        this.deferShutdownUntilReply(clientId, request.id, authenticatedClient.controlSocket, () =>
          this.finishIdleShutdown(serverClose)
        )
        return { retiring: true }
      }

      case 'getSnapshot': {
        const snapshotStart = performance.now()
        const requestedScrollbackRows = request.payload.scrollbackRows
        const scrollbackRows =
          typeof requestedScrollbackRows === 'number' && Number.isFinite(requestedScrollbackRows)
            ? Math.max(0, Math.min(50_000, Math.floor(requestedScrollbackRows)))
            : undefined
        const snapshot = this.host.getSnapshot(request.payload.sessionId, { scrollbackRows })
        const snapshotMs = performance.now() - snapshotStart
        if (snapshotMs >= 25) {
          // Serialize stalls block the daemon's single thread; surface them to attribute field typing stalls (issue #5096 family).
          recordDaemonStreamBacklogEvent('slowGetSnapshot', {
            sessionIdSuffix: request.payload.sessionId.slice(-10),
            snapshotMs: Math.round(snapshotMs)
          })
        }
        return { snapshot }
      }

      case 'getSize': {
        const size = this.host.getAppliedSize(request.payload.sessionId)
        return size ? { status: 'ok', size } : { status: 'session-not-found', size: null }
      }

      case 'takePendingOutput':
        // Why no await: with includeSnapshot, drain+serialize must share one sync turn or cold restore replays doubled PTY bytes.
        return this.host.takePendingOutput(
          request.payload.sessionId,
          request.payload.includeSnapshot === true,
          { teardownSnapshot: request.payload.teardownSnapshot === true }
        )

      case 'ping':
        return { pong: true }

      case 'systemResolverHealth':
        return { health: await readCurrentProcessMacSystemResolverHealth() }

      case 'ptySpawnHealth':
        await this.ptySpawnHealthCheck()
        return { healthy: true }

      case 'shutdown': {
        this.log.log('shutdown', {
          reason: 'rpc',
          killSessions: request.payload.killSessions === true
        })
        const serverClose = this.beginOrdinaryShutdownFence()
        if (request.payload.killSessions) {
          try {
            await this.host.dispose()
          } catch (err) {
            // Why: shutdown must always self-terminate; failed owners stay retryable for the follow-up shutdown() below.
            this.log.log('shutdown-dispose-failed', {
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
        const controlSocket = this.clients.get(clientId)?.controlSocket
        if (controlSocket) {
          this.deferShutdownUntilReply(clientId, request.id, controlSocket, () =>
            this.finishOrdinaryShutdown(serverClose)
          )
        } else if (!this.shutdownPromise) {
          this.shutdownPromise = this.finishOrdinaryShutdown(serverClose)
        }
        return {}
      }
    }
    throw new Error(`Unknown request type: ${(request as { type: string }).type}`)
  }

  protected sendExitEvent(
    client: ConnectedClient | undefined,
    sessionId: string,
    code: number
  ): void {
    if (!client?.streamSocket) {
      return
    }
    // Why: write/resize don't wait for replies, so this synthetic exit is the renderer's only signal to clear stale pane bindings.
    this.streamDataBatcher.enqueueControlEvent(client.clientId, sessionId, {
      type: 'event',
      event: 'exit',
      sessionId,
      payload: { code }
    })
    this.streamDataBatcher.flush(client.clientId)
  }
}
