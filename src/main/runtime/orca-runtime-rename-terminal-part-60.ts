import { type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, canonicalizeAgentSessionIdentity, type TuiAgent, type RuntimeTerminalRename, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isTuiAgentEnabled, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, parseWslUncPath, resolveBareAgentLaunchCommand, type TerminalCreateOptions, type TerminalWorkspaceLaunchScope } from './orca-runtime-symbols'
import { OrcaRuntimeRemoveManagedWorktreePart59 } from './orca-runtime-remove-managed-worktree-part-59'

export class OrcaRuntimeRenameTerminalPart60 extends OrcaRuntimeRemoveManagedWorktreePart59 {
  async renameTerminal(handle: string, title: string | null): Promise<RuntimeTerminalRename> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      pty.pty.title = title
      // Why: a manual rename must outrank later agent OSC title updates (which
      // win by timestamp), so stamp it as the freshest title.
      pty.pty.titleUpdatedAt = Date.now()
      this.touchMobileSessionSnapshotsForPty(pty.pty.ptyId)
      // Why: without a renderer the rename only lived on the live pty and was
      // lost on restart. Persist customTitle so a headless rebuild keeps it.
      if (!this.notifier?.renameTerminal && pty.pty.tabId) {
        this.persistHeadlessTerminalTitle(pty.pty.worktreeId, pty.pty.tabId, title)
      }
      for (const leaf of this.leaves.values()) {
        if (leaf.ptyId === pty.pty.ptyId) {
          this.notifier?.renameTerminal(leaf.tabId, title)
          return { handle, tabId: leaf.tabId, title }
        }
      }
      return { handle, tabId: pty.pty.tabId ?? pty.record.tabId, title }
    }
    this.assertGraphReady()
    const { leaf } = this.getLiveLeafForHandle(handle)
    this.notifier?.renameTerminal(leaf.tabId, title)
    return { handle, tabId: leaf.tabId, title }
  }
  protected async resolveAgentTerminalCreateOptions(
    workspace: TerminalWorkspaceLaunchScope,
    opts: TerminalCreateOptions
  ): Promise<TerminalCreateOptions> {
    // Why: raw shell commands like `codex exec` must remain user-authored shell.
    // Only unmanaged, repo-backed, bare agent launches get Settings defaults.
    if (
      !opts.command ||
      opts.env ||
      opts.launchConfig ||
      opts.launchAgent ||
      opts.startupCommandDelivery ||
      opts.claudeAgentTeamsSourceCommand ||
      !workspace.repo ||
      !this.store
    ) {
      return opts
    }

    const settings = this.store.getSettings()
    const platform = this.getAgentLaunchPlatformForWorkspace(workspace)
    const isRemote = repoIsRemote(workspace.repo)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const agent = resolveBareAgentLaunchCommand({
      command: opts.command,
      settings,
      platform,
      isRemote
    })
    if (!agent) {
      return opts
    }

    const startupPlan = buildAgentStartupPlan({
      agent,
      prompt: '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      return opts
    }

    if (workspace.connectionId) {
      await this.markRemoteWorkspaceTrustedForAgent(agent, workspace.connectionId, workspace.path)
    } else {
      this.markLocalWorkspaceTrustedForAgent(agent, workspace.path)
    }

    return {
      ...opts,
      command: startupPlan.launchCommand,
      ...(startupPlan.env ? { env: startupPlan.env } : {}),
      launchConfig: startupPlan.launchConfig,
      launchAgent: agent,
      startupCommandDelivery: startupPlan.startupCommandDelivery
    }
  }
  protected getAgentSessionExecutionNamespace(
    workspace: TerminalWorkspaceLaunchScope,
    agent: TuiAgent
  ): { machine: string; principal: string; container: string; providerRoot: string } | null {
    if (workspace.connectionId) {
      // Why: SSH target ids are not execution-namespace proof. Preserve the
      // legacy launch until an attested route can safely participate in claims.
      return null
    }
    const wsl = parseWslUncPath(workspace.path)
    const principal =
      typeof process.getuid === 'function'
        ? `uid:${process.getuid()}`
        : `user:${process.env.USERNAME ?? ''}`
    return {
      machine: wsl ? 'wsl-host' : `native:${process.platform}`,
      principal,
      container: wsl ? `wsl:${wsl.distro.toLocaleLowerCase('en-US')}` : 'native',
      // Why: merging account roots is conservative (it may conflict) and can
      // never permit two TUIs to own one provider session.
      providerRoot: `profile-default:${agent}`
    }
  }
  protected async executionOwnerSupportsAgentSessionOperation(
    workspace: TerminalWorkspaceLaunchScope,
    operation: 'resume' | 'create',
    signal?: AbortSignal
  ): Promise<boolean> {
    const provider = workspace.connectionId
      ? this.getSshProviderFn?.(workspace.connectionId)
      : this.getLocalProvider()
    if (!provider) {
      // An unavailable route is not proof of an old owner; preserve the structured failure.
      return true
    }
    const probe =
      operation === 'resume'
        ? provider.supportsAgentSessionClaims
        : provider.supportsAgentSessionCreateOperations
    if (!probe) {
      // Local in-process PTYs need no wire negotiation; unknown SSH providers are legacy.
      return workspace.connectionId === null
    }
    try {
      return (await probe.call(provider, { signal })) === true
    } catch {
      // Why: this read-only check has not launched anything, so the old route remains safe.
      return false
    }
  }
  protected toAgentSessionOptions(
    preferences: AgentLaunchPreferences | undefined
  ): Record<string, string> | undefined {
    if (!preferences) {
      return undefined
    }
    const options = {
      ...(preferences.model ? { model: preferences.model } : {}),
      ...(preferences.effort ? { effort: preferences.effort } : {}),
      ...(preferences.mode ? { mode: preferences.mode } : {})
    }
    return Object.keys(options).length > 0 ? options : undefined
  }
  async ensureAgentSession(
    request: RuntimeEnsureAgentSessionRequest,
    _caller: RuntimeAgentSessionRpcCaller = {}
  ): Promise<RuntimeEnsureAgentSessionResult> {
    if (request.kind === 'automatic') {
      // Legacy renderer sleep records are migration evidence, not host authority.
      throw new Error('agent_session_resume_not_authorized')
    }
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(request.worktree)
    const namespace = this.getAgentSessionExecutionNamespace(workspace, request.agent)
    if (
      !namespace ||
      !(await this.executionOwnerSupportsAgentSessionOperation(workspace, 'resume', _caller.signal))
    ) {
      // Why: the renderer still holds the exact old request and may retry it before any side effect.
      throw new Error('agent_session_legacy_required')
    }
    // Why: nested SSH paths belong to the execution owner, so compatibility selection must happen before local filesystem canonicalization.
    const identity = canonicalizeAgentSessionIdentity(request.agent, request.providerSession)
    const claim = this.agentSessionClaimSigner.createClaim({
      namespace,
      identity,
      canonicalWorktreeId: workspace.id
    })
    const settings = this.store.getSettings()
    if (!isTuiAgentEnabled(request.agent, settings.disabledTuiAgents)) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before resuming.')
    }
    const platform = this.getAgentLaunchPlatformForWorkspace(workspace)
    const isRemote = workspace.repo ? repoIsRemote(workspace.repo) : Boolean(workspace.connectionId)
    const shell = resolveLocalWindowsAgentStartupShell({
      platform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const startup = buildAgentResumeStartupPlan({
      agent: request.agent,
      providerSession: identity.providerSession,
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs:
        request.agentArgs !== undefined
          ? request.agentArgs
          : resolveTuiAgentLaunchArgs(request.agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(request.agent, settings.agentDefaultEnv),
      ompResumeFilePath: request.ompResumeFilePath,
      sessionOptions: this.toAgentSessionOptions(request.launchPreferences),
      platform,
      shell,
      isRemote
    })
    if (!startup) {
      throw new Error('agent_session_identity_required')
    }
    if (workspace.connectionId) {
      await this.markRemoteWorkspaceTrustedForAgent(
        request.agent,
        workspace.connectionId,
        workspace.path
      )
    } else {
      this.markLocalWorkspaceTrustedForAgent(request.agent, workspace.path)
    }
    if (_caller.signal?.aborted) {
      throw new Error('client_disconnected')
    }
    const terminal = await this.createTerminal(`id:${workspace.id}`, {
      command: startup.launchCommand,
      env: startup.env,
      launchConfig: startup.launchConfig,
      launchAgent: request.agent,
      presentation: request.presentation ?? 'background',
      tabId: request.placement?.tabId,
      leafId: request.placement?.leafId,
      persistHostSessionBinding: true,
      agentSessionClaim: claim,
      signal: _caller.signal
    })
    return {
      terminal,
      disposition: terminal.agentSessionDisposition ?? 'created'
    }
  }
}
