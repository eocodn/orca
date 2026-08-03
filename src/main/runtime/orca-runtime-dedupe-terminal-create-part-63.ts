import { type WorktreeStartupLaunch, type TuiAgent, LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId, getRegisteredSshState, type SleepingAgentLaunchConfig, navigationTargetsHost, type RuntimeNavigationTarget, type RuntimeTerminalCreate, type RuntimeMobileSessionCreateTerminalResult, isPtyIncarnationId, deriveRemoteRuntimeTerminalCreateHandle, inferWorktreeIdFromPtyId, withTimeoutResult, PTY_CONTROLLER_LIST_TIMEOUT_MS, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS } from './orca-runtime-symbols'
import { OrcaRuntimeCreateTerminalPart62 } from './orca-runtime-create-terminal-part-62'

export class OrcaRuntimeDedupeTerminalCreatePart63 extends OrcaRuntimeCreateTerminalPart62 {
  async dedupeTerminalCreate(
    clientIdentity: string,
    worktreeSelector: string | undefined,
    clientMutationId: string | undefined,
    reconcileExisting: boolean,
    run: (
      canonicalWorktreeSelector: string | undefined,
      preAllocatedHandle: string | undefined
    ) => Promise<RuntimeTerminalCreate>
  ): Promise<RuntimeTerminalCreate> {
    if (!clientMutationId || !worktreeSelector) {
      if (reconcileExisting) {
        throw new Error('runtime_unavailable')
      }
      return await run(worktreeSelector, undefined)
    }
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(worktreeSelector)
    const canonicalWorktreeSelector = `id:${workspace.id}`
    const preAllocatedHandle = deriveRemoteRuntimeTerminalCreateHandle(
      clientIdentity,
      workspace.id,
      clientMutationId
    )
    return this.terminalCreateIdempotency.run(
      clientIdentity,
      workspace.id,
      clientMutationId,
      async () => {
        if (reconcileExisting) {
          const adopted = await this.reconcileRemoteTerminalCreate(workspace.id, preAllocatedHandle)
          if (adopted) {
            return adopted
          }
        }
        return await run(canonicalWorktreeSelector, preAllocatedHandle)
      }
    )
  }
  protected async reconcileRemoteTerminalCreate(
    worktreeId: string,
    terminalHandle: string
  ): Promise<RuntimeTerminalCreate | null> {
    if (!this.ptyController?.listProcesses) {
      throw new Error('runtime_unavailable')
    }
    const listed = await withTimeoutResult(
      this.ptyController.listProcesses(),
      PTY_CONTROLLER_LIST_TIMEOUT_MS
    )
    if (!listed.ok) {
      // Why: unknown inventory cannot prove the first create failed, so spawning could duplicate a live shell.
      throw new Error('runtime_unavailable')
    }
    const matches = listed.value.filter((session) => session.terminalHandle === terminalHandle)
    if (matches.length > 1) {
      throw new Error('terminal_create_identity_conflict')
    }
    if (matches.length === 0) {
      const sameWorktreeHasUnknownIdentity = listed.value.some(
        (session) =>
          (session.worktreeId ?? inferWorktreeIdFromPtyId(session.id)) === worktreeId &&
          !session.terminalHandle
      )
      if (sameWorktreeHasUnknownIdentity) {
        // Why: older retained providers may list the first shell without its handle; absence is not authoritative in that shape.
        throw new Error('runtime_unavailable')
      }
      return null
    }
    const session = matches[0]
    if (session.incarnationId !== undefined && !isPtyIncarnationId(session.incarnationId)) {
      throw new Error('terminal_create_identity_conflict')
    }
    const authoritativeWorktreeId = session.worktreeId ?? inferWorktreeIdFromPtyId(session.id)
    if (authoritativeWorktreeId !== worktreeId) {
      // Why: a reused address or forged provider record must never adopt a PTY from another workspace.
      throw new Error('terminal_create_identity_conflict')
    }
    this.adoptControllerTerminalHandle(session.id, terminalHandle, session.incarnationId)
    const pty = this.recordAuthoritativePtyWorktree(session.id, worktreeId, {
      title: session.title,
      ...(session.incarnationId ? { incarnationId: session.incarnationId } : {})
    })
    const adoptedHandle = this.issuePtyHandle(pty)
    if (adoptedHandle !== terminalHandle) {
      throw new Error('terminal_create_identity_conflict')
    }
    return {
      handle: adoptedHandle,
      ptyId: session.id,
      worktreeId,
      title: session.title || null,
      surface: 'background'
    }
  }
  protected getPtyExecutionHostMetadata(
    ptyId: string | null
  ): Pick<RuntimeTerminalCreate, 'executionHostId' | 'hostPlatform'> {
    if (!ptyId) {
      return {}
    }
    const pty = this.ptysById.get(ptyId)
    if (!pty) {
      return {}
    }
    if (pty.connectionId) {
      const remotePlatform = getRegisteredSshState(pty.connectionId)?.remotePlatform
      return {
        executionHostId: toSshExecutionHostId(pty.connectionId),
        ...(remotePlatform ? { hostPlatform: remotePlatform } : {})
      }
    }
    return {
      executionHostId: LOCAL_EXECUTION_HOST_ID,
      hostPlatform: pty.isWsl || pty.wslDistro ? 'linux' : process.platform
    }
  }
  async launchAgentTerminal(
    worktreeSelector: string,
    opts: { agent: TuiAgent; prompt: string; title?: string }
  ): Promise<RuntimeTerminalCreate> {
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = this.store?.getRepo(worktree.repoId)
    if (!repo) {
      throw new Error('Repository for the selected workspace is no longer available.')
    }
    const startup = this.buildStartupForAgent(repo, opts.agent, opts.prompt)
    if (repo.connectionId) {
      await this.markRemoteWorkspaceTrustedForAgent(opts.agent, repo.connectionId, worktree.path)
    } else {
      this.markLocalWorkspaceTrustedForAgent(opts.agent, worktree.path)
    }
    return await this.createTerminal(`id:${worktree.id}`, {
      command: startup.startup.command,
      env: startup.startup.env,
      ...(startup.startup.launchConfig ? { launchConfig: startup.startup.launchConfig } : {}),
      launchAgent: startup.agent,
      startupCommandDelivery: startup.startup.startupCommandDelivery,
      telemetry: startup.startup.telemetry,
      title: opts.title
    })
  }

  // Why: dedupes a worktree.create whose response was lost when a mobile
  // connection migration (relay/direct hand-off on shoddy cellular) rejected the
  // in-flight request. A retry with the same clientMutationId returns the
  // in-flight or just-finished create instead of a duplicate worktree; failures
  // drop immediately so a genuine retry starts fresh, and successes linger
  // briefly so a retry whose response was lost in the cutover still reconciles.
  dedupeWorktreeCreate<T>(
    repoSelector: string,
    clientMutationId: string | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    if (!clientMutationId) {
      return run()
    }
    const key = `${repoSelector}\0${clientMutationId}`
    const inflight = this.worktreeCreateByMutationId.get(key)
    if (inflight) {
      return inflight as Promise<T>
    }
    const created = run()
    this.worktreeCreateByMutationId.set(key, created)
    const drop = (): void => {
      if (this.worktreeCreateByMutationId.get(key) === created) {
        this.worktreeCreateByMutationId.delete(key)
      }
    }
    void created.then(() => {
      setTimeout(drop, WORKTREE_CREATE_RESULT_TTL_MS).unref?.()
    }, drop)
    return created
  }
  async createMobileSessionTerminal(
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
      select?: boolean
      clientNavigationId?: string
      navigation?: RuntimeNavigationTarget
      clientMutationId?: string
      signal?: AbortSignal
    } = {}
  ): Promise<RuntimeMobileSessionCreateTerminalResult> {
    const navigation = opts.navigation ?? 'all'
    const select = opts.select ?? opts.activate !== false
    const runOpts = {
      ...opts,
      activate: select && navigationTargetsHost(navigation)
    }
    const mutationId = opts.clientMutationId
    let result: RuntimeMobileSessionCreateTerminalResult
    if (!mutationId) {
      result = await this.runCreateMobileSessionTerminal(worktreeSelector, runOpts)
    } else {
      // Why: idempotency is caller-owned; two paired devices may reuse the same mutation id without sharing a result.
      const mutationKey = `${opts.clientNavigationId ?? 'local'}\0${worktreeSelector}\0${mutationId}`
      // Why: a retried create (double-tap, reconnect replay) with the same
      // idempotency key must return the in-flight operation instead of spawning a
      // duplicate terminal. Successes are kept briefly so a retry whose response
      // was lost in transit reuses the created terminal; failures are dropped
      // immediately so a retry can start a fresh create.
      const inflight = this.mobileTerminalCreateByMutationId.get(mutationKey)
      const run = inflight ?? this.runCreateMobileSessionTerminal(worktreeSelector, runOpts)
      if (!inflight) {
        this.mobileTerminalCreateByMutationId.set(mutationKey, run)
        const drop = (): void => {
          if (this.mobileTerminalCreateByMutationId.get(mutationKey) === run) {
            this.mobileTerminalCreateByMutationId.delete(mutationKey)
          }
        }
        void run.then(() => {
          setTimeout(drop, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS).unref?.()
        }, drop)
      }
      result = await run
    }
    if (select) {
      const worktreeId =
        this.getValidatedExplicitWorktreeIdSelector(worktreeSelector) ??
        (await this.resolveWorktreeSelector(worktreeSelector)).id
      this.applyMobileSessionTabNavigation(
        this.getMobileSessionTabsForWorktree(worktreeId),
        result.tab.id,
        navigation,
        opts.clientNavigationId
      )
    }
    return result
  }
}
