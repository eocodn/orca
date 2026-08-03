import { randomUUID, type WorktreeStartupLaunch, type TuiAgent, type SleepingAgentLaunchConfig, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionTabsSnapshot, parsePaneKey, type RuntimePtyWorktreeRecord, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS } from './orca-runtime-symbols'
import { OrcaRuntimeRunCreateMobileSessionTerminalPart64 } from './orca-runtime-run-create-mobile-session-terminal-part-64'

export class OrcaRuntimeCreateHeadlessMobileSessionTerminalPart65 extends OrcaRuntimeRunCreateMobileSessionTerminalPart64 {
  protected async createHeadlessMobileSessionTerminal(
    worktreeId: string,
    activate: boolean,
    afterTabId?: string,
    opts: {
      command?: string
      cwd?: string
      env?: Record<string, string>
      envToDelete?: string[]
      startupCommandDelivery?: WorktreeStartupLaunch['startupCommandDelivery']
      identity?: { tabId: string; leafId: string; sessionId?: string }
      launchAgent?: TuiAgent
      viewMode?: 'terminal' | 'chat'
      targetGroupId?: string
      launchConfig?: SleepingAgentLaunchConfig
    } = {}
  ): Promise<RuntimeMobileSessionCreateTerminalResult> {
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(`id:${worktreeId}`)
    const cwd = this.resolveWorkspaceTerminalStartupCwd(workspace, opts.cwd)
    // Why: SshPtyProvider treats sessionId as a relay reattach; only synthesize local serve ids so SSH fresh terminals still call pty.spawn.
    const stableSessionId =
      opts.identity?.sessionId ?? (workspace.connectionId ? undefined : `serve-${randomUUID()}`)
    const terminal = await this.createTerminal(`id:${worktreeId}`, {
      focus: false,
      command: opts.command,
      cwd,
      env: opts.env,
      envToDelete: opts.envToDelete,
      ...(opts.launchConfig ? { launchConfig: opts.launchConfig } : {}),
      ...(opts.launchAgent ? { launchAgent: opts.launchAgent } : {}),
      ...(opts.viewMode ? { viewMode: opts.viewMode } : {}),
      startupCommandDelivery: opts.startupCommandDelivery,
      ...(opts.identity
        ? {
            tabId: opts.identity.tabId,
            leafId: opts.identity.leafId,
            ...(stableSessionId ? { sessionId: stableSessionId } : {})
          }
        : stableSessionId
          ? { sessionId: stableSessionId }
          : {}),
      persistHostSessionBinding: true,
      // Why: this method publishes the authoritative snapshot below; skip the intermediate publish to avoid a wrong-group flash.
      deferMobileSessionPublish: true
    })
    const livePty = this.getLivePtyForHandle(terminal.handle)
    if (!livePty) {
      throw new Error('terminal_handle_stale')
    }
    const parentTabId = livePty.pty.tabId ?? `pty:${livePty.pty.ptyId}`
    const leafId = parsePaneKey(livePty.pty.paneKey ?? '')?.leafId ?? randomUUID()
    if (opts.viewMode) {
      // Why: the runtime-owned binding must survive a serve restart with the same initial mode, not a later client's local default.
      this.persistHeadlessSessionTabProps(worktreeId, parentTabId, { viewMode: opts.viewMode })
    }
    const existing = this.mobileSessionTabsByWorktree.get(worktreeId)
    const existingSurface =
      existing?.tabs.find(
        (candidate): candidate is RuntimeMobileSessionTerminalTab =>
          candidate.type === 'terminal' &&
          candidate.parentTabId === parentTabId &&
          candidate.leafId === leafId
      ) ?? null
    const parentLayout = this.buildMaterializedHeadlessParentLayout(
      leafId,
      livePty.pty.ptyId,
      existingSurface?.parentLayout
    )
    const tab: RuntimeMobileSessionTerminalTab = {
      type: 'terminal',
      id: `${parentTabId}::${leafId}`,
      parentTabId,
      leafId,
      ptyId: livePty.pty.ptyId,
      title: terminal.title ?? livePty.pty.title ?? 'Terminal',
      ...(cwd ? { startupCwd: cwd } : {}),
      ...(opts.launchAgent ? { launchAgent: opts.launchAgent } : {}),
      ...(opts.viewMode ? { viewMode: opts.viewMode } : {}),
      parentLayout,
      isActive: activate
    }
    const tabs = (existing?.tabs ?? [])
      .filter((candidate) => candidate.id !== tab.id)
      .map((candidate) => ({
        ...candidate,
        ...(candidate.type === 'terminal' && candidate.parentTabId === parentTabId
          ? { parentLayout }
          : {}),
        isActive: activate ? false : candidate.isActive
      }))
    const insertAfter = afterTabId ? tabs.findIndex((candidate) => candidate.id === afterTabId) : -1
    if (insertAfter >= 0) {
      tabs.splice(insertAfter + 1, 0, tab)
    } else {
      tabs.push(tab)
    }
    const next: RuntimeMobileSessionTabsSnapshot = {
      worktree: worktreeId,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: (existing?.snapshotVersion ?? 0) + 1,
      // Why: activating the new tab also focuses its group, so a "+" targeting a specific split group makes that group active too.
      activeGroupId:
        activate && opts.targetGroupId
          ? opts.targetGroupId
          : (existing?.activeGroupId ?? this.getHeadlessMobileSessionGroupId(worktreeId)),
      activeTabId: activate ? tab.id : (existing?.activeTabId ?? null),
      activeTabType: activate ? 'terminal' : (existing?.activeTabType ?? null),
      tabGroups: this.buildHeadlessMobileSessionTabGroups(
        worktreeId,
        tabs,
        activate ? tab : null,
        existing?.tabGroups,
        opts.targetGroupId ? { tabId: parentTabId, groupId: opts.targetGroupId } : undefined
      ),
      // Why: keep group split geometry on new-tab creation, else opening a terminal while split loses the arrangement.
      ...(existing?.tabGroupLayout ? { tabGroupLayout: existing.tabGroupLayout } : {}),
      tabs
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, next)
    const result = this.toMobileSessionTabsResult(next)
    for (const subscription of this.mobileSessionTabListeners) {
      subscription.listener(
        this.clientSessionTabSelections.project(result, subscription.clientNavigationId)
      )
    }
    const created = result.tabs.find((candidate) => candidate.id === tab.id)
    if (!created || created.type !== 'terminal') {
      throw new Error('terminal_handle_stale')
    }
    return {
      tab: created,
      publicationEpoch: result.publicationEpoch,
      snapshotVersion: result.snapshotVersion
    }
  }
  protected waitForMobileTerminalSurface(
    worktreeId: string,
    parentTabId: string,
    options: { timeoutMs?: number; requireReady?: boolean; signal?: AbortSignal } = {}
  ): Promise<RuntimeMobileSessionCreateTerminalResult> {
    const timeoutMs = options.timeoutMs ?? MOBILE_TERMINAL_SURFACE_TIMEOUT_MS
    const existing = this.findMobileTerminalSurface(worktreeId, parentTabId, options)
    if (existing) {
      return Promise.resolve(existing)
    }
    if (options.signal?.aborted) {
      return Promise.reject(new Error('client_disconnected'))
    }

    return new Promise<RuntimeMobileSessionCreateTerminalResult>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        const idx = this.graphSyncCallbacks.indexOf(check)
        if (idx !== -1) {
          this.graphSyncCallbacks.splice(idx, 1)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('Timed out waiting for terminal surface after creation'))
      }, timeoutMs)
      // Why: a dead client connection cancels the wait immediately instead of running down the timeout into rollback (#7718).
      const onAbort = (): void => {
        cleanup()
        reject(new Error('client_disconnected'))
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })

      const check = (): void => {
        const next = this.findMobileTerminalSurface(worktreeId, parentTabId, options)
        if (!next) {
          return
        }
        cleanup()
        resolve(next)
      }
      this.graphSyncCallbacks.push(check)
      check()
    })
  }
  protected findMobileTerminalSurface(
    worktreeId: string,
    parentTabId: string,
    options: { requireReady?: boolean } = {}
  ): RuntimeMobileSessionCreateTerminalResult | null {
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (!snapshot) {
      return null
    }
    const result = this.toMobileSessionTabsResult(snapshot)
    const tab = result.tabs.find(
      (candidate) => candidate.type === 'terminal' && candidate.parentTabId === parentTabId
    )
    if (!tab || tab.type !== 'terminal') {
      return null
    }
    const surface = {
      tab,
      publicationEpoch: result.publicationEpoch,
      snapshotVersion: result.snapshotVersion
    }
    if (options.requireReady === true && !this.isReadyMobileTerminalSurface(surface)) {
      return null
    }
    return surface
  }
  protected findMobileTerminalSurfaceForPty(
    worktreeId: string,
    ptyId: string
  ): RuntimeMobileSessionCreateTerminalResult | null {
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    const tab = snapshot?.tabs.find(
      (candidate) =>
        candidate.type === 'terminal' &&
        (candidate.ptyId === ptyId ||
          candidate.parentLayout?.ptyIdsByLeafId?.[candidate.leafId] === ptyId)
    )
    return tab?.type === 'terminal'
      ? this.findMobileTerminalSurface(worktreeId, tab.parentTabId)
      : null
  }

  // Why: publish an in-flight mobile create main-side from the live PTY so it can't stall on graph sync and destroy the session (#7587).
  protected ensurePtyBackedMobileSurfaceForRendererTab(
    worktreeId: string,
    tabId: string
  ): RuntimeMobileSessionCreateTerminalResult | null {
    const pending = this.pendingMobileTerminalCreatesByKey.get(`${worktreeId}::${tabId}`)
    if (!pending) {
      return null
    }
    const existing = this.findMobileTerminalSurface(worktreeId, tabId)
    const pty = this.findLiveRegisteredPtyForRendererTab(worktreeId, tabId)
    if (pty) {
      pty.runtimeSessionOwned = true
    }
    if (
      existing &&
      this.isReadyMobileTerminalSurface(existing) &&
      (pending.viewMode === undefined || existing.tab.viewMode === pending.viewMode)
    ) {
      // Why: the renderer's ready publication already landed with the intended mode; only a pending shell needs the main-side rescue.
      return existing
    }
    const leafId = pty ? parsePaneKey(pty.paneKey ?? '')?.leafId : undefined
    if (!pty || !leafId) {
      return existing
    }
    this.publishPtyBackedMobileSessionTerminal(worktreeId, pty, {
      tabId,
      leafId,
      title: null,
      activate: pending.activate,
      selectIfNoActiveTab: pending.selectIfNoActiveTab,
      ...(pending.viewMode ? { viewMode: pending.viewMode } : {})
    })
    // Why: check closures normally drain only inside syncWindowGraph; a main-side publish must drain them too or the pending wait misses the insertion.
    for (const cb of [...this.graphSyncCallbacks]) {
      cb()
    }
    return this.findMobileTerminalSurface(worktreeId, tabId)
  }
  protected findLiveRegisteredPtyForRendererTab(
    worktreeId: string,
    tabId: string
  ): RuntimePtyWorktreeRecord | null {
    for (const pty of this.ptysById.values()) {
      if (
        pty.worktreeId === worktreeId &&
        pty.tabId === tabId &&
        pty.connected &&
        parsePaneKey(pty.paneKey ?? '')?.leafId
      ) {
        return pty
      }
    }
    return null
  }

  // Why: looser rollback guard than findLiveRegisteredPtyForRendererTab — a shell without a registered pane key is still a real terminal the timeout must not kill (#7718).
  protected hasLiveShellForRendererTab(worktreeId: string, tabId: string): boolean {
    for (const pty of this.ptysById.values()) {
      if (pty.worktreeId === worktreeId && pty.tabId === tabId && pty.connected) {
        return true
      }
    }
    return false
  }
  protected isReadyMobileTerminalSurface(
    surface: RuntimeMobileSessionCreateTerminalResult | null
  ): boolean {
    return (
      surface?.tab.status === 'ready' &&
      typeof surface.tab.terminal === 'string' &&
      surface.tab.terminal.length > 0
    )
  }
  protected waitForTerminalHandle(tabId: string, timeoutMs = 10_000): Promise<string> {
    const existing = this.resolveHandleForTab(tabId)
    if (existing) {
      return Promise.resolve(existing)
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.graphSyncCallbacks.indexOf(check)
        if (idx !== -1) {
          this.graphSyncCallbacks.splice(idx, 1)
        }
        reject(new Error('Timed out waiting for terminal handle after creation'))
      }, timeoutMs)

      const check = (): void => {
        const handle = this.resolveHandleForTab(tabId)
        if (handle) {
          clearTimeout(timer)
          const idx = this.graphSyncCallbacks.indexOf(check)
          if (idx !== -1) {
            this.graphSyncCallbacks.splice(idx, 1)
          }
          resolve(handle)
        }
      }
      this.graphSyncCallbacks.push(check)
      // Why: graph sync may have fired between the initial check and registration; re-check to avoid a missed wake-up.
      check()
    })
  }

  // Why: mobile may subscribe before the PTY spawns; wait for it so subscribe proceeds with phone-fit instead of a bare scrollback+end.
}
