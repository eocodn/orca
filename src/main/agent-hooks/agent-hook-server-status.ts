import { AgentHookServerBase } from "./agent-hook-server-base"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as hookShared from "./agent-hook-server-shared"
import type { AgentHookSource, AgentHookStatusChangeEntry, AgentHookProviderSessionIdentity, AgentHookAuthorityEvidence, AgentHookAuthorityAttestation } from "./agent-hook-server-shared"
import { AGENT_KIND_VALUES, type AgentKind } from "../../shared/telemetry-events"
import { ORCA_HOOK_PROTOCOL_VERSION } from "../../shared/agent-hook-types"
import { clearAllListenerCaches, clearPaneCacheState, clearClaudeAnsweredQuestionWait, createHookListenerState, getEndpointFileName, hasCodexTranscriptSubagents, hasPendingAgentResultText, HOOK_REQUEST_SLOWLORIS_MS, markClaudeLeadTurnInterrupted, markCodexLeadTurnInterrupted, MAX_PANE_KEY_LEN, movePaneCacheState, normalizeHookPayload, parseFormEncodedBody, readRequestBody, reapRestoredClaudeSubagentsForDeadPane, reconcileRemoteCodexState, resolveHookSource, preparePendingGrokResultDiscovery, seedClaudeSubagentRosterFromSnapshots, seedCodexStateFromSnapshot, warnOnHookEnvOrVersionMismatch, writeEndpointFile, type AgentHookEventPayload, type HookListenerState } from "../../shared/agent-hook-listener"
import { claudeRosterHasRestoredSnapshotSubagent, claudeRosterHasWorkingSubagent, claudeRosterToSnapshots } from "../../shared/claude-subagent-roster"
import { CLAUDE_STATUSLINE_PATHNAME, parseClaudeStatusLineBody, type ClaudeStatusLineRateLimits } from "../../shared/claude-statusline-rate-limits"
import { AGENT_STATUS_STALE_AFTER_MS, type AgentStatusClearIpcPayload, type AgentStatusIpcPayload, type AgentType, type AgentStatusState, type ParsedAgentStatusPayload, normalizeAgentStatusPayload } from "../../shared/agent-status-types"
import { resolveAgentStatusIdentity, shouldSuppressInheritedTerminalStatus } from "../../shared/agent-status-identity"
import { isAgentInterruptInputIntent, type AgentInterruptInferenceRequest } from "../../shared/agent-interrupt-intent"
import { isAskUserQuestionTool, type AgentQuestionAnsweredInferenceRequest } from "../../shared/agent-question-answered-intent"
import { parseLegacyNumericPaneKey, parsePaneKey } from "../../shared/stable-pane-id"
import type { LegacyPaneKeyAliasEntry } from "../../shared/types"
import { getAgentResumeArgv, normalizeAgentProviderSession, type AgentProviderSessionMetadata } from "../../shared/agent-session-resume"
import { isCommandCodeNewTurnWhileWorking } from "../../shared/command-code-turn-boundary"

const { agentTypeToPromptSentAgentKind, equivalentInterruptAgentType, isValidPaneKey, dropHydratedIdleClaudeSubagents, isValidPiProviderSessionOnly, sanitizeHydratedEntry, readPersistedLaunchTokenHash, sanitizePersistedAuthorityCommitment, authorityCommitmentsMatch, toAgentStatusIpcPayload, equivalentParsedAgentStatusPayload, trackEmptyPaneKeyHook, isToolProgressWorkingAfterInterrupt, paneCacheKeyTabId, paneCacheKeyMatchesTab, shouldKeepClaudePermissionVisible, isClaudePermissionResumingApprovedTool, shouldInheritClaudeToolUseIdForPermission, attachClaudePermissionToolUseId, LAST_STATUS_FILE_NAME, ASSISTANT_MESSAGE_RETRY_ATTEMPTS, ASSISTANT_MESSAGE_RETRY_MS, CODEX_SUBAGENT_POLL_MS, INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS, LAST_STATUS_FILE_VERSION, STATUS_PERSIST_DEBOUNCE_MS, TOOL_PROGRESS_HOOK_EVENTS, AGENT_PROMPT_SENT_AGENT_KINDS, HYDRATE_MAX_AGE_MS, CLOSED_AGENT_STATUS_TAB_IDS_MAX, CLOSED_AGENT_STATUS_PANE_KEYS_MAX, PANE_KEY_ALIASES_MAX } = hookShared

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload
type PersistedAgentHookEventPayload = hookShared.PersistedAgentHookEventPayload
type PersistedAgentAuthorityCommitment = hookShared.PersistedAgentAuthorityCommitment
type StatusChangeListener = hookShared.StatusChangeListener
type ProviderSessionChangeListener = hookShared.ProviderSessionChangeListener
type PaneStatusClearListener = hookShared.PaneStatusClearListener
type PaneKeyAliasPersistenceListener = hookShared.PaneKeyAliasPersistenceListener
type PaneKeyAliasEntry = hookShared.PaneKeyAliasEntry
type LastStatusFile = hookShared.LastStatusFile
type AgentPromptSentDedupeEntry = hookShared.AgentPromptSentDedupeEntry

export class AgentHookServerStatus extends AgentHookServerBase {
  protected applyNormalizedStatus(payload: AgentHookEventPayload): EnrichedAgentHookEventPayload {
    const previous = this.state.lastStatusByPaneKey.get(payload.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    const connectionClearWatermark = payload.connectionId
      ? this.connectionTimestampWatermarkById.get(payload.connectionId)
      : undefined
    // Why: Date.now() can repeat across reconnect; a remote replay must sort strictly after its connection's transient clear.
    const now = Math.max(Date.now(), (connectionClearWatermark ?? -1) + 1)
    if (payload.connectionId) {
      this.connectionTimestampWatermarkById.set(payload.connectionId, now)
    }
    if (payload.providerSessionOnly) {
      // Why: Pi session_start replaces stale turn state and survives replay, but must not emit prompt telemetry or a fabricated status.
      const enriched = this.attachStatusTiming(payload, now)
      this.clearAssistantMessageRetry(enriched.paneKey)
      this.runtimeObservedStatusPaneKeys.delete(enriched.paneKey)
      this.state.lastStatusByPaneKey.set(enriched.paneKey, enriched)
      this.scheduleStatusPersist()
      this.notifyStatusChangeListeners()
      this.emitEnrichedStatus(enriched)
      return enriched
    }
    const stateReconciledPayload =
      payload.connectionId && payload.payload.agentType === 'codex' && payload.hookEventName
        ? {
            ...payload,
            payload: reconcileRemoteCodexState(
              this.state,
              payload.paneKey,
              payload.hookEventName,
              payload.toolAgentId,
              payload.payload,
              previous?.payload
            )
          }
        : payload
    const previousCodexRoot =
      stateReconciledPayload.payload.agentType === 'codex' &&
      stateReconciledPayload.toolAgentId &&
      previous?.payload.agentType === 'codex'
        ? previous
        : undefined
    const preservedProviderSession = !stateReconciledPayload.providerSession
      ? previousCodexRoot?.providerSession
      : undefined
    const preservedRootModel = !stateReconciledPayload.payload.model
      ? previousCodexRoot?.payload.model
      : undefined
    // Why: an SSH relay restart forgets root-only fields; child hooks must not erase durable resume/model identity.
    const rootContextPreservingPayload =
      preservedProviderSession || preservedRootModel
        ? {
            ...stateReconciledPayload,
            ...(preservedProviderSession ? { providerSession: preservedProviderSession } : {}),
            payload: preservedRootModel
              ? { ...stateReconciledPayload.payload, model: preservedRootModel }
              : stateReconciledPayload.payload
          }
        : stateReconciledPayload
    const identity = resolveAgentStatusIdentity({
      existing: previous
        ? {
            agentType: previous.payload.agentType,
            state: previous.payload.state,
            updatedAt: previous.receivedAt
          }
        : undefined,
      incoming: rootContextPreservingPayload.payload.agentType,
      now
    })
    if (
      previous &&
      shouldSuppressInheritedTerminalStatus({
        inheritedFromActivePane: identity.inheritedFromActivePane,
        incomingState: rootContextPreservingPayload.payload.state
      })
    ) {
      return previous
    }
    const identityResolvedPayload =
      identity.agentType === rootContextPreservingPayload.payload.agentType
        ? rootContextPreservingPayload
        : {
            ...rootContextPreservingPayload,
            payload: {
              ...rootContextPreservingPayload.payload,
              agentType: identity.agentType
            }
          }
    const effectivePayload = attachClaudePermissionToolUseId(previous, identityResolvedPayload)
    if (previous && shouldKeepClaudePermissionVisible(previous, effectivePayload)) {
      return previous
    }
    // Why: some TUIs emit a delayed tool/working hook after Ctrl+C stopped the turn; don't let it resurrect the row.
    if (
      previous?.payload.state === 'done' &&
      previous.payload.interrupted === true &&
      effectivePayload.payload.state === 'done' &&
      previous.payload.agentType === effectivePayload.payload.agentType &&
      previous.payload.prompt === effectivePayload.payload.prompt &&
      Date.now() - previous.receivedAt <= INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS
    ) {
      return previous
    }
    if (
      previous?.payload.state === 'done' &&
      previous.payload.interrupted === true &&
      effectivePayload.payload.state === 'working' &&
      previous.payload.agentType === effectivePayload.payload.agentType &&
      previous.payload.prompt === effectivePayload.payload.prompt &&
      (effectivePayload.isReplay === true ||
        isToolProgressWorkingAfterInterrupt(effectivePayload) ||
        (effectivePayload.hasExplicitPrompt !== true &&
          Date.now() - previous.receivedAt <= INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS))
    ) {
      return previous
    }
    if (
      effectivePayload.payload.state !== 'done' ||
      effectivePayload.payload.lastAssistantMessage
    ) {
      this.clearAssistantMessageRetry(effectivePayload.paneKey)
    }
    if (!identity.inheritedFromActivePane) {
      this.maybeTrackAgentPromptSent(effectivePayload, previous)
    }
    const enriched = this.attachStatusTiming(effectivePayload, now)
    this.runtimeObservedStatusPaneKeys.add(enriched.paneKey)
    this.state.lastStatusByPaneKey.set(enriched.paneKey, enriched)
    this.scheduleStatusPersist()
    this.notifyStatusChangeListeners()
    this.emitEnrichedStatus(enriched)
    return enriched
  }

  // Why: every status emit must reach plugins too, so a new early-return path
  // upstream cannot silently leave the plugin tap behind the main-window fanout.
  protected emitEnrichedStatus(enriched: EnrichedAgentHookEventPayload): void {
    this.onAgentStatus?.(enriched)
    for (const listener of this.enrichedStatusListeners) {
      try {
        listener(enriched)
      } catch (err) {
        console.error('[agent-hooks] enriched status listener threw', err)
      }
    }
  }

  protected clearAssistantMessageRetry(paneKey: string): void {
    const timer = this.assistantMessageRetryTimers.get(paneKey)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.assistantMessageRetryTimers.delete(paneKey)
  }

  protected clearCodexSubagentPoll(paneKey: string): void {
    const timer = this.codexSubagentPollTimers.get(paneKey)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.codexSubagentPollTimers.delete(paneKey)
  }

  protected scheduleCodexSubagentPoll(
    source: AgentHookSource,
    body: unknown,
    original: EnrichedAgentHookEventPayload
  ): void {
    // Why: a nested non-codex CLI inherits ORCA_PANE_KEY, so clearing here would silently end a live codex poll.
    if (source !== 'codex') {
      return
    }
    this.clearCodexSubagentPoll(original.paneKey)
    if (!hasCodexTranscriptSubagents(this.state, original.paneKey)) {
      return
    }
    const timer = setTimeout(() => {
      this.codexSubagentPollTimers.delete(original.paneKey)
      const current = this.state.lastStatusByPaneKey.get(original.paneKey)
      if (!this.server || current !== original) {
        return
      }
      const normalized = normalizeHookPayload(this.state, source, body, this.env)
      if (!normalized) {
        return
      }
      const subagentsChanged =
        JSON.stringify(normalized.payload.subagents) !== JSON.stringify(original.payload.subagents)
      const next = subagentsChanged ? this.applyNormalizedStatus(normalized) : original
      this.scheduleCodexSubagentPoll(source, body, next)
    }, CODEX_SUBAGENT_POLL_MS)
    this.codexSubagentPollTimers.set(original.paneKey, timer)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  protected scheduleAssistantMessageRetry(
    source: AgentHookSource,
    body: unknown,
    original: EnrichedAgentHookEventPayload,
    attempt = 1,
    discoveryReady = false
  ): void {
    if (
      original.payload.lastAssistantMessage ||
      !hasPendingAgentResultText(source, body) ||
      attempt > ASSISTANT_MESSAGE_RETRY_ATTEMPTS
    ) {
      return
    }
    this.clearAssistantMessageRetry(original.paneKey)
    if (!discoveryReady) {
      const discovery = preparePendingGrokResultDiscovery(source, body)
      if (discovery) {
        // Why: slug-group discovery can outlive the bounded flush timers; its completion must drive the first retry deterministically.
        void discovery
          .then(() => {
            if (this.server) {
              this.applyAssistantMessageRetry(source, body, original, 1, true)
            }
          })
          .catch((err) => {
            console.error('[agent-hooks] Grok result discovery failed:', err)
          })
        return
      }
    }
    const timer = setTimeout(() => {
      try {
        this.assistantMessageRetryTimers.delete(original.paneKey)
        this.applyAssistantMessageRetry(source, body, original, attempt + 1, discoveryReady)
      } catch (err) {
        console.error('[agent-hooks] assistant message retry failed:', err)
      }
    }, ASSISTANT_MESSAGE_RETRY_MS)
    this.assistantMessageRetryTimers.set(original.paneKey, timer)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  protected applyAssistantMessageRetry(
    source: AgentHookSource,
    body: unknown,
    original: EnrichedAgentHookEventPayload,
    nextAttempt: number,
    requireExactOriginal: boolean
  ): void {
    const current = this.state.lastStatusByPaneKey.get(original.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (
      !current ||
      (requireExactOriginal && current !== original) ||
      current.payload.agentType !== original.payload.agentType ||
      current.payload.prompt !== original.payload.prompt ||
      current.payload.lastAssistantMessage
    ) {
      return
    }
    const normalized = normalizeHookPayload(this.state, source, body, this.env)
    if (!normalized?.payload.lastAssistantMessage) {
      this.scheduleAssistantMessageRetry(source, body, original, nextAttempt, requireExactOriginal)
      return
    }
    // Why: some agents POST Stop before their transcript line is flushed; discovery is event-driven, later content retries stay timed.
    this.applyNormalizedStatus(normalized)
  }

}
