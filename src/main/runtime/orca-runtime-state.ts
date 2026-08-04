import { type TerminalSideEffectBatch, type AgentStatusIpcPayload, type AgentHookAuthorityAttestation, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, type RuntimeDesktopWindowStatus, configureAiVaultSessionSources, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type IPtyProvider, type StatsCollector, AgentDetector, registerConptyDa1OverrideInstaller, registerTerminalViewAttributesApplier, RuntimeClientSettingsCommands, RuntimeAutomationCommands, RuntimeRepoHookCommands, type RuntimeStore, type RuntimeTerminalAgentStatusEvent } from './orca-runtime-symbols'
import { OrcaRuntimeStatePart3 } from './orca-runtime-state-part-3'

export class OrcaRuntimeState extends OrcaRuntimeStatePart3 {

  constructor(
    store: RuntimeStore | null = null,
    stats?: StatsCollector,
    deps?: {
      getLocalProvider?: () => IPtyProvider
      getSshProvider?: (connectionId: string) => IPtyProvider | undefined
      onPtyStopped?: (ptyId: string) => void
      onTerminalAgentStatus?: (event: RuntimeTerminalAgentStatusEvent) => void
      onTerminalSideEffects?: (batch: TerminalSideEffectBatch) => void
      // Why: agent status mostly arrives via hooks (agent-hooks/server), not OSC
      // terminal output. worktree.ps reads this at query time so mobile shows the
      // same inline agent rows the desktop sidebar does — same source, 1:1.
      getAgentStatusSnapshot?: () => AgentStatusIpcPayload[]
      /** Same rows, but including the resume-identity-only ones `getAgentStatusSnapshot`
       *  filters out so they can't read as running agents. Mobile native chat needs
       *  them: for an agent that publishes identity separately (Pi), that row is the
       *  only carrier of the provider session a transcript is addressed by. */
      getAgentProviderSessionSnapshot?: () => AgentStatusIpcPayload[]
      getAgentProviderSessionRowsForPane?: (paneKey: string) => AgentStatusIpcPayload[]
      attestAgentHookCompatibilityAuthority?: (candidate: {
        paneKey: string
        launchTokenHash: string
        connectionId: string | null
        terminalProvenance: 'current_runtime' | 'restored'
      }) => AgentHookAuthorityAttestation | null
      retireAgentHookCompatibilityAuthority?: (paneKey: string) => void
      canRecoverPersistentLocalPtys?: () => boolean
      // Why: codex-home paths for the Agent Session History scan must be sourced
      // here, not via the window-only registerCoreHandlers path — that path never
      // runs under `orca serve`, so remote/SSH hosts would silently drop
      // managed-Codex sessions. The runtime ctor runs in BOTH window and serve.
      getAdditionalAiVaultCodexHomePaths?: () => readonly string[]
      prepareAiVaultSessionResume?: (
        args: AiVaultPrepareSessionResumeArgs
      ) => Promise<AiVaultPrepareSessionResumeResult>
      buildAgentHookPtyEnv?: () => Record<string, string>
      getDesktopWindowStatus?: () => RuntimeDesktopWindowStatus
      agentSessionClaimSigner?: AgentSessionClaimSigner
    }
  ) {
    super()
    this.store = store
    this.clientSettingsCommands = new RuntimeClientSettingsCommands(store, () =>
      this.reconcileManagedAgentHooks()
    )
    this.automationCommands = new RuntimeAutomationCommands(
      store,
      {
        showRepo: (selector) => this.showRepo(selector),
        showManagedWorktree: (selector) => this.showManagedWorktree(selector)
      },
      (id) => {
        if (!this.automationService) {
          throw new Error('runtime_unavailable')
        }
        return this.automationService.runNow(id)
      }
    )
    this.repoHookCommands = new RuntimeRepoHookCommands({
      resolveRepoSelector: (selector) => this.resolveRepoSelector(selector)
    })
    // Why: per-device tab selections must survive host restarts, or every phone snaps back to the first tab on return.
    const persistedClientTabSelections = store?.getMobileClientTabSelections?.()
    if (persistedClientTabSelections) {
      this.clientSessionTabSelections.hydrate(persistedClientTabSelections)
    }
    this.clientSessionTabSelections.setPersistListener((state) => {
      this.store?.setMobileClientTabSelections?.(state)
    })
    if (stats) {
      this.stats = stats
      this.agentDetector = new AgentDetector(stats)
    }
    this.getAgentStatusSnapshotFn = deps?.getAgentStatusSnapshot ?? null
    this.getAgentProviderSessionSnapshotFn =
      deps?.getAgentProviderSessionSnapshot ?? deps?.getAgentStatusSnapshot ?? null
    this.getAgentProviderSessionRowsForPaneFn = deps?.getAgentProviderSessionRowsForPane ?? null
    this.attestAgentHookCompatibilityAuthorityFn =
      deps?.attestAgentHookCompatibilityAuthority ?? null
    this.retireAgentHookCompatibilityAuthorityFn =
      deps?.retireAgentHookCompatibilityAuthority ?? null
    this.canRecoverPersistentLocalPtysFn = deps?.canRecoverPersistentLocalPtys ?? (() => true)
    // Why: configure the shared AiVault scan cache from a serve-mode-reachable
    // seam so the aiVault.listSessions RPC includes managed-Codex + WSL sessions
    // even on headless `orca serve` hosts where registerCoreHandlers never runs.
    if (deps?.getAdditionalAiVaultCodexHomePaths) {
      configureAiVaultSessionSources({
        getAdditionalCodexHomePaths: deps.getAdditionalAiVaultCodexHomePaths
      })
    }
    // Why: the daemon adapter is installed via `setLocalPtyProvider()` during
    // attachMainWindowServices, AFTER this service is constructed. Capturing
    // `getLocalPtyProvider()` at construction time would freeze a reference to
    // the pre-daemon `LocalPtyProvider` and miss the routed adapter. Resolve
    // lazily via thunk so teardown always sees the currently-installed
    // provider (design §4.3 wire-up).
    this.getLocalProviderFn = deps?.getLocalProvider ?? null
    this.getSshProviderFn = deps?.getSshProvider ?? null
    this.onPtyStopped = deps?.onPtyStopped ?? null
    this.onTerminalAgentStatus = deps?.onTerminalAgentStatus ?? null
    this.buildAgentHookPtyEnv = deps?.buildAgentHookPtyEnv ?? null
    this.getDesktopWindowStatusFn = deps?.getDesktopWindowStatus ?? (() => 'openable')
    this.prepareAiVaultSessionResumeFn = deps?.prepareAiVaultSessionResume ?? null
    this.agentSessionClaimSigner =
      deps?.agentSessionClaimSigner ?? createEphemeralAgentSessionClaimSigner(this.runtimeId)
    this.onTerminalSideEffects = deps?.onTerminalSideEffects ?? null
    // Why: the ConPTY spawn mark can land after daemon stream data already
    // created this PTY's emulator; the mark retrofits the DA1 override here
    // (terminal-query-authority.md §ConPTY DA1).
    registerConptyDa1OverrideInstaller((ptyId) => this.ensureNativeWindowsConptyDa1Override(ptyId))
    // Why: a renderer attribute push must reach already-live emulators too —
    // cursor options for DECRQSS/DECRQM parity plus the per-PTY OSC color
    // override reset a theme apply implies (terminal-query-authority.md
    // §View-attribute bridge).
    registerTerminalViewAttributesApplier((attributes) => {
      for (const state of this.headlessTerminals.values()) {
        state.emulator.applyPushedViewAttributes(attributes)
      }
    })
  }
}
