import type { ToolSnapshot } from './agent-hook-prompt-tools'

import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
import { readCopilotToolCall } from './agent-hook-source-tools'
const { deriveToolInputPreview, deriveFallbackToolInputPreview, readString, hasOwnField, hasAnyOwnField, toolUpdate, clearActiveToolFieldsUpdate, deriveInteractivePrompt, readFirstString, extractToolResponseText } = prompt
const { readLastAssistantFromTranscript, readLastCommandCodeAssistantFromTranscript, readLastAssistantFromGrokChatHistory } = transcript

export function isAskUserTool(toolName: string | undefined): boolean {
  return toolName?.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() === 'askuser'
}

export function extractCopilotToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  const update: ToolSnapshot = {}
  if (eventName === 'PostToolUseFailure' || eventName === 'ErrorOccurred') {
    Object.assign(update, clearActiveToolFieldsUpdate())
  } else if (
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse' ||
    eventName === 'PermissionRequest'
  ) {
    const copilotToolCall = readCopilotToolCall(hookPayload)
    const toolName =
      readFirstString(hookPayload, ['tool_name', 'toolName', 'name']) ?? copilotToolCall.toolName
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.toolInput) ??
      deriveToolInputPreview(toolName, hookPayload.toolArgs) ??
      deriveToolInputPreview(toolName, hookPayload.input) ??
      deriveToolInputPreview(toolName, hookPayload.arguments) ??
      deriveToolInputPreview(toolName, copilotToolCall.toolInputSource)
    Object.assign(
      update,
      toolUpdate(
        { toolName, toolInput },
        {
          hasToolInputField:
            hasAnyOwnField(hookPayload, [
              'tool_input',
              'toolInput',
              'toolArgs',
              'input',
              'arguments'
            ]) || copilotToolCall.toolInputSource !== undefined
        }
      )
    )
    if (isAskUserTool(toolName) && toolInput) {
      update.lastAssistantMessage = toolInput
    }
  }
  if (eventName === 'PostToolUse') {
    const responseText =
      extractToolResponseText(hookPayload.tool_result) ??
      extractToolResponseText(hookPayload.toolResult) ??
      extractToolResponseText(hookPayload.tool_response) ??
      extractToolResponseText(hookPayload.toolResponse)
    if (responseText) {
      update.lastAssistantMessage = responseText
    }
  }
  if (eventName === 'PostToolUseFailure' || eventName === 'ErrorOccurred') {
    const errorText =
      extractToolResponseText(hookPayload.tool_result) ??
      extractToolResponseText(hookPayload.toolResult) ??
      extractToolResponseText(hookPayload.tool_response) ??
      extractToolResponseText(hookPayload.toolResponse) ??
      readFirstString(hookPayload, ['error_message', 'errorMessage', 'error', 'message'])
    if (errorText) {
      update.lastAssistantMessage = errorText
    }
  }
  if (eventName === 'Notification') {
    const notificationType = readFirstString(hookPayload, ['notification_type', 'notificationType'])
    if (notificationType === 'permission_prompt' || notificationType === 'elicitation_dialog') {
      const message = readFirstString(hookPayload, ['message', 'body', 'text', 'title'])
      if (message) {
        update.lastAssistantMessage = message
      }
    }
  }
  if (eventName === 'Stop') {
    const direct = readFirstString(hookPayload, [
      'last_assistant_message',
      'lastAssistantMessage',
      'message'
    ])
    if (direct) {
      update.lastAssistantMessage = direct
    } else {
      const lastFromTranscript = readLastAssistantFromTranscript(
        hookPayload.transcript_path ?? hookPayload.transcriptPath
      )
      if (lastFromTranscript) {
        update.lastAssistantMessage = lastFromTranscript
      } else {
        update.clearLastAssistantMessage = true
      }
    }
  }
  return update
}

export function extractPiToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  agentKind: 'pi' | 'omp'
): ToolSnapshot {
  if (
    eventName === 'tool_call' ||
    eventName === 'tool_execution_start' ||
    eventName === 'tool_execution_end'
  ) {
    const toolName = readString(hookPayload, 'tool_name')
    const rawToolInput = hookPayload.tool_input
    const toolInput = deriveToolInputPreview(toolName, rawToolInput)
    // Why: OMP shares this extractor; only derive interactivePrompt for Pi so OMP ask_user_question metadata stays unchanged.
    const interactivePrompt =
      agentKind === 'pi' && (eventName === 'tool_call' || eventName === 'tool_execution_start')
        ? deriveInteractivePrompt(toolName, rawToolInput, eventName)
        : undefined
    return toolUpdate(
      { toolName, toolInput, interactivePrompt },
      { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
    )
  }
  if (eventName === 'message_end' && hookPayload.role === 'assistant') {
    const text = readString(hookPayload, 'text')
    if (text) {
      return { lastAssistantMessage: text }
    }
  }
  return {}
}

export function isDroidPermissionNotification(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  const lower = message.toLowerCase()
  // Why: 'confirm' is excluded — it false-positives on benign messages like "task confirmed" that aren't permission prompts.
  return lower.includes('permission') || lower.includes('approve') || lower.includes('approval')
}

export function isDroidIdleNotification(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  const lower = message.toLowerCase()
  return lower.includes('waiting for your input') || lower.includes('waiting for input')
}

export function isDroidAskUserTool(toolName: string | undefined): boolean {
  if (!toolName) {
    return false
  }
  return toolName.replaceAll(/[^a-z0-9]/gi, '').toLowerCase() === 'askuser'
}

export function readDroidToolRiskLevel(hookPayload: Record<string, unknown>): string | undefined {
  const directRisk = readString(hookPayload, 'riskLevel') ?? readString(hookPayload, 'risk_level')
  if (directRisk) {
    return directRisk
  }

  for (const key of ['tool_input', 'input', 'arguments'] as const) {
    const value = hookPayload[key]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue
    }
    const record = value as Record<string, unknown>
    const nestedRisk = readString(record, 'riskLevel') ?? readString(record, 'risk_level')
    if (nestedRisk) {
      return nestedRisk
    }
  }
  return undefined
}

export function isDroidHighRiskToolUse(hookPayload: Record<string, unknown>): boolean {
  return readDroidToolRiskLevel(hookPayload)?.trim().toLowerCase() === 'high'
}

export function extractDroidToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse' ||
    eventName === 'PermissionRequest'
  ) {
    const toolName = readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name')
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.input) ??
      deriveToolInputPreview(toolName, hookPayload.arguments)
    const update: ToolSnapshot = toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['tool_input', 'input', 'arguments']) }
    )
    if (eventName === 'PostToolUse') {
      const responseText =
        extractToolResponseText(hookPayload.tool_response) ??
        extractToolResponseText(hookPayload.tool_output)
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    return update
  }
  if (eventName === 'Stop') {
    const direct = readString(hookPayload, 'last_assistant_message')
    if (direct) {
      return { lastAssistantMessage: direct }
    }
    const fromTranscript = readLastAssistantFromTranscript(hookPayload.transcript_path)
    if (fromTranscript) {
      return { lastAssistantMessage: fromTranscript }
    }
  }
  return {}
}

export function extractCommandCodeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    const toolName =
      readString(hookPayload, 'tool_name') ??
      readString(hookPayload, 'toolName') ??
      readString(hookPayload, 'tool_display_name')
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveFallbackToolInputPreview(hookPayload.tool_input)
    const update: ToolSnapshot = toolUpdate(
      { toolName, toolInput },
      { hasToolInputField: hasOwnField(hookPayload, 'tool_input') }
    )
    if (eventName === 'PostToolUse') {
      const responseText =
        extractToolResponseText(hookPayload.tool_response) ??
        extractToolResponseText(hookPayload.tool_output)
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    return update
  }
  if (eventName === 'Stop') {
    const direct = readString(hookPayload, 'last_assistant_message')
    if (direct) {
      return { lastAssistantMessage: direct }
    }
    const fromTranscript = readLastCommandCodeAssistantFromTranscript(
      hookPayload.transcript_path ?? hookPayload.transcriptPath
    )
    if (fromTranscript) {
      return { lastAssistantMessage: fromTranscript }
    }
  }
  return {}
}

export function normalizeHookEventName(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()
}

export function isGrokEvent(eventName: unknown, ...expected: readonly string[]): boolean {
  const normalized = normalizeHookEventName(eventName)
  return expected.includes(normalized)
}

export function extractGrokToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>,
  grokHome?: string
): ToolSnapshot {
  if (isGrokEvent(eventName, 'pre_tool_use', 'post_tool_use', 'post_tool_use_failure')) {
    const update: ToolSnapshot = {}
    if (isGrokEvent(eventName, 'post_tool_use_failure')) {
      Object.assign(update, clearActiveToolFieldsUpdate())
    } else {
      const toolName =
        readString(hookPayload, 'toolName') ??
        readString(hookPayload, 'tool_name') ??
        readString(hookPayload, 'name')
      const rawInput =
        hookPayload.toolInput ??
        hookPayload.tool_input ??
        hookPayload.input ??
        hookPayload.arguments
      const toolInput =
        deriveToolInputPreview(toolName, rawInput) ?? deriveFallbackToolInputPreview(rawInput)
      // Why: Grok's ask_user_question is auto-allowed via PreToolUse, not PermissionRequest; capture full payload for the live card.
      const interactivePrompt = deriveInteractivePrompt(toolName, rawInput, eventName)
      Object.assign(
        update,
        toolUpdate(
          { toolName, toolInput, interactivePrompt },
          {
            hasToolInputField: hasAnyOwnField(hookPayload, [
              'toolInput',
              'tool_input',
              'input',
              'arguments'
            ])
          }
        )
      )
    }
    if (isGrokEvent(eventName, 'post_tool_use', 'post_tool_use_failure')) {
      const responseText =
        extractToolResponseText(hookPayload.toolResponse) ??
        extractToolResponseText(hookPayload.tool_response) ??
        extractToolResponseText(hookPayload.toolOutput) ??
        extractToolResponseText(hookPayload.tool_output) ??
        readString(hookPayload, 'error') ??
        readString(hookPayload, 'message')
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    return update
  }
  if (isGrokEvent(eventName, 'stop', 'session_end', 'stop_failure')) {
    const direct =
      readString(hookPayload, 'lastAssistantMessage') ??
      readString(hookPayload, 'last_assistant_message')
    if (direct) {
      return { lastAssistantMessage: direct }
    }
    const fromTranscript = readLastAssistantFromTranscript(
      hookPayload.transcriptPath ?? hookPayload.transcript_path
    )
    if (fromTranscript) {
      return { lastAssistantMessage: fromTranscript }
    }
    const fromChatHistory = readLastAssistantFromGrokChatHistory(hookPayload, grokHome)
    if (fromChatHistory) {
      return { lastAssistantMessage: fromChatHistory }
    }
  }
  return {}
}

export function extractHermesToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (
    eventName === 'pre_tool_call' ||
    eventName === 'post_tool_call' ||
    eventName === 'pre_approval_request' ||
    eventName === 'post_approval_response'
  ) {
    const toolName =
      readString(hookPayload, 'tool_name') ??
      readString(hookPayload, 'name') ??
      (eventName === 'pre_approval_request' || eventName === 'post_approval_response'
        ? 'approval'
        : undefined)
    const toolInput =
      deriveToolInputPreview(toolName, hookPayload.tool_input) ??
      deriveToolInputPreview(toolName, hookPayload.args) ??
      deriveToolInputPreview(toolName, hookPayload.input) ??
      // Why: Hermes has many tool names; fall back to obvious arg fields so a new name still shows a value, not a blank row.
      deriveFallbackToolInputPreview(hookPayload.tool_input) ??
      deriveFallbackToolInputPreview(hookPayload.args) ??
      deriveFallbackToolInputPreview(hookPayload.input) ??
      readString(hookPayload, 'command') ??
      readString(hookPayload, 'description')
    const update: ToolSnapshot = toolUpdate(
      { toolName, toolInput },
      {
        hasToolInputField: hasAnyOwnField(hookPayload, [
          'tool_input',
          'args',
          'input',
          'command',
          'description'
        ])
      }
    )
    if (eventName === 'post_tool_call') {
      const responseText =
        extractToolResponseText(hookPayload.result) ??
        extractToolResponseText(hookPayload.tool_response) ??
        extractToolResponseText(hookPayload.output)
      if (responseText) {
        update.lastAssistantMessage = responseText
      }
    }
    return update
  }
  if (eventName === 'post_llm_call') {
    const message =
      readString(hookPayload, 'last_assistant_message') ??
      readString(hookPayload, 'assistant_response') ??
      readString(hookPayload, 'response_text')
    if (message) {
      return { lastAssistantMessage: message }
    }
  }
  return {}
}

export function isGrokPermissionNotification(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  const lower = message.toLowerCase()
  return (
    lower.includes('permission') ||
    lower.includes('approval') ||
    lower.includes('approve') ||
    lower.includes('allow') ||
    lower.includes('confirm') ||
    lower.includes('needs your') ||
    lower.includes('requires your') ||
    lower.includes('feedback') ||
    lower.includes('clarify') ||
    lower.includes('question')
  )
}

export function getGrokNotificationType(hookPayload: Record<string, unknown>): string | undefined {
  return (
    readString(hookPayload, 'notificationType') ??
    readString(hookPayload, 'notification_type') ??
    readString(hookPayload, 'type')
  )
}

export function isGrokRoutinePermissionPromptNotification(
  notificationType: string | undefined,
  message: string | undefined,
  level: string | undefined
): boolean {
  // Why: Grok emits this before each tool even under bypassPermissions; PreToolUse already covers progress.
  return (
    isGrokEvent(notificationType, 'permission_prompt') &&
    message?.trim().toLowerCase() === 'tool permission requested' &&
    (!level || level.trim().toLowerCase() === 'info')
  )
}

export function isGrokIdleNotification(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  const lower = message.toLowerCase()
  return (
    lower.includes('type your message') ||
    lower.includes('enter send') ||
    lower.includes('shift-tab normal') ||
    lower.includes('ask a side question')
  )
}
