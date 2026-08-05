import { AgentHookServerAuthority } from './agent-hook-server-authority'
import type * as hookShared from './agent-hook-server-shared'
import { normalizeAgentProviderSession } from '../../shared/agent-session-resume'
import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../shared/agent-status-types'
import {
  equivalentParsedAgentStatusPayload,
  isValidPiProviderSessionOnly
} from './agent-hook-server-shared'
import { parsePaneKey } from '../../shared/stable-pane-id'
import {
  MAX_PANE_KEY_LEN,
  warnOnHookEnvOrVersionMismatch,
  type AgentHookEventPayload
} from '../../shared/agent-hook-listener'

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload

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
      ...(typeof envelope.launchToken === 'string' && envelope.launchToken.trim().length > 0
        ? { launchToken: envelope.launchToken }
        : {}),
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
    // Replay is recovery data; once this process has observed the pane live, it cannot replace it.
    if (
      event.isReplay === true &&
      this.runtimeObservedStatusPaneKeys.has(paneKey) &&
      this.state.lastStatusByPaneKey.has(paneKey)
    ) {
      return
    }
    this.recordCurrentAuthorityObservation(event)
    this.applyNormalizedStatus(event)
  }
}
