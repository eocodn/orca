import { randomUUID, type RuntimeTerminalCreate, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, isTerminalLeafId, makePaneKey, isValidHostTerminalTabId, buildClaudeAgentTeamsLaunchPlan, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, ipcMain, getTerminalViewColorQueryReplyColors, copySleepingAgentLaunchConfig, inferCapturedClaudeAgentTeamsMode, mergeTerminalEnvDeletionKeys, type TerminalCreateOptions, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation } from './orca-runtime-symbols'
import { OrcaRuntimeCreateAgentSessionPart61 } from './orca-runtime-create-agent-session-part-61'

export class OrcaRuntimeCreateTerminalPart62 extends OrcaRuntimeCreateAgentSessionPart61 {
  async createTerminal(
    worktreeSelector?: string,
    opts: TerminalCreateOptions = {}
  ): Promise<RuntimeTerminalCreate> {
    const presentation = resolveTerminalPresentation(opts)
    const requiresRendererFocus = opts.presentation === 'focused' || opts.focus === true
    const availableAuthoritativeWindow = this.getAvailableAuthoritativeWindow()
    // Why: pre-diff createTerminal fell back to the renderer's active worktree
    // when no selector was provided. The new background-spawn branch hard-
    // requires a resolvable selector, so route the no-selector case through
    // the renderer IPC path to preserve that behavior.
    const rendererWindow = opts.rendererBacked === true ? availableAuthoritativeWindow : null
    const shouldCreateInBackground =
      worktreeSelector !== undefined &&
      (Boolean(opts.agentSessionClaim) ||
        (!requiresRendererFocus && opts.rendererBacked !== true) ||
        // Why: `orca serve` exposes the local runtime without a renderer
        // window. Renderer-backed Codex terminals are preferred for the app,
        // but headless CLI users still need a usable terminal handle.
        (opts.rendererBacked === true && rendererWindow === null))

    if (shouldCreateInBackground) {
      if (!this.ptyController?.spawn) {
        throw new Error('runtime_unavailable')
      }
      const workspace = await this.resolveTerminalWorkspaceLaunchScope(worktreeSelector)
      const launchOpts = await this.resolveAgentTerminalCreateOptions(workspace, opts)
      let ptySpawnCommitReported = false
      const reportPtySpawnCommitted = (): void => {
        if (ptySpawnCommitReported) {
          return
        }
        ptySpawnCommitReported = true
        launchOpts.onPtySpawnCommitted?.()
      }
      const cwd =
        this.resolveWorkspaceTerminalStartupCwd(workspace, launchOpts.cwd) ?? workspace.path
      let preAllocatedHandle =
        launchOpts.preAllocatedHandle ?? this.createPreAllocatedTerminalHandle()
      // Why: mint tabId in main before spawn so paneKey is known at PTY env
      // build time. Hook-based agent status (Claude/Codex/Cursor/Gemini) keys
      // off `${tabId}:${leafId}` — without these vars set on the PTY, the
      // hook payload arrives with an empty paneKey and the renderer cannot
      // attribute the event. Use a stable UUID leaf because hooks reject the
      // legacy numeric pane keys after the pane-id migration.
      const hintedTabId = launchOpts.tabId?.trim()
      const canAdoptPaneIdentity =
        hintedTabId !== undefined &&
        isValidHostTerminalTabId(hintedTabId) &&
        launchOpts.leafId !== undefined &&
        isTerminalLeafId(launchOpts.leafId)
      let tabId = canAdoptPaneIdentity ? (hintedTabId as string) : randomUUID()
      let leafId = canAdoptPaneIdentity ? (launchOpts.leafId as string) : randomUUID()
      let paneKey = makePaneKey(tabId, leafId)
      const launchToken = launchOpts.launchConfig
        ? (launchOpts.launchToken ?? randomUUID())
        : undefined
      const baseEnv = {
        ...launchOpts.env,
        ...(launchToken ? { ORCA_AGENT_LAUNCH_TOKEN: launchToken } : {})
      }
      const claudeAgentTeamsSourceCommand =
        launchOpts.claudeAgentTeamsSourceCommand?.trim() || launchOpts.command?.trim() || undefined
      const claudeAgentTeamsMode = this.store?.getSettings?.().claudeAgentTeamsMode
      const effectiveClaudeAgentTeamsMode = inferCapturedClaudeAgentTeamsMode(
        launchOpts.launchConfig,
        claudeAgentTeamsSourceCommand,
        claudeAgentTeamsMode
      )
      const agentTeamsPlan = await buildClaudeAgentTeamsLaunchPlan({
        command: claudeAgentTeamsSourceCommand,
        mode: effectiveClaudeAgentTeamsMode,
        baseEnv: {
          ...process.env,
          ...baseEnv
        },
        createTeamEnv: (shimDir, shimBin) =>
          this.claudeAgentTeams.createLaunchEnv({
            leaderHandle: preAllocatedHandle,
            baseEnv: {
              ...process.env,
              ...baseEnv
            },
            shimDir,
            shimBin
          }).env
      })
      const sequencedStartupCommand =
        agentTeamsPlan &&
        claudeAgentTeamsSourceCommand &&
        launchOpts.command &&
        claudeAgentTeamsSourceCommand !== launchOpts.command
          ? agentTeamsPlan.command
          : undefined
      const effectiveLaunchConfig =
        launchOpts.launchConfig && agentTeamsPlan
          ? {
              ...launchOpts.launchConfig,
              agentCommand: launchOpts.launchConfig.agentCommand
                ? effectiveClaudeAgentTeamsMode === 'in-process' || process.platform === 'win32'
                  ? addClaudeTeammateModeInProcess(launchOpts.launchConfig.agentCommand)
                  : addClaudeTeammateModeAuto(launchOpts.launchConfig.agentCommand)
                : agentTeamsPlan.command,
              agentEnv: {
                ...launchOpts.launchConfig.agentEnv,
                ...agentTeamsPlan.env
              }
            }
          : launchOpts.launchConfig
      // Why: setup/agent sequencing wraps the PTY launch in a wait shell before
      // Claude Agent Teams runs. Preserve the direct Claude command separately
      // so the wrapper can exec the teammate-mode variant after setup completes.
      const env = this.buildTerminalWorkspaceEnv(
        workspace,
        {
          ...baseEnv,
          ...(sequencedStartupCommand
            ? { [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: sequencedStartupCommand }
            : {})
        },
        paneKey,
        tabId,
        agentTeamsPlan?.env
      )
      const terminalColorQueryReplies =
        launchOpts.terminalColorQueryReplies ?? getTerminalViewColorQueryReplyColors()
      if (launchOpts.signal?.aborted) {
        throw new Error('client_disconnected')
      }
      const result = await this.ptyController.spawn({
        cols: 120,
        rows: 40,
        cwd,
        command: sequencedStartupCommand
          ? launchOpts.command
          : (agentTeamsPlan?.command ?? launchOpts.command),
        launchAgent: launchOpts.launchAgent,
        commandDelivery: 'provider',
        startupCommandDelivery: launchOpts.startupCommandDelivery,
        env,
        envToDelete: mergeTerminalEnvDeletionKeys(
          launchOpts.envToDelete,
          agentTeamsPlan?.envToDelete
        ),
        resumeProviderSession: launchOpts.resumeProviderSession,
        telemetry: launchOpts.telemetry,
        connectionId: workspace.connectionId,
        worktreeId: workspace.id,
        preAllocatedHandle,
        tabId,
        leafId,
        ...(terminalColorQueryReplies ? { terminalColorQueryReplies } : {}),
        ...(launchOpts.agentSessionClaim
          ? {
              agentSessionEnsure: {
                claim: launchOpts.agentSessionClaim,
                surface: {
                  worktreeId: workspace.id,
                  tabId,
                  leafId,
                  terminalHandle: preAllocatedHandle
                }
              }
            }
          : {}),
        ...(launchOpts.agentSessionCreateOperationId
          ? { agentSessionCreateOperationId: launchOpts.agentSessionCreateOperationId }
          : {}),
        ...(launchOpts.signal ? { signal: launchOpts.signal } : {}),
        ...(launchOpts.onPtySpawnCommitted ? { onPtySpawnCommitted: reportPtySpawnCommitted } : {}),
        ...(launchOpts.sessionId ? { sessionId: launchOpts.sessionId } : {}),
        // Why: a headless-created pane has no renderer session writer. Persist
        // its tab/leaf binding at spawn so a later promoted window reattaches
        // the live daemon or SSH PTY instead of replacing it with a fresh one.
        // Re-check freshly: the entry-time snapshot can go stale across the
        // awaits above if the authoritative window is destroyed mid-spawn.
        ...(launchOpts.persistHostSessionBinding || this.getAvailableAuthoritativeWindow() === null
          ? { persistHostSessionBinding: true }
          : {})
      })
      reportPtySpawnCommitted()
      if (result.agentSessionEnsure) {
        const canonicalSurface = result.agentSessionEnsure.owner.surface
        preAllocatedHandle = canonicalSurface.terminalHandle
        tabId = canonicalSurface.tabId
        leafId = canonicalSurface.leafId
        paneKey = makePaneKey(tabId, leafId)
      }
      try {
        this.assertPtyDidNotExitBeforeRegistration(result.id, result.incarnationId)
      } catch (error) {
        if (error instanceof Error && error.message === 'agent_session_exited_during_start') {
          this.releaseRejectedPtyRegistrationFence(result.id, result.incarnationId)
        }
        throw error
      }
      this.registerPreAllocatedHandleForPty(result.id, preAllocatedHandle)
      if (result.wslDistro) {
        this.preparePtyExecutionContext(result.id, result.wslDistro)
      }
      const registeredIncarnation = this.registerPty(
        result.id,
        workspace.id,
        workspace.connectionId,
        {
          tabId,
          leafId,
          ...(result.incarnationId ? { incarnationId: result.incarnationId } : {})
        }
      )
      result.incarnationId ??= registeredIncarnation ?? undefined
      const pty = this.getOrCreatePtyWorktreeRecord(result.id)
      if (pty) {
        if (launchOpts.persistHostSessionBinding) {
          pty.runtimeSessionOwned = true
        }
        if (launchOpts.title) {
          const observedAt = this.nextTitleObservationSequence()
          pty.title = launchOpts.title
          pty.titleUpdatedAt = observedAt
          this.setPtyManagementTitleFromObservedTitle(pty, launchOpts.title, observedAt)
        } else {
          pty.title = null
          pty.titleUpdatedAt = null
        }
        pty.tabId = tabId
        pty.paneKey = paneKey
        pty.launchConfig = effectiveLaunchConfig
          ? copySleepingAgentLaunchConfig(effectiveLaunchConfig)
          : null
        pty.launchToken = launchToken ?? null
        pty.launchAgent = launchOpts.launchAgent ?? null
      }
      const handle = pty ? this.issuePtyHandle(pty) : preAllocatedHandle
      if (pty && launchOpts.deferMobileSessionPublish !== true) {
        this.publishPtyBackedMobileSessionTerminal(workspace.id, pty, {
          tabId,
          leafId,
          title: launchOpts.title ?? null,
          activate: presentation === 'focused',
          // Why: explicit background presentation may carry legacy activate
          // metadata from an already-owned renderer pane; don't select it on mobile.
          selectIfNoActiveTab: presentation !== 'background',
          ...(launchOpts.viewMode ? { viewMode: launchOpts.viewMode } : {}),
          ...(cwd !== workspace.path ? { startupCwd: cwd } : {})
        })
      }
      let surface: RuntimeTerminalCreate['surface'] = 'background'
      let warning: string | undefined
      if (presentation !== 'background' && this.notifier?.revealTerminalSession) {
        try {
          // Why: after the PTY is spawned, renderer tab adoption is best-effort;
          // failing here must not strand a live process without returning a handle.
          // Pass the pre-minted tabId so the renderer adopts under the same id
          // already baked into the PTY env — keeps paneKey hook attribution intact.
          await this.notifier.revealTerminalSession(workspace.id, {
            ptyId: result.id,
            title: launchOpts.title ?? null,
            ...(cwd !== workspace.path ? { cwd } : {}),
            ...(effectiveLaunchConfig ? { launchConfig: effectiveLaunchConfig } : {}),
            ...(launchToken ? { launchToken } : {}),
            ...(launchOpts.launchAgent ? { launchAgent: launchOpts.launchAgent } : {}),
            ...(launchOpts.viewMode ? { viewMode: launchOpts.viewMode } : {}),
            activate: presentation === 'focused',
            ...(presentation ? { presentation } : {}),
            ...ownerSurfacing(opts.surfaceOwner !== false),
            tabId,
            leafId
          })
          surface = 'visible'
        } catch (err) {
          console.warn(`[terminal-create] failed to create inactive tab for ${result.id}:`, err)
          warning = createTerminalRevealWarning(handle, err)
        }
      } else if (presentation !== 'background') {
        warning = createTerminalRevealWarning(handle)
      }
      return {
        handle,
        tabId,
        paneKey,
        ptyId: result.id,
        worktreeId: workspace.id,
        title: launchOpts.title ?? null,
        ...this.getPtyExecutionHostMetadata(result.id),
        surface,
        ...(result.agentSessionEnsure
          ? { agentSessionDisposition: result.agentSessionEnsure.disposition }
          : {}),
        ...(warning ? { warning } : {})
      }
    }

    this.assertGraphReady()
    const win = rendererWindow ?? this.getAuthoritativeWindow()
    // Why: mirrors browserTabCreate — when no worktree is specified, pass
    // undefined so the renderer uses its current active worktree.
    const workspace = worktreeSelector
      ? await this.resolveTerminalWorkspaceLaunchScope(worktreeSelector)
      : null
    const launchOpts = workspace
      ? await this.resolveAgentTerminalCreateOptions(workspace, opts)
      : opts
    const worktreeId = workspace?.id
    const cwd = workspace
      ? this.resolveWorkspaceTerminalStartupCwd(workspace, launchOpts.cwd)
      : launchOpts.cwd
    const requestId = randomUUID()

    // Why: terminal creation is a renderer-side Zustand store operation (like
    // browser tab creation). The main process sends a request, the renderer
    // creates the tab and replies with the tabId so we can resolve the handle.
    const reply = await new Promise<{ tabId: string; title: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('terminal:tabCreateReply', handler)
        reject(new Error('Terminal creation timed out'))
      }, 10_000)

      const handler = (
        event: Electron.IpcMainEvent,
        r: { requestId: string; tabId?: string; title?: string; error?: string }
      ): void => {
        if (event.sender !== win.webContents || r.requestId !== requestId) {
          return
        }
        clearTimeout(timer)
        ipcMain.removeListener('terminal:tabCreateReply', handler)
        if (r.error) {
          reject(new Error(r.error))
        } else {
          resolve({ tabId: r.tabId!, title: r.title ?? launchOpts.title ?? '' })
        }
      }
      ipcMain.on('terminal:tabCreateReply', handler)
      win.webContents.send('terminal:requestTabCreate', {
        requestId,
        worktreeId,
        command: launchOpts.command,
        cwd,
        ...(launchOpts.env ? { env: launchOpts.env } : {}),
        ...(launchOpts.launchConfig ? { launchConfig: launchOpts.launchConfig } : {}),
        ...(launchOpts.resumeProviderSession
          ? { resumeProviderSession: launchOpts.resumeProviderSession }
          : {}),
        ...(launchOpts.launchToken ? { launchToken: launchOpts.launchToken } : {}),
        ...(launchOpts.launchAgent ? { launchAgent: launchOpts.launchAgent } : {}),
        ...(launchOpts.viewMode ? { viewMode: launchOpts.viewMode } : {}),
        startupCommandDelivery: launchOpts.startupCommandDelivery,
        title: launchOpts.title,
        activate: presentation === 'focused',
        ...(presentation ? { presentation } : {}),
        ...ownerSurfacing(opts.surfaceOwner !== false)
      })
    })

    // Why: the renderer created the tab immediately, but the graph sync that
    // populates this.leaves may not have arrived yet. Wait for the leaf to
    // appear so we can return a valid handle the caller can use right away.
    const handle = await this.waitForTerminalHandle(reply.tabId)
    return {
      handle,
      tabId: reply.tabId,
      worktreeId: worktreeId ?? '',
      title: reply.title,
      ...this.getPtyExecutionHostMetadata(this.handles.get(handle)?.ptyId ?? null),
      surface: 'visible'
    }
  }
}
