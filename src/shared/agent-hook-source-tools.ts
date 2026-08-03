import type { ToolSnapshot } from './agent-hook-prompt-tools'

import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
const { deriveToolInputPreview, deriveFallbackToolInputPreview, readString, hasOwnField, hasAnyOwnField, toolUpdate, clearActiveToolFieldsUpdate, stripHookEnvelopeKeys, deriveInteractivePrompt, readFirstString, parseJsonObjectString, extractToolResponseText } = prompt
const { readLastAssistantFromTranscript } = transcript

export function isAntigravityFeedbackTool(toolName: string | undefined): boolean {
  return toolName === 'ask_question' || toolName === 'ask_permission'
}

export function isAntigravityStopStillBusy(hookPayload: Record<string, unknown>): boolean {
  return hookPayload.fullyIdle === false || hookPayload.fully_idle === false
}

export function extractClaudeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  const update: ToolSnapshot = {}
  if (eventName === 'PostToolUseFailure') {
    Object.assign(update, clearActiveToolFieldsUpdate())
  } else if (
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse' ||
    eventName === 'PermissionRequest'
  ) {
    const toolName = readString(hookPayload, 'tool_name')
    Object.assign(
      update,
      toolUpdate(
        {
          toolName,
          toolInput: deriveToolInputPreview(toolName, hookPayload.tool_input),
          interactivePrompt: deriveInteractivePrompt(toolName, hookPayload.tool_input, eventName)
        },
        { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
      )
    )
  }
  if (eventName === 'PostToolUse') {
    const responseText = extractToolResponseText(hookPayload.tool_response)
    if (responseText) {
      update.lastAssistantMessage = responseText
    }
  }
  if (eventName === 'PostToolUseFailure') {
    const errorText =
      extractToolResponseText(hookPayload.tool_response) ??
      readString(hookPayload, 'error') ??
      readString(hookPayload, 'message')
    if (errorText) {
      update.lastAssistantMessage = errorText
    }
  }
  if (eventName === 'Stop') {
    const direct = readString(hookPayload, 'last_assistant_message')
    if (direct) {
      update.lastAssistantMessage = direct
    } else {
      const lastFromTranscript = readLastAssistantFromTranscript(hookPayload.transcript_path)
      if (lastFromTranscript) {
        update.lastAssistantMessage = lastFromTranscript
      }
    }
  }
  return update
}

export function extractCodexToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'PreToolUse' ||
    eventName === 'PermissionRequest' ||
    eventName === 'PostToolUse'
  ) {
    const toolName = readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name')
    const rawInput = hookPayload.tool_input ?? hookPayload.input ?? hookPayload.arguments
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.input) ??
      deriveToolInputPreview(toolName, hookPayload.arguments)
    return toolUpdate(
      {
        toolName,
        toolInput,
        interactivePrompt: deriveInteractivePrompt(toolName, rawInput, eventName)
      },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['tool_input', 'input', 'arguments']) }
    )
  }
  if (eventName === 'Stop') {
    const message = readString(hookPayload, 'last_assistant_message')
    if (message) {
      return { lastAssistantMessage: message }
    }
  }
  return {}
}

export function extractGeminiToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'BeforeTool' ||
    eventName === 'AfterTool' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
  ) {
    const toolName = readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name')
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.args) ??
      deriveToolInputPreview(toolName, hookPayload.input)
    return toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['tool_input', 'args', 'input']) }
    )
  }
  if (eventName === 'AfterAgent') {
    const message = readString(hookPayload, 'prompt_response')
    if (message) {
      return { lastAssistantMessage: message }
    }
  }
  return {}
}

export function readAntigravityToolCall(hookPayload: Record<string, unknown>): {
  toolName?: string
  toolInputSource?: unknown
} {
  const toolCall = hookPayload.toolCall
  if (typeof toolCall !== 'object' || toolCall === null) {
    return {}
  }
  const record = toolCall as Record<string, unknown>
  return {
    toolName: readFirstString(record, ['name', 'toolName', 'tool_name']),
    toolInputSource: record.args
  }
}

export function extractAntigravityToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    const toolCall = readAntigravityToolCall(hookPayload)
    const toolName = toolCall.toolName
    const toolInput =
      deriveToolInputPreview(toolName, toolCall.toolInputSource) ??
      deriveFallbackToolInputPreview(toolCall.toolInputSource)
    return toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: toolCall.toolInputSource !== undefined }
    )
  }
  if (eventName === 'Stop') {
    if (isAntigravityStopStillBusy(hookPayload)) {
      return {}
    }
    const message =
      readString(hookPayload, 'last_assistant_message') ??
      readLastAssistantFromTranscript(hookPayload.transcriptPath ?? hookPayload.transcript_path)
    if (message) {
      return { lastAssistantMessage: message }
    }
  }
  return {}
}

export function extractAmpToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'tool.call' || eventName === 'tool.result') {
    const toolName =
      readString(hookPayload, 'tool') ??
      readString(hookPayload, 'toolName') ??
      readString(hookPayload, 'name')
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.input) ??
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.arguments) ??
      // Why: Amp plugin tools can have arbitrary names; fall back to obvious arg fields instead of an empty tool preview.
      deriveFallbackToolInputPreview(hookPayload.input) ??
      deriveFallbackToolInputPreview(hookPayload.tool_input) ??
      deriveFallbackToolInputPreview(hookPayload.arguments)
    const update: ToolSnapshot = toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['input', 'tool_input', 'arguments']) }
    )
    if (eventName === 'tool.result') {
      const responseText =
        readFirstString(hookPayload, ['error', 'output', 'result', 'message']) ??
        extractToolResponseText(hookPayload.output) ??
        extractToolResponseText(hookPayload.result)
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    return update
  }
  return {}
}

export function extractOpenCodeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'MessagePart' && hookPayload.role === 'assistant') {
    const text = readString(hookPayload, 'text')
    if (text) {
      return { lastAssistantMessage: capOpenCodeHookText(text) }
    }
  }
  if (eventName === 'AskUserQuestion') {
    // Why: OpenCode's payload is question.asked's event.properties (hook_event_name merged in); strip envelope or use tool_input, capture JSON for the card.
    const toolInputSource = hasOwnField(hookPayload, 'tool_input')
      ? hookPayload.tool_input
      : stripHookEnvelopeKeys(hookPayload)
    return {
      hasToolUpdate: true,
      interactivePrompt: deriveInteractivePrompt('AskUserQuestion', toolInputSource)
    }
  }
  return {}
}

export function extractCursorToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'preToolUse' ||
    eventName === 'postToolUse' ||
    eventName === 'postToolUseFailure'
  ) {
    const update: ToolSnapshot = {}
    if (eventName === 'postToolUseFailure') {
      Object.assign(update, clearActiveToolFieldsUpdate())
    } else {
      const toolName = readString(hookPayload, 'tool_name')
      const toolInput = deriveToolInputPreview(toolName, hookPayload.tool_input)
      Object.assign(
        update,
        toolUpdate(
          { toolName, toolInput },
          { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
        )
      )
    }
    if (eventName === 'postToolUse') {
      const responseText = extractToolResponseText(hookPayload.tool_output)
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    if (eventName === 'postToolUseFailure') {
      const errorText =
        extractToolResponseText(hookPayload.tool_output) ??
        readString(hookPayload, 'error_message') ??
        readString(hookPayload, 'error')
      if (errorText) {
        update.lastAssistantMessage = errorText
      }
    }
    return update
  }
  if (eventName === 'beforeShellExecution') {
    const command = readString(hookPayload, 'command')
    return toolUpdate(
      { toolName: 'Shell', toolInput: command },
      { hasToolInputField: hasOwnField(hookPayload, 'command') }
    )
  }
  if (eventName === 'beforeMCPExecution') {
    const toolName = readString(hookPayload, 'tool_name') ?? 'MCP'
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      readString(hookPayload, 'command') ??
      readString(hookPayload, 'url')
    return toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['tool_input', 'command', 'url']) }
    )
  }
  if (eventName === 'afterAgentResponse') {
    const text = readString(hookPayload, 'text')
    if (text) {
      return { lastAssistantMessage: text }
    }
  }
  return {}
}

export function normalizeCopilotEventName(eventName: unknown): unknown {
  if (typeof eventName !== 'string') {
    return eventName
  }
  const eventMap: Record<string, string> = {
    sessionStart: 'SessionStart',
    sessionEnd: 'SessionEnd',
    userPromptSubmitted: 'UserPromptSubmit',
    userPromptSubmit: 'UserPromptSubmit',
    preToolUse: 'PreToolUse',
    postToolUse: 'PostToolUse',
    postToolUseFailure: 'PostToolUseFailure',
    subagentStart: 'SubagentStart',
    subagentStop: 'SubagentStop',
    preCompact: 'PreCompact',
    agentStop: 'Stop',
    stop: 'Stop',
    errorOccurred: 'ErrorOccurred',
    permissionRequest: 'PermissionRequest',
    notification: 'Notification'
  }
  return eventMap[eventName] ?? eventName
}

export function resolveCopilotEventName(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): unknown {
  const explicit =
    eventName ??
    readFirstString(hookPayload, ['hook_event_name', 'hookEventName', 'hook_type', 'hookType'])
  if (explicit) {
    return explicit
  }
  if (readFirstString(hookPayload, ['initial_prompt', 'initialPrompt'])) {
    return 'SessionStart'
  }
  if (readString(hookPayload, 'prompt')) {
    return 'UserPromptSubmit'
  }
  if (readFirstString(hookPayload, ['notification_type', 'notificationType'])) {
    return 'Notification'
  }
  if (
    readFirstString(hookPayload, ['transcript_path', 'transcriptPath', 'stop_reason', 'stopReason'])
  ) {
    return 'Stop'
  }
  if (hookPayload.error || readFirstString(hookPayload, ['error_context', 'errorContext'])) {
    return 'ErrorOccurred'
  }
  if (
    Array.isArray(hookPayload.toolCalls) ||
    readFirstString(hookPayload, ['tool_name', 'toolName', 'name'])
  ) {
    if (
      hookPayload.tool_result ||
      hookPayload.toolResult ||
      hookPayload.tool_response ||
      hookPayload.toolResponse
    ) {
      return 'PostToolUse'
    }
    return 'PreToolUse'
  }
  return eventName
}

export function readCopilotToolCall(hookPayload: Record<string, unknown>): {
  toolName?: string
  toolInputSource?: unknown
} {
  const toolCalls = hookPayload.toolCalls
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return {}
  }
  const first = toolCalls[0]
  if (typeof first !== 'object' || first === null) {
    return {}
  }
  const record = first as Record<string, unknown>
  return {
    toolName: readFirstString(record, ['name', 'toolName', 'tool_name']),
    toolInputSource:
      parseJsonObjectString(record.args) ??
      record.args ??
      parseJsonObjectString(record.arguments) ??
      record.arguments
  }
}
