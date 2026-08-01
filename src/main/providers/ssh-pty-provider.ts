import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { IPtyProvider, PtyProcessInfo, PtySpawnOptions, PtySpawnResult } from './types'
import { toAppSshPtyId, toRelaySshPtyId } from './ssh-pty-id'
import { createSshPtyAppliedSizeReader } from './ssh-pty-applied-size'
import type {
  RemoteCliBridgeEnv,
  SshPtyDataCallback,
  SshPtyDeliveryPauseAdapter,
  SshPtyExitCallback,
  SshPtyReplayCallback
} from './ssh-pty-provider-contract'
import { SshPtyProviderOutputState } from './ssh-pty-provider-output-state'
import { spawnFreshSshPty } from './ssh-agent-session-create-operation'
import {
  requestSshPtyAttach,
  reattachSshPtySessionWithExitFence,
  type PtySourceRecoveryRequest,
  type SshPtyAttachResult
} from './ssh-pty-session-reattach'
import { buildSshPtySpawnRequest } from './ssh-pty-spawn-request'
import { SshPtySpawnExitRaceTracker } from './ssh-pty-spawn-exit-race'
import { SshAgentSessionCapabilities } from './ssh-agent-session-capabilities'
import type { PtyProcessInspection } from './pty-process-inspection'
import type { PtyDataEvent } from './pty-provider-events'
import { SSH_SESSION_EXPIRED_ERROR } from './ssh-pty-errors'
import {
  requestSshPtyClearBuffer,
  requestSshPtyCloseStartupAuthority,
  requestSshPtyDefaultShell,
  requestSshPtyForegroundProcess,
  requestSshPtyHasChildProcesses,
  requestSshPtyProcessInspection,
  requestSshPtyProcessList,
  requestSshPtyProfiles,
  requestSshPtyResizeIfCurrent,
  requestSshPtyRevive,
  requestSshPtySerialize,
  requestSshPtySignal,
  requestSshPtyShutdown,
  requestSshPtyString
} from './ssh-pty-provider-rpc'

/** Remote PTY provider that proxies IPtyProvider operations through the relay. */
export class SshPtyProvider implements IPtyProvider {
  private mux: SshChannelMultiplexer
  private connectionId: string
  private livePtyIds = new Set<string>()
  readonly getAppliedSize: NonNullable<IPtyProvider['getAppliedSize']>
  private readonly agentSessionCapabilities: SshAgentSessionCapabilities
  private spawnExitRaces = new SshPtySpawnExitRaceTracker()
  private readonly outputState: SshPtyProviderOutputState

  constructor(
    connectionId: string,
    mux: SshChannelMultiplexer,
    private readonly remoteCliBridgeEnv?: RemoteCliBridgeEnv,
    readonly providerGeneration = 1
  ) {
    this.connectionId = connectionId
    this.mux = mux
    this.agentSessionCapabilities = new SshAgentSessionCapabilities(mux)
    this.getAppliedSize = createSshPtyAppliedSizeReader(mux, connectionId)

    this.outputState = new SshPtyProviderOutputState(providerGeneration, {
      mux,
      toAppPtyId: (id) => this.toAppPtyId(id),
      livePtyIds: this.livePtyIds,
      recordExit: (relayPtyId, incarnationId) => {
        this.spawnExitRaces.recordExit(relayPtyId, incarnationId)
      }
    })
  }

  dispose(): void {
    this.outputState.dispose()
    this.livePtyIds.clear()
  }

  getConnectionId = (): string => this.connectionId

  private toRelayPtyId = (id: string): string => toRelaySshPtyId(this.connectionId, id)

  private toAppPtyId = (id: string): string => toAppSshPtyId(this.connectionId, id)

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    if (opts.agentSessionEnsure && opts.sessionId) {
      throw new Error('agent_session_claim_unavailable')
    }
    if (opts.agentSessionEnsure) {
      const supportsClaims = await this.supportsAgentSessionClaims({ signal: opts.signal })
      if (opts.signal?.aborted) {
        throw new Error('client_disconnected')
      }
      if (!supportsClaims) {
        throw new Error('agent_session_claim_unavailable')
      }
    }
    if (opts.sessionId) {
      let result: Awaited<ReturnType<typeof reattachSshPtySessionWithExitFence>> | undefined
      try {
        result = await reattachSshPtySessionWithExitFence({
          mux: this.mux,
          connectionId: this.connectionId,
          sessionId: opts.sessionId,
          options: opts,
          exitRaceTracker: this.spawnExitRaces,
          installSourceActivation: (relayPtyId, activation) =>
            this.outputState.installReceivingActivation(relayPtyId, activation),
          rememberPtyIncarnation: (relayPtyId, incarnationId) =>
            this.outputState.rememberPtyIncarnation(relayPtyId, incarnationId)
        })
        if (result.sourceRecovery?.status === 'restoreRequired') {
          throw new Error(
            `${SSH_SESSION_EXPIRED_ERROR}: ${toRelaySshPtyId(this.connectionId, result.id)}`
          )
        }
        this.livePtyIds.add(result.id)
        result.sourceActivationLease?.commit()
        const {
          sourceActivationLease: _lease,
          sourceRecovery: _sourceRecovery,
          ...spawnResult
        } = result
        return spawnResult
      } catch (error) {
        result?.sourceActivationLease?.rollback()
        throw error
      }
    }

    const supportsCreateOperation = opts.agentSessionCreateOperationId
      ? await this.supportsAgentSessionCreateOperations({ signal: opts.signal })
      : false
    if (opts.signal?.aborted) {
      throw new Error('client_disconnected')
    }
    if (opts.agentSessionCreateOperationId && !supportsCreateOperation) {
      // Why: host routing owns legacy selection; a changed relay must not downgrade after dispatch.
      throw new Error('execution_owner_unavailable')
    }
    return await spawnFreshSshPty({
      mux: this.mux,
      options: opts,
      params: buildSshPtySpawnRequest({
        options: opts,
        remoteCliBridgeEnv: this.remoteCliBridgeEnv,
        supportsCreateOperation
      }),
      exitRaceTracker: this.spawnExitRaces,
      installSourceActivation: (id, activation) =>
        this.outputState.installReceivingActivation(id, activation),
      rememberPtyIncarnation: (id, incarnation) =>
        this.outputState.rememberPtyIncarnation(id, incarnation),
      acceptLivePty: (id) => this.livePtyIds.add(id),
      toAppPtyId: this.toAppPtyId
    })
  }

  async supportsAgentSessionClaims(options: { signal?: AbortSignal } = {}): Promise<boolean> {
    return await this.agentSessionCapabilities.supportsClaims(options)
  }

  providesAgentSessionOwnerListings(_ptyId: string): boolean {
    return this.agentSessionCapabilities.providesOwnerListings()
  }

  async supportsAgentSessionCreateOperations(
    options: { signal?: AbortSignal } = {}
  ): Promise<boolean> {
    return await this.agentSessionCapabilities.supportsCreateOperations(options)
  }

  async attach(id: string): Promise<void> {
    const relayPtyId = this.toRelayPtyId(id)
    await requestSshPtyAttach({
      mux: this.mux,
      relayPtyId,
      params: { id: relayPtyId },
      commitSourceActivation: true,
      installSourceActivation: (ptyId, activation) =>
        this.outputState.installReceivingActivation(ptyId, activation),
      rememberPtyIncarnation: (ptyId, incarnationId) =>
        this.outputState.rememberPtyIncarnation(ptyId, incarnationId)
    })
  }

  async attachForReconnect(
    id: string,
    expected?: { paneKey?: string; tabId?: string },
    sourceRecovery?: PtySourceRecoveryRequest
  ): Promise<SshPtyAttachResult> {
    // Why: reconnect owns replay delivery so stale/duplicate attach results can
    // be filtered before they reach the renderer. The expected identity lets the
    // relay reject a cross-generation id collision instead of reattaching this
    // lease to a different pane's freshly spawned PTY.
    const params = {
      id: this.toRelayPtyId(id),
      suppressReplayNotification: true,
      ...(sourceRecovery ? { sourceRecovery } : {}),
      ...(expected?.paneKey ? { expectedPaneKey: expected.paneKey } : {}),
      ...(expected?.tabId ? { expectedTabId: expected.tabId } : {})
    }
    const relayPtyId = this.toRelayPtyId(id)
    return await requestSshPtyAttach({
      mux: this.mux,
      relayPtyId,
      params,
      timeoutMs: 10_000,
      installSourceActivation: (ptyId, activation) =>
        this.outputState.installReceivingActivation(ptyId, activation),
      rememberPtyIncarnation: (ptyId, incarnationId) =>
        this.outputState.rememberPtyIncarnation(ptyId, incarnationId)
    })
  }

  write(id: string, data: string): void {
    this.mux.notify('pty.data', { id: this.toRelayPtyId(id), data })
  }

  resize(id: string, cols: number, rows: number): void {
    this.mux.notify('pty.resize', { id: this.toRelayPtyId(id), cols, rows })
  }

  async resizeIfCurrent(
    id: string,
    expectedIncarnationId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    return await requestSshPtyResizeIfCurrent(
      this.mux,
      this.toRelayPtyId(id),
      expectedIncarnationId,
      cols,
      rows
    )
  }

  async shutdown(
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    await requestSshPtyShutdown(this.mux, this.toRelayPtyId(id), opts)
    this.livePtyIds.delete(id)
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await requestSshPtySignal(this.mux, this.toRelayPtyId(id), signal)
  }

  async getCwd(id: string): Promise<string> {
    return await requestSshPtyString(this.mux, 'pty.getCwd', this.toRelayPtyId(id))
  }

  async getInitialCwd(id: string): Promise<string> {
    return await requestSshPtyString(this.mux, 'pty.getInitialCwd', this.toRelayPtyId(id))
  }

  async clearBuffer(id: string): Promise<void> {
    await requestSshPtyClearBuffer(this.mux, this.toRelayPtyId(id))
  }

  async closeStartupQueryAuthority(id: string): Promise<number> {
    return await requestSshPtyCloseStartupAuthority(this.mux, this.toRelayPtyId(id))
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.mux.notify('pty.ackData', { id: this.toRelayPtyId(id), charCount })
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    return await requestSshPtyHasChildProcesses(this.mux, this.toRelayPtyId(id))
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    return await requestSshPtyForegroundProcess(this.mux, this.toRelayPtyId(id))
  }

  async inspectProcess(id: string): Promise<PtyProcessInspection> {
    return await requestSshPtyProcessInspection(this.mux, this.toRelayPtyId(id))
  }

  async serialize(ids: string[]): Promise<string> {
    return await requestSshPtySerialize(
      this.mux,
      ids.map((id) => this.toRelayPtyId(id))
    )
  }

  async revive(state: string): Promise<void> {
    await requestSshPtyRevive(this.mux, state)
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    const processes = await requestSshPtyProcessList(this.mux, opts?.deadlineMs, (id) =>
      this.toAppPtyId(id)
    )
    for (const process of processes) {
      this.livePtyIds.add(process.id)
      const relayPtyId = this.toRelayPtyId(process.id)
      this.outputState.rememberPtyIncarnation(relayPtyId, process.incarnationId)
    }
    return processes
  }

  hasPty = (id: string): boolean => this.livePtyIds.has(id)

  async getDefaultShell(): Promise<string> {
    return await requestSshPtyDefaultShell(this.mux)
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return await requestSshPtyProfiles(this.mux)
  }

  onData(callback: SshPtyDataCallback): () => void
  onData(callback: (payload: PtyDataEvent) => void): () => void
  onData(callback: ((payload: PtyDataEvent) => void) | SshPtyDataCallback): () => void {
    return this.outputState.onData((payload) =>
      callback({ ...payload, incarnationId: payload.ptyIncarnation })
    )
  }
  onReplay = (callback: SshPtyReplayCallback): (() => void) => this.outputState.onReplay(callback)
  onExit = (callback: SshPtyExitCallback): (() => void) => this.outputState.onExit(callback)

  setPtyDeliveryPauseAdapter(adapter: SshPtyDeliveryPauseAdapter | null): void {
    this.outputState.setDeliveryPauseAdapter(adapter)
  }

  hasPtyDeliveryPauseAdapter = (): boolean => this.outputState.hasDeliveryPauseAdapter()

  pauseProducer = (id: string): void => this.outputState.pause(this.toRelayPtyId(id))

  resumeProducer = (id: string): void => this.outputState.resume(this.toRelayPtyId(id))

  closeOutputIntake(reason: string): void {
    this.mux.dispose('connection_lost')
    console.error('[ssh-pty-provider] closed after bounded output intake failure', { reason })
  }
}
