import type { AgentHookSource } from './agent-hook-relay'
import type { AgentHookEventPayload, ClaudeLeadTurnState, CodexLeadTurnState, HookListenerState } from './agent-hook-state'
import type { ExtractedPromptText, ToolSnapshot } from './agent-hook-prompt-tools'

import { normalizeAgentStatusPayload, type AgentStatusState, type ParsedAgentStatusPayload } from './agent-status-types'
import * as state from './agent-hook-state'
import * as request from './agent-hook-request-body'
import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
import * as sourceTools from './agent-hook-source-tools'
import * as providerTools from './agent-hook-provider-tools'
import * as policy from './agent-hook-event-policy'
const { createHookListenerState, clearPaneCacheState, movePaneScopedMapEntries, movePaneScopedSetEntries, movePaneCacheState, clearPaneTurnCacheState, deletePaneScopedCacheEntry, deletePaneScopedSetEntry, clearAllListenerCaches, warnOnHookEnvOrVersionMismatch } = state
const { HOOK_REQUEST_MAX_BYTES, HOOK_REQUEST_INITIAL_BUFFER_BYTES, AGENT_HOOK_JSON_STRUCTURE_LIMITS, parseAgentHookJson, MAX_WARNED_KEYS, HOOK_REQUEST_SLOWLORIS_MS, OPENCODE_HOOK_TEXT_MAX_CHARS, capOpenCodeHookText, MAX_PANE_KEY_LEN, parseFormEncodedBody, readRequestBody, ignoreSettledRequestError } = request
const { contentBlockArrayText, extractPromptText, stripGrokUserQueryWrapper, resolvePrompt, resolveToolState, TOOL_INPUT_KEYS_BY_TOOL, FALLBACK_TOOL_INPUT_KEYS, deriveToolInputPreview, deriveFallbackToolInputPreview, readString, hasOwnField, hasAnyOwnField, toolUpdate, clearActiveToolFieldsUpdate, stripHookEnvelopeKeys, summarizeApprovalInput, deriveInteractivePrompt, readFirstString, parseJsonObjectString, extractToolResponseText } = prompt
const { TRANSCRIPT_CHUNK_BYTES, TRANSCRIPT_MAX_SCAN_BYTES, EMPTY_TRANSCRIPT_REGION, AMP_THREAD_ID_MAX_LENGTH, AMP_MAX_SCOPED_THREAD_CACHE_KEYS, GROK_SESSION_CWD_MAX_LENGTH, GROK_HOME_ENVELOPE_MAX_LENGTH, extractAssistantTextFromLine, extractAssistantContentText, extractAntigravityUserRequest, extractUserPromptTextFromLine, readLastAssistantFromTranscript, readLastUserPromptFromTranscript, extractCommandCodeUserPromptFromLine, hashInteractionKeyPart, findLastCommandCodePromptInRegion, readLastCommandCodeUserPromptEntryFromTranscript, extractCommandCodeAssistantTextFromLine, readLastCommandCodeAssistantFromTranscript, parseHookBodyPayloadRecord, readBoundedString, readGrokHomeEnvelope, hasControlCharacter, readGrokSessionMetadata, getGrokChatHistoryPath, readLastAssistantFromGrokChatHistory, hasPendingAgentResultText, hasNonEmptyString, hasExplicitLastAssistantResult, preparePendingGrokResultDiscovery, readLastAssistantFromTranscriptOnce, readLastTextFromTranscriptOnce, findLastExtractedTranscriptLineText } = transcript
const { extractClaudeToolFields, extractCodexToolFields, extractGeminiToolFields, readAntigravityToolCall, extractAntigravityToolFields, extractAmpToolFields, extractOpenCodeToolFields, extractCursorToolFields, normalizeCopilotEventName, resolveCopilotEventName, readCopilotToolCall, isAntigravityFeedbackTool, isAntigravityStopStillBusy } = sourceTools
const { isAskUserTool, extractCopilotToolFields, extractPiToolFields, isDroidPermissionNotification, isDroidIdleNotification, isDroidAskUserTool, readDroidToolRiskLevel, isDroidHighRiskToolUse, extractDroidToolFields, extractCommandCodeToolFields, normalizeHookEventName, isGrokEvent, extractGrokToolFields, extractHermesToolFields, isGrokPermissionNotification, getGrokNotificationType, isGrokRoutinePermissionPromptNotification, isGrokIdleNotification } = providerTools
const { isNewTurnEvent, hasExplicitUserPrompt, extractToolFields } = policy
import { extractAgentProviderSession } from './agent-session-resume'

export function normalizeDevinEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (eventName === 'SessionStart') {
    // Why: Devin emits SessionStart on idle TUI open/resume; mapping it to 'working' showed a spinner before the user typed, so only UserPromptSubmit/tool activity may create a row.
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  const stateName =
    eventName === 'UserPromptSubmit' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostCompaction'
      ? 'working'
      : eventName === 'PermissionRequest'
        ? 'waiting'
        : eventName === 'Stop' || eventName === 'SessionEnd'
          ? 'done'
          : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('devin', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('devin', eventName) }
  )

  const interrupted =
    eventName === 'Stop' && hookPayload['is_interrupt'] === true ? true : undefined

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('devin', eventName)
    }),
    agentType: 'devin',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted
  })
}

// Why: Kimi's auto-allowed AskUserQuestion emits PreToolUse (not PermissionRequest) while awaiting an answer; treat as waiting so the UI shows the attention icon, not a spinner.
export function isKimiUserInputTool(toolName: string | undefined): boolean {
  return toolName?.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() === 'askuserquestion'
}

// Why: Kimi Code emits Claude-compatible payloads/event names; normalize but attribute to Kimi so the sidebar shows Kimi's icon/label, not Claude's.
export function normalizeKimiEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const toolName = readString(hookPayload, 'tool_name')
  const isUserInputTool = isKimiUserInputTool(toolName)

  let stateName: 'working' | 'waiting' | 'done' | null = null
  if (
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure' ||
    (eventName === 'PreToolUse' && !isUserInputTool)
  ) {
    stateName = 'working'
  } else if (eventName === 'PermissionRequest' || (eventName === 'PreToolUse' && isUserInputTool)) {
    stateName = 'waiting'
  } else if (eventName === 'Stop' || eventName === 'StopFailure') {
    stateName = 'done'
  }

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('kimi', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('kimi', eventName) }
  )

  const interrupted =
    eventName === 'Stop' && hookPayload['is_interrupt'] === true ? true : undefined

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('kimi', eventName)
    }),
    agentType: 'kimi',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted
  })
}

export function normalizeGeminiEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  // Why: Gemini CLI's native pre-tool event is BeforeTool; PreToolUse/PostToolUse still accepted for legacy Antigravity-compatible payloads.
  const stateName =
    eventName === 'BeforeAgent' ||
    eventName === 'BeforeTool' ||
    eventName === 'AfterTool' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
      ? 'working'
      : eventName === 'AfterAgent'
        ? 'done'
        : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('gemini', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('gemini', eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('gemini', eventName)
    }),
    agentType: 'gemini',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeAntigravityEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const transcriptPath = readFirstString(hookPayload, ['transcriptPath', 'transcript_path'])
  if (eventName === 'PreInvocation') {
    state.antigravityCompletedTranscriptByPaneKey.delete(paneKey)
  } else if (
    transcriptPath &&
    eventName !== 'Stop' &&
    state.antigravityCompletedTranscriptByPaneKey.get(paneKey) === transcriptPath
  ) {
    // Why: agy can emit a bookkeeping PostToolUse after Stop; ignore it so a finished row doesn't turn back into a yellow spinner.
    return null
  }

  const toolName = readAntigravityToolCall(hookPayload).toolName
  const stopStillBusy = eventName === 'Stop' && isAntigravityStopStillBusy(hookPayload)
  const stateName =
    eventName === 'PreToolUse' && isAntigravityFeedbackTool(toolName)
      ? 'waiting'
      : eventName === 'Stop'
        ? stopStillBusy
          ? 'working'
          : 'done'
        : eventName === 'PreInvocation' ||
            eventName === 'PostInvocation' ||
            eventName === 'PreToolUse' ||
            eventName === 'PostToolUse'
          ? 'working'
          : null

  if (!stateName) {
    return null
  }

  const resetsTurn = isNewTurnEvent('antigravity', eventName)
  // Why: once the prompt is cached for this pane, avoid rescanning the (potentially large) Antigravity transcript per hook.
  const cachedPrompt = resetsTurn ? undefined : state.lastPromptByPaneKey.get(paneKey)
  const effectivePrompt =
    promptText || cachedPrompt || readLastUserPromptFromTranscript(transcriptPath) || ''
  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('antigravity', eventName, hookPayload),
    { resetOnNewTurn: resetsTurn }
  )

  const payload = normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: resetsTurn
    }),
    agentType: 'antigravity',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
  // Why: Antigravity can emit Stop with fullyIdle=false between tool steps; only a fully idle Stop is terminal, else the sidebar bounces done -> working and ignores later tool updates.
  if (eventName === 'Stop' && !stopStillBusy && transcriptPath) {
    state.antigravityCompletedTranscriptByPaneKey.set(paneKey, transcriptPath)
  }
  return payload
}

export function normalizeAmpEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const ampCacheKey = getAmpCacheKey(paneKey, hookPayload)
  if (eventName === 'session.start') {
    clearPaneTurnCacheState(state, ampCacheKey)
    if (ampCacheKey !== paneKey) {
      clearPaneTurnCacheState(state, paneKey)
    }
    return null
  }

  const stateName =
    eventName === 'agent.start' || eventName === 'tool.call' || eventName === 'tool.result'
      ? 'working'
      : eventName === 'agent.end'
        ? 'done'
        : null

  if (!stateName) {
    return null
  }
  if (eventName === 'agent.start') {
    state.ampCompletedCacheKeys.delete(ampCacheKey)
  } else if (
    (eventName === 'tool.call' || eventName === 'tool.result') &&
    state.ampCompletedCacheKeys.has(ampCacheKey)
  ) {
    // Why: Amp status posts are fire-and-forget, so drop stale tool events that arrive after the thread ended.
    return null
  }

  const snapshot = resolveToolState(
    state,
    ampCacheKey,
    extractToolFields('amp', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('amp', eventName) }
  )

  const interrupted =
    eventName === 'agent.end' && hookPayload.status === 'cancelled' ? true : undefined
  const explicitPrompt = readFirstString(hookPayload, [
    'prompt',
    'user_prompt',
    'userPrompt',
    'initial_prompt',
    'initialPrompt',
    'user_message'
  ])
  const canUseMessageAsPrompt =
    eventName === 'agent.start' ||
    (eventName === 'agent.end' && !state.lastPromptByPaneKey.has(ampCacheKey))
  const ampPromptText = explicitPrompt ?? (canUseMessageAsPrompt ? promptText : '')

  const normalized = normalizeAgentStatusPayload({
    state: stateName,
    // Why: Amp tool/result events may use `message` for tool output; only lifecycle events may treat it as the turn prompt.
    prompt: resolvePrompt(state, ampCacheKey, ampPromptText, {
      resetOnNewTurn: isNewTurnEvent('amp', eventName)
    }),
    agentType: 'amp',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted
  })
  if (normalized && eventName === 'agent.end') {
    state.ampCompletedCacheKeys.add(ampCacheKey)
  }
  if (normalized) {
    pruneAmpThreadCacheKeys(state, paneKey, ampCacheKey)
  }
  return normalized
}

export function getAmpCacheKey(paneKey: string, hookPayload: Record<string, unknown>): string {
  const threadId = readBoundedString(
    hookPayload,
    ['threadId', 'threadID', 'thread_id'],
    AMP_THREAD_ID_MAX_LENGTH
  )
  // Why: Amp emits events for multiple threads per pane; cache by thread internally while keeping the visible paneKey stable.
  return threadId ? `${paneKey}\0amp:${threadId}` : paneKey
}

export function pruneAmpThreadCacheKeys(
  state: HookListenerState,
  paneKey: string,
  currentCacheKey: string
): void {
  const scopedPrefix = `${paneKey}\0amp:`
  if (!currentCacheKey.startsWith(scopedPrefix)) {
    return
  }

  const scopedKeys = new Set<string>()
  for (const key of state.lastPromptByPaneKey.keys()) {
    if (key.startsWith(scopedPrefix)) {
      scopedKeys.add(key)
    }
  }
  for (const key of state.lastToolByPaneKey.keys()) {
    if (key.startsWith(scopedPrefix)) {
      scopedKeys.add(key)
    }
  }
  for (const key of state.ampCompletedCacheKeys) {
    if (key.startsWith(scopedPrefix)) {
      scopedKeys.add(key)
    }
  }

  let overflow = scopedKeys.size - AMP_MAX_SCOPED_THREAD_CACHE_KEYS
  if (overflow <= 0) {
    return
  }

  // Why: Amp multiplexes many thread IDs through one pane; keep the current thread plus the most recent entries instead of retaining every completed thread until teardown.
  for (const key of scopedKeys) {
    if (overflow <= 0) {
      break
    }
    if (key === currentCacheKey) {
      continue
    }
    state.lastPromptByPaneKey.delete(key)
    state.lastToolByPaneKey.delete(key)
    state.ampCompletedCacheKeys.delete(key)
    overflow--
  }
}

export function hasExplicitPromptForSource(
  source: AgentHookSource,
  eventName: unknown,
  promptText: string,
  hookPayload: Record<string, unknown>
): boolean {
  if (source !== 'amp') {
    return promptText.length > 0
  }
  if (
    readFirstString(hookPayload, [
      'prompt',
      'user_prompt',
      'userPrompt',
      'initial_prompt',
      'initialPrompt',
      'user_message'
    ])
  ) {
    return true
  }
  // Why: Amp tool/result `message` is output text, not a user prompt.
  return eventName === 'agent.start' && promptText.length > 0
}
