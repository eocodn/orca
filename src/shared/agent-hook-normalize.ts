import type { AgentHookSource } from './agent-hook-relay'
import type { AgentHookEventPayload, HookListenerState } from './agent-hook-state'
import { normalizeAgentStatusPayload, type ParsedAgentStatusPayload } from './agent-status-types'
import { extractAgentProviderSession } from './agent-session-resume'
import { parsePaneKey } from './stable-pane-id'
import * as state from './agent-hook-state'
import * as request from './agent-hook-request-body'
import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
import * as sourceTools from './agent-hook-source-tools'
import * as providerTools from './agent-hook-provider-tools'
import * as policy from './agent-hook-event-policy'
import * as claudeEvents from './agent-hook-claude-events'
import * as basicEvents from './agent-hook-basic-events'
import * as codexEvents from './agent-hook-codex-events'
import * as providerEvents from './agent-hook-provider-events'
const { createHookListenerState, clearPaneCacheState, movePaneScopedMapEntries, movePaneScopedSetEntries, movePaneCacheState, clearPaneTurnCacheState, deletePaneScopedCacheEntry, deletePaneScopedSetEntry, clearAllListenerCaches, warnOnHookEnvOrVersionMismatch } = state
const { HOOK_REQUEST_MAX_BYTES, HOOK_REQUEST_INITIAL_BUFFER_BYTES, AGENT_HOOK_JSON_STRUCTURE_LIMITS, parseAgentHookJson, MAX_WARNED_KEYS, HOOK_REQUEST_SLOWLORIS_MS, OPENCODE_HOOK_TEXT_MAX_CHARS, capOpenCodeHookText, MAX_PANE_KEY_LEN } = request
const { contentBlockArrayText, extractPromptText, stripGrokUserQueryWrapper, resolvePrompt, resolveToolState, TOOL_INPUT_KEYS_BY_TOOL, FALLBACK_TOOL_INPUT_KEYS, deriveToolInputPreview, deriveFallbackToolInputPreview, readString, hasOwnField, hasAnyOwnField, toolUpdate, clearActiveToolFieldsUpdate, stripHookEnvelopeKeys, summarizeApprovalInput, deriveInteractivePrompt, readFirstString, parseJsonObjectString, extractToolResponseText } = prompt
const { TRANSCRIPT_CHUNK_BYTES, TRANSCRIPT_MAX_SCAN_BYTES, EMPTY_TRANSCRIPT_REGION, AMP_THREAD_ID_MAX_LENGTH, AMP_MAX_SCOPED_THREAD_CACHE_KEYS, GROK_SESSION_CWD_MAX_LENGTH, GROK_HOME_ENVELOPE_MAX_LENGTH, extractAssistantTextFromLine, extractAssistantContentText, extractAntigravityUserRequest, extractUserPromptTextFromLine, readLastAssistantFromTranscript, readLastUserPromptFromTranscript, extractCommandCodeUserPromptFromLine, hashInteractionKeyPart, findLastCommandCodePromptInRegion, readLastCommandCodeUserPromptEntryFromTranscript, extractCommandCodeAssistantTextFromLine, readLastCommandCodeAssistantFromTranscript, parseHookBodyPayloadRecord, readBoundedString, readGrokHomeEnvelope, hasControlCharacter, readGrokSessionMetadata, getGrokChatHistoryPath, readLastAssistantFromGrokChatHistory, hasPendingAgentResultText, hasNonEmptyString, hasExplicitLastAssistantResult, preparePendingGrokResultDiscovery, readLastAssistantFromTranscriptOnce, readLastTextFromTranscriptOnce, findLastExtractedTranscriptLineText } = transcript
const { extractClaudeToolFields, extractCodexToolFields, extractGeminiToolFields, readAntigravityToolCall, extractAntigravityToolFields, extractAmpToolFields, extractOpenCodeToolFields, extractCursorToolFields, normalizeCopilotEventName, resolveCopilotEventName, readCopilotToolCall } = sourceTools
const { isAskUserTool, extractCopilotToolFields, extractPiToolFields, isDroidPermissionNotification, isDroidIdleNotification, isDroidAskUserTool, readDroidToolRiskLevel, isDroidHighRiskToolUse, extractDroidToolFields, extractCommandCodeToolFields, normalizeHookEventName, isGrokEvent, extractGrokToolFields, extractHermesToolFields, isGrokPermissionNotification, getGrokNotificationType, isGrokRoutinePermissionPromptNotification, isGrokIdleNotification } = providerTools
const { isNewTurnEvent, hasExplicitUserPrompt, extractToolFields } = policy
const { getOrCreateClaudeSubagentRoster, normalizeClaudeSubagentLifecycleEvent, markClaudeLeadTurnInterrupted, seedClaudeSubagentRosterFromSnapshots, reapRestoredClaudeSubagentsForDeadPane, clearClaudePendingWaitForAgent, clearClaudeAnsweredQuestionWait, buildClaudeChildDrivenStatusPayload, normalizeClaudeEvent, buildClaudeStatusPayload } = claudeEvents
const { normalizeDevinEvent, isKimiUserInputTool, normalizeKimiEvent, normalizeGeminiEvent, isAntigravityFeedbackTool, isAntigravityStopStillBusy, normalizeAntigravityEvent, normalizeAmpEvent, getAmpCacheKey, pruneAmpThreadCacheKeys, hasExplicitPromptForSource } = basicEvents
const { getOrCreateCodexSubagentRoster, getOrCreateCodexSubagentTranscriptState, hasCodexTranscriptSubagents, seedCodexStateFromSnapshot, markCodexLeadTurnInterrupted, codexLeadStateForHookEvent, reconcileRemoteCodexState, buildCodexStatusPayload, buildCodexChildDrivenStatusPayload, normalizeCodexSubagentLifecycleEvent, normalizeCodexEvent } = codexEvents
const { normalizeOpenCodeFamilyEvent, normalizeCursorEvent, normalizeCopilotEvent, normalizePiCompatibleEvent, normalizeDroidEvent, normalizeCommandCodeEvent, normalizeGrokEvent, normalizeHermesEvent } = providerEvents

export function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizeHookPayload(
  state: HookListenerState,
  source: AgentHookSource,
  body: unknown,
  expectedEnv: string
): AgentHookEventPayload | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const record = body as Record<string, unknown>
  const paneKey = typeof record.paneKey === 'string' ? record.paneKey.trim() : ''
  const parsedPaneKey = parsePaneKey(paneKey)
  const rawPayload = record.payload
  const hookPayload =
    typeof rawPayload === 'string'
      ? (() => {
          try {
            return parseAgentHookJson(rawPayload)
          } catch {
            return null
          }
        })()
      : rawPayload
  if (
    !paneKey ||
    paneKey.length > MAX_PANE_KEY_LEN ||
    !parsedPaneKey ||
    typeof hookPayload !== 'object' ||
    hookPayload === null
  ) {
    return null
  }

  warnOnHookEnvOrVersionMismatch(state, {
    version: readStringField(record, 'version'),
    env: readStringField(record, 'env'),
    expectedEnv
  })

  const tabId = readStringField(record, 'tabId')
  if (tabId && tabId !== parsedPaneKey.tabId) {
    return null
  }
  const worktreeId = readStringField(record, 'worktreeId')
  const launchToken = readStringField(record, 'launchToken')

  const hookPayloadRecord = hookPayload as Record<string, unknown>
  let promptInteractionKey: string | undefined
  const eventName =
    readFirstString(record, ['hook_event_name', 'hookEventName', 'hook_type', 'hookType']) ??
    hookPayloadRecord.hook_event_name ??
    hookPayloadRecord.hookEventName
  const extractedPrompt = extractPromptText(hookPayload as Record<string, unknown>)
  const promptText = extractedPrompt.text
  let resolvedPromptText = promptText
  let hasTranscriptPromptEvidence = false
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of silently misrouting.
  let payload: ParsedAgentStatusPayload | null
  switch (source) {
    case 'claude':
      payload = normalizeClaudeEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'codex':
      payload = normalizeCodexEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'gemini':
      payload = normalizeGeminiEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'antigravity':
      if (isNewTurnEvent('antigravity', eventName)) {
        resolvedPromptText =
          promptText ||
          readLastUserPromptFromTranscript(
            readFirstString(hookPayloadRecord, ['transcriptPath', 'transcript_path'])
          ) ||
          ''
      }
      payload = normalizeAntigravityEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'amp':
      payload = normalizeAmpEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'opencode':
    case 'mimo-code':
      if (extractedPrompt.source === 'role_user_text') {
        const messageId = readFirstString(hookPayloadRecord, [
          'messageID',
          'messageId',
          'message_id'
        ])
        const prefix = source === 'mimo-code' ? 'mimo-code-message' : 'opencode-message'
        promptInteractionKey = messageId ? `${prefix}-${messageId}` : undefined
      }
      payload = normalizeOpenCodeFamilyEvent(
        source,
        state,
        eventName,
        promptText,
        paneKey,
        hookPayloadRecord
      )
      break
    case 'cursor':
      payload = normalizeCursorEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'pi':
      payload = normalizePiCompatibleEvent(
        state,
        'pi',
        eventName,
        promptText,
        paneKey,
        hookPayloadRecord
      )
      break
    case 'omp':
      payload = normalizePiCompatibleEvent(
        state,
        'omp',
        eventName,
        promptText,
        paneKey,
        hookPayloadRecord
      )
      break
    case 'droid':
      payload = normalizeDroidEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'command-code':
      {
        const transcriptPrompt = readLastCommandCodeUserPromptEntryFromTranscript(
          hookPayloadRecord.transcript_path ?? hookPayloadRecord.transcriptPath
        )
        hasTranscriptPromptEvidence = transcriptPrompt !== undefined
        promptInteractionKey = transcriptPrompt?.interactionKey
        resolvedPromptText = transcriptPrompt?.text ?? ''
        if (promptText && extractedPrompt.source !== 'message') {
          resolvedPromptText = promptText
        }
      }
      payload = normalizeCommandCodeEvent(
        state,
        eventName,
        resolvedPromptText,
        paneKey,
        hookPayloadRecord
      )
      break
    case 'grok':
      payload = normalizeGrokEvent(
        state,
        eventName,
        promptText,
        paneKey,
        hookPayloadRecord,
        readGrokHomeEnvelope(record)
      )
      break
    case 'copilot':
      payload = normalizeCopilotEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'hermes':
      payload = normalizeHermesEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'devin':
      payload = normalizeDevinEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
    case 'kimi':
      payload = normalizeKimiEvent(state, eventName, promptText, paneKey, hookPayloadRecord)
      break
  }

  // Why: connectionId is null here; ingestRemote stamps it from mux identity on receive. See docs/design/agent-status-over-ssh.md §5.
  // Why: Codex child hooks expose the child's session_id on the parent's pane;
  // treating it as the root resume id would replace the terminal's real session.
  const providerSession =
    source === 'codex' && readString(hookPayloadRecord, 'agent_id')
      ? null
      : extractAgentProviderSession(source, hookPayloadRecord)
  const providerSessionOnly =
    source === 'pi' && eventName === 'session_start' && providerSession !== null
  // Why: Pi session_start carries resume identity while idle; providerSessionOnly makes receivers discard the placeholder row.
  const transportPayload =
    payload ??
    (providerSessionOnly
      ? normalizeAgentStatusPayload({ state: 'done', prompt: '', agentType: 'pi' })
      : null)
  return transportPayload
    ? {
        paneKey,
        launchToken,
        tabId,
        worktreeId,
        connectionId: null,
        hasExplicitPrompt:
          source === 'amp'
            ? hasExplicitPromptForSource(source, eventName, promptText, hookPayloadRecord)
              ? true
              : undefined
            : hasExplicitUserPrompt(
                source,
                eventName,
                extractedPrompt,
                resolvedPromptText,
                hasTranscriptPromptEvidence
              ),
        promptInteractionKey,
        hookEventName: typeof eventName === 'string' ? eventName : undefined,
        toolUseId: readFirstString(hookPayloadRecord, ['tool_use_id', 'toolUseId']),
        toolAgentId: readFirstString(hookPayloadRecord, ['agent_id', 'agentId']),
        toolAgentType: readString(hookPayloadRecord, 'agent_type'),
        ...(providerSession ? { providerSession } : {}),
        ...(providerSessionOnly ? { providerSessionOnly: true } : {}),
        payload: transportPayload
      }
    : null
}
