import { join, OrchestrationDb, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, type Automation, type AutomationRun, type GlobalSettings, type PersistedUIState, type StatsSummary, type MemorySnapshot, type TerminalQuickCommand, type WorkspaceSessionState, LOCAL_EXECUTION_HOST_ID, type ExecutionHostId, type FeatureInteractionId, makePaneKey, type TerminalQuickCommandMutation, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, type IPtyProvider, collectMemorySnapshot, app, killAllProcessesForWorktree, type RuntimeClientSettings, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, resolveTerminalSessionWorktreeId, runtimeWorktreeIdsEqual, type LegacyWorkerTerminalRecoveryResult } from './orca-runtime-symbols'
import { OrcaRuntimeState } from './orca-runtime-state'
import type { OrcaRuntimeService } from './orca-runtime'

export class OrcaRuntimeGetLocalProviderPart1 extends OrcaRuntimeState {
  getLocalProvider(): IPtyProvider | null {
    return this.getLocalProviderFn ? this.getLocalProviderFn() : null
  }
  protected async stopPtysForDestructiveWorktreeRemoval(
    worktreeId: string,
    connectionId?: string
  ): Promise<void> {
    const provider = connectionId ? this.getSshProviderFn?.(connectionId) : this.getLocalProvider()
    if (!provider) {
      throw new Error(`PTY provider unavailable for worktree deletion: ${worktreeId}`)
    }
    const teardownResult = await killAllProcessesForWorktree(worktreeId, {
      runtime: this as unknown as OrcaRuntimeService,
      localProvider: provider,
      onPtyStopped: this.onPtyStopped ?? undefined,
      requirePhysicalStop: true,
      ...(connectionId ? { includeLocalRegistry: false } : {})
    })
    const total =
      teardownResult.runtimeStopped +
      teardownResult.providerStopped +
      teardownResult.registryStopped
    if (total > 0) {
      console.info(
        `[worktree-teardown] ${worktreeId} killed runtime=${teardownResult.runtimeStopped} provider=${teardownResult.providerStopped} registry=${teardownResult.registryStopped}`
      )
    }
  }
  getStatsSummary(): StatsSummary | null {
    return this.stats?.getSummary() ?? null
  }
  getMemorySnapshot(): Promise<MemorySnapshot> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    return collectMemorySnapshot(this.store)
  }
  getUIState(): PersistedUIState {
    return this.clientSettingsCommands.getUIState()
  }
  updateUIState(updates: Partial<PersistedUIState>): PersistedUIState {
    return this.clientSettingsCommands.updateUIState(updates)
  }
  recordFeatureInteraction(id: FeatureInteractionId): PersistedUIState {
    return this.clientSettingsCommands.recordFeatureInteraction(id)
  }
  getClientSettings(): RuntimeClientSettings {
    return this.clientSettingsCommands.getClientSettings()
  }
  protected reconcileManagedAgentHooks(): Promise<void> {
    const generation = ++this.managedHookReconciliationGeneration
    const reconciliation = this.managedHookReconciliationTail.then(async () => {
      if (generation !== this.managedHookReconciliationGeneration) {
        return
      }
      const settings = this.store?.getSettings()
      if (!settings) {
        return
      }
      await applyAgentStatusHooksEnabled(settings.agentStatusHooksEnabled !== false, settings, {
        shouldHydrateShellPath: app.isPackaged && process.platform !== 'win32',
        onInstallError: recordManagedHookInstallFailure,
        shouldContinue: (agent) => {
          const current = this.store?.getSettings()
          return (
            current !== undefined &&
            current.agentStatusHooksEnabled !== false &&
            !current.disabledTuiAgents?.includes(agent)
          )
        }
      })
    })
    this.managedHookReconciliationTail = reconciliation.catch(() => {})
    return reconciliation
  }
  async updateClientSettings(
    updates: Pick<
      Partial<GlobalSettings>,
      | 'agentStatusHooksEnabled'
      | 'defaultTuiAgent'
      | 'disabledTuiAgents'
      | 'agentDefaultArgs'
      | 'agentDefaultEnv'
      | 'defaultTaskSource'
      | 'defaultTaskViewPreset'
      | 'visibleTaskProviders'
      | 'defaultRepoSelection'
      | 'defaultLinearTeamSelection'
      | 'githubProjects'
      | 'experimentalNewWorktreeCardStyle'
      | 'compactWorktreeCards'
      | 'minimaxGroupId'
      | 'minimaxUsageModels'
      | 'prBotAuthorOverrides'
    >
  ): Promise<
    Pick<
      GlobalSettings,
      | 'defaultTuiAgent'
      | 'disabledTuiAgents'
      | 'agentCmdOverrides'
      | 'agentDefaultArgs'
      | 'agentDefaultEnv'
      | 'agentStatusHooksEnabled'
      | 'defaultTaskSource'
      | 'defaultTaskViewPreset'
      | 'visibleTaskProviders'
      | 'defaultRepoSelection'
      | 'defaultLinearTeamSelection'
      | 'githubProjects'
      | 'experimentalNewWorktreeCardStyle'
      | 'compactWorktreeCards'
      | 'minimaxGroupId'
      | 'minimaxUsageModels'
      | 'prBotAuthorOverrides'
    >
  > {
    return this.clientSettingsCommands.updateClientSettings(updates)
  }
  getClientTerminalQuickCommands(): TerminalQuickCommand[] {
    return this.clientSettingsCommands.getClientTerminalQuickCommands()
  }
  updateClientTerminalQuickCommands(
    mutation: TerminalQuickCommandMutation
  ): TerminalQuickCommand[] {
    return this.clientSettingsCommands.updateClientTerminalQuickCommands(mutation)
  }
  updateClientPRBotAuthorOverride(args: { author: string; isBot: boolean }) {
    return this.clientSettingsCommands.updateClientPRBotAuthorOverride(args)
  }
  listAutomations(): Automation[] {
    return this.automationCommands.listAutomations()
  }
  listAutomationRuns(automationId?: string): AutomationRun[] {
    return this.automationCommands.listAutomationRuns(automationId)
  }
  showAutomation(id: string): Automation {
    return this.automationCommands.showAutomation(id)
  }
  async createAutomation(input: RuntimeAutomationCreateInput): Promise<Automation> {
    return this.automationCommands.createAutomation(input)
  }
  async updateAutomation(id: string, updates: RuntimeAutomationUpdateInput): Promise<Automation> {
    return this.automationCommands.updateAutomation(id, updates)
  }
  deleteAutomation(id: string): { removed: boolean; id: string } {
    return this.automationCommands.deleteAutomation(id)
  }
  async runAutomationNow(id: string): Promise<AutomationRun> {
    return this.automationCommands.runAutomationNow(id)
  }

  // Why: lazy initialization — the DB path depends on Electron's userData
  // which may not be finalized until after app.ready. Also allows unit tests
  // to inject an in-memory DB without touching the filesystem.
  getOrchestrationDb(): OrchestrationDb {
    if (!this._orchestrationDb) {
      const { app } = require('electron')
      const dbPath = join(app.getPath('userData'), 'orchestration.db')
      this._orchestrationDb = new OrchestrationDb(dbPath)
    }
    return this._orchestrationDb
  }
  setOrchestrationDb(db: OrchestrationDb): void {
    this._orchestrationDb = db
  }
  protected getLegacyWorkerTerminalRecoveryPlan(): LegacyWorkerTerminalRecoveryPlan {
    try {
      return planLegacyWorkerTerminalRecovery(
        this.getOrchestrationDb().listLegacyWorkerTerminalRecoveryRows()
      )
    } catch (error) {
      console.warn('[orchestration] failed to plan legacy worker terminal recovery', error)
      return { blockedPanes: [], candidates: [], ambiguousDispatchIds: [] }
    }
  }
  prepareLegacyWorkerTerminalRecovery(): LegacyWorkerTerminalRecoveryPlan {
    const plan = this.getLegacyWorkerTerminalRecoveryPlan()
    const store = this.store
    if (!store?.getWorkspaceSession || !store.setWorkspaceSession || !store.flushOrThrow) {
      return plan
    }
    const sessions = new Map<
      ExecutionHostId,
      { current: WorkspaceSessionState; next: WorkspaceSessionState }
    >()
    const changedHostIds = new Set<ExecutionHostId>()
    for (const blocked of plan.blockedPanes) {
      let hostIds: ExecutionHostId[]
      try {
        hostIds = [this.getWorkspaceSessionHostIdForWorktree(blocked.worktreeId)]
      } catch (error) {
        console.warn('[orchestration] legacy worker resume fence owner is unavailable', {
          worktreeId: blocked.worktreeId,
          error
        })
        hostIds = store.getWorkspaceSessionHostIds?.() ?? [LOCAL_EXECUTION_HOST_ID]
      }
      for (const hostId of hostIds) {
        let state = sessions.get(hostId)
        if (!state) {
          const current = store.getWorkspaceSession(hostId)
          if (!current) {
            continue
          }
          state = { current, next: structuredClone(current) }
          sessions.set(hostId, state)
        }
        const record = state.next.sleepingAgentSessionsByPaneKey?.[blocked.paneKey]
        if (
          !record ||
          !runtimeWorktreeIdsEqual(record.worktreeId, blocked.worktreeId) ||
          record.automaticResumeBlockedBy === 'legacy-orchestration-worker'
        ) {
          continue
        }
        state.next.sleepingAgentSessionsByPaneKey = {
          ...state.next.sleepingAgentSessionsByPaneKey,
          [blocked.paneKey]: {
            ...record,
            automaticResumeBlockedBy: 'legacy-orchestration-worker'
          }
        }
        changedHostIds.add(hostId)
      }
    }
    const changed = [...sessions].filter(([hostId]) => changedHostIds.has(hostId))
    if (changed.length === 0) {
      return plan
    }
    try {
      for (const [hostId, state] of changed) {
        store.setWorkspaceSession(state.next, hostId)
      }
      store.flushOrThrow()
    } catch (error) {
      console.warn('[orchestration] failed to persist legacy worker resume fence', error)
    }
    return plan
  }
  async reconcileLegacyWorkerTerminals(
    options: { connectionId?: string; materializeRenderer?: boolean } = {}
  ): Promise<LegacyWorkerTerminalRecoveryResult> {
    let resolveResult!: (result: LegacyWorkerTerminalRecoveryResult) => void
    let rejectResult!: (error: unknown) => void
    const result = new Promise<LegacyWorkerTerminalRecoveryResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const run = this.legacyWorkerTerminalRecoveryQueue.then(async () => {
      try {
        resolveResult(await this.reconcileLegacyWorkerTerminalsNow(options))
      } catch (error) {
        rejectResult(error)
      }
    })
    this.legacyWorkerTerminalRecoveryQueue = run.catch(() => undefined)
    return result
  }
  async refreshRestoredOrchestrationAuthority(connectionId: string | null = null): Promise<void> {
    if (connectionId === null && !this.canRecoverPersistentLocalPtysFn()) {
      return
    }
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      [...(await this.getResolvedWorktreeMap()).values()],
      null,
      undefined,
      connectionId
    )
    if (!inventory) {
      throw new Error('terminal_liveness_unavailable')
    }
  }
  protected hasExactTerminalSurfaceIdentity(expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    terminalHandle: string
    incarnationId: string
  }): boolean {

    if (this.graphStatus !== 'ready') {
      return false
    }
    const pty = this.ptysById.get(expected.ptyId)
    if (
      !pty?.connected ||
      pty.incarnationId !== expected.incarnationId ||
      pty.tabId !== expected.tabId ||
      pty.paneKey !== makePaneKey(expected.tabId, expected.leafId) ||
      !runtimeWorktreeIdsEqual(pty.worktreeId, expected.worktreeId) ||
      this.handleByPtyId.get(expected.ptyId) !== expected.terminalHandle
    ) {
      return false
    }
    const tab = this.tabs.get(expected.tabId)
    const leaf = this.leaves.get(this.getLeafKey(expected.tabId, expected.leafId))
    const ptyLeaves = this.getLeavesForPty(expected.ptyId)
    return (
      Boolean(tab && runtimeWorktreeIdsEqual(tab.worktreeId, expected.worktreeId)) &&
      Boolean(
        leaf &&
        leaf.ptyId === expected.ptyId &&
        runtimeWorktreeIdsEqual(leaf.worktreeId, expected.worktreeId)
      ) &&
      ptyLeaves.length === 1 &&
      ptyLeaves[0]?.tabId === expected.tabId &&
      ptyLeaves[0]?.leafId === expected.leafId
    )
  }
  protected hasExactPersistedTerminalSurfaceIdentity(expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    incarnationId: string
  }): boolean {
    const session = this.getWorkspaceSessionForWorktree(expected.worktreeId)
    const sessionWorktreeId = session
      ? resolveTerminalSessionWorktreeId(session, expected.worktreeId)
      : null
    if (!session || !sessionWorktreeId) {
      return false
    }
    const tab = session.tabsByWorktree[sessionWorktreeId]?.find(
      (candidate) => candidate.id === expected.tabId
    )
    const paneKey = makePaneKey(expected.tabId, expected.leafId)
    return Boolean(
      tab &&
      session.terminalLayoutsByTabId[expected.tabId]?.ptyIdsByLeafId?.[expected.leafId] ===
        expected.ptyId &&
      session.terminalPtyIncarnationsByPaneKey?.[paneKey] === expected.incarnationId
    )
  }
  protected persistLegacyWorkerTerminalRecoveryResolution(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number],
    resolution: 'adopted' | 'exited'
  ): boolean {
    const store = this.store
    const session = this.getWorkspaceSessionForWorktree(candidate.worktreeId)
    if (!store?.setWorkspaceSession || !store.flushOrThrow || !session) {
      return false
    }
    const record = session.sleepingAgentSessionsByPaneKey?.[candidate.paneKey]
    if (!record || !runtimeWorktreeIdsEqual(record.worktreeId, candidate.worktreeId)) {
      return true
    }
    const next = structuredClone(session)
    delete next.sleepingAgentSessionsByPaneKey?.[candidate.paneKey]
    try {
      this.setWorkspaceSessionForWorktree(candidate.worktreeId, next)
      store.flushOrThrow()
      return true
    } catch (error) {
      this.setWorkspaceSessionForWorktree(candidate.worktreeId, session)
      console.warn('[orchestration] failed to persist legacy worker recovery resolution', {
        dispatchId: candidate.dispatchId,
        resolution,
        error
      })
      return false
    }
  }
  protected reconcileMissingLegacyWorkerTerminal(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number]
  ): boolean {
    if (candidate.dispatchStatus !== 'pending' && candidate.dispatchStatus !== 'dispatched') {
      return true
    }
    try {
      this.getOrchestrationDb().reconcileMissingWorkerTerminal(
        candidate.dispatchId,
        'The assigned worker terminal is no longer live after orchestration recovery.'
      )
      return true
    } catch (error) {
      console.warn('[orchestration] failed to reconcile missing worker terminal', {
        dispatchId: candidate.dispatchId,
        error
      })
      return false
    }
  }
}
