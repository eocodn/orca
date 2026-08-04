import {
  type Repo,
  type Worktree,
  type WorktreeLineage,
  type WorkspaceLineage,
  type WorktreeLineageWarning,
  type WorktreeStartupLaunch,
  type TuiAgent,
  getRepoExecutionHostId,
  navigationTargetsClients,
  navigationTargetsHost,
  type RuntimeNavigationTarget,
  buildAgentDraftLaunchPlan,
  buildAgentStartupPlan,
  repoIsRemote,
  isTuiAgentEnabled,
  pickTuiAgent,
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv,
  resolveLocalWindowsAgentStartupShell,
  isTuiAgent,
  TUI_AGENT_CONFIG,
  detectInstalledAgentsWithShellPathHydration,
  detectRemoteAgents,
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted,
  markRemoteAgentWorkspaceTrusted,
  worktreeWorkspaceKey,
  type WorktreeStartupDraftPaste,
  type WorktreeStartupFollowup,
  type WorktreeLineageResolution,
  type WorkspaceSessionState
} from './orca-runtime-symbols'
import { OrcaRuntimeGetGitLabRepoWorkItemByPathPart50 } from './orca-runtime-get-git-lab-repo-work-item-by-path-part-50'

export class OrcaRuntimeActivateManagedWorktreePart51 extends OrcaRuntimeGetGitLabRepoWorkItemByPathPart50 {
  async activateManagedWorktree(
    worktreeSelector: string,
    opts: {
      notifyClients?: boolean
      clientKind?: 'mobile' | 'runtime'
      navigation?: RuntimeNavigationTarget
    } = {}
  ): Promise<{
    repoId: string
    worktreeId: string
    activated: boolean
    /** Mobile-scoped slept-agent wake outcome. `unsupported-headless` means no
     *  renderer holds the sleeping records (headless `orca serve`), so nothing
     *  woke — clients must not present the worktree's agents as resumed. */
    sleepingAgentWake: 'requested' | 'unsupported-headless' | 'not-applicable'
  }> {
    this.assertGraphReady()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = this.store?.getRepo(worktree.repoId)
    if (!repo) {
      throw new Error('repo_not_found')
    }
    const navigation = opts.navigation ?? (opts.notifyClients === false ? 'caller' : 'all')
    const targetsHost = navigationTargetsHost(navigation)
    const targetsClients = navigationTargetsClients(navigation)

    if (!targetsHost && this.store?.getWorktreeMeta(worktree.id)?.isUnread) {
      // Why: mobile/web session activation intentionally bypasses renderer
      // selection, so the runtime must acknowledge the unread state itself.
      this.store.setWorktreeMeta(worktree.id, { isUnread: false })
      this.notifyWorktreesChanged(repo.id)
    }

    let sleepingAgentWake: 'requested' | 'unsupported-headless' | 'not-applicable' =
      'not-applicable'

    if (targetsHost || targetsClients) {
      // Why: inactive worktree terminal panes are renderer-owned and may not have
      // live PTYs until the desktop activates the worktree and mounts them.
      if (targetsHost) {
        this.notifyHostActivateWorktree(repo.id, worktree.id)
      }
      if (targetsClients) {
        this.notifyClientsActivateWorktree(repo.id, worktree.id)
      }
    }
    if (!targetsHost) {
      // Why: mobile/web selection needs fresh session surfaces without forcing
      // every attached desktop renderer to navigate to the phone's workspace.
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id, {
        allowAttachedWindow: true
      })
      await this.refreshMobileSessionPtyRecords()
      this.notifyMobileSessionTabsChanged(worktree.id)
      // Why: a phone open must also wake the worktree's slept agents (experimental
      // agent sleep). Only the host renderer holds the sleeping records + wake
      // authority, so fire-and-forget ask it — mobile-scoped so web/desktop are
      // unaffected. Headless serve has no renderer to wake anything, so report
      // that explicitly instead of letting mobile assume the agents resumed.
      if (opts.clientKind === 'mobile') {
        if (this.getAvailableAuthoritativeWindow()) {
          this.notifier?.resumeSleepingAgents?.(worktree.id)
          sleepingAgentWake = 'requested'
        } else if (
          // Why: sleeping records are partitioned by execution host; reading
          // only the local partition would miss slept agents on SSH-host
          // worktrees and skip the headless warning for them.
          Object.values(
            (
              this.store?.getWorkspaceSession?.(
                getRepoExecutionHostId(repo)
              ) as WorkspaceSessionState | null
            )?.sleepingAgentSessionsByPaneKey ?? {}
          ).some((record) => record.worktreeId === worktree.id)
        ) {
          // Why: headless is only degraded when this worktree actually has a
          // persisted resume record. Ordinary mobile activation must not show
          // an unsupported warning merely because no desktop window is open.
          sleepingAgentWake = 'unsupported-headless'
        }
      }
    }
    return { repoId: repo.id, worktreeId: worktree.id, activated: true, sleepingAgentWake }
  }
  protected async buildStartupForDraft(
    repo: Repo,
    draft: string,
    requestedAgent?: TuiAgent
  ): Promise<{
    agent: TuiAgent
    startup: WorktreeStartupLaunch
    draftPaste?: WorktreeStartupDraftPaste
  } | null> {
    if (!this.store) {
      return null
    }
    const content = draft.trim()
    if (!content) {
      return null
    }
    const settings = this.store.getSettings()
    const preferredAgent = requestedAgent ?? settings.defaultTuiAgent
    if (preferredAgent === 'blank') {
      // Why: `blank` is an explicit user preference to create a shell-only
      // workspace, so linked task drafts must not auto-pick a detected agent.
      return null
    }
    let agent =
      isTuiAgent(preferredAgent) && isTuiAgentEnabled(preferredAgent, settings.disabledTuiAgents)
        ? preferredAgent
        : null
    if (!agent) {
      let detected: string[] = []
      try {
        // Why: startup-draft fallback can run from sparse runtime launch envs too.
        detected = repo.connectionId
          ? await detectRemoteAgents({ connectionId: repo.connectionId })
          : await detectInstalledAgentsWithShellPathHydration()
      } catch {
        detected = []
      }
      const typedDetected = detected.filter(isTuiAgent)
      agent = pickTuiAgent(null, typedDetected, settings.disabledTuiAgents)
    }
    if (!agent) {
      return null
    }

    // Why: a mobile client can run on Windows while the workspace shell is
    // Linux over SSH. Startup command quoting must target the shell that runs it.
    const agentLaunchPlatform = this.getAgentLaunchPlatformForRepo(repo)
    const isRemote = repoIsRemote(repo)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform: agentLaunchPlatform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const draftLaunchPlan = buildAgentDraftLaunchPlan({
      agent,
      draft: content,
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote
    })
    if (draftLaunchPlan) {
      return {
        agent,
        startup: {
          command: draftLaunchPlan.launchCommand,
          launchConfig: draftLaunchPlan.launchConfig,
          ...(draftLaunchPlan.startupCommandDelivery
            ? { startupCommandDelivery: draftLaunchPlan.startupCommandDelivery }
            : {}),
          ...(draftLaunchPlan.env ? { env: draftLaunchPlan.env } : {})
        }
      }
    }

    const startupPlan = buildAgentStartupPlan({
      agent,
      prompt: '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      return null
    }
    return {
      agent,
      startup: {
        command: startupPlan.launchCommand,
        launchConfig: startupPlan.launchConfig,
        ...(startupPlan.startupCommandDelivery
          ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
          : {}),
        ...(startupPlan.env ? { env: startupPlan.env } : {})
      },
      draftPaste: { agent, content }
    }
  }
  protected buildStartupForAgent(
    repo: Repo,
    agent: TuiAgent,
    prompt: string | undefined
  ): { agent: TuiAgent; startup: WorktreeStartupLaunch; followup?: WorktreeStartupFollowup } {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const settings = this.store.getSettings()
    if (!isTuiAgentEnabled(agent, settings.disabledTuiAgents)) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    // Why: CLI clients may target SSH runtimes from macOS/Windows, so quote for
    // the workspace shell rather than the client shell.
    const agentLaunchPlatform = this.getAgentLaunchPlatformForRepo(repo)
    const isRemote = repoIsRemote(repo)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform: agentLaunchPlatform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const startupPlan = buildAgentStartupPlan({
      agent,
      prompt: prompt ?? '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      throw new Error(`Could not build launch command for ${agent}.`)
    }
    return {
      agent,
      startup: {
        command: startupPlan.launchCommand,
        launchConfig: startupPlan.launchConfig,
        ...(startupPlan.startupCommandDelivery
          ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
          : {}),
        ...(startupPlan.env ? { env: startupPlan.env } : {})
      },
      ...(startupPlan.followupPrompt
        ? {
            followup: {
              expectedProcess: startupPlan.expectedProcess,
              prompt: startupPlan.followupPrompt
            }
          }
        : {})
    }
  }
  protected markLocalWorkspaceTrustedForAgent(agent: TuiAgent, workspacePath: string): void {
    const preset = TUI_AGENT_CONFIG[agent].preflightTrust
    if (!preset) {
      return
    }
    try {
      if (preset === 'cursor') {
        markCursorWorkspaceTrusted(workspacePath)
      } else if (preset === 'copilot') {
        markCopilotFolderTrusted(workspacePath)
      } else if (preset === 'codex') {
        markCodexProjectTrusted(workspacePath)
      }
    } catch {
      // Best-effort: the user can still accept the agent trust prompt manually.
    }
  }
  protected async markRemoteWorkspaceTrustedForAgent(
    agent: TuiAgent,
    connectionId: string,
    workspacePath: string
  ): Promise<void> {
    const preset = TUI_AGENT_CONFIG[agent].preflightTrust
    if (!preset) {
      return
    }
    try {
      await markRemoteAgentWorkspaceTrusted({ preset, connectionId, workspacePath })
    } catch {
      // Best-effort: the user can still accept the remote agent trust prompt manually.
    }
  }
  protected recordCreatedWorktreeLineage(
    worktree: Pick<Worktree, 'id' | 'instanceId'>,
    lineageResolution: WorktreeLineageResolution
  ): {
    lineage: WorktreeLineage | null
    workspaceLineage: WorkspaceLineage | null
    warnings: WorktreeLineageWarning[]
  } {
    const warnings = lineageResolution.kind === 'none' ? [...lineageResolution.warnings] : []
    let lineage: WorktreeLineage | null = null
    let workspaceLineage: WorkspaceLineage | null = null
    if (lineageResolution.kind !== 'lineage') {
      return { lineage, workspaceLineage, warnings }
    }

    const childInstanceId = worktree.instanceId
    const parentInstanceId = lineageResolution.parent.instanceId
    const createdAt = Date.now()
    if (
      lineageResolution.parent.type === 'worktree' &&
      childInstanceId &&
      parentInstanceId &&
      this.store?.setWorktreeLineage
    ) {
      lineage = this.store.setWorktreeLineage(worktree.id, {
        worktreeId: worktree.id,
        worktreeInstanceId: childInstanceId,
        parentWorktreeId: lineageResolution.parent.worktree.id,
        parentWorktreeInstanceId: parentInstanceId,
        origin: lineageResolution.origin,
        capture: lineageResolution.capture,
        ...(lineageResolution.createdByTerminalHandle
          ? { createdByTerminalHandle: lineageResolution.createdByTerminalHandle }
          : {}),
        createdAt
      })
    } else if (lineageResolution.parent.type === 'worktree') {
      warnings.push({
        code: 'LINEAGE_PARENT_CONTEXT_MISSING',
        message:
          'Worktree created, but Orca could not record lineage because instance identity was unavailable.',
        details: {
          childHasInstanceId: Boolean(childInstanceId),
          parentHasInstanceId: Boolean(parentInstanceId),
          storeSupportsLineage: Boolean(this.store?.setWorktreeLineage)
        }
      })
    }
    if (childInstanceId && this.store?.setWorkspaceLineage) {
      workspaceLineage = this.store.setWorkspaceLineage({
        childWorkspaceKey: worktreeWorkspaceKey(worktree.id),
        childInstanceId,
        parentWorkspaceKey: lineageResolution.parent.workspaceKey,
        parentInstanceId,
        origin: lineageResolution.origin,
        capture: lineageResolution.capture,
        ...(lineageResolution.createdByTerminalHandle
          ? { createdByTerminalHandle: lineageResolution.createdByTerminalHandle }
          : {}),
        createdAt
      })
    }
    return { lineage, workspaceLineage, warnings }
  }
}
