import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import { combineUnsubscribes } from './combine-unsubscribes'
import {
  shutdownDegradedFallbackSessions,
  type FallbackSessionIdentity
} from './degraded-daemon-fallback-shutdown'
import { inspectPtyProviderProcess } from '../providers/pty-process-inspection'
import type {
  IPtyProvider,
  PtyBackgroundStreamEvent,
  PtyDataEvent,
  PtyProviderBufferSnapshot,
  PtyProcessInfo,
  PtySpawnOptions,
  PtySpawnResult
} from '../providers/types'
import { findDaemonAdapter, listProviderSessionIds } from './degraded-daemon-session-routing'
import { probePtyOwners } from './daemon-pty-liveness-probe'

export type CurrentDaemonInventoryState =
  | { status: 'complete' }
  | { status: 'failed'; error: string }

export class DegradedDaemonPtyProvider implements IPtyProvider {
  readonly routesFreshSpawnsToLocalProvider: boolean
  // Why: surface that fresh PTYs lack daemon persistence until restart.
  readonly isDegraded: boolean

  private current: DaemonPtyAdapter
  private legacy: DaemonPtyAdapter[]
  private fallback: IPtyProvider
  private sessionProviders = new Map<string, IPtyProvider>()
  private unsubscribers: (() => void)[] = []
  private dataListeners: ((payload: PtyDataEvent) => void)[] = []
  private exitListeners: ((payload: {
    id: string
    code: number
    incarnationId?: string
  }) => void)[] = []
  private sessionIncarnations = new Map<string, string>()
  private retiredFallbackIncarnations = new Map<string, string | undefined>()
  private retryableFallbackSessions: FallbackSessionIdentity[] = []
  private currentDaemonInventory = new Map<string, string | undefined>()
  private currentDaemonInventoryState: CurrentDaemonInventoryState = { status: 'complete' }

  constructor(opts: {
    current: DaemonPtyAdapter
    legacy: DaemonPtyAdapter[]
    fallback: IPtyProvider
    preservedFallbackSessions?: FallbackSessionIdentity[]
    routesFreshSpawnsToLocalProvider?: boolean
  }) {
    this.current = opts.current
    this.legacy = opts.legacy
    this.fallback = opts.fallback
    this.routesFreshSpawnsToLocalProvider = opts.routesFreshSpawnsToLocalProvider ?? true
    this.isDegraded = this.routesFreshSpawnsToLocalProvider

    for (const session of opts.preservedFallbackSessions ?? []) {
      this.sessionProviders.set(session.id, this.fallback)
      if (session.incarnationId) {
        this.sessionIncarnations.set(session.id, session.incarnationId)
      }
    }

    for (const provider of this.allProviders()) {
      this.unsubscribers.push(
        provider.onData((payload) => {
          const mappedProvider = this.sessionProviders.get(payload.id)
          const trackedIncarnation = this.sessionIncarnations.get(payload.id)
          if (
            (mappedProvider !== undefined && mappedProvider !== provider) ||
            (mappedProvider === provider &&
              payload.incarnationId !== undefined &&
              trackedIncarnation !== undefined &&
              trackedIncarnation !== payload.incarnationId)
          ) {
            return
          }
          this.sessionIncarnations.set(payload.id, payload.incarnationId)
          for (const listener of this.dataListeners) {
            listener(payload)
          }
        }),
        provider.onExit((payload) => {
          const mappedProvider = this.sessionProviders.get(payload.id)
          const retiredIncarnation = this.retiredFallbackIncarnations.get(payload.id)
          if (
            mappedProvider === undefined &&
            retiredIncarnation !== undefined &&
            (payload.incarnationId === undefined || payload.incarnationId === retiredIncarnation)
          ) {
            this.retiredFallbackIncarnations.delete(payload.id)
            return
          }
          const trackedIncarnation = this.sessionIncarnations.get(payload.id)
          if (mappedProvider !== undefined && mappedProvider !== provider) {
            return
          }
          const incarnationMatches =
            payload.incarnationId === undefined ||
            trackedIncarnation === undefined ||
            trackedIncarnation === payload.incarnationId
          if (mappedProvider === provider && !incarnationMatches) {
            // A stale exit may still reach the wrapper, but cannot retire the newer route.
            const staleIncarnationId = payload.incarnationId
            for (const listener of this.exitListeners) {
              listener({
                ...payload,
                ...(staleIncarnationId ? { incarnationId: staleIncarnationId } : {})
              })
            }
            return
          }
          if (mappedProvider === provider) {
            this.sessionProviders.delete(payload.id)
            this.currentDaemonInventory.delete(payload.id)
            this.sessionIncarnations.delete(payload.id)
          }
          const incarnationId = payload.incarnationId ?? trackedIncarnation
          const exitPayload = {
            ...payload,
            ...(incarnationId ? { incarnationId } : {})
          }
          for (const listener of this.exitListeners) {
            listener(exitPayload)
          }
        })
      )
    }
  }

  async discoverDaemonSessions(): Promise<void> {
    for (const adapter of this.allDaemonAdapters()) {
      try {
        const sessions = await adapter.listProcesses()
        for (const session of sessions) {
          this.sessionProviders.set(session.id, adapter)
          if (adapter === this.current) {
            this.currentDaemonInventory.set(session.id, session.incarnationId)
          }
          if (session.incarnationId) {
            this.sessionIncarnations.set(session.id, session.incarnationId)
          } else {
            this.sessionIncarnations.delete(session.id)
          }
        }
      } catch (error) {
        console.warn('[daemon] Failed to discover degraded daemon sessions', error)
      }
    }
  }

  async spawn(opts: PtySpawnOptions): Promise<PtySpawnResult> {
    const mapped = opts.sessionId ? this.sessionProviders.get(opts.sessionId) : undefined
    const target = mapped ?? (this.routesFreshSpawnsToLocalProvider ? this.fallback : this.current)
    const result = await target.spawn(opts)
    this.sessionProviders.set(result.id, target)
    this.retiredFallbackIncarnations.delete(result.id)
    if (result.incarnationId) {
      this.sessionIncarnations.set(result.id, result.incarnationId)
    } else {
      this.sessionIncarnations.delete(result.id)
    }
    return result
  }

  async attach(id: string): Promise<void> {
    await this.providerFor(id).attach(id)
  }

  hasPty(id: string): boolean {
    if (this.retiredFallbackIncarnations.has(id)) {
      return false
    }
    const mapped = this.sessionProviders.get(id)
    return mapped ? (mapped.hasPty?.(id) ?? true) : this.findProviderForExistingSession(id) !== null
  }

  async probePtyLiveness(id: string): Promise<boolean | null> {
    return await probePtyOwners(id, this.sessionProviders.get(id), this.allDaemonAdapters())
  }

  // Why: an unknown id cannot borrow listing authority from the fresh-spawn provider.
  providesAgentSessionOwnerListings = (ptyId: string): boolean =>
    (
      this.sessionProviders.get(ptyId) ?? this.findProviderForExistingSession(ptyId)
    )?.providesAgentSessionOwnerListings?.(ptyId) === true

  write(id: string, data: string): void {
    this.providerFor(id).write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.providerFor(id).resize(id, cols, rows)
  }

  async resizeIfCurrent(
    id: string,
    expectedIncarnationId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    const provider = this.providerFor(id)
    return provider.resizeIfCurrent
      ? await provider.resizeIfCurrent(id, expectedIncarnationId, cols, rows)
      : false
  }

  pauseProducer(id: string): void {
    this.providerFor(id).pauseProducer?.(id)
  }

  resumeProducer(id: string): void {
    this.providerFor(id).resumeProducer?.(id)
  }

  setPtyBackgrounded(id: string, background: boolean): void {
    this.providerFor(id).setPtyBackgrounded?.(id, background)
  }

  async shutdown(
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    await this.providerFor(id).shutdown(id, opts)
    if (!opts.keepHistory) {
      this.sessionProviders.delete(id)
    }
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await this.providerFor(id).sendSignal(id, signal)
  }

  async getCwd(id: string): Promise<string> {
    return this.providerFor(id).getCwd(id)
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.providerFor(id).getInitialCwd(id)
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    return (await this.providerFor(id).getAppliedSize?.(id)) ?? null
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    // Why: recovery must reach the legacy adapter that owns the thinned session model.
    return (await this.providerFor(id).getBufferSnapshot?.(id, opts)) ?? null
  }

  async clearBuffer(id: string): Promise<void> {
    await this.providerFor(id).clearBuffer(id)
  }

  async closeStartupQueryAuthority(id: string): Promise<number> {
    return (await this.providerFor(id).closeStartupQueryAuthority?.(id)) ?? 0
  }

  acknowledgeDataEvent(id: string, charCount: number): void {
    this.providerFor(id).acknowledgeDataEvent(id, charCount)
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    return this.providerFor(id).hasChildProcesses(id)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    return this.providerFor(id).getForegroundProcess(id)
  }
  inspectProcess(id: string) {
    return this.hasPty(id)
      ? inspectPtyProviderProcess(this.providerFor(id), id)
      : Promise.reject(new Error('terminal_gone'))
  }
  async confirmForegroundProcess(id: string): Promise<string | null> {
    return this.providerFor(id).confirmForegroundProcess?.(id) ?? null
  }

  async serialize(ids: string[]): Promise<string> {
    return this.fallback.serialize(ids)
  }

  async revive(state: string): Promise<void> {
    await this.fallback.revive(state)
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    const results = await Promise.all(
      this.allProviders().map((provider) => provider.listProcesses(opts))
    )
    return results.flat()
  }

  async getDefaultShell(): Promise<string> {
    return this.fallback.getDefaultShell()
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return this.fallback.getProfiles()
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
    return combineUnsubscribes(
      this.allProviders().flatMap((provider) => provider.onBackgroundStreamEvent?.(callback) ?? [])
    )
  }

  // Why: main subscribes on the routed provider, so without this the dead-endpoint
  // fan-out reaches no listener and only the written pane recovers (STA-2373). Daemon
  // adapters only — the local fallback has no dead-socket problem.
  onWriteUnavailable(callback: (payload: { id: string }) => void): () => void {
    return combineUnsubscribes(
      this.allDaemonAdapters().map((adapter) => adapter.onWriteUnavailable(callback))
    )
  }

  onReplay(callback: (payload: { id: string; data: string }) => void): () => void {
    const unsubscribes = this.allProviders().map((provider) => provider.onReplay(callback))
    let active = true
    const trackedUnsubscribe = (): void => {
      if (!active) {
        return
      }
      active = false
      const idx = this.unsubscribers.indexOf(trackedUnsubscribe)
      if (idx !== -1) {
        this.unsubscribers.splice(idx, 1)
      }
      combineUnsubscribes(unsubscribes)()
    }
    this.unsubscribers.push(trackedUnsubscribe)
    return trackedUnsubscribe
  }

  onExit(
    callback: (payload: { id: string; code: number; incarnationId?: string }) => void
  ): () => void {
    this.exitListeners.push(callback)
    return () => {
      const idx = this.exitListeners.indexOf(callback)
      if (idx !== -1) {
        this.exitListeners.splice(idx, 1)
      }
    }
  }

  ackColdRestore(sessionId: string): void {
    findDaemonAdapter(this.sessionProviders, this.allDaemonAdapters(), sessionId)?.ackColdRestore(
      sessionId
    )
  }

  clearTombstone(sessionId: string): void {
    findDaemonAdapter(this.sessionProviders, this.allDaemonAdapters(), sessionId)?.clearTombstone(
      sessionId
    )
  }

  async reconcileOnStartup(validWorktreeIds: Set<string>): Promise<{
    alive: string[]
    killed: string[]
  }> {
    const alive: string[] = []
    const killed: string[] = []
    for (const adapter of this.allDaemonAdapters()) {
      const result = await adapter.reconcileOnStartup(validWorktreeIds)
      for (const id of result.alive) {
        alive.push(id)
        this.sessionProviders.set(id, adapter)
      }
      for (const id of result.killed) {
        killed.push(id)
        this.sessionProviders.delete(id)
      }
    }
    return { alive, killed }
  }

  dispose(): void {
    this.disposeProviderOnly()
    for (const adapter of this.allDaemonAdapters()) {
      adapter.dispose()
    }
  }

  disposeProviderOnly(): void {
    combineUnsubscribes(this.unsubscribers.splice(0))()
    this.sessionIncarnations.clear()
    this.currentDaemonInventory.clear()
  }

  async shutdownFallbackSessions(): Promise<number> {
    this.retryableFallbackSessions = []
    const result = await shutdownDegradedFallbackSessions(
      this.sessionProviders,
      this.fallback,
      (id) => this.sessionIncarnations.get(id)
    )
    this.retryableFallbackSessions = result.retryable
    for (const session of result.retired) {
      const incarnationId = session.incarnationId ?? this.sessionIncarnations.get(session.id)
      this.sessionProviders.delete(session.id)
      this.sessionIncarnations.delete(session.id)
      this.retiredFallbackIncarnations.set(session.id, incarnationId)
      for (const listener of this.exitListeners) {
        listener({ id: session.id, code: -1, ...(incarnationId ? { incarnationId } : {}) })
      }
    }
    return result.killedCount
  }

  getRetryableFallbackSessions(): FallbackSessionIdentity[] {
    return this.retryableFallbackSessions.map((session) => ({ ...session }))
  }

  getFallbackProvider(): IPtyProvider {
    return this.fallback
  }

  getCurrentDaemonSessionIds(): string[] {
    return [
      ...new Set([
        ...listProviderSessionIds(this.sessionProviders, this.current),
        ...this.currentDaemonInventory.keys()
      ])
    ]
  }

  async collectCurrentDaemonSessionIds(): Promise<string[]> {
    let sessions: PtyProcessInfo[]
    try {
      sessions = await this.current.listProcesses()
    } catch (error) {
      this.currentDaemonInventoryState = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      }
      throw error
    }
    this.currentDaemonInventoryState = { status: 'complete' }
    for (const session of sessions) {
      this.currentDaemonInventory.set(session.id, session.incarnationId)
      const mappedProvider = this.sessionProviders.get(session.id)
      if (mappedProvider === undefined || mappedProvider === this.current) {
        this.sessionProviders.set(session.id, this.current)
        if (session.incarnationId) {
          this.sessionIncarnations.set(session.id, session.incarnationId)
        } else {
          this.sessionIncarnations.delete(session.id)
        }
      }
    }
    return this.getCurrentDaemonSessionIds()
  }

  getCurrentDaemonInventoryState(): CurrentDaemonInventoryState {
    return { ...this.currentDaemonInventoryState }
  }

  fanoutCurrentDaemonSyntheticExits(code: number): void {
    for (const id of this.getCurrentDaemonSessionIds()) {
      const mappedProvider = this.sessionProviders.get(id)
      const incarnationId = this.currentDaemonInventory.has(id)
        ? this.currentDaemonInventory.get(id)
        : this.sessionIncarnations.get(id)
      // Why: restart kills listed sessions even when the adapter did not track them active.
      // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
      for (const listener of [...this.exitListeners]) {
        listener({ id, code, ...(incarnationId ? { incarnationId } : {}) })
      }
      if (mappedProvider === this.current) {
        this.sessionProviders.delete(id)
        this.sessionIncarnations.delete(id)
      }
      this.currentDaemonInventory.delete(id)
    }
  }

  async disconnectOnly(): Promise<void> {
    this.disposeProviderOnly()
    await Promise.all(this.allDaemonAdapters().map((adapter) => adapter.disconnectOnly()))
  }

  getCurrentAdapter(): DaemonPtyAdapter {
    return this.current
  }

  getLegacyAdapters(): readonly DaemonPtyAdapter[] {
    return this.legacy
  }

  getAllAdapters(): readonly DaemonPtyAdapter[] {
    return this.allDaemonAdapters()
  }

  private providerFor(sessionId: string): IPtyProvider {
    return (
      this.sessionProviders.get(sessionId) ??
      this.findProviderForExistingSession(sessionId) ??
      (this.routesFreshSpawnsToLocalProvider ? this.fallback : this.current)
    )
  }

  private findProviderForExistingSession(sessionId: string): IPtyProvider | null {
    if (this.retiredFallbackIncarnations.has(sessionId)) {
      return null
    }
    for (const provider of this.allProviders()) {
      if (provider.hasPty?.(sessionId) === true) {
        this.sessionProviders.set(sessionId, provider)
        return provider
      }
    }
    return null
  }

  private allProviders(): IPtyProvider[] {
    return [this.fallback, ...this.allDaemonAdapters()]
  }

  private allDaemonAdapters(): DaemonPtyAdapter[] {
    return [this.current, ...this.legacy]
  }
}
