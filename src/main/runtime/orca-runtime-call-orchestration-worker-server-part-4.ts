import {
  OrchestrationError,
  syncFederatedDispatch,
  type WorkspaceSessionState,
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId,
  type RuntimeClientEvent,
  type RuntimeStatus,
  getRepoIdFromWorktreeId,
  parseWorkspaceKey,
  BROWSER_HEADLESS_RUNTIME_CAPABILITY,
  BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY,
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY,
  RUNTIME_CAPABILITIES,
  RUNTIME_PROTOCOL_VERSION,
  TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY,
  type RuntimeCapability,
  listAiVaultSessions,
  type AiVaultListArgs,
  type AiVaultListResult,
  type AiVaultPrepareSessionResumeArgs,
  type AiVaultPrepareSessionResumeResult,
  notifyRuntimeListeners,
  type RuntimePtyController,
  type RuntimeNotifier
} from './orca-runtime-symbols'
import { OrcaRuntimeReconcileLegacyWorkerTerminalsNowPart3 } from './orca-runtime-reconcile-legacy-worker-terminals-now-part-3'
import type { OrcaRuntimeService } from './orca-runtime'

export class OrcaRuntimeCallOrchestrationWorkerServerPart4 extends OrcaRuntimeReconcileLegacyWorkerTerminalsNowPart3 {
  async callOrchestrationWorkerServer(
    selector: string,
    method: string,
    params: unknown,
    timeoutMs?: number
  ): Promise<unknown> {
    if (!this.orchestrationEnvironmentTransport) {
      throw new OrchestrationError(
        'server_required',
        'Connected-server orchestration is unavailable in this runtime.'
      )
    }
    const response = await this.orchestrationEnvironmentTransport.call(
      selector,
      method,
      params,
      timeoutMs
    )
    if (response.ok === false) {
      throw new OrchestrationError(response.error.code, response.error.message, response.error.data)
    }
    return response.result
  }
  async syncOrchestrationFederation(runId?: string): Promise<void> {
    if (!this.orchestrationEnvironmentTransport) {
      return
    }
    const dispatches = this.getOrchestrationDb().listActiveFederatedDispatches(runId)
    await Promise.allSettled(
      dispatches.map((dispatch) => this.syncOrchestrationFederatedDispatch(dispatch.dispatch_id))
    )
  }
  protected syncOrchestrationFederatedDispatch(dispatchId: string): Promise<void> {
    const current = this.orchestrationFederationSyncs.get(dispatchId)
    if (current) {
      return current
    }
    const sync = syncFederatedDispatch(this as unknown as OrcaRuntimeService, dispatchId)
      .then(() => {
        this.orchestrationFederationWarnings.delete(dispatchId)
      })
      .catch((error: unknown) => {
        if (!this.orchestrationFederationWarnings.has(dispatchId)) {
          console.warn(`[orchestration] Federation sync failed for ${dispatchId}:`, error)
          this.orchestrationFederationWarnings.add(dispatchId)
        }
        throw error
      })
      .finally(() => {
        this.orchestrationFederationSyncs.delete(dispatchId)
      })
    this.orchestrationFederationSyncs.set(dispatchId, sync)
    return sync
  }
  ensureOrchestrationFederationRelay(runId?: string): void {
    if (!this.orchestrationEnvironmentTransport) {
      return
    }
    for (const dispatch of this.getOrchestrationDb().listActiveFederatedDispatches(runId)) {
      if (this.orchestrationFederationTimers.has(dispatch.dispatch_id)) {
        continue
      }
      const tick = () => {
        const worker = this.getOrchestrationDb().getWorkerDispatch(dispatch.dispatch_id)
        if (!worker || !['starting', 'ready', 'stopping'].includes(worker.state)) {
          const activeTimer = this.orchestrationFederationTimers.get(dispatch.dispatch_id)
          if (activeTimer) {
            clearInterval(activeTimer)
          }
          this.orchestrationFederationTimers.delete(dispatch.dispatch_id)
          this.orchestrationFederationWarnings.delete(dispatch.dispatch_id)
          return
        }
        void this.syncOrchestrationFederatedDispatch(dispatch.dispatch_id).catch(() => undefined)
      }
      const timer = setInterval(tick, 1_000)
      timer.unref?.()
      this.orchestrationFederationTimers.set(dispatch.dispatch_id, timer)
      tick()
    }
  }
  stopOrchestrationFederationRelay(): void {
    for (const timer of this.orchestrationFederationTimers.values()) {
      clearInterval(timer)
    }
    this.orchestrationFederationTimers.clear()
    this.orchestrationFederationWarnings.clear()
  }
  getStartedAt(): number {
    return this.startedAt
  }
  protected getWorkspaceSessionHostIdForWorktree(worktreeId: string): ExecutionHostId {
    const scope = parseWorkspaceKey(worktreeId)
    if (scope?.type === 'folder') {
      const workspace = this.store
        ?.getFolderWorkspaces?.()
        .find((entry) => entry.id === scope.folderWorkspaceId)
      if (!workspace) {
        throw new Error('folder_workspace_not_found')
      }
      const connectionId = this.resolveFolderWorkspaceConnectionId(workspace)
      return connectionId ? toSshExecutionHostId(connectionId) : LOCAL_EXECUTION_HOST_ID
    }
    const resolvedWorktreeId = scope?.type === 'worktree' ? scope.worktreeId : worktreeId
    const repo = this.store?.getRepo?.(getRepoIdFromWorktreeId(resolvedWorktreeId))
    const worktreeMeta = this.store?.getWorktreeMeta?.(resolvedWorktreeId)
    return getWorktreeExecutionHostId(worktreeMeta ?? {}, repo)
  }
  protected getWorkspaceSessionForWorktree(worktreeId: string): WorkspaceSessionState | null {
    return (
      this.store?.getWorkspaceSession?.(this.getWorkspaceSessionHostIdForWorktree(worktreeId)) ??
      null
    )
  }
  protected setWorkspaceSessionForWorktree(
    worktreeId: string,
    session: WorkspaceSessionState
  ): void {
    this.store?.setWorkspaceSession?.(
      session,
      this.getWorkspaceSessionHostIdForWorktree(worktreeId)
    )
  }
  protected getKnownWorkspaceSessionWorktreeIds(): Set<string> {
    const repos = this.store?.getRepos?.() ?? []
    const repoIds = new Set(repos.map((repo) => repo.id))
    const hostIds = new Set<ExecutionHostId>(['local'])
    for (const repo of repos) {
      hostIds.add(getRepoExecutionHostId(repo))
    }
    const worktreeIds = new Set<string>()
    for (const hostId of hostIds) {
      const session = this.store?.getWorkspaceSession?.(hostId)
      for (const worktreeId of Object.keys(session?.tabsByWorktree ?? {})) {
        if (repoIds.has(getRepoIdFromWorktreeId(worktreeId))) {
          worktreeIds.add(worktreeId)
        }
      }
    }
    return worktreeIds
  }
  getStatus(): RuntimeStatus {
    // Why: browser panes need a backend that can create and stream a page. A
    // desktop renderer provides one via <webview>; a headless serve provides one
    // via the offscreen backend. Either way the same browser.screencast.v1 path
    // works, so advertise it when either is present. browser.headless.v1
    // additionally tells clients this host owns browser pages with no renderer,
    // so they must not fall back to a local desktop browser tab.
    const hasRenderer = Boolean(this.getAvailableAuthoritativeWindow())
    const hasOffscreen = !hasRenderer && Boolean(this.offscreenBrowserBackend)
    const canBrowse = hasRenderer || hasOffscreen
    const capabilities: RuntimeCapability[] = RUNTIME_CAPABILITIES.filter(
      (capability) =>
        (capability !== 'browser.screencast.v1' || canBrowse) &&
        // Why: the nested-runtime E2E needs a real legacy transport without maintaining an old binary fixture.
        (process.env.ORCA_E2E_DISABLE_RUNTIME_SHARED_CONTROL !== '1' ||
          capability !== REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY) &&
        (process.env.ORCA_E2E_DISABLE_PAIRED_TERMINAL_PARKING !== '1' ||
          capability !== TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY)
    )
    if (hasOffscreen) {
      capabilities.push(BROWSER_HEADLESS_RUNTIME_CAPABILITY)
    }
    // Why: certificate proceed is owned by the browser-hosting process for both
    // desktop webviews and offscreen pages. Advertise whenever either backend
    // can host a page so remote clients can surface Proceed Anyway (Unsafe).
    if (canBrowse) {
      capabilities.push(BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY)
    }
    return {
      runtimeId: this.runtimeId,
      rendererGraphEpoch: this.rendererGraphEpoch,
      graphStatus: this.graphStatus,
      authoritativeWindowId: this.authoritativeWindowId,
      desktopWindowStatus: hasRenderer ? 'available' : this.getDesktopWindowStatusFn(),
      liveTabCount: this.tabs.size,
      liveLeafCount: this.leaves.size,
      runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
      // Why: headless orca serve cannot create/stream BrowserViews, so clients
      // must not treat browser panes as supported just because runtime RPC is up.
      capabilities,
      hostPlatform: process.platform,
      terminalWindowsShell: this.store?.getSettings?.().terminalWindowsShell ?? null,
      floatingWorkspaceEnabled: this.store?.getSettings?.().floatingTerminalEnabled !== false,
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleMobileVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION
    }
  }

  // Why: scans the transcript-owning host's disk (correct by construction over
  // RPC — a remote/SSH host scans its own disk). Delegates to the one shared
  // cache so the desktop panel and the mobile screen never double-scan.
  listAiVaultSessions(args?: AiVaultListArgs): Promise<AiVaultListResult> {
    return listAiVaultSessions(args)
  }
  prepareAiVaultSessionResume(
    args: AiVaultPrepareSessionResumeArgs
  ): Promise<AiVaultPrepareSessionResumeResult> {
    return (
      this.prepareAiVaultSessionResumeFn?.(args) ?? Promise.resolve({ useRealCodexHome: false })
    )
  }
  setPtyController(controller: RuntimePtyController | null): void {
    // Why: CLI terminal writes must go through the main-owned PTY registry
    // instead of tunneling back through renderer IPC, or live handles could
    // drift from the process they are supposed to control during reloads.
    this.ptyController = controller
  }
  setNotifier(notifier: RuntimeNotifier | null): void {
    this.notifier = notifier
    // Why: run the one-shot fork-upstream backfill once a renderer is attached,
    // so existing forks self-correct on launch and the result can be broadcast.
    if (notifier && !this.forkBackfillStarted) {
      this.forkBackfillStarted = true
      void this.backfillForkUpstreams()
    }
  }
  onClientEvent(
    listener: (event: RuntimeClientEvent) => void,
    options?: { consumesTerminalSideEffects?: boolean }
  ): () => void {
    this.clientEventListeners.add(listener)
    if (options?.consumesTerminalSideEffects === false) {
      this.terminalSideEffectExcludedClientEventListeners.add(listener)
    }
    this.refreshTerminalSideEffectConsumerAvailability()
    return () => {
      this.clientEventListeners.delete(listener)
      this.terminalSideEffectExcludedClientEventListeners.delete(listener)
      this.refreshTerminalSideEffectConsumerAvailability()
    }
  }
  protected countTerminalSideEffectConsumingClientEventListeners(): number {
    return this.clientEventListeners.size - this.terminalSideEffectExcludedClientEventListeners.size
  }
  getTerminalSleepClientEventSnapshot(): RuntimeClientEvent[] {
    const events: RuntimeClientEvent[] = []
    const sleepStates = [...this.terminalSleepStateByWorktreeId.values()].sort((a, b) =>
      a.worktreeId.localeCompare(b.worktreeId)
    )
    for (const state of sleepStates) {
      const committedPtyIds = new Set(state.ptyIds)
      if (state.phase === 'stopping') {
        const pendingPtyIds = Object.keys(state.terminalHandlesByPtyId)
          .filter((ptyId) => !committedPtyIds.has(ptyId))
          .sort()
        if (pendingPtyIds.length > 0) {
          events.push({
            type: 'worktreeTerminalSleepState',
            worktreeId: state.worktreeId,
            generation: state.generation,
            phase: 'started',
            ptyIds: pendingPtyIds,
            terminalHandles: this.getRecordedTerminalSleepHandles(
              pendingPtyIds,
              state.terminalHandlesByPtyId
            )
          })
        }
      }
      if (state.ptyIds.length > 0) {
        events.push({
          type: 'worktreeTerminalSleepState',
          worktreeId: state.worktreeId,
          generation: state.generation,
          phase: 'committed',
          ptyIds: [...state.ptyIds].sort(),
          terminalHandles: this.getRecordedTerminalSleepHandles(
            state.ptyIds,
            state.terminalHandlesByPtyId
          )
        })
      }
    }
    return events
  }
  getNativeChatLaunchDraftResolutionClientEventSnapshot(): Extract<
    RuntimeClientEvent,
    { type: 'nativeChatLaunchDraftResolved' }
  >[] {
    return [...this.nativeChatLaunchDraftResolutionByTabId.values()]
      .sort((a, b) => a.tabId.localeCompare(b.tabId))
      .map(({ tabId, text, createdAt }) => ({
        type: 'nativeChatLaunchDraftResolved',
        tabId,
        text,
        createdAt
      }))
  }
  protected emitClientEvent(event: RuntimeClientEvent): void {
    // Why: mobile streams discard terminalSideEffects; skip excluded listeners so
    // paired phones never receive the per-OSC batch frames over the relay. Filtered
    // inside the delivery callback to keep live-Set iteration (a listener that
    // unsubscribes mid-fan-out must not be delivered to) and stay allocation-free.
    const skipExcluded =
      event.type === 'terminalSideEffects' &&
      this.terminalSideEffectExcludedClientEventListeners.size > 0
    // Why: a throwing subscriber here once escaped acquireWorktreeTerminalSpawn after it took the
    // per-worktree terminal mutation, leaking it and wedging that worktree's sleep until restart.
    notifyRuntimeListeners(
      this.clientEventListeners,
      (listener) => {
        if (skipExcluded && this.terminalSideEffectExcludedClientEventListeners.has(listener)) {
          return
        }
        listener(event)
      },
      'client-event'
    )
  }
}
