import type { RuntimeRepoHookCommands } from './orca-runtime-symbols'
import {
  type TerminalSideEffectBatch,
  type AgentStatusIpcPayload,
  type AgentSessionClaimSigner,
  type RuntimeDesktopWindowStatus,
  type IPtyProvider,
  ClaudeAgentTeamsService,
  type StatsCollector,
  type CommitMessageAgentEnvironmentResolvers,
  PtyLayoutQueue,
  type PtyLayoutState,
  PtyGenerationReferenceCount,
  type PreservedBranchCleanupTarget,
  type RuntimeWorktreeRemovalInFlight,
  type RemoteFetchResult,
  type RuntimeTerminalAgentStatusEvent,
  type AgentSessionCreateOperation
} from './orca-runtime-symbols'
import { OrcaRuntimeStatePart2 } from './orca-runtime-state-part-2'

export class OrcaRuntimeStatePart3 extends OrcaRuntimeStatePart2 {
  protected pendingRestoreTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; clientId: string }
  >()

  // Why: inline resize events replace the unsubscribe→resubscribe pattern.
  // Listeners are notified when mode changes or desktop restores, allowing
  // the subscribe stream to emit a 'resized' event with fresh scrollback.
  // `seq` is the layout state-machine sequence number bumped on every
  // applyLayout success; mobile clients use it to drop stale events that
  // arrive after a newer transition. See docs/mobile-terminal-layout-state-machine.md.
  protected resizeListeners = new Map<
    string,
    Set<
      (event: {
        cols: number
        rows: number
        displayMode: string
        reason: string
        seq?: number
      }) => void
    >
  >()

  // Why: per-PTY layout state machine. `applyLayout` is the sole writer of
  // `layouts`, `terminalFitOverrides`, and `ptyController.resize`; every
  // trigger method routes through `enqueueLayout`. The monotonic `seq` is
  // emitted on the mobile subscribe stream so clients can drop stale events.
  // See docs/mobile-terminal-layout-state-machine.md.
  protected layouts = new Map<string, PtyLayoutState>()

  // Why: queue ownership is separate from layout application so resize order
  // and generation cancellation stay testable without a live PTY provider.
  protected readonly layoutQueue = new PtyLayoutQueue({
    getGeneration: (ptyId) => this.getPtyLifecycleGeneration(ptyId),
    hasLayout: (ptyId) => this.layouts.has(ptyId),
    isFreshSubscribe: (ptyId, generation) => this.isFreshSubscribe(ptyId, generation),
    apply: (ptyId, target, generation, resizeMutation) =>
      this.applyLayout(ptyId, target, generation, resizeMutation)
  })

  // Why: gate so enqueueLayout's "no layouts entry" short-circuit doesn't
  // fire on the very first transition for a PTY (where the entry doesn't
  // exist yet *because* we're about to create it). `handleMobileSubscribe`
  // adds the ptyId before calling enqueueLayout and removes it after the
  // call resolves.
  protected freshSubscribeGuard = new PtyGenerationReferenceCount()
  protected stats: StatsCollector | null = null
  // Why (§3.3 + §7.1): the renderer-create path and coordinator
  // `probeWorktreeDrift` share this cache so a create that already fetched
  // `origin` within the last 30s does not re-fetch during dispatch, and
  // vice-versa. Keyed by `<repoPath>::<remote>` so multi-remote repos (even
  // though v1 only uses `origin`) don't cross-contaminate. The in-flight Map
  // also provides serialization — two concurrent callers share a single
  // underlying `git fetch`. Full-remote fetch lifecycle rules:
  //   - entry inserted BEFORE await,
  //   - `.finally()` removes the entry on BOTH success and rejection,
  //   - timestamp written ONLY on success (rejection must not make the
  //     30s freshness cache lie).
  // A literal "insert before await / read-back after await" without these
  // three rules wedges future fetches on the same repo after a single
  // DNS hiccup until process restart (see §3.3 Lifecycle). Exact base-ref
  // refreshes share the in-flight rule and maintain their own exact-base
  // freshness entries; a full-remote fetch may be narrowed by repo refspecs,
  // so it must not prove a specific branch for create.
  protected fetchInflight = new Map<string, Promise<RemoteFetchResult>>()
  // Why: `git fetch origin` and `git fetch origin <refspec>` contend for the
  // same repo remote/ref locks. This queue serializes all fetch shapes for one
  // canonical repo+remote while still letting same-shape callers share promises.
  protected remoteFetchQueueTail = new Map<string, Promise<RemoteFetchResult>>()
  protected fetchLastCompletedAt = new Map<string, number>()
  // Why: `getCanonicalFetchKey` is awaited from every freshness probe and
  // every getOrStartRemoteFetch call. Without memoization the warm-cache hot
  // path spawns a `git rev-parse --git-common-dir` subprocess per touch
  // (twice in createLocalWorktree). Cache by `<repoPath>::<remote>` so the
  // canonical key is resolved at most once per repo+remote in the process.
  protected canonicalFetchKeyCache = new Map<string, string>()
  protected optimisticReconcileTokens = new Map<string, string>()
  protected removeManagedWorktreeInFlight = new Map<string, RuntimeWorktreeRemovalInFlight>()
  protected preservedBranchCleanupByWorktreeId = new Map<string, PreservedBranchCleanupTarget>()
  protected getLocalProviderFn!: (() => IPtyProvider) | null
  protected getSshProviderFn!: ((connectionId: string) => IPtyProvider | undefined) | null
  protected onPtyStopped!: ((ptyId: string) => void) | null
  protected onTerminalAgentStatus!: ((event: RuntimeTerminalAgentStatusEvent) => void) | null
  protected onTerminalSideEffects!: ((batch: TerminalSideEffectBatch) => void) | null
  protected terminalSideEffectLocalConsumerAvailable = false
  protected terminalSideEffectConsumerAvailable = false
  protected getAgentStatusSnapshotFn!: (() => AgentStatusIpcPayload[]) | null
  protected getAgentProviderSessionSnapshotFn!: (() => AgentStatusIpcPayload[]) | null
  protected getAgentProviderSessionRowsForPaneFn!:
    | ((paneKey: string) => AgentStatusIpcPayload[])
    | null
  protected retireAgentHookCompatibilityAuthorityFn!: ((paneKey: string) => void) | null
  protected canRecoverPersistentLocalPtysFn!: () => boolean
  protected buildAgentHookPtyEnv!: (() => Record<string, string>) | null
  protected getDesktopWindowStatusFn!: () => RuntimeDesktopWindowStatus
  protected agentSessionClaimSigner!: AgentSessionClaimSigner
  protected readonly agentSessionCreateOperations = new Map<string, AgentSessionCreateOperation>()
  protected sshRelayRecoveryGenerationByTargetId = new Map<string, number>()
  protected ptyControllerInventorySequence = 0
  protected ptyControllerAggregateInventoryGeneration = 0
  protected ptyControllerInventoryGenerationByProvider = new Map<string, number>()
  protected commitMessageAgentEnv: CommitMessageAgentEnvironmentResolvers | null = null
  protected repoHookCommands!: RuntimeRepoHookCommands
  protected readonly claudeAgentTeams = new ClaudeAgentTeamsService()
}
