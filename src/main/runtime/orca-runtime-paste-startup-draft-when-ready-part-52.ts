import { isShellProcess, randomUUID, buildObservedSetupCommand, type CreateWorktreeResult, type GlobalSettings, type TuiAgent, buildSetupRunnerCommand, isExpectedAgentProcess, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, prefetchWorktreeCreateBase, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, ownerSurfacing } from './orca-runtime-symbols'
import { OrcaRuntimeActivateManagedWorktreePart51 } from './orca-runtime-activate-managed-worktree-part-51'

export class OrcaRuntimePasteStartupDraftWhenReadyPart52 extends OrcaRuntimeActivateManagedWorktreePart51 {
  protected pasteStartupDraftWhenReady(handle: string, draft: WorktreeStartupDraftPaste): void {
    void this.waitForStartupDraftReady(handle, draft.agent)
      .then((ptyId) => {
        if (!ptyId) {
          console.warn('[worktree-create] agent did not become ready for draft paste')
          return
        }
        this.ptyController?.write(
          ptyId,
          `${BRACKETED_PASTE_BEGIN}${draft.content}${BRACKETED_PASTE_END}`
        )
      })
      .catch((error) => {
        console.warn('[worktree-create] failed to paste startup draft:', error)
      })
  }
  protected sendStartupFollowupWhenReady(handle: string, followup: WorktreeStartupFollowup): void {
    void this.waitForStartupFollowupReady(handle, followup.expectedProcess)
      .then((ptyId) => {
        if (!ptyId) {
          console.warn('[worktree-create] agent did not become ready for follow-up prompt')
          return
        }
        this.ptyController?.write(ptyId, `${followup.prompt}\r`)
      })
      .catch((error) => {
        console.warn('[worktree-create] failed to send startup follow-up prompt:', error)
      })
  }
  protected async createDefaultTabTerminals(
    worktreeSelector: string,
    worktreeId: string,
    defaultTabs: CreateWorktreeResult['defaultTabs'] | undefined,
    surfacing: { surfaceOwner?: false } = {}
  ): Promise<string[]> {
    if (!defaultTabs || defaultTabs.tabs.length === 0 || !this.ptyController?.spawn) {
      return []
    }
    const handles: string[] = []
    for (const template of defaultTabs.tabs) {
      try {
        const command = template.command?.trim()
        const terminal = await this.createTerminal(worktreeSelector, {
          ...(template.title ? { title: template.title } : {}),
          ...(command && defaultTabs.runCommands ? { command } : {}),
          ...surfacing
        })
        handles.push(terminal.handle)
        if (template.color && terminal.tabId) {
          await this.setMobileSessionTabProps(`id:${worktreeId}`, {
            tabId: terminal.tabId,
            color: template.color
          })
        }
      } catch (error) {
        console.warn(`[worktree-create] Failed to create default tab for ${worktreeId}:`, error)
      }
    }
    return handles
  }
  protected async provisionManagedWorktreeTerminals(args: {
    worktreeSelector: string
    worktreeId: string
    worktreePath: string
    setup?: CreateWorktreeResult['setup']
    defaultTabs?: CreateWorktreeResult['defaultTabs']
    primaryTerminalHandle?: string | null
    hasStartupTerminal: boolean
    setupCommandPlatform: 'windows' | 'posix'
    observeSetupCompletion?: boolean
    // Why: when the agent startup is sequenced to wait for setup
    // (waitForAgentStartup), the startup PTY runs a wrapper that already embeds
    // the setup command. Pass that wrapped command through so the Setup tab runs
    // the same script the agent is waiting on instead of a bare runner.
    wrappedSetupCommand?: string
    // Why: a workspace provisioned in the background must not pull the sidebar
    // to itself; the user never asked to look at these tabs.
    surfaceOwner?: false
  }): Promise<{ setupSpawned: boolean; setupTerminalHandle: string | null }> {
    if (!this.ptyController?.spawn) {
      return { setupSpawned: false, setupTerminalHandle: null }
    }
    const surfacing = ownerSurfacing(args.surfaceOwner !== false)
    let setupSpawned = false
    let setupTerminalHandle: string | null = null
    try {
      const defaultTabHandles = await this.createDefaultTabTerminals(
        args.worktreeSelector,
        args.worktreeId,
        args.defaultTabs,
        surfacing
      )
      let primaryTerminalHandle = args.primaryTerminalHandle ?? defaultTabHandles[0] ?? null
      const setupLaunchMode =
        (
          this.requireStore().getSettings() as Partial<
            Pick<GlobalSettings, 'setupScriptLaunchMode'>
          >
        ).setupScriptLaunchMode ?? 'new-tab'
      if (!args.hasStartupTerminal && !primaryTerminalHandle) {
        const terminal = await this.createTerminal(args.worktreeSelector, surfacing)
        primaryTerminalHandle = terminal.handle
      }
      if (args.setup) {
        const completionToken =
          args.observeSetupCompletion && !args.wrappedSetupCommand ? randomUUID() : null
        const observedCommand = completionToken
          ? buildObservedSetupCommand(
              args.setup.runnerScriptPath,
              args.setupCommandPlatform,
              completionToken
            )
          : null
        const setupCommand =
          args.wrappedSetupCommand ??
          observedCommand?.command ??
          buildSetupRunnerCommand(args.setup.runnerScriptPath, args.setupCommandPlatform)
        const setupEnv = { ...args.setup.envVars, ...observedCommand?.env }
        const shouldSplitSetup =
          primaryTerminalHandle &&
          (setupLaunchMode === 'split-vertical' || setupLaunchMode === 'split-horizontal')
        const setupTerminal = await (shouldSplitSetup
          ? this.splitTerminal(primaryTerminalHandle!, {
              direction: setupLaunchMode === 'split-horizontal' ? 'horizontal' : 'vertical',
              command: setupCommand,
              env: setupEnv,
              activate: false,
              ...surfacing
            })
          : this.createTerminal(args.worktreeSelector, {
              title: 'Setup',
              command: setupCommand,
              env: setupEnv,
              ...surfacing
            }))
        setupTerminalHandle = setupTerminal.handle
        setupSpawned = true
        const ptyId = this.getLivePtyForHandle(setupTerminal.handle)?.pty.ptyId
        if (completionToken && ptyId) {
          this.setupCompletionTokenByPtyId.set(ptyId, completionToken)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(
        `[worktree-create] Failed to create setup/default terminals for ${args.worktreePath}: ${message}`
      )
    }
    return { setupSpawned, setupTerminalHandle }
  }
  protected async waitForStartupFollowupReady(
    handle: string,
    expectedProcess: string
  ): Promise<string | null> {
    const livePty = this.getLivePtyForHandle(handle)
    const ptyId = livePty?.pty.ptyId
    if (!ptyId || !this.ptyController) {
      return null
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      try {
        const foregroundProcess = await this.ptyController.getForegroundProcess(ptyId)
        if (isExpectedAgentProcess(foregroundProcess, expectedProcess)) {
          return ptyId
        }
        if (attempt >= 4 && !isShellProcess(foregroundProcess ?? '')) {
          const hasChildProcesses =
            (await this.ptyController.hasChildProcesses?.(ptyId).catch(() => false)) ?? false
          if (hasChildProcesses) {
            return ptyId
          }
        }
      } catch {
        // Ignore transient PTY inspection failures and keep polling.
      }
    }
    return null
  }
  protected waitForStartupDraftReady(handle: string, agent: TuiAgent): Promise<string | null> {
    const livePty = this.getLivePtyForHandle(handle)
    const ptyId = livePty?.pty.ptyId
    if (!ptyId) {
      return Promise.resolve(null)
    }
    const readySignal =
      TUI_AGENT_CONFIG[agent].draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
    return new Promise<string | null>((resolve) => {
      let settled = false
      const scanner = createDraftPasteReadyScanner(readySignal)
      let quietTimer: NodeJS.Timeout | null = null
      let hardTimer: NodeJS.Timeout | null = null
      let unsubscribe: (() => void) | null = null

      const finish = (value: string | null): void => {
        if (settled) {
          return
        }
        settled = true
        if (quietTimer) {
          clearTimeout(quietTimer)
        }
        if (hardTimer) {
          clearTimeout(hardTimer)
        }
        unsubscribe?.()
        resolve(value)
      }

      const armQuietTimer = (): void => {
        if (quietTimer) {
          clearTimeout(quietTimer)
        }
        quietTimer = setTimeout(() => finish(ptyId), BRACKETED_PASTE_QUIET_MS)
      }

      const observeData = (data: string): void => {
        const { ready, armQuietTimer: shouldArm } = scanner.observe(data)
        if (ready) {
          finish(ptyId)
          return
        }
        if (shouldArm) {
          armQuietTimer()
        }
      }

      unsubscribe = this.subscribeToTerminalData(ptyId, observeData)
      const replay = this.terminalOutputState.getRecent(ptyId)?.read()
      if (replay) {
        observeData(replay)
      }
      hardTimer = setTimeout(() => finish(null), DRAFT_PASTE_READY_TIMEOUT_MS)
    })
  }
  async prefetchManagedWorktreeCreateBase(args: {
    repoSelector: string
    baseBranch?: string
  }): Promise<void> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }

    const repo = await this.resolveRepoSelector(args.repoSelector)
    await prefetchWorktreeCreateBase({
      repo,
      baseBranch: args.baseBranch,
      runtime: this as unknown as Parameters<typeof prefetchWorktreeCreateBase>[0]['runtime']
    })
  }
}
