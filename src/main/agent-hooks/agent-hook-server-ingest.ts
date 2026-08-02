import { AgentHookServerAuthority } from "./agent-hook-server-authority"
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

export class AgentHookServerIngest extends AgentHookServerAuthority {
  ingestTerminalStatus(event: {
    paneKey: string
    tabId?: string
    worktreeId?: string
    connectionId?: string | null
    payload: ParsedAgentStatusPayload
  }): void {
    const physicalPaneKey = event.paneKey.trim()
    const paneKey = this.resolvePaneKeyAlias(physicalPaneKey)
    const parsedPaneKey = parsePaneKey(paneKey)
    if (paneKey.length === 0) {
      track('agent_hook_unattributed', { reason: 'empty_pane_key' })
      return
    }
    if (paneKey.length > MAX_PANE_KEY_LEN || !parsedPaneKey) {
      return
    }
    const reportedTabId =
      event.tabId !== undefined && event.tabId.trim().length > 0 ? event.tabId.trim() : undefined
    if (
      paneKey === physicalPaneKey &&
      reportedTabId !== undefined &&
      reportedTabId !== parsedPaneKey.tabId
    ) {
      return
    }
    const tabId = paneKey !== physicalPaneKey ? parsedPaneKey.tabId : reportedTabId
    if (this.shouldSuppressClosedTabStatus(paneKey)) {
      return
    }
    const worktreeId =
      event.worktreeId !== undefined && event.worktreeId.trim().length > 0
        ? event.worktreeId.trim()
        : undefined
    const connectionId =
      typeof event.connectionId === 'string' && event.connectionId.trim().length > 0
        ? event.connectionId.trim()
        : null
    const previous = this.state.lastStatusByPaneKey.get(paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    if (
      previous?.connectionId === connectionId &&
      previous.tabId === tabId &&
      previous.worktreeId === worktreeId &&
      equivalentParsedAgentStatusPayload(previous.payload, event.payload)
    ) {
      return
    }
    // Why: the OSC 9999 wire payload has no providerSession field at all, so an OSC observation is
    // never evidence that the session ended — yet overwriting the row dropped the cached identity.
    // That erased it from persisted rows (lost across restart) and from headless `orca serve`, which
    // serves these rows to mobile directly instead of the renderer store, blanking Chat UI (#10630).
    // A new turn after `done` still starts clean so a reused pane cannot inherit a finished session.
    // Why: mirror resolveAgentStatusIdentity, which treats a literal 'unknown' exactly like an
    // omitted type — an OSC ping that names no agent makes no claim about the pane's identity, so
    // it must not be read as a mismatch and strip the session the renderer would have kept.
    const claimedAgentType =
      event.payload.agentType && event.payload.agentType !== 'unknown'
        ? event.payload.agentType
        : undefined
    const preservedProviderSession =
      previous?.providerSession &&
      (claimedAgentType === undefined || claimedAgentType === previous.payload.agentType) &&
      (previous.payload.state !== 'done' || event.payload.state === 'done')
        ? previous.providerSession
        : undefined
    // Why: OSC status is a runtime observation, not a prompt boundary; keep prompt-sent telemetry tied to native hooks.
    this.applyNormalizedStatus({
      paneKey,
      tabId,
      worktreeId,
      connectionId,
      ...(preservedProviderSession ? { providerSession: preservedProviderSession } : {}),
      payload: event.payload
    })
  }

  /** Ingest a payload from the relay JSON-RPC channel (not the local HTTP server); connectionId is stamped here. Main is still the SSH trust boundary, so re-run the canonical normalizer before caching. */
  ingestRemote(
    envelope: {
      paneKey: string
      tabId?: string
      worktreeId?: string
      env?: string
      version?: string
      launchToken?: string
      hasExplicitPrompt?: boolean
      promptInteractionKey?: string
      hookEventName?: string
      toolUseId?: string
      toolAgentId?: string
      toolAgentType?: string
      providerSession?: unknown
      providerSessionOnly?: unknown
      isReplay?: boolean
      payload: unknown
    },
    connectionId: string
  ): void {
    // Why: wire crosses a trust boundary — re-check/trim so an empty connectionId can't poison caches.
    if (typeof connectionId !== 'string') {
      return
    }
    const trimmedConnectionId = connectionId.trim()
    if (trimmedConnectionId.length === 0) {
      return
    }
    if (!envelope || typeof envelope.paneKey !== 'string') {
      return
    }
    // Why: trim paneKey to match the HTTP path, else remote-vs-local events for one pane diverge.
    const physicalPaneKey = envelope.paneKey.trim()
    const paneKey = this.resolvePaneKeyAlias(physicalPaneKey)
    const parsedPaneKey = parsePaneKey(paneKey)
    if (paneKey.length === 0) {
      track('agent_hook_unattributed', { reason: 'empty_pane_key' })
      return
    }
    if (paneKey.length > MAX_PANE_KEY_LEN) {
      return
    }
    if (!parsedPaneKey) {
      return
    }
    if (envelope.tabId !== undefined && typeof envelope.tabId !== 'string') {
      return
    }
    if (envelope.worktreeId !== undefined && typeof envelope.worktreeId !== 'string') {
      return
    }
    // Why: mirror the HTTP path's readStringField — trim and treat empty-after-trim as undefined.
    const reportedTabId =
      envelope.tabId !== undefined && envelope.tabId.trim().length > 0
        ? envelope.tabId.trim()
        : undefined
    if (
      paneKey === physicalPaneKey &&
      reportedTabId !== undefined &&
      reportedTabId !== parsedPaneKey.tabId
    ) {
      return
    }
    const tabId = paneKey !== physicalPaneKey ? parsedPaneKey.tabId : reportedTabId
    if (this.shouldSuppressClosedTabStatus(paneKey)) {
      return
    }
    const worktreeId =
      envelope.worktreeId !== undefined && envelope.worktreeId.trim().length > 0
        ? envelope.worktreeId.trim()
        : undefined
    const hookEventName =
      typeof envelope.hookEventName === 'string' && envelope.hookEventName.trim().length > 0
        ? envelope.hookEventName.trim()
        : undefined
    const promptInteractionKey =
      typeof envelope.promptInteractionKey === 'string' &&
      envelope.promptInteractionKey.trim().length > 0
        ? envelope.promptInteractionKey.trim()
        : undefined
    const toolUseId =
      typeof envelope.toolUseId === 'string' && envelope.toolUseId.trim().length > 0
        ? envelope.toolUseId.trim()
        : undefined
    const toolAgentId =
      typeof envelope.toolAgentId === 'string' && envelope.toolAgentId.trim().length > 0
        ? envelope.toolAgentId.trim()
        : undefined
    const toolAgentType =
      typeof envelope.toolAgentType === 'string' && envelope.toolAgentType.trim().length > 0
        ? envelope.toolAgentType.trim()
        : undefined
    const providerSession = normalizeAgentProviderSession(envelope.providerSession) ?? undefined
    // Why: relay crosses a trust boundary — re-run the canonical normalizer to enforce caps/invariants (returns null on malformed).
    const normalizedPayload = normalizeAgentStatusPayload(envelope.payload)
    if (!normalizedPayload) {
      return
    }
    if (
      envelope.providerSessionOnly === true &&
      !isValidPiProviderSessionOnly(providerSession, normalizedPayload.agentType)
    ) {
      return
    }
    // Why: run the HTTP path's warn-once version/env-mismatch diagnostics with this.env as expected.
    warnOnHookEnvOrVersionMismatch(this.state, {
      version: envelope.version,
      env: envelope.env,
      expectedEnv: this.env
    })
    const event: AgentHookEventPayload = {
      paneKey,
      launchToken: envelope.launchToken,
      tabId,
      worktreeId,
      connectionId: trimmedConnectionId,
      hasExplicitPrompt: envelope.hasExplicitPrompt === true ? true : undefined,
      promptInteractionKey,
      hookEventName,
      toolUseId,
      toolAgentId,
      toolAgentType,
      providerSession,
      providerSessionOnly: envelope.providerSessionOnly === true ? true : undefined,
      isReplay: envelope.isReplay === true ? true : undefined,
      payload: normalizedPayload
    }
    this.recordCurrentAuthorityObservation(event)
    this.applyNormalizedStatus(event)
  }

}
