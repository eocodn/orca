import type { AgentHookSource } from './agent-hook-relay'
import type { HookListenerState } from './agent-hook-state'
import type { ExtractedPromptText, ToolSnapshot } from './agent-hook-prompt-tools'
import * as prompt from './agent-hook-prompt-tools'
import * as sourceTools from './agent-hook-source-tools'
import * as providerTools from './agent-hook-provider-tools'
import { isKnownHarnessInjectedUserTurnText } from './harness-injected-user-turns'
const { normalizeCopilotEventName } = providerTools
const {
  extractClaudeToolFields,
  extractCodexToolFields,
  extractGeminiToolFields,
  extractAntigravityToolFields,
  extractAmpToolFields,
  extractOpenCodeToolFields,
  extractCursorToolFields
} = sourceTools
const {
  extractPiToolFields,
  extractDroidToolFields,
  extractCommandCodeToolFields,
  extractGrokToolFields,
  extractCopilotToolFields,
  extractHermesToolFields
} = providerTools

export function isNewTurnEvent(source: AgentHookSource, eventName: unknown): boolean {
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of falling through to false.
  switch (source) {
    case 'claude':
    // Why: Kimi Code emits Claude-compatible hook events, so UserPromptSubmit is its new-turn boundary too.
    // falls through
    case 'kimi':
      return eventName === 'UserPromptSubmit'
    case 'codex':
      return eventName === 'SessionStart' || eventName === 'UserPromptSubmit'
    case 'gemini':
      return eventName === 'BeforeAgent'
    case 'antigravity':
      return eventName === 'PreInvocation'
    case 'amp':
      return eventName === 'agent.start'
    case 'opencode':
    case 'mimo-code':
      return false
    case 'cursor':
      return eventName === 'beforeSubmitPrompt' || eventName === 'sessionStart'
    case 'pi':
    case 'omp':
      return eventName === 'before_agent_start'
    case 'droid':
      return eventName === 'UserPromptSubmit'
    case 'command-code':
      return false
    case 'grok':
      return isGrokEvent(eventName, 'user_prompt_submit')
    case 'copilot': {
      const normalizedEventName = normalizeCopilotEventName(eventName)
      return normalizedEventName === 'SessionStart' || normalizedEventName === 'UserPromptSubmit'
    }
    case 'hermes':
      return eventName === 'pre_llm_call' || eventName === 'on_session_start'
    case 'devin':
      // Why: SessionStart is handled by an early return in normalizeDevinEvent, so UserPromptSubmit is Devin's real new-turn boundary here.
      return eventName === 'UserPromptSubmit'
  }
}

export function hasExplicitUserPrompt(
  source: AgentHookSource,
  eventName: unknown,
  extractedPrompt: ExtractedPromptText,
  resolvedPromptText: string,
  hasTranscriptPromptEvidence = false
): boolean {
  if (
    source === 'command-code' &&
    (eventName === 'PreToolUse' || eventName === 'Stop') &&
    (extractedPrompt.source !== 'message' || hasTranscriptPromptEvidence) &&
    resolvedPromptText.trim().length > 0
  ) {
    // Why: Command Code exposes the submitted prompt via its transcript, not direct hook fields; treat the transcript-backed prompt as explicit so telemetry covers real turns.
    return true
  }
  if (
    source === 'antigravity' &&
    isNewTurnEvent(source, eventName) &&
    resolvedPromptText.trim().length > 0
  ) {
    return true
  }
  if (extractedPrompt.source === 'role_user_text') {
    return (source === 'opencode' || source === 'mimo-code') && eventName === 'MessagePart'
  }
  if (extractedPrompt.text.length === 0) {
    return false
  }
  // Why: harness-injected turns aren't a user submit (no prompt-sent telemetry or permission stickiness); match only KNOWN tags so a real `<my-element>` prompt still counts and survives interrupt recovery.
  if (isKnownHarnessInjectedUserTurnText(extractedPrompt.text)) {
    return false
  }
  // Why: bare `message` fields often carry permission/status copy — may update visible status prompts but aren't proof of a user submit.
  if (extractedPrompt.source === 'message') {
    return false
  }
  if (
    extractedPrompt.source === 'user_prompt' ||
    extractedPrompt.source === 'userPrompt' ||
    extractedPrompt.source === 'user_message'
  ) {
    return isNewTurnEvent(source, eventName)
  }
  return isNewTurnEvent(source, eventName)
}

export function extractToolFields(
  source: AgentHookSource,
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  options?: { grokHome?: string }
): ToolSnapshot {
  // Why: exhaustive switch so a new AgentHookSource fails typecheck here instead of silently routing through OpenCode's extractor.
  switch (source) {
    case 'claude':
    // Why: Kimi Code uses Claude's tool_name/tool_input payload fields verbatim.
    // falls through
    case 'kimi':
      return extractClaudeToolFields(eventName, hookPayload)
    case 'codex':
      return extractCodexToolFields(eventName, hookPayload)
    case 'gemini':
      return extractGeminiToolFields(eventName, hookPayload)
    case 'antigravity':
      return extractAntigravityToolFields(eventName, hookPayload)
    case 'amp':
      return extractAmpToolFields(eventName, hookPayload)
    case 'opencode':
    case 'mimo-code':
      return extractOpenCodeToolFields(eventName, hookPayload)
    case 'cursor':
      return extractCursorToolFields(eventName, hookPayload)
    case 'pi':
    case 'omp':
      return extractPiToolFields(eventName, hookPayload, source)
    case 'droid':
      return extractDroidToolFields(eventName, hookPayload)
    case 'command-code':
      return extractCommandCodeToolFields(eventName, hookPayload)
    case 'grok':
      return extractGrokToolFields(eventName, hookPayload, options?.grokHome)
    case 'copilot':
      return extractCopilotToolFields(normalizeCopilotEventName(eventName), hookPayload)
    case 'hermes':
      return extractHermesToolFields(eventName, hookPayload)
    case 'devin':
      return extractClaudeToolFields(eventName, hookPayload)
  }
}
