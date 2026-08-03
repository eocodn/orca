import { type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type CreateWorktreeResult, type GitPushTarget, type Repo, type WorktreeStartupLaunch, type TuiAgent, type WorkspaceLinkedItem, type TaskSourceContext, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, isWindowsAbsolutePathLike, BrowserWindow, createRemoteWorktree, type Store, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, ownerSurfacing } from './orca-runtime-symbols'
import { OrcaRuntimeCreateManagedWorktreePart53 } from './orca-runtime-create-managed-worktree-part-53'

export class OrcaRuntimeCreateManagedRemoteWorktreePart54 extends OrcaRuntimeCreateManagedWorktreePart53 {
  protected async createManagedRemoteWorktree(
    repo: Repo,
    args: {
      name: string
      baseBranch?: string
      compareBaseRef?: string
      branchNameOverride?: string
      linkedIssue?: number | null
      linkedPR?: number | null
      linkedLinearIssue?: string
      linkedLinearIssueWorkspaceId?: string | null
      linkedLinearIssueOrganizationUrlKey?: string | null
      linkedGitLabMR?: number | null
      linkedGitLabIssue?: number | null
      linkedBitbucketPR?: number | null
      linkedAzureDevOpsPR?: number | null
      linkedGiteaPR?: number | null
      linkedWorkItem?: WorkspaceLinkedItem | null
      linkedTaskSourceContext?: TaskSourceContext | null
      comment?: string
      displayName?: string
      workspaceStatus?: string
      manualOrder?: number
      sparseCheckout?: { directories: string[]; presetId?: string }
      pushTarget?: GitPushTarget
      runHooks?: boolean
      activate?: boolean
      setupDecision?: 'run' | 'skip' | 'inherit'
      awaitTerminalProvisioning?: boolean
      observeSetupCompletion?: boolean
      createdWithAgent?: TuiAgent
      pendingFirstAgentMessageRename?: boolean
      automationProvenance?: AutomationWorkspaceProvenance
      cliProvenance?: CliWorkspaceProvenance
      startup?: WorktreeStartupLaunch
      startupFollowup?: WorktreeStartupFollowup
      startupDraftPaste?: WorktreeStartupDraftPaste
    }
  ): Promise<CreateWorktreeResult> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }

    // Why: runtime/mobile callers do not own a renderer BrowserWindow, but the
    // SSH create helper only uses it for progress and change notifications.
    // Runtime emits those through RuntimeNotifier after the create succeeds.
    const headlessWindow = {
      isDestroyed: () => false,
      webContents: { send: () => undefined }
    } as unknown as BrowserWindow

    const result = await createRemoteWorktree(
      {
        repoId: repo.id,
        name: args.name,
        ...(args.displayName ? { displayName: args.displayName } : {}),
        ...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
        ...(args.compareBaseRef ? { compareBaseRef: args.compareBaseRef } : {}),
        ...(args.branchNameOverride ? { branchNameOverride: args.branchNameOverride } : {}),
        ...(args.runHooks ? { setupDecision: 'run' as const } : {}),
        ...(!args.runHooks && args.setupDecision ? { setupDecision: args.setupDecision } : {}),
        ...(args.sparseCheckout ? { sparseCheckout: args.sparseCheckout } : {}),
        ...(args.linkedIssue != null ? { linkedIssue: args.linkedIssue } : {}),
        ...(args.linkedPR != null ? { linkedPR: args.linkedPR } : {}),
        ...(args.linkedLinearIssue ? { linkedLinearIssue: args.linkedLinearIssue } : {}),
        ...(args.linkedLinearIssueWorkspaceId !== undefined
          ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
          : {}),
        ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
          ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
          : {}),
        ...(args.linkedGitLabMR != null ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
        ...(args.linkedGitLabIssue != null ? { linkedGitLabIssue: args.linkedGitLabIssue } : {}),
        ...(args.linkedBitbucketPR != null ? { linkedBitbucketPR: args.linkedBitbucketPR } : {}),
        ...(args.linkedAzureDevOpsPR != null
          ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
          : {}),
        ...(args.linkedGiteaPR != null ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
        ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
        ...(args.linkedTaskSourceContext !== undefined
          ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
          : {}),
        ...(args.pushTarget ? { pushTarget: args.pushTarget } : {}),
        ...(args.workspaceStatus ? { workspaceStatus: args.workspaceStatus as never } : {}),
        ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
        ...(args.createdWithAgent ? { createdWithAgent: args.createdWithAgent } : {}),
        ...(args.pendingFirstAgentMessageRename === true
          ? { pendingFirstAgentMessageRename: true }
          : {}),
        ...(args.automationProvenance ? { automationProvenance: args.automationProvenance } : {}),
        ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {})
      },
      repo,
      this.store as unknown as Store,
      headlessWindow
    )

    if (args.comment !== undefined) {
      this.store.setWorktreeMeta(result.worktree.id, { comment: args.comment })
      result.worktree.comment = args.comment
    }

    this.invalidateResolvedWorktreeCache()
    this.invalidateWorktreeScanCacheForRepo(repo.id)
    this.notifyWorktreesChanged(repo.id)

    const shouldActivate = args.activate === true || args.runHooks === true
    let warning = result.warning
    let didSpawnStartup = false
    // Why: same no-double-spawn contract as the local path — once runtime
    // provisions setup, omit it from activation and the RPC result.
    let didSpawnSetup = false
    let setupTerminalHandle: string | null = null
    let startupTerminalHandle: string | null = null
    let startupTerminalTabId: string | null = null
    let startupTerminalPaneKey: string | null = null
    let startupTerminalPtyId: string | null = null

    let sequencedStartup = args.startup
    let wrappedSetupCommandStr: string | undefined
    if (args.startup && result.setup?.waitForAgentStartup === true) {
      const platform = getSetupRunnerCommandPlatformForPath(result.setup.runnerScriptPath, 'posix')
      const sequenced = createSequencedSetupAgentCommands({
        runnerScriptPath: result.setup.runnerScriptPath,
        startupCommand: args.startup.command,
        platform
      })
      sequencedStartup = {
        ...args.startup,
        command: sequenced.startupCommand,
        ...(sequenced.startupEnv ? { env: { ...args.startup.env, ...sequenced.startupEnv } } : {})
      }
      wrappedSetupCommandStr = sequenced.setupCommand
    }

    if (sequencedStartup && this.ptyController?.spawn) {
      try {
        const startupTrustAgent = args.startupDraftPaste?.agent ?? args.createdWithAgent
        if (startupTrustAgent) {
          await this.markRemoteWorkspaceTrustedForAgent(
            startupTrustAgent,
            repo.connectionId!,
            result.worktree.path
          )
        }
        const terminal = await this.createTerminal(`path:${result.worktree.path}`, {
          command: sequencedStartup.command,
          ...(result.setup && args.startup
            ? { claudeAgentTeamsSourceCommand: args.startup.command }
            : {}),
          env: sequencedStartup.env,
          ...(sequencedStartup.launchConfig ? { launchConfig: sequencedStartup.launchConfig } : {}),
          ...(args.createdWithAgent ? { launchAgent: args.createdWithAgent } : {}),
          ...(sequencedStartup.viewMode ? { viewMode: sequencedStartup.viewMode } : {}),
          startupCommandDelivery: sequencedStartup.startupCommandDelivery,
          telemetry: sequencedStartup.telemetry,
          ...ownerSurfacing(shouldActivate)
        })
        if (args.startupDraftPaste) {
          this.pasteStartupDraftWhenReady(terminal.handle, args.startupDraftPaste)
        }
        if (args.startupFollowup) {
          this.sendStartupFollowupWhenReady(terminal.handle, args.startupFollowup)
        }
        didSpawnStartup = true
        startupTerminalHandle = terminal.handle
        startupTerminalTabId = terminal.tabId ?? null
        startupTerminalPaneKey = terminal.paneKey ?? null
        startupTerminalPtyId = terminal.ptyId ?? null
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        warning = warning
          ? `${warning} Also failed to create the startup terminal for ${result.worktree.path}: ${message}`
          : `Failed to create the startup terminal for ${result.worktree.path}: ${message}`
      }
    }

    if (shouldActivate) {
      const runtimeWillProvisionTerminals =
        didSpawnStartup && Boolean(result.setup || result.defaultTabs)
      if (runtimeWillProvisionTerminals) {
        // Why: remote/mobile task creates spawn the agent terminal in runtime,
        // so renderer activation may not materialize setup/default tabs. Await so
        // a failed setup spawn falls back to renderer activation for retry.
        const provisioned = await this.provisionManagedWorktreeTerminals({
          worktreeSelector: `path:${result.worktree.path}`,
          worktreeId: result.worktree.id,
          worktreePath: result.worktree.path,
          ...(result.setup ? { setup: result.setup } : {}),
          ...(result.defaultTabs ? { defaultTabs: result.defaultTabs } : {}),
          primaryTerminalHandle: startupTerminalHandle,
          hasStartupTerminal: didSpawnStartup,
          setupCommandPlatform: result.setup
            ? isWindowsAbsolutePathLike(result.setup.runnerScriptPath)
              ? 'windows'
              : 'posix'
            : 'posix',
          observeSetupCompletion: args.observeSetupCompletion,
          // Why: carry the wait-for-agent wrapped setup command (#6298) so the
          // remote Setup tab runs the same script the sequenced agent waits on.
          ...(wrappedSetupCommandStr ? { wrappedSetupCommand: wrappedSetupCommandStr } : {})
        })
        didSpawnSetup = provisioned.setupSpawned
        setupTerminalHandle = provisioned.setupTerminalHandle
      }
      // Why: omit setup from activation when runtime spawned it; on spawn
      // failure fall through with the wrapped command so renderer retries.
      const activationSetup = didSpawnSetup
        ? undefined
        : result.setup
          ? {
              ...result.setup,
              ...(didSpawnStartup && wrappedSetupCommandStr
                ? { command: wrappedSetupCommandStr }
                : {})
            }
          : undefined
      const activationDefaultTabs = runtimeWillProvisionTerminals ? undefined : result.defaultTabs
      if (args.startup && !didSpawnStartup) {
        this.notifyActivateWorktree(
          repo.id,
          result.worktree.id,
          activationSetup,
          args.startup,
          activationDefaultTabs
        )
      } else {
        this.notifyActivateWorktree(
          repo.id,
          result.worktree.id,
          activationSetup,
          undefined,
          activationDefaultTabs
        )
      }
    }

    if (
      !shouldActivate &&
      this.ptyController?.spawn &&
      (result.setup || result.defaultTabs || didSpawnStartup)
    ) {
      // Why: inactive terminal materialization matches normal worktree creation,
      // but setup/default tab failures must not gate automation dispatch.
      const provisioning = this.provisionManagedWorktreeTerminals({
        worktreeSelector: `path:${result.worktree.path}`,
        worktreeId: result.worktree.id,
        worktreePath: result.worktree.path,
        ...(result.setup ? { setup: result.setup } : {}),
        ...(result.defaultTabs ? { defaultTabs: result.defaultTabs } : {}),
        primaryTerminalHandle: startupTerminalHandle,
        hasStartupTerminal: didSpawnStartup,
        setupCommandPlatform: result.setup
          ? isWindowsAbsolutePathLike(result.setup.runnerScriptPath)
            ? 'windows'
            : 'posix'
          : 'posix',
        observeSetupCompletion: args.observeSetupCompletion,
        ...(wrappedSetupCommandStr ? { wrappedSetupCommand: wrappedSetupCommandStr } : {}),
        surfaceOwner: false
      })
      // Why: runtime owns setup spawning here, so omit setup from the RPC result
      // to keep the headless/mobile caller from launching it a second time.
      if (args.awaitTerminalProvisioning) {
        const provisioned = await provisioning
        didSpawnSetup = provisioned.setupSpawned
        setupTerminalHandle = provisioned.setupTerminalHandle
      } else {
        void provisioning
        if (result.setup) {
          didSpawnSetup = true
        }
      }
    } else if (!shouldActivate && this.ptyController?.spawn) {
      try {
        await this.createTerminal(`path:${result.worktree.path}`, { surfaceOwner: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        warning = warning
          ? `${warning} Also failed to create the initial terminal for ${result.worktree.path}: ${message}`
          : `Failed to create the initial terminal for ${result.worktree.path}: ${message}`
      }
    }

    const returnedSetup = didSpawnSetup
      ? undefined
      : result.setup
        ? {
            ...result.setup,
            ...(didSpawnStartup && wrappedSetupCommandStr
              ? { command: wrappedSetupCommandStr }
              : {})
          }
        : undefined
    const resultForRenderer = returnedSetup
      ? { ...result, setup: returnedSetup }
      : (() => {
          const { setup: _setup, ...resultWithoutSetup } = result
          return resultWithoutSetup
        })()

    const resultWithStartupTerminal =
      didSpawnStartup && startupTerminalHandle
        ? {
            ...resultForRenderer,
            startupTerminal: {
              spawned: true,
              handle: startupTerminalHandle,
              ...(startupTerminalTabId ? { tabId: startupTerminalTabId } : {}),
              ...(startupTerminalPaneKey ? { paneKey: startupTerminalPaneKey } : {}),
              ...(startupTerminalPtyId ? { ptyId: startupTerminalPtyId } : {}),
              surface: 'background' as const
            }
          }
        : resultForRenderer

    const requestedSetupDecision = args.runHooks ? 'run' : (args.setupDecision ?? 'inherit')
    const setupReceipt = {
      requested: requestedSetupDecision,
      hookFound: Boolean(result.setup),
      startupPolicy: result.setup?.waitForAgentStartup
        ? ('wait-for-setup' as const)
        : ('start-immediately' as const),
      state:
        requestedSetupDecision === 'skip'
          ? ('skipped' as const)
          : !result.setup

            ? ('not_configured' as const)
            : didSpawnSetup
              ? ('running' as const)
              : ('spawn_failed' as const),
      ...(setupTerminalHandle ? { terminalHandle: setupTerminalHandle } : {})
    }
    const resultWithSetupReceipt = args.awaitTerminalProvisioning
      ? { ...resultWithStartupTerminal, setupReceipt }
      : resultWithStartupTerminal
    return warning ? { ...resultWithSetupReceipt, warning } : resultWithSetupReceipt
  }

  /**
   * Fetch `remote` in `repoPath`, sharing the 30s freshness window + in-flight
   * serialization with all other callers. Never rejects — callers
   * log-and-proceed on offline failures (§3.3 Lifecycle).
   *
   * Why a shared cache on the runtime instead of module-scoped: §7.1 relies on
   * one cache for BOTH the renderer create path and `probeWorktreeDrift`. A
   * dispatch tick that reuses a just-completed create-path fetch is the
   * primary telemetry target; splitting the cache by call-site would double
   * the fetch load on warm repos.
   */
}
