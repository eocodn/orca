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
const { extractClaudeToolFields, extractCodexToolFields, extractGeminiToolFields, readAntigravityToolCall, extractAntigravityToolFields, extractAmpToolFields, extractOpenCodeToolFields, extractCursorToolFields, normalizeCopilotEventName, resolveCopilotEventName, readCopilotToolCall } = sourceTools
const { isAskUserTool, extractCopilotToolFields, extractPiToolFields, isDroidPermissionNotification, isDroidIdleNotification, isDroidAskUserTool, readDroidToolRiskLevel, isDroidHighRiskToolUse, extractDroidToolFields, extractCommandCodeToolFields, normalizeHookEventName, isGrokEvent, extractGrokToolFields, extractHermesToolFields, isGrokPermissionNotification, getGrokNotificationType, isGrokRoutinePermissionPromptNotification, isGrokIdleNotification } = providerTools
const { isNewTurnEvent, hasExplicitUserPrompt, extractToolFields } = policy

export function normalizeOpenCodeFamilyEvent(
  source: 'opencode' | 'mimo-code',
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const stateName =
    eventName === 'SessionBusy' || eventName === 'MessagePart'
      ? 'working'
      : eventName === 'SessionIdle'
        ? 'done'
        : eventName === 'PermissionRequest' || eventName === 'AskUserQuestion'
          ? 'waiting'
          : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields(source, eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent(source, eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent(source, eventName)
    }),
    agentType: source,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeCursorEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  // Why: Cursor can emit final response text after `stop`; enrich the completed row, don't resurrect the agent as working.
  const previousStatus = state.lastStatusByPaneKey.get(paneKey)?.payload
  const stateName =
    eventName === 'beforeSubmitPrompt' ||
    eventName === 'sessionStart' ||
    eventName === 'preToolUse' ||
    eventName === 'postToolUse' ||
    eventName === 'postToolUseFailure' ||
    // Why: these fire on every shell/MCP invocation (pre-execution gates, not just approval); treat as working to avoid waiting-notification spam.
    eventName === 'beforeShellExecution' ||
    eventName === 'beforeMCPExecution'
      ? 'working'
      : eventName === 'afterAgentResponse'
        ? previousStatus?.state === 'done' && previousStatus.agentType === 'cursor'
          ? 'done'
          : 'working'
        : eventName === 'stop' || eventName === 'sessionEnd'
          ? 'done'
          : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('cursor', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('cursor', eventName) }
  )

  const interrupted =
    eventName === 'stop' &&
    typeof hookPayload.status === 'string' &&
    hookPayload.status !== 'completed'
      ? true
      : undefined

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('cursor', eventName)
    }),
    agentType: 'cursor',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted
  })
}

// Why: Copilot PermissionRequest fires before allow/ask/deny (stays working); ask_user and notification prompts are the real blocked signals.
export function normalizeCopilotEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const normalizedEventName = normalizeCopilotEventName(
    resolveCopilotEventName(eventName, hookPayload)
  )
  const notificationType = readFirstString(hookPayload, ['notification_type', 'notificationType'])
  const isBlockingNotification =
    normalizedEventName === 'Notification' &&
    (notificationType === 'permission_prompt' || notificationType === 'elicitation_dialog')
  const toolSnapshot = extractToolFields('copilot', normalizedEventName, hookPayload)
  const isAskUserPrompt =
    (normalizedEventName === 'PreToolUse' || normalizedEventName === 'PermissionRequest') &&
    isAskUserTool(toolSnapshot.toolName)
  const stateName =
    normalizedEventName === 'SessionStart' ||
    normalizedEventName === 'UserPromptSubmit' ||
    normalizedEventName === 'PostToolUse' ||
    normalizedEventName === 'PostToolUseFailure'
      ? 'working'
      : isBlockingNotification || isAskUserPrompt
        ? 'blocked'
        : normalizedEventName === 'PreToolUse' || normalizedEventName === 'PermissionRequest'
          ? 'working'
          : normalizedEventName === 'Stop' || normalizedEventName === 'SessionEnd'
            ? 'done'
            : normalizedEventName === 'ErrorOccurred'
              ? hookPayload.recoverable === true
                ? 'working'
                : 'done'
              : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(state, paneKey, toolSnapshot, {
    resetOnNewTurn: isNewTurnEvent('copilot', normalizedEventName)
  })

  const effectivePrompt = normalizedEventName === 'Notification' ? '' : promptText

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: isNewTurnEvent('copilot', normalizedEventName)
    }),
    agentType: 'copilot',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizePiCompatibleEvent(
  state: HookListenerState,
  agentType: 'pi' | 'omp',
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (agentType === 'pi' && eventName === 'session_start') {
    // Why: Pi's session_start fires on TUI open/resume; discard stale turn details, no working row before user activity.
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  // Why: gate on the event's own tool_name (not a merged snapshot) so a stale cached ask_user_question can't re-enter blocked.
  const isPiAskUserQuestion =
    agentType === 'pi' &&
    isAskUserQuestionTool(readString(hookPayload, 'tool_name')) &&
    (eventName === 'tool_call' || eventName === 'tool_execution_start')

  const stateName = isPiAskUserQuestion
    ? 'blocked'
    : eventName === 'before_agent_start' ||
        eventName === 'agent_start' ||
        eventName === 'tool_call' ||
        eventName === 'tool_execution_start' ||
        eventName === 'tool_execution_end' ||
        eventName === 'message_end'
      ? 'working'
      : eventName === 'agent_end'
        ? 'done'
        : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields(agentType, eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent(agentType, eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent(agentType, eventName)
    }),
    agentType,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeDroidEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (eventName === 'SessionStart') {
    // Why: Droid's SessionStart fires while idle (TUI open/resume); wait for real activity before a working row.
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  const notificationMessage = readString(hookPayload, 'message')
  const droidToolName = readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name')
  let stateName: 'working' | 'waiting' | 'done' | null = null
  if (
    eventName === 'PreToolUse' &&
    (isDroidAskUserTool(droidToolName) || isDroidHighRiskToolUse(hookPayload))
  ) {
    // Why: Droid surfaces AskUser and high-risk approvals as PreToolUse; the approval path emits no Notification hook.
    stateName = 'waiting'
  } else if (
    eventName === 'UserPromptSubmit' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
  ) {
    stateName = 'working'
  } else if (eventName === 'Stop') {
    stateName = 'done'
  } else if (eventName === 'PermissionRequest') {
    stateName = 'waiting'
  } else if (eventName === 'Notification' && isDroidPermissionNotification(notificationMessage)) {
    stateName = 'waiting'
  } else if (eventName === 'Notification' && isDroidIdleNotification(notificationMessage)) {
    // Why: Droid emits no Stop on user-interrupt, only an idle notification when ready again.
    stateName = 'done'
  }
  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('droid', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('droid', eventName) }
  )

  // Why: Droid Notification.message is status text, not the prompt; '' keeps resolvePrompt's cached UserPromptSubmit value.
  const effectivePrompt = eventName === 'Notification' ? '' : promptText

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: isNewTurnEvent('droid', eventName)
    }),
    agentType: 'droid',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeCommandCodeEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const stateName =
    eventName === 'PreToolUse' || eventName === 'PostToolUse'
      ? 'working'
      : eventName === 'Stop'
        ? 'done'
        : null
  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('command-code', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('command-code', eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('command-code', eventName)
    }),
    agentType: 'command-code',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeGrokEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  grokHome?: string
): ParsedAgentStatusPayload | null {
  if (isGrokEvent(eventName, 'session_start')) {
    // Why: SessionStart resets stale per-turn state but must not create a working row before any prompt/tool event.
    clearPaneTurnCacheState(state, paneKey)
    return null
  }

  const notificationMessage = readString(hookPayload, 'message')
  const notificationType = getGrokNotificationType(hookPayload)
  const notificationLevel = readString(hookPayload, 'level')
  const preToolName =
    readString(hookPayload, 'toolName') ??
    readString(hookPayload, 'tool_name') ??
    readString(hookPayload, 'name')
  // Why: Grok's ask_user_question is auto-allowed, so it fires PreToolUse while blocked on a human answer; map to waiting.
  const isUserInputPreTool =
    isGrokEvent(eventName, 'pre_tool_use') && isAskUserQuestionTool(preToolName)

  let stateName: 'working' | 'waiting' | 'done' | null = null
  if (
    isGrokEvent(eventName, 'user_prompt_submit', 'post_tool_use', 'post_tool_use_failure') ||
    (isGrokEvent(eventName, 'pre_tool_use') && !isUserInputPreTool)
  ) {
    stateName = 'working'
  } else if (isUserInputPreTool) {
    stateName = 'waiting'
  } else if (isGrokEvent(eventName, 'stop', 'session_end', 'stop_failure')) {
    stateName = 'done'
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokRoutinePermissionPromptNotification(
      notificationType,
      notificationMessage,
      notificationLevel
    )
  ) {
    return null
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokPermissionNotification(notificationMessage)
  ) {
    stateName = 'waiting'
  } else if (
    isGrokEvent(eventName, 'notification') &&
    isGrokIdleNotification(notificationMessage)
  ) {
    stateName = 'done'
  }
  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('grok', eventName, hookPayload, { grokHome }),
    { resetOnNewTurn: isNewTurnEvent('grok', eventName) }
  )

  // Why: Grok Notification.message is status UI text, not the prompt; '' preserves the cached UserPromptSubmit.
  const effectivePrompt = isGrokEvent(eventName, 'notification')
    ? ''
    : stripGrokUserQueryWrapper(promptText)

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, effectivePrompt, {
      resetOnNewTurn: isNewTurnEvent('grok', eventName)
    }),
    agentType: 'grok',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}

export function normalizeHermesEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const stateName =
    eventName === 'pre_approval_request'
      ? 'waiting'
      : eventName === 'post_llm_call' ||
          eventName === 'on_session_end' ||
          eventName === 'on_session_finalize' ||
          eventName === 'on_session_reset'
        ? 'done'
        : eventName === 'on_session_start' ||
            eventName === 'pre_llm_call' ||
            eventName === 'pre_tool_call' ||
            eventName === 'post_tool_call' ||
            eventName === 'post_approval_response'
          ? 'working'
          : null

  if (!stateName) {
    return null
  }

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields('hermes', eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent('hermes', eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent('hermes', eventName)
    }),
    agentType: 'hermes',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage
  })
}
