import {
  type GlobalSettings,
  type PersistedUIState,
  type StatsSummary,
  type MemorySnapshot,
  type TerminalQuickCommand,
  type FeatureInteractionId,
  type TerminalQuickCommandMutation,
  type IPtyProvider,
  collectMemorySnapshot,
  killAllProcessesForWorktree,
  type RuntimeClientSettings
} from './orca-runtime-symbols'
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
  async updateClientSettings(
    updates: Pick<
      Partial<GlobalSettings>,
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
}
