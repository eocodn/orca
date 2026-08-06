// Generic status authority shared by OSC/PTY ingestion and persistence.
import { createHash } from 'node:crypto'

import { AGENT_KIND_VALUES, type AgentKind } from '../../shared/telemetry-events'
import { MAX_PANE_KEY_LEN, type AgentHookEventPayload } from '../../shared/agent-status-event'
import type { AgentHookSource } from '../../shared/agent-status-event'
import {
  type AgentStatusClearIpcPayload,
  type AgentType,
  type AgentStatusState,
  type ParsedAgentStatusPayload,
  normalizeAgentStatusPayload
} from '../../shared/agent-status-types'
import { isAskUserQuestionTool } from '../../shared/agent-question-answered-intent'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../shared/stable-pane-id'
import type { LegacyPaneKeyAliasEntry } from '../../shared/types'
import {
  getAgentResumeArgv,
  normalizeAgentProviderSession,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session-resume'

export type { AgentHookSource }

// Why: server-side enrichment — receivedAt = latest event arrival, stateStartedAt = when the current state first appeared; extra fields ride the shared map untouched (it only writes/clears).
export type EnrichedAgentHookEventPayload = AgentHookEventPayload & {
  receivedAt: number
  stateStartedAt: number
}

export type PersistedAgentHookEventPayload = Omit<
  EnrichedAgentHookEventPayload,
  'launchToken' | 'promptInteractionKey'
> & {
  launchTokenHash?: string
}

export type PersistedAgentHookAuthorityCommitment = {
  paneKey: string
  launchTokenHash: string
  connectionId: string | null
  tabId?: string
  worktreeId?: string
  observedAt: number
}

export type AgentHookStatusChangeEntry = {
  state: AgentStatusState
  receivedAt: number
  observedInCurrentRuntime: boolean
}

export type AgentHookProviderSessionIdentity = {
  paneKey: string
  sessionId: string
  transcriptPath?: string
  worktreeId?: string
}

export type AgentHookAuthorityEvidence = Readonly<{
  paneKey: string
  launchTokenHash: string
  connectionId: string | null
  tabId?: string
  worktreeId?: string
  observedAt: number
}>

export type AgentHookAuthorityAttestation = Readonly<{
  paneKey: string
  source: 'current_hook' | 'hydrated_commitment'
}>

export type StatusChangeListener = (statuses: AgentHookStatusChangeEntry[]) => void
export type ProviderSessionChangeListener = (
  providerSessions: AgentHookProviderSessionIdentity[]
) => void
export type PaneStatusClearListener = (clear: AgentStatusClearIpcPayload) => void
export type PaneKeyAliasPersistenceListener = (entries: LegacyPaneKeyAliasEntry[]) => void
export type PaneKeyAliasEntry = {
  stablePaneKey: string
  ptyId: string | null
  updatedAt: number
  authorityVerified: boolean
}

// Why: co-located with the endpoint file in userData/agent-hooks/ so hook-server cross-restart artifacts stay together.
export const LAST_STATUS_FILE_NAME = 'last-status.json'
export const ASSISTANT_MESSAGE_RETRY_ATTEMPTS = 5
export const ASSISTANT_MESSAGE_RETRY_MS = 50
export const CODEX_SUBAGENT_POLL_MS = 1_000
export const INTERRUPTED_DONE_LATE_WORKING_SUPPRESSION_MS = 15_000

// Why: starts at 2 — pre-merge v1 lacked receivedAt/stateStartedAt (never shipped); a mismatched version hydrates empty (treated as corrupt).
export const LAST_STATUS_FILE_VERSION = 2

// Why: trailing-edge debounce so a burst of hook events yields one disk write, not N; quit-time flushStatusPersistSync() guarantees the final flush.
export const STATUS_PERSIST_DEBOUNCE_MS = 250
export const TOOL_PROGRESS_HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure'
])
export const AGENT_PROMPT_SENT_AGENT_KINDS = new Set<AgentKind>(AGENT_KIND_VALUES)

// Why: bound file growth from PTYs that never re-attach; 7 days is the "still relevant?" horizon beyond which entries shouldn't resurrect on hydrate.
export const HYDRATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Why: a long-closed tab can't receive status events; bound the set so it can't grow one entry per close for the whole session.
export const CLOSED_AGENT_STATUS_TAB_IDS_MAX = 1024
export const CLOSED_AGENT_STATUS_PANE_KEYS_MAX = 1024
export const PANE_KEY_ALIASES_MAX = 1024

export type LastStatusFile = {
  version: number
  entries: Record<string, PersistedAgentHookEventPayload>
  authorityCommitments?: Record<string, PersistedAgentHookAuthorityCommitment>
}

export type AgentPromptSentDedupeEntry = {
  agentKind: AgentKind
  promptHash: string
  promptInteractionKey?: string
}

export function agentTypeToPromptSentAgentKind(agentType: AgentType | undefined): AgentKind {
  const normalized = agentType?.trim().toLowerCase()
  if (!normalized || normalized === 'unknown') {
    return 'other'
  }
  if (normalized === 'claude') {
    return 'claude-code'
  }
  return AGENT_PROMPT_SENT_AGENT_KINDS.has(normalized as AgentKind)
    ? (normalized as AgentKind)
    : 'other'
}

export function equivalentInterruptAgentType(
  actual: AgentType | undefined,
  baseline: AgentType | undefined
): boolean {
  const normalizedActual = actual === 'unknown' ? undefined : actual
  const normalizedBaseline = baseline === 'unknown' ? undefined : baseline
  return normalizedActual === normalizedBaseline
}

// Why: validate the durable `${tabId}:${leafUuid}` leaf suffix at write/hydrate so legacy numeric rows fail closed.
export function isValidPaneKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_PANE_KEY_LEN && parsePaneKey(value) !== null
  )
}

export function dropHydratedIdleClaudeSubagents(
  payload: ParsedAgentStatusPayload
): ParsedAgentStatusPayload {
  if (
    payload.agentType !== 'claude' ||
    !payload.subagents?.some((subagent) => subagent.state === 'idle')
  ) {
    return payload
  }
  const activeSubagents = payload.subagents.filter((subagent) => subagent.state !== 'idle')
  // Why: an idle teammate's liveness can't be proven across a restart (its TeammateIdle confirmation is in-memory); prune so a dead pile can't resurrect — a live teammate re-earns its row via SubagentStart.
  return {
    ...payload,
    subagents: activeSubagents.length > 0 ? activeSubagents : undefined
  }
}

// Why: the sole gate for keeping a providerSessionOnly row; shared so hydrate and status ingestion can't drift.
export function isValidPiProviderSessionOnly(
  providerSession: AgentProviderSessionMetadata | undefined,
  agentType: AgentType | undefined
): boolean {
  return Boolean(providerSession && agentType === 'pi' && getAgentResumeArgv('pi', providerSession))
}

export function sanitizeHydratedEntry(
  paneKey: string,
  rawEntry: unknown
): EnrichedAgentHookEventPayload | null {
  const parsedPaneKey = parsePaneKey(paneKey)
  if (!parsedPaneKey) {
    return null
  }
  if (typeof rawEntry !== 'object' || rawEntry === null) {
    return null
  }
  const record = rawEntry as Record<string, unknown>
  if (record.paneKey !== paneKey) {
    return null
  }
  const tabId = record.tabId
  if (tabId !== undefined && (typeof tabId !== 'string' || tabId.length === 0)) {
    return null
  }
  // Why: a stored tabId that diverges from the paneKey's tab segment is corruption; drop instead of hydrating an inconsistent row.
  if (typeof tabId === 'string' && tabId !== parsedPaneKey.tabId) {
    return null
  }
  const worktreeId = record.worktreeId
  if (worktreeId !== undefined && (typeof worktreeId !== 'string' || worktreeId.length === 0)) {
    return null
  }
  const receivedAt = record.receivedAt
  if (typeof receivedAt !== 'number' || !Number.isFinite(receivedAt) || receivedAt <= 0) {
    return null
  }
  const stateStartedAt = record.stateStartedAt
  if (
    typeof stateStartedAt !== 'number' ||
    !Number.isFinite(stateStartedAt) ||
    stateStartedAt <= 0
  ) {
    return null
  }
  // Why: connectionId is null (local) or string (relay); any other shape is rejected to keep the typed surface honest.
  const connectionIdRaw = record.connectionId
  let connectionId: string | null
  if (connectionIdRaw === null || connectionIdRaw === undefined) {
    connectionId = null
  } else if (typeof connectionIdRaw === 'string') {
    connectionId = connectionIdRaw
  } else {
    return null
  }
  const payload = normalizeAgentStatusPayload(record.payload)
  if (!payload) {
    return null
  }
  const providerSession = normalizeAgentProviderSession(record.providerSession) ?? undefined
  const providerSessionOnly = record.providerSessionOnly === true
  if (providerSessionOnly && !isValidPiProviderSessionOnly(providerSession, payload.agentType)) {
    return null
  }
  return {
    paneKey,
    tabId: typeof tabId === 'string' ? tabId : undefined,
    worktreeId: typeof worktreeId === 'string' ? worktreeId : undefined,
    connectionId,
    hasExplicitPrompt: record.hasExplicitPrompt === true ? true : undefined,
    hookEventName: typeof record.hookEventName === 'string' ? record.hookEventName : undefined,
    toolUseId: typeof record.toolUseId === 'string' ? record.toolUseId : undefined,
    toolAgentId: typeof record.toolAgentId === 'string' ? record.toolAgentId : undefined,
    toolAgentType: typeof record.toolAgentType === 'string' ? record.toolAgentType : undefined,
    providerSession,
    providerSessionOnly: providerSessionOnly ? true : undefined,
    payload,
    receivedAt,
    stateStartedAt
  }
}

export function readPersistedLaunchTokenHash(rawEntry: unknown): string | null {
  if (typeof rawEntry !== 'object' || rawEntry === null) {
    return null
  }
  const record = rawEntry as Record<string, unknown>
  const launchTokenHash =
    typeof record.launchTokenHash === 'string' ? record.launchTokenHash.trim() : ''
  if (/^[a-f0-9]{64}$/.test(launchTokenHash)) {
    return launchTokenHash
  }
  const legacyLaunchToken = typeof record.launchToken === 'string' ? record.launchToken.trim() : ''
  return legacyLaunchToken ? createHash('sha256').update(legacyLaunchToken).digest('hex') : null
}

export function sanitizePersistedAuthorityCommitment(
  paneKey: string,
  value: unknown
): AgentHookAuthorityEvidence | null {
  if (!isValidPaneKey(paneKey) || typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  const launchTokenHash =
    typeof record.launchTokenHash === 'string' ? record.launchTokenHash.trim() : ''
  const connectionId = record.connectionId
  const observedAt = record.observedAt
  if (
    !/^[a-f0-9]{64}$/.test(launchTokenHash) ||
    (connectionId !== null && typeof connectionId !== 'string') ||
    typeof observedAt !== 'number' ||
    !Number.isFinite(observedAt)
  ) {
    return null
  }
  return Object.freeze({
    paneKey,
    launchTokenHash,
    connectionId,
    ...(typeof record.tabId === 'string' ? { tabId: record.tabId } : {}),
    ...(typeof record.worktreeId === 'string' ? { worktreeId: record.worktreeId } : {}),
    observedAt
  })
}

export function authorityCommitmentsMatch(
  left: AgentHookAuthorityEvidence,
  right: AgentHookAuthorityEvidence
): boolean {
  return (
    left.paneKey === right.paneKey &&
    left.launchTokenHash === right.launchTokenHash &&
    left.connectionId === right.connectionId &&
    left.tabId === right.tabId &&
    left.worktreeId === right.worktreeId
  )
}

export function trackEmptyPaneKeyHook(body: unknown): void {
  if (typeof body !== 'object' || body === null) {
    return
  }
  const paneKey = (body as Record<string, unknown>).paneKey
  if (typeof paneKey === 'string' && paneKey.trim().length > 0) {
    return
  }
}

export function isToolProgressWorkingAfterInterrupt(next: AgentHookEventPayload): boolean {
  if (next.payload.state !== 'working') {
    return false
  }
  if (next.payload.agentType !== 'claude') {
    return false
  }
  // Why: a same-prompt retry is another UserPromptSubmit, while late post-Ctrl+C progress arrives as tool lifecycle work.
  return next.hookEventName !== undefined && TOOL_PROGRESS_HOOK_EVENTS.has(next.hookEventName)
}

export function paneCacheKeyTabId(key: string): string | null {
  const paneKey = key.split('\0', 1)[0] ?? key
  return parsePaneKey(paneKey)?.tabId ?? parseLegacyNumericPaneKey(paneKey)?.tabId ?? null
}

export function paneCacheKeyMatchesTab(key: string, tabId: string): boolean {
  return paneCacheKeyTabId(key) === tabId
}

export function shouldKeepClaudePermissionVisible(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): boolean {
  if (
    previous?.payload.agentType !== 'claude' ||
    previous.payload.state !== 'waiting' ||
    previous.hookEventName !== 'PermissionRequest' ||
    next.payload.agentType !== 'claude' ||
    next.payload.state !== 'working'
  ) {
    return false
  }
  if (next.hasExplicitPrompt === true) {
    return false
  }
  if (isClaudePermissionResumingApprovedTool(previous, next)) {
    return false
  }
  // Why: only real permission requests stay sticky; newer Claude reports AskUserQuestion as a PermissionRequest, so tool name (not event) decides.
  if (isAskUserQuestionTool(previous.payload.toolName)) {
    return false
  }
  return true
}

export function isClaudePermissionResumingApprovedTool(
  previous: EnrichedAgentHookEventPayload,
  next: AgentHookEventPayload
): boolean {
  const previousToolUseId = previous.toolUseId?.trim() || undefined
  const nextToolUseId = next.toolUseId?.trim() || undefined
  const previousAgentId = previous.toolAgentId?.trim() || undefined
  const nextAgentId = next.toolAgentId?.trim() || undefined
  const hasAgentId = previousAgentId !== undefined || nextAgentId !== undefined
  const previousAgentType = previous.toolAgentType?.trim() || undefined
  const nextAgentType = next.toolAgentType?.trim() || undefined
  const hasMatchingConcreteAgentId =
    previousAgentId !== undefined && previousAgentId === nextAgentId
  const hasSameExplicitAgentType =
    !hasAgentId && previousAgentType !== undefined && previousAgentType === nextAgentType
  const sameToolName =
    previous.payload.toolName !== undefined && previous.payload.toolName === next.payload.toolName
  const sameKnownToolInput =
    previous.payload.toolInput !== undefined &&
    previous.payload.toolInput === next.payload.toolInput
  const sameUnknownInputFromConcreteAgent =
    hasMatchingConcreteAgentId &&
    previous.payload.toolInput === undefined &&
    next.payload.toolInput === undefined
  const hasMatchingToolUseId =
    previousToolUseId !== undefined && previousToolUseId === nextToolUseId
  const hasConflictingToolUseId =
    previousToolUseId !== undefined &&
    nextToolUseId !== undefined &&
    previousToolUseId !== nextToolUseId
  const sameUnknownInputFromToolUseId =
    hasMatchingToolUseId &&
    previous.payload.toolInput === undefined &&
    next.payload.toolInput === undefined

  return (
    (next.hookEventName === 'PreToolUse' || next.hookEventName === 'PostToolUse') &&
    nextToolUseId !== undefined &&
    !hasConflictingToolUseId &&
    // Why: subagents share agent_type, so a concrete agent id (or the preserved PostToolUse tool_use_id) is the safest resume signal.
    (hasMatchingConcreteAgentId || hasSameExplicitAgentType || hasMatchingToolUseId) &&
    sameToolName &&
    (sameKnownToolInput || sameUnknownInputFromConcreteAgent || sameUnknownInputFromToolUseId)
  )
}

export function shouldInheritClaudeToolUseIdForPermission(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): boolean {
  if (
    previous?.payload.agentType !== 'claude' ||
    previous.payload.state !== 'working' ||
    previous.hookEventName !== 'PreToolUse' ||
    typeof previous.toolUseId !== 'string' ||
    previous.toolUseId.trim().length === 0 ||
    next.payload.agentType !== 'claude' ||
    next.payload.state !== 'waiting' ||
    next.hookEventName !== 'PermissionRequest' ||
    next.toolUseId !== undefined
  ) {
    return false
  }
  const sameKnownToolInput =
    previous.payload.toolInput !== undefined &&
    previous.payload.toolInput === next.payload.toolInput
  const sameUnknownToolInput =
    previous.payload.toolInput === undefined && next.payload.toolInput === undefined
  if (
    previous.toolAgentId !== next.toolAgentId ||
    previous.toolAgentType !== next.toolAgentType ||
    previous.payload.toolName === undefined ||
    previous.payload.toolName !== next.payload.toolName ||
    (!sameKnownToolInput && !sameUnknownToolInput)
  ) {
    return false
  }
  return true
}

export function attachClaudePermissionToolUseId(
  previous: EnrichedAgentHookEventPayload | undefined,
  next: AgentHookEventPayload
): AgentHookEventPayload {
  const inheritedToolUseId = previous?.toolUseId
  if (
    !shouldInheritClaudeToolUseIdForPermission(previous, next) ||
    typeof inheritedToolUseId !== 'string'
  ) {
    return next
  }
  return {
    ...next,
    // Why: Claude emits PermissionRequest without tool_use_id, then PostToolUse carries the original PreToolUse id.
    toolUseId: inheritedToolUseId
  }
}
