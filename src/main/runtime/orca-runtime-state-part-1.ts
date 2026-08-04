import { type RemoteTerminalSourceRangeConsumerHooks, randomUUID, type RuntimeClientEvent, type RuntimeGraphStatus, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeSyncedTab, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type PtyIncarnationId, RemoteRuntimeTerminalCreateIdempotency, TerminalOutputState, WorktreeResolutionState, RuntimeTerminalInputCommands, type RetiredTerminalSurface, ClientSessionTabSelectionStore, type AgentBrowserBridge, type BrowserBackend, RuntimeNotificationRegistry, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type PtyForegroundAgentRefresh, type RuntimeHeadlessTerminal, type RuntimePtyController, type RuntimeNotifier, type TerminalHandleRecord, type TerminalWaiter, type RuntimeWorktreeScanResult, type ResolvedWorktreeSnapshot, type RuntimeWorktreeLifecycleEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, type AgentDetector, type RuntimeClientSettingsCommands } from './orca-runtime-symbols'
import { OrcaRuntimeMethodSurface } from './orca-runtime-state-surface'

export class OrcaRuntimeStatePart1 extends OrcaRuntimeMethodSurface {
  protected readonly runtimeId = randomUUID()
  protected readonly startedAt = Date.now()
  protected store!: RuntimeStore | null
  protected clientSettingsCommands!: RuntimeClientSettingsCommands
  protected managedHookReconciliationGeneration = 0
  protected managedHookReconciliationTail: Promise<void> = Promise.resolve()
  protected rendererGraphEpoch = 0
  protected graphStatus: RuntimeGraphStatus = 'unavailable'
  protected authoritativeWindowId: number | null = null
  protected tabs = new Map<string, RuntimeSyncedTab>()
  protected mobileSessionTabsByWorktree = new Map<string, RuntimeMobileSessionTabsSnapshot>()
  // Why: renderer publication ordering must be judged against the renderer's
  // own last-accepted (epoch, version) — never against the stored snapshot's
  // version, which main-local touches bump independently and can push
  // permanently ahead of the renderer's counter. The renderer reuses one pair
  // for byte-identical content, so a same-epoch version <= this one is a no-op
  // resend (or stale) and is skipped without touching the stored entry.
  protected acceptedRendererMobileSnapshotByWorktree = new Map<
    string,
    { publicationEpoch: string; rendererVersion: number }
  >()
  protected clientSessionTabSelections = new ClientSessionTabSelectionStore()
  // Why: idempotency map for mobile terminal creation — a retried create with the
  // same clientMutationId returns the in-flight operation instead of duplicating.
  protected mobileTerminalCreateByMutationId = new Map<
    string,
    Promise<RuntimeMobileSessionCreateTerminalResult>
  >()
  protected readonly terminalCreateIdempotency = new RemoteRuntimeTerminalCreateIdempotency()
  // Why: concurrent clients sleeping one host workspace must share one physical teardown.
  protected terminalSleepByWorktreeId = new Map<string, Promise<RuntimeWorktreeTerminalSleepResult>>()
  protected terminalMutationTailByWorktreeId = new Map<string, Promise<void>>()
  protected terminalSleepStateByWorktreeId = new Map<
    string,
    {
      worktreeId: string
      generation: number
      phase: 'stopping' | 'partial' | 'sleeping'
      ptyIds: string[]
      terminalHandles: string[]
      terminalHandlesByPtyId: Record<string, string[]>
    }
  >()
  protected terminalSleepGeneration = 0
  protected terminalPaneRecoveryByIdentity = new Map<string, Promise<RuntimeTerminalResolvePane>>()
  // Why: idempotency map for worktree.create — a create interrupted by a mobile
  // connection migration is retried with the same clientMutationId and returns
  // the in-flight (or just-finished) operation instead of a duplicate worktree.
  protected worktreeCreateByMutationId = new Map<string, Promise<unknown>>()
  // Why: a mobile create waits for the renderer to publish the new tab's surface
  // via graph-sync, but a throttled/hidden renderer can park that past the surface
  // timeout and the create would then destroy the live PTY (#7587). This lets the
  // renderer's own PTY spawn publish the surface main-side, scoped to in-flight
  // creates so ordinary renderer spawns never publish here.
  protected pendingMobileTerminalCreatesByKey = new Map<
    string,
    {
      activate: boolean
      selectIfNoActiveTab: boolean
      viewMode?: 'terminal' | 'chat'
    }
  >()
  protected mobileSessionTabListeners = new Set<{
    listener: (snapshot: RuntimeMobileSessionTabsResult) => void
    clientNavigationId?: string
  }>()
  // Why: one watermark per repo replaces per-closed-pane fences while preserving stale-write safety.
  protected terminalTopologyRevisionByRepoId = new Map<string, number>()
  // Why: a deleted folder has no durable host session left to carry its stale-snapshot fence.
  protected deletedFolderTerminalRetirementFences = new Set<string>()
  // Why: a successful in-memory retirement must reject an older renderer snapshot until a live replacement owns the pane.
  protected terminalSurfaceRetirementFences = new Set<string>()
  // Why: provider exit can beat surface registration; that exact dead incarnation must never publish.
  protected earlyExitedPtyIncarnations = new Map<string, PtyIncarnationId | null>()
  // Why: quarantine disconnects the model, so retain provider evidence per exact incarnation.
  protected observedPtyExitIncarnations = new Map<string, Set<PtyIncarnationId>>()
  // Why: durable retirement can fail after in-memory exit state is recorded; retain the exact surfaces for an idempotent retry.
  protected pendingPtyDurableRetirements = new Map<
    string,
    {
      ptyId: string
      incarnationId: PtyIncarnationId
      exactSurfaces: readonly Pick<
        RetiredTerminalSurface,
        'worktreeId' | 'parentTabId' | 'leafId'
      >[]
    }
  >()
  protected pendingPtyDurableRetirementRetryAttempts = new Map<string, number>()
  protected pendingPtyDurableRetirementRetryScheduled = new Set<string>()
  protected pendingPtyRegistrationIncarnations = new Map<string, PtyIncarnationId | null>()
  protected headlessPtyIncarnationById = new Map<string, PtyIncarnationId>()
  protected ptyInventoryOverlapGraceById = new Map<string, PtyIncarnationId | null>()
  // Why: exact-stop is the current sleep transaction boundary; its exit must
  // leave the renderer's intentional sleeping surface available for wake.
  protected intentionalHandlelessPtyStops = new Map<string, string | null>()
  // Why: coalesces title/status-driven session.tabs emits so spinner churn
  // doesn't fan out (and per-client JSON.stringify) a snapshot several times a
  // second. Emit reads the latest snapshot, so only the freshest version ships.
  protected readonly mobileSessionTabsNotifyCoalescer: MobileSessionTabsNotifyCoalescer =
    createMobileSessionTabsNotifyCoalescer((worktreeId) =>
      this.notifyMobileSessionTabsChangedNow(worktreeId)
    )
  protected pendingMobileSessionPtyInventoryRefresh: Promise<Set<string> | null> | null = null
  protected leaves = new Map<string, RuntimeLeafRecord>()
  // Why: PTY output is a per-keystroke hot path. Looking up affected leaves by
  // ptyId keeps active TUI redraws independent of the total open terminal count.
  protected leavesByPtyId = new Map<string, RuntimeLeafRecord[]>()
  protected handles = new Map<string, TerminalHandleRecord>()
  protected handleByLeafKey = new Map<string, string>()
  protected handleByPtyId = new Map<string, string>()
  protected syntheticTerminalHandles = new Set<string>()
  protected detachedPreAllocatedLeaves = new Map<string, RuntimeLeafRecord>()
  protected graphSyncCallbacks: (() => void)[] = []
  protected waitersByHandle = new Map<string, Set<TerminalWaiter>>()
  protected ptyController: RuntimePtyController | null = null
  protected notifier: RuntimeNotifier | null = null
  protected clientEventListeners = new Set<(event: RuntimeClientEvent) => void>()
  // Why: mobile subscribers discard terminalSideEffects; exclude them from batch delivery and production.
  protected terminalSideEffectExcludedClientEventListeners = new Set<
    (event: RuntimeClientEvent) => void
  >()
  protected nativeChatLaunchDraftResolutionByTabId = new Map<
    string,
    NativeChatLaunchDraftResolutionTombstone
  >()
  protected worktreeLifecycleListeners = new Set<(event: RuntimeWorktreeLifecycleEvent) => void>()
  protected forkBackfillStarted = false
  protected agentBrowserBridge: AgentBrowserBridge | null = null
  protected offscreenBrowserBackend: BrowserBackend | null = null
  protected readonly worktreeResolutionState = new WorktreeResolutionState<
    ResolvedWorktreeSnapshot,
    RuntimeWorktreeScanResult
  >()
  protected cloneInFlightByPath = new Map<string, Promise<void>>()
  protected agentDetector: AgentDetector | null = null
  protected ptyForegroundAgentRefreshes = new Map<string, PtyForegroundAgentRefresh>()
  protected ptyDelayedForegroundSnapshotTitleObservations = new Map<string, number>()
  // Why: mobile clients subscribe to terminal output via terminal.subscribe.
  // These listeners fire on every onPtyData call, enabling real-time streaming
  // without polling. Keyed by ptyId for O(1) lookup per data event.
  protected remoteTerminalSourceRangeConsumerHooks: RemoteTerminalSourceRangeConsumerHooks | null =
    null
  // Why: startup draft paste can subscribe after the agent already emitted its
  // ready marker. Keep a bounded raw buffer so fast startup output is replayed.
  protected setupCompletionTokenByPtyId = new Map<string, string>()
  // Why: mobile clients need to know when the desktop restores a terminal
  // from mobile-fit so they can update their UI. These listeners are
  // invoked from resizeForClient and onClientDisconnected/onPtyExit.
  protected fitOverrideListeners = new Map<
    string,
    Set<
      (event: {
        mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
        cols: number
        rows: number
      }) => void
    >
  >()
  protected driverListeners = new Map<string, Set<(driver: DriverState) => void>>()
  protected subscriptionCleanups = new Map<string, () => void | Promise<void>>()
  protected subscriptionCleanupPromises = new Map<
    string,
    { cleanup: () => void | Promise<void>; promise: Promise<void> }
  >()
  // Why: index of subscriptionIds by per-WebSocket connectionId so the
  // server can sweep all subscriptions for a closing socket without
  // touching subscriptions on other live sockets that share the same
  // deviceToken (multi-screen mobile).
  protected subscriptionsByConnection = new Map<string, Set<string>>()
  protected subscriptionConnectionByEntry = new Map<string, string>()
  protected activeBrowserScreencastsByConnection = new Map<
    string,
    { cancel: (emitEnd?: boolean) => void; done: Promise<void>; connectionKey: string }
  >()
  protected activeBrowserScreencastsByPage = new Map<
    string,
    { cancel: (emitEnd?: boolean) => void; done: Promise<void>; connectionKey: string }
  >()
  // Why: mobile clients subscribe to desktop notifications via
  // notifications.subscribe. This set enables fan-out — each connected
  // mobile client gets its own listener, and dispatchMobileNotification
  // iterates them all. Listeners are cleaned up via subscriptionCleanups.
  protected readonly notificationRegistry = new RuntimeNotificationRegistry()
  protected ptysById = new Map<string, RuntimePtyWorktreeRecord>()
  protected wslDistroByPtyId = new Map<string, string>()
  protected titleObservationSequence = 0
  protected headlessTerminals = new Map<string, RuntimeHeadlessTerminal>()
  protected readonly terminalOutputState = new TerminalOutputState()
  // Compatibility view for IPC diagnostics that inspect the authoritative map.
  readonly ptyOutputSequenceById = this.terminalOutputState.sequenceMap
  protected readonly terminalInputCommands = new RuntimeTerminalInputCommands(
    () => this.ptyController
  )
  protected readonly writeTerminalAction = this.terminalInputCommands.writeTerminalAction.bind(
    this.terminalInputCommands
  )
  protected readonly writeTerminalInputChunks =
    this.terminalInputCommands.writeTerminalInputChunks.bind(this.terminalInputCommands)
  protected readonly writeTerminalAgentPrompt =
    this.terminalInputCommands.writeTerminalAgentPrompt.bind(this.terminalInputCommands)
  protected providerSequenceInitializedPtys = new Set<string>()
  protected providerSequenceOffsetByPtyId = new Map<string, number>()
  protected providerSnapshotPreferredPtys = new Set<string>()
}
