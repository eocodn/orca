import { createHash, randomBytes } from 'node:crypto'
import type { createServer } from 'node:http'

import * as hookShared from './agent-hook-server-shared'
import type {
  AgentHookAuthorityAttestation,
  AgentHookAuthorityEvidence,
  AgentHookProviderSessionIdentity,
  AgentHookStatusChangeEntry
} from './agent-hook-server-shared'
import {
  clearClaudeAnsweredQuestionWait,
  createHookListenerState,
  markClaudeLeadTurnInterrupted,
  markCodexLeadTurnInterrupted,
  type AgentHookEventPayload,
  type HookListenerState
} from '../../shared/agent-hook-listener'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload,
  type AgentType
} from '../../shared/agent-status-types'
import type { ClaudeStatusLineRateLimits } from '../../shared/claude-statusline-rate-limits'
import {
  isAgentInterruptInputIntent,
  type AgentInterruptInferenceRequest
} from '../../shared/agent-interrupt-intent'
import {
  isAskUserQuestionTool,
  type AgentQuestionAnsweredInferenceRequest
} from '../../shared/agent-question-answered-intent'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { isCommandCodeNewTurnWhileWorking } from '../../shared/command-code-turn-boundary'

const {
  agentTypeToPromptSentAgentKind,
  equivalentInterruptAgentType,
  isValidPaneKey,
  toAgentStatusIpcPayload,
  CLOSED_AGENT_STATUS_TAB_IDS_MAX,
  CLOSED_AGENT_STATUS_PANE_KEYS_MAX
} = hookShared

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload
type StatusChangeListener = hookShared.StatusChangeListener
type ProviderSessionChangeListener = hookShared.ProviderSessionChangeListener
type PaneStatusClearListener = hookShared.PaneStatusClearListener
type PaneKeyAliasPersistenceListener = hookShared.PaneKeyAliasPersistenceListener
type PaneKeyAliasEntry = hookShared.PaneKeyAliasEntry
type AgentPromptSentDedupeEntry = hookShared.AgentPromptSentDedupeEntry

export abstract class AgentHookServerBase {
  protected server: ReturnType<typeof createServer> | null = null
  protected port = 0
  protected token = ''
  // Why: identifies this Orca instance so the server can detect dev vs. prod cross-talk; set at start() from packaged-build knowledge.
  protected env = 'production'
  protected onAgentStatus: ((payload: EnrichedAgentHookEventPayload) => void) | null = null
  protected onClaudeStatusLine: ((event: ClaudeStatusLineRateLimits) => void) | null = null
  protected onPaneStatusCleared: PaneStatusClearListener | null = null
  protected statusChangeListeners = new Set<StatusChangeListener>()
  protected providerSessionChangeListeners = new Set<ProviderSessionChangeListener>()
  // Why: setListener is a single slot owned by the main-window fanout; the
  // plugin event bus (and future consumers) need an additive subscription
  // that also works in headless serve, where no window listener exists.
  protected enrichedStatusListeners = new Set<(payload: EnrichedAgentHookEventPayload) => void>()
  // Why: set via start()'s userDataPath so the class has no direct Electron dependency (mockable in vitest node env).
  protected endpointDir: string | null = null
  protected endpointFilePathCache: string | null = null
  protected endpointFileWritten = false
  // Why: per-instance (not module-level) so tests can spin up multiple servers without state cross-contamination.
  protected state: HookListenerState = createHookListenerState()
  // Why: hydrated rows give UI continuity but aren't evidence of live agent work in this runtime.
  protected runtimeObservedStatusPaneKeys = new Set<string>()
  protected hydratedAuthorityCommitments: readonly AgentHookAuthorityEvidence[] = Object.freeze([])
  protected hydratedLaunchTokenHashByPaneKey = new Map<string, string>()
  protected persistedAuthorityCommitmentsByPaneKey = new Map<string, AgentHookAuthorityEvidence>()
  protected revokedHydratedAuthorityCommitments = new WeakSet<AgentHookAuthorityEvidence>()
  protected currentAuthorityObservations = new Map<string, AgentHookAuthorityEvidence>()
  protected legacyPaneKeyAliases = new Map<string, PaneKeyAliasEntry>()
  protected paneKeyAliasPersistenceListener: PaneKeyAliasPersistenceListener | null = null
  // Why: on-disk last-status cache path; null without a userDataPath (tests), where persistence is a no-op and only in-memory replay applies.
  protected lastStatusFilePath: string | null = null
  // Why: trailing-edge debounce timer, per-instance so test servers in one process don't share state.
  protected statusPersistTimer: ReturnType<typeof setTimeout> | null = null
  protected assistantMessageRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  protected codexSubagentPollTimers = new Map<string, ReturnType<typeof setTimeout>>()
  protected promptSentDedupeByPaneKey = new Map<string, AgentPromptSentDedupeEntry>()
  protected promptSentHashSalt = randomBytes(16).toString('hex')
  protected closedAgentStatusTabIds = new Set<string>()
  protected closedAgentStatusPaneKeys = new Set<string>()
  protected connectionTimestampWatermarkById = new Map<string, number>()
  // Why: skip disk writes when the JSON exactly matches the last write; guards against re-firing trailing timers when nothing changed.
  protected lastWrittenJson: string | null = null

  protected abstract applyNormalizedStatus(
    payload: AgentHookEventPayload
  ): EnrichedAgentHookEventPayload

  protected resolvePaneKeyAlias(paneKey: string): string {
    return this.legacyPaneKeyAliases.get(paneKey)?.stablePaneKey ?? paneKey
  }

  // Why: status layers can run in relay-like instances without the disk adapter.
  protected scheduleStatusPersist(): void {}

  protected recordCurrentAuthorityObservation(payload: AgentHookEventPayload): void {
    const evidence = this.toAuthorityEvidence(payload)
    if (evidence) {
      this.currentAuthorityObservations.set(evidence.paneKey, evidence)
      this.persistedAuthorityCommitmentsByPaneKey.set(evidence.paneKey, evidence)
      this.hydratedLaunchTokenHashByPaneKey.set(evidence.paneKey, evidence.launchTokenHash)
    }
  }

  protected toAuthorityEvidence(
    payload: AgentHookEventPayload | EnrichedAgentHookEventPayload,
    launchTokenHashOverride?: string
  ): AgentHookAuthorityEvidence | null {
    const launchToken = payload.launchToken?.trim()
    const launchTokenHash =
      launchTokenHashOverride ??
      (launchToken ? createHash('sha256').update(launchToken).digest('hex') : null)
    if (!launchTokenHash) {
      return null
    }
    return Object.freeze({
      paneKey: payload.paneKey,
      launchTokenHash,
      connectionId: payload.connectionId,
      ...(payload.tabId ? { tabId: payload.tabId } : {}),
      ...(payload.worktreeId ? { worktreeId: payload.worktreeId } : {}),
      observedAt: 'receivedAt' in payload ? payload.receivedAt : Date.now()
    })
  }

  setListener(listener: ((payload: EnrichedAgentHookEventPayload) => void) | null): void {
    this.onAgentStatus = listener
    if (!listener) {
      return
    }
    // Why: replay is best-effort per pane so one throwing listener can't starve the rest.
    for (const payload of this.state.lastStatusByPaneKey.values()) {
      try {
        // Why: cache always holds enriched payloads; the map's declared type is the bare shape only because the shared module never reads it.
        listener({ ...(payload as EnrichedAgentHookEventPayload), isReplay: true })
      } catch (err) {
        console.error('[agent-hooks] replay listener threw', err)
      }
    }
  }

  // Why: statusline posts carry live Claude usage windows, not agent status; they feed RateLimitService directly.
  setClaudeStatusLineListener(
    listener: ((event: ClaudeStatusLineRateLimits) => void) | null
  ): void {
    this.onClaudeStatusLine = listener
  }

  subscribeStatusChanges(listener: StatusChangeListener): () => void {
    this.statusChangeListeners.add(listener)
    return () => {
      this.statusChangeListeners.delete(listener)
    }
  }

  subscribeProviderSessionChanges(listener: ProviderSessionChangeListener): () => void {
    this.providerSessionChangeListeners.add(listener)
    return () => {
      this.providerSessionChangeListeners.delete(listener)
    }
  }

  /** Multi-subscriber tap on every enriched status change (no replay). */
  subscribeEnrichedStatus(listener: (payload: EnrichedAgentHookEventPayload) => void): () => void {
    this.enrichedStatusListeners.add(listener)
    return () => {
      this.enrichedStatusListeners.delete(listener)
    }
  }

  setPaneStatusClearListener(listener: PaneStatusClearListener | null): void {
    this.onPaneStatusCleared = listener
  }

  /** Snapshot of cached statuses in IPC shape. Used by `agentStatus:getSnapshot` after tabs hydrate so the
   *  dashboard catches up on hook events that fired during startup. */
  getStatusSnapshot(): AgentStatusIpcPayload[] {
    return Array.from(this.state.lastStatusByPaneKey.values(), (entry) =>
      toAgentStatusIpcPayload(entry as EnrichedAgentHookEventPayload)
    )
  }

  /** Provider-session identities, including Pi's metadata-only rows. */
  getProviderSessionIdentities(): AgentHookProviderSessionIdentity[] {
    return this.buildStatusChangeNotification().providerSessions
  }

  getStatusSnapshotForPane(paneKey: string): AgentStatusIpcPayload[] {
    const entry = this.state.lastStatusByPaneKey.get(paneKey)
    return entry ? [toAgentStatusIpcPayload(entry as EnrichedAgentHookEventPayload)] : []
  }

  getHydratedAuthorityCommitments(): readonly AgentHookAuthorityEvidence[] {
    return this.hydratedAuthorityCommitments
  }

  getCurrentAuthorityObservations(): readonly AgentHookAuthorityEvidence[] {
    return Object.freeze(
      Array.from(this.currentAuthorityObservations.values(), (entry) => Object.freeze({ ...entry }))
    )
  }

  attestCompatibilityAuthority(candidate: {
    paneKey: string
    launchTokenHash: string
    connectionId: string | null
    terminalProvenance: 'current_runtime' | 'restored'
  }): AgentHookAuthorityAttestation | null {
    const paneKey = this.resolvePaneKeyAlias(candidate.paneKey)
    const matchesCandidate = (entry: AgentHookAuthorityEvidence): boolean =>
      entry.launchTokenHash === candidate.launchTokenHash &&
      entry.connectionId === candidate.connectionId
    const commitments = this.hydratedAuthorityCommitments.filter(
      (entry) => matchesCandidate(entry) && !this.revokedHydratedAuthorityCommitments.has(entry)
    )
    const current = Array.from(this.currentAuthorityObservations.values())
    const observations = current.filter(matchesCandidate)
    const paneObservations = current.filter(
      (entry) => this.resolvePaneKeyAlias(entry.paneKey) === paneKey
    )
    const hasUniqueCurrentObservation =
      observations.length === 1 &&
      paneObservations.length === 1 &&
      this.resolvePaneKeyAlias(observations[0]!.paneKey) === paneKey
    if (candidate.terminalProvenance === 'current_runtime') {
      return hasUniqueCurrentObservation ? Object.freeze({ paneKey, source: 'current_hook' }) : null
    }
    if (commitments.length !== 1 || this.resolvePaneKeyAlias(commitments[0]!.paneKey) !== paneKey) {
      return null
    }
    if (observations.length === 0 && paneObservations.length === 0) {
      return Object.freeze({ paneKey, source: 'hydrated_commitment' })
    }
    if (!hasUniqueCurrentObservation) {
      return null
    }
    return Object.freeze({ paneKey, source: 'current_hook' })
  }

  inferInterrupt(request: AgentInterruptInferenceRequest): boolean {
    if (!isValidPaneKey(request.paneKey)) {
      return false
    }
    if (!isAgentInterruptInputIntent(request.intent)) {
      return false
    }
    const existing = this.state.lastStatusByPaneKey.get(request.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!existing) {
      return false
    }
    if (existing.providerSessionOnly) {
      return false
    }
    const payload = existing.payload
    const agentType: AgentType | undefined = payload.agentType
    // Why: Droid's Ctrl+C exits the CLI (handled by PTY lifecycle) rather than interrupting the current turn.
    if (agentType === 'droid' && request.intent === 'ctrl-c') {
      return false
    }
    // Why: these agents use the first Escape as a TUI cancel that can leave the turn running; only a double Escape infers an interrupt.
    if (
      (agentType === 'opencode' || agentType === 'copilot') &&
      request.intent === 'plain-escape' &&
      request.inputCount !== 2
    ) {
      return false
    }
    // Why: inference is a fallback for a missing final hook; a strict baseline match keeps a delayed timer from clobbering any newer hook.
    if (
      payload.state !== 'working' ||
      !equivalentInterruptAgentType(agentType, request.baselineAgentType) ||
      payload.prompt !== request.baselinePrompt ||
      existing.receivedAt !== request.baselineUpdatedAt ||
      existing.stateStartedAt !== request.baselineStateStartedAt ||
      Date.now() - existing.receivedAt > AGENT_STATUS_STALE_AFTER_MS
    ) {
      return false
    }
    // Why: a 'working' pane can be child-driven; Ctrl+C doesn't stop background children, so inferring done would retire live child rows.
    if (payload.subagents?.some((subagent) => subagent.state !== 'idle')) {
      return false
    }

    // Why: keep the Claude lead-turn record in sync, or a later child event re-emits the stale 'working' state and resurrects the cancelled pane.
    if (agentType === 'claude') {
      markClaudeLeadTurnInterrupted(this.state, existing.paneKey)
    }
    if (agentType === 'codex') {
      markCodexLeadTurnInterrupted(this.state, existing.paneKey)
    }
    const inferred = this.applyNormalizedStatus({
      paneKey: existing.paneKey,
      tabId: existing.tabId,
      worktreeId: existing.worktreeId,
      connectionId: existing.connectionId,
      providerSession: existing.providerSession,
      payload: {
        state: 'done',
        prompt: payload.prompt,
        agentType,
        ...(payload.model ? { model: payload.model } : {}),
        interrupted: true,
        // Why: idle children are display state; dropping them on an inferred interrupt blanks rows a later hook would restore.
        ...(payload.subagents ? { subagents: payload.subagents } : {})
      }
    })
    console.debug('[agent-hooks] inferred interrupted agent status', {
      paneKey: inferred.paneKey,
      agentType,
      intent: request.intent
    })
    return true
  }

  /** Guarded fallback for a hook Claude never sends: answering AskUserQuestion produces no event, so re-validate the
   *  renderer's baseline against the cached status (a racing real hook wins) and synthesize the post-answer state. */
  inferQuestionAnswered(request: AgentQuestionAnsweredInferenceRequest): boolean {
    if (!isValidPaneKey(request.paneKey)) {
      return false
    }
    const existing = this.state.lastStatusByPaneKey.get(request.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (!existing) {
      return false
    }
    const payload = existing.payload
    // Why: only Claude's interactive question clears on typed input — tool name (not hook event) discriminates; real permission waits stay sticky.
    if (
      payload.agentType !== 'claude' ||
      payload.state !== 'waiting' ||
      !isAskUserQuestionTool(payload.toolName)
    ) {
      return false
    }
    if (
      payload.agentType !== request.baselineAgentType ||
      payload.prompt !== request.baselinePrompt ||
      existing.receivedAt !== request.baselineUpdatedAt ||
      existing.stateStartedAt !== request.baselineStateStartedAt ||
      Date.now() - existing.receivedAt > AGENT_STATUS_STALE_AFTER_MS
    ) {
      return false
    }
    // Why: sync the listener's lead-turn record too, or a later child event re-emits the stale waiting state and resurrects the card.
    const restored = clearClaudeAnsweredQuestionWait(this.state, existing.paneKey)
    const inferred = this.applyNormalizedStatus({
      paneKey: existing.paneKey,
      tabId: existing.tabId,
      worktreeId: existing.worktreeId,
      connectionId: existing.connectionId,
      providerSession: existing.providerSession,
      payload: {
        state: restored.state,
        prompt: payload.prompt,
        agentType: payload.agentType,
        ...(restored.state === 'done' && restored.interrupted ? { interrupted: true } : {}),
        ...(payload.subagents ? { subagents: payload.subagents } : {})
      }
    })
    console.debug('[agent-hooks] inferred answered question status', {
      paneKey: inferred.paneKey,
      state: inferred.payload.state
    })
    return true
  }

  getStatusChangeSnapshot(): AgentHookStatusChangeEntry[] {
    return this.buildStatusChangeNotification().statuses
  }

  protected buildStatusChangeNotification(): {
    statuses: AgentHookStatusChangeEntry[]
    providerSessions: AgentHookProviderSessionIdentity[]
  } {
    const statuses: AgentHookStatusChangeEntry[] = []
    const providerSessions: AgentHookProviderSessionIdentity[] = []
    for (const [paneKey, entry] of this.state.lastStatusByPaneKey) {
      const enriched = entry as EnrichedAgentHookEventPayload
      if (enriched.providerSession) {
        providerSessions.push({
          paneKey,
          sessionId: enriched.providerSession.id,
          ...(enriched.providerSession.transcriptPath
            ? { transcriptPath: enriched.providerSession.transcriptPath }
            : {}),
          ...(enriched.worktreeId ? { worktreeId: enriched.worktreeId } : {})
        })
      }
      if (!enriched.providerSessionOnly) {
        statuses.push({
          state: enriched.payload.state,
          receivedAt: enriched.receivedAt,
          observedInCurrentRuntime: this.runtimeObservedStatusPaneKeys.has(paneKey)
        })
      }
    }
    return { statuses, providerSessions }
  }

  protected notifyStatusChangeListeners(): void {
    if (this.statusChangeListeners.size === 0 && this.providerSessionChangeListeners.size === 0) {
      return
    }
    const { statuses, providerSessions } = this.buildStatusChangeNotification()
    for (const listener of this.statusChangeListeners) {
      try {
        listener(statuses)
      } catch (err) {
        console.error('[agent-hooks] status-change listener threw', err)
      }
    }
    for (const listener of this.providerSessionChangeListeners) {
      try {
        listener(providerSessions)
      } catch (err) {
        console.error('[agent-hooks] provider-session listener threw', err)
      }
    }
  }

  protected markTabClosedForAgentStatus(tabId: string): void {
    // Delete-then-add keeps recently closed tabs most-recent so eviction sheds only the oldest ids.
    this.closedAgentStatusTabIds.delete(tabId)
    this.closedAgentStatusTabIds.add(tabId)
    while (this.closedAgentStatusTabIds.size > CLOSED_AGENT_STATUS_TAB_IDS_MAX) {
      const oldest = this.closedAgentStatusTabIds.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.closedAgentStatusTabIds.delete(oldest)
    }
  }

  protected shouldSuppressClosedTabStatus(paneKey: string): boolean {
    const ownerPaneKey = this.resolvePaneKeyAlias(paneKey)
    if (
      this.closedAgentStatusPaneKeys.has(paneKey) ||
      this.closedAgentStatusPaneKeys.has(ownerPaneKey)
    ) {
      return true
    }
    const tabId = parsePaneKey(ownerPaneKey)?.tabId
    if (!tabId) {
      return false
    }
    return this.closedAgentStatusTabIds.has(tabId)
  }

  protected markPaneClosedForAgentStatus(paneKey: string): void {
    this.closedAgentStatusPaneKeys.delete(paneKey)
    this.closedAgentStatusPaneKeys.add(paneKey)
    while (this.closedAgentStatusPaneKeys.size > CLOSED_AGENT_STATUS_PANE_KEYS_MAX) {
      const oldest = this.closedAgentStatusPaneKeys.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.closedAgentStatusPaneKeys.delete(oldest)
    }
  }

  protected attachStatusTiming(
    payload: AgentHookEventPayload,
    now = Date.now()
  ): EnrichedAgentHookEventPayload {
    const previous = this.state.lastStatusByPaneKey.get(payload.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    const commandCodeNewTurn =
      previous !== undefined &&
      isCommandCodeNewTurnWhileWorking({
        agentType: payload.payload.agentType,
        previousState: previous.payload.state,
        incomingState: payload.payload.state,
        previousPrompt: previous.payload.prompt,
        incomingPrompt: payload.payload.prompt,
        hasExplicitPrompt: payload.hasExplicitPrompt,
        previousPromptInteractionKey: previous.promptInteractionKey,
        incomingPromptInteractionKey: payload.promptInteractionKey
      })
    const stateStartedAt =
      previous && previous.payload.state === payload.payload.state && !commandCodeNewTurn
        ? previous.stateStartedAt
        : now
    return {
      ...payload,
      receivedAt: now,
      stateStartedAt
    }
  }

  protected hashPromptForTelemetryDedupe(prompt: string): string {
    return createHash('sha256')
      .update(this.promptSentHashSalt)
      .update('\0')
      .update(prompt)
      .digest('hex')
  }

  protected maybeTrackAgentPromptSent(
    payload: AgentHookEventPayload,
    previousStatus: EnrichedAgentHookEventPayload | undefined
  ): void {
    if (payload.isReplay === true || payload.hasExplicitPrompt !== true) {
      return
    }
    const prompt = payload.payload.prompt?.trim() ?? ''
    if (prompt.length === 0) {
      return
    }
    const agentKind = agentTypeToPromptSentAgentKind(payload.payload.agentType)
    const promptHash = this.hashPromptForTelemetryDedupe(prompt)
    const promptInteractionKey =
      typeof payload.promptInteractionKey === 'string' &&
      payload.promptInteractionKey.trim().length > 0
        ? payload.promptInteractionKey.trim()
        : undefined
    const previousDedupe = this.promptSentDedupeByPaneKey.get(payload.paneKey)
    const isCompletedTurnBoundary =
      previousStatus?.payload.state === 'done' && payload.payload.state === 'working'
    if (
      previousDedupe?.agentKind === agentKind &&
      previousDedupe.promptInteractionKey !== undefined &&
      previousDedupe.promptInteractionKey === promptInteractionKey &&
      (agentKind === 'opencode' || previousDedupe.promptHash === promptHash)
    ) {
      return
    }
    if (
      previousDedupe?.agentKind === agentKind &&
      previousDedupe.promptHash === promptHash &&
      !(
        previousStatus?.payload.state === 'done' &&
        payload.payload.state === 'done' &&
        previousDedupe.promptInteractionKey !== undefined &&
        promptInteractionKey !== undefined &&
        previousDedupe.promptInteractionKey !== promptInteractionKey
      ) &&
      !isCompletedTurnBoundary
    ) {
      return
    }
    this.promptSentDedupeByPaneKey.set(payload.paneKey, {
      agentKind,
      promptHash,
      promptInteractionKey
    })
    try {
      // Why: hooks prove a turn was submitted but not which UI launched the terminal; keep attribution low-cardinality.
    } catch (err) {
      console.error('[agent-hooks] prompt-sent telemetry failed', err)
    }
  }
}
