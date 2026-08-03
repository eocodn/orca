import { randomUUID, type WorktreeStartupLaunch, type TuiAgent, type SleepingAgentLaunchConfig, type RuntimeMobileSessionCreateTerminalResult, buildAgentStartupPlan, repoIsRemote, isTuiAgentEnabled, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, ipcMain, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, isClientDisconnectedError, type TerminalWorkspaceLaunchScope } from './orca-runtime-symbols'
import { OrcaRuntimeDedupeTerminalCreatePart63 } from './orca-runtime-dedupe-terminal-create-part-63'

export class OrcaRuntimeRunCreateMobileSessionTerminalPart64 extends OrcaRuntimeDedupeTerminalCreatePart63 {
  protected async runCreateMobileSessionTerminal(
    worktreeSelector: string,
    opts: {
      afterTabId?: string
      targetGroupId?: string
      command?: string
      cwd?: string
      env?: Record<string, string>
      envToDelete?: string[]
      startupCommandDelivery?: WorktreeStartupLaunch['startupCommandDelivery']
      agent?: TuiAgent
      agentPrompt?: string
      launchConfig?: SleepingAgentLaunchConfig
      launchAgent?: TuiAgent
      viewMode?: 'terminal' | 'chat'
      activate?: boolean
      clientMutationId?: string
      signal?: AbortSignal
    } = {}
  ): Promise<RuntimeMobileSessionCreateTerminalResult> {
    this.assertGraphReady()
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(worktreeSelector)
    const worktreeId = workspace.id
    const cwd = this.resolveWorkspaceTerminalStartupCwd(workspace, opts.cwd)
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId)
    let afterDesktopTabId: string | undefined
    if (opts.afterTabId) {
      const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
      const anchor = snapshot?.tabs.find((tab) => tab.id === opts.afterTabId)
      if (!anchor) {
        throw new Error('after_tab_not_found')
      }
      afterDesktopTabId = anchor.type === 'terminal' ? anchor.parentTabId : anchor.id
    }
    const startupCommand = await this.resolveMobileSessionTerminalCommand(workspace, opts)

    const win = this.getAvailableAuthoritativeWindow()
    if (!win) {
      return await this.createHeadlessMobileSessionTerminal(
        worktreeId,
        opts.activate !== false,
        opts.afterTabId,
        {
          command: startupCommand.command,
          cwd,
          env: startupCommand.env,
          envToDelete: startupCommand.envToDelete,
          startupCommandDelivery: startupCommand.startupCommandDelivery,
          launchAgent: startupCommand.launchAgent,
          viewMode: opts.viewMode,
          targetGroupId: opts.targetGroupId,
          launchConfig: startupCommand.launchConfig
        }
      )
    }
    const requestId = randomUUID()
    const reply = await new Promise<{ tabId: string; title: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('terminal:tabCreateReply', handler)
        opts.signal?.removeEventListener('abort', onAbort)
        reject(new Error('Terminal creation timed out'))
      }, 10_000)
      // Why: a dead client connection cancels the wait; the renderer tab (and
      // its shell) stays alive for the host and mirrors on reconnect (#7718).
      const onAbort = (): void => {
        clearTimeout(timer)
        ipcMain.removeListener('terminal:tabCreateReply', handler)
        reject(new Error('client_disconnected'))
      }

      const handler = (
        event: Electron.IpcMainEvent,
        r: { requestId: string; tabId?: string; title?: string; error?: string }
      ): void => {
        if (event.sender !== win.webContents || r.requestId !== requestId) {
          return
        }
        clearTimeout(timer)
        ipcMain.removeListener('terminal:tabCreateReply', handler)
        opts.signal?.removeEventListener('abort', onAbort)
        if (r.error) {
          reject(new Error(r.error))
        } else {
          resolve({ tabId: r.tabId!, title: r.title ?? '' })
        }
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      ipcMain.on('terminal:tabCreateReply', handler)
      win.webContents.send('terminal:requestTabCreate', {
        requestId,
        worktreeId,
        afterTabId: afterDesktopTabId,
        targetGroupId: opts.targetGroupId,
        command: startupCommand.command,
        cwd,
        ...(startupCommand.env ? { env: startupCommand.env } : {}),
        ...(startupCommand.envToDelete ? { envToDelete: startupCommand.envToDelete } : {}),
        ...(startupCommand.launchConfig ? { launchConfig: startupCommand.launchConfig } : {}),
        ...(startupCommand.launchAgent ? { launchAgent: startupCommand.launchAgent } : {}),
        ...(opts.viewMode ? { viewMode: opts.viewMode } : {}),
        startupCommandDelivery: startupCommand.startupCommandDelivery,
        source: 'runtime-session',
        activate: opts.activate
      })
    })

    if (opts.activate !== false) {
      this.notifier?.focusTerminal(reply.tabId, worktreeId, null)
    }
    // Why: register the wait before the renderer's PTY spawn arrives so that
    // spawn (registerPty) can publish the pty-backed surface main-side even if
    // graph-sync is stalled (#7587). Removed in the finally below.
    const pendingCreateKey = `${worktreeId}::${reply.tabId}`
    // Why: a rescue publishes into the active group (opts.targetGroupId is not
    // threaded); the renderer's reconciling publication then moves the tab to the
    // requested group, so any wrong-group placement is cosmetic and stall-window-only.
    this.pendingMobileTerminalCreatesByKey.set(pendingCreateKey, {
      activate: opts.activate !== false,
      selectIfNoActiveTab: true,
      ...(opts.viewMode ? { viewMode: opts.viewMode } : {})
    })
    try {
      // Why: the PTY spawn and the tabCreate reply race on independent IPC
      // channels; if the spawn already registered, publish immediately so the
      // wait resolves without depending on a graph sync.
      this.ensurePtyBackedMobileSurfaceForRendererTab(worktreeId, reply.tabId)
      const surface = await this.waitForMobileTerminalSurface(worktreeId, reply.tabId, {
        timeoutMs: MOBILE_TERMINAL_SURFACE_TIMEOUT_MS,
        signal: opts.signal
      })
      if (this.isReadyMobileTerminalSurface(surface)) {
        return surface
      }
      const readySurface = await this.waitForMobileTerminalSurface(worktreeId, reply.tabId, {
        timeoutMs: MOBILE_TERMINAL_READY_FALLBACK_MS,
        requireReady: true,
        signal: opts.signal
      }).catch(() => null)
      if (readySurface) {
        return readySurface
      }
      if (opts.signal?.aborted) {
        // Why: nobody awaits this create anymore; don't materialize or roll back — the renderer's own publication settles the tab.
        throw new Error('client_disconnected')
      }
      const pendingSurface = this.findMobileTerminalSurface(worktreeId, reply.tabId)
      if (!pendingSurface) {
        throw new Error('Timed out waiting for terminal surface after creation')
      }
      // Why: a hidden renderer can publish the tab shell before the PTY spawns; reuse the same identity so later focus adopts instead of creating another tab.
      return await this.createHeadlessMobileSessionTerminal(
        worktreeId,
        opts.activate !== false,
        opts.afterTabId,
        {
          command: startupCommand.command,
          cwd,
          env: startupCommand.env,
          envToDelete: startupCommand.envToDelete,
          startupCommandDelivery: startupCommand.startupCommandDelivery,
          identity: { tabId: pendingSurface.tab.parentTabId, leafId: pendingSurface.tab.leafId },
          launchAgent: startupCommand.launchAgent,
          viewMode: opts.viewMode,
          targetGroupId: opts.targetGroupId,
          launchConfig: startupCommand.launchConfig
        }
      )
    } catch (error) {
      // Why: publication latency (hidden renderer) can trip the surface timeout; rescue only when a live PTY backs the tab, else a ghost tab skips rollback (#7587).
      if (this.findLiveRegisteredPtyForRendererTab(worktreeId, reply.tabId)) {
        const rescued = this.ensurePtyBackedMobileSurfaceForRendererTab(worktreeId, reply.tabId)
        if (rescued) {
          return rescued
        }
      }
      // Why: don't roll back on a client disconnect or a live shell already backing the tab — that would kill a visible terminal ("tab dies after ~10s", #7718).
      if (
        isClientDisconnectedError(error) ||
        this.hasLiveShellForRendererTab(worktreeId, reply.tabId)
      ) {
        throw error
      }
      // Why: renderer made the tab but no live PTY backs it (real spawn/handle failure); roll it back so it can't linger as a ghost in mobile snapshots.
      this.notifier?.closeTerminal(reply.tabId)
      throw error
    } finally {
      this.pendingMobileTerminalCreatesByKey.delete(pendingCreateKey)
    }
  }
  protected async resolveMobileSessionTerminalCommand(
    workspace: TerminalWorkspaceLaunchScope,
    opts: {
      command?: string
      env?: Record<string, string>
      envToDelete?: string[]
      startupCommandDelivery?: WorktreeStartupLaunch['startupCommandDelivery']
      agent?: TuiAgent
      agentPrompt?: string
      launchConfig?: SleepingAgentLaunchConfig
      launchAgent?: TuiAgent
    }
  ): Promise<{
    command?: string
    env?: Record<string, string>
    envToDelete?: string[]
    startupCommandDelivery?: WorktreeStartupLaunch['startupCommandDelivery']
    launchConfig?: SleepingAgentLaunchConfig
    launchAgent?: TuiAgent
  }> {
    if (opts.command || !opts.agent) {
      return {
        command: opts.command,
        env: opts.env,
        envToDelete: opts.envToDelete,
        launchConfig: opts.launchConfig,
        launchAgent: opts.launchAgent,
        startupCommandDelivery: opts.startupCommandDelivery
      }
    }
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const settings = this.store.getSettings()
    if (!isTuiAgentEnabled(opts.agent, settings.disabledTuiAgents)) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    // Why: mobile may be iOS while the shell host is Windows/macOS/Linux or SSH Linux; quote for the host shell.
    const platform = this.getAgentLaunchPlatformForWorkspace(workspace)
    // Why: SSH runs the CLI through the relay shim (plain `orca`), so the Linux-only `orca-ide` rename must not apply.
    const isRemote = workspace.repo ? repoIsRemote(workspace.repo) : repoIsRemote(workspace)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const startupPlan = buildAgentStartupPlan({
      agent: opts.agent,
      prompt: opts.agentPrompt ?? '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(opts.agent, settings.agentDefaultArgs),

      agentEnv: resolveTuiAgentLaunchEnv(opts.agent, settings.agentDefaultEnv),
      platform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      throw new Error(`Could not build launch command for ${opts.agent}.`)
    }
    if (opts.agentPrompt && startupPlan.followupPrompt) {
      throw new Error(`Agent ${opts.agent} does not support startup prompt quick commands.`)
    }
    if (workspace.connectionId) {
      await this.markRemoteWorkspaceTrustedForAgent(
        opts.agent,
        workspace.connectionId,
        workspace.path
      )
    } else {
      this.markLocalWorkspaceTrustedForAgent(opts.agent, workspace.path)
    }
    return {
      command: startupPlan.launchCommand,
      env: startupPlan.env,
      // Why: a real-home Codex resume strips inherited CODEX_HOME via
      // envToDelete; dropping it here would resume against the wrong home.
      envToDelete: opts.envToDelete,
      launchConfig: startupPlan.launchConfig,
      launchAgent: opts.agent,
      startupCommandDelivery: startupPlan.startupCommandDelivery
    }
  }
}
