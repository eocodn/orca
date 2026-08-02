import type { HookListenerState } from './agent-hook-state'
import { capOpenCodeHookText } from './agent-hook-request-body'
import { isAskUserQuestionTool } from './agent-question-answered-intent'
import { isKnownHarnessInjectedUserTurnText } from './harness-injected-user-turns'

// ─── Per-pane field caches + extractors ─────────────────────────────

export type ExtractedPromptText = {
  text: string
  source:
    | 'prompt'
    | 'user_prompt'
    | 'userPrompt'
    | 'initial_prompt'
    | 'initialPrompt'
    | 'user_message'
    | 'message'
    | 'role_user_text'
    | null
}

// Joins text of an Anthropic-style content-block array; returns '' when nothing textual so callers fall through to the next prompt source.
export function contentBlockArrayText(value: unknown[]): string {
  const parts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item)
      continue
    }
    if (item && typeof item === 'object') {
      const text = (item as Record<string, unknown>).text
      if (typeof text === 'string') {
        parts.push(text)
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function extractPromptText(hookPayload: Record<string, unknown>): ExtractedPromptText {
  const candidateKeys = [
    'prompt',
    'user_prompt',
    'userPrompt',
    'initial_prompt',
    'initialPrompt',
    'user_message',
    'message'
  ]
  for (const key of candidateKeys) {
    const value = hookPayload[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      // Why: trim so prompts match readStringField output — whitespace would otherwise leak into UI and caches.
      return { text: value.trim(), source: key as Exclude<ExtractedPromptText['source'], null> }
    }
    // Why: Kimi sends `prompt` as a content-block array, not a string; extract it for real prompt keys but skip `message` (ambiguous status field).
    if (key !== 'message' && Array.isArray(value)) {
      const text = contentBlockArrayText(value)
      if (text.length > 0) {
        return { text, source: key as Exclude<ExtractedPromptText['source'], null> }
      }
    }
  }
  // Why: OpenCode sends MessagePart { role, text } with no UserPromptSubmit; when role === 'user' the text is the prompt.
  if (hookPayload.role === 'user' && typeof hookPayload.text === 'string') {
    const trimmed = capOpenCodeHookText(hookPayload.text.trim())
    if (trimmed.length > 0) {
      return { text: trimmed, source: 'role_user_text' }
    }
  }
  return { text: '', source: null }
}

export function stripGrokUserQueryWrapper(promptText: string): string {
  const opener = '<user_query>'
  if (!promptText.startsWith(opener)) {
    return promptText
  }
  const closer = '</user_query>'
  const wrappedText = promptText.slice(opener.length)
  const text = wrappedText.endsWith(closer) ? wrappedText.slice(0, -closer.length) : wrappedText
  // Why: Grok wraps the submitted prompt in a `<user_query>` envelope; the status cache should hold the plain user text.
  return text.trim()
}

export function resolvePrompt(
  state: HookListenerState,
  paneKey: string,
  promptText: string,
  options?: { resetOnNewTurn?: boolean }
): string {
  // Why: harness-injected turns fire UserPromptSubmit but aren't the user's ask — keep cached prompt; match only known tags so real <tags> still reset the turn.
  if (isKnownHarnessInjectedUserTurnText(promptText)) {
    return state.lastPromptByPaneKey.get(paneKey) ?? ''
  }
  if (options?.resetOnNewTurn) {
    state.lastPromptByPaneKey.delete(paneKey)
  }
  if (promptText) {
    state.lastPromptByPaneKey.set(paneKey, promptText)
    return promptText
  }
  return state.lastPromptByPaneKey.get(paneKey) ?? ''
}

export type ToolSnapshot = {
  toolName?: string
  toolInput?: string
  /** Full JSON of an AskUserQuestion tool input; set only on its own event and NOT inherited (resolveToolState) so no stale prompt lingers. */
  interactivePrompt?: string
  hasToolUpdate?: boolean
  hasToolInputField?: boolean
  lastAssistantMessage?: string
  clearLastAssistantMessage?: boolean
}

export function resolveToolState(
  state: HookListenerState,
  paneKey: string,
  update: ToolSnapshot,
  options: { resetOnNewTurn: boolean }
): ToolSnapshot {
  if (options.resetOnNewTurn) {
    state.lastToolByPaneKey.delete(paneKey)
  }
  const previous = state.lastToolByPaneKey.get(paneKey) ?? {}
  // Why: undefined means either "no update" or "input not previewable"; extractor metadata decides whether to inherit stale input.
  const clearsUnpreviewableInput =
    update.hasToolInputField === true && update.toolInput === undefined
  const clearsUnidentifiedTool =
    update.hasToolUpdate === true &&
    update.toolName === undefined &&
    update.hasToolInputField === true
  const toolName = clearsUnidentifiedTool ? undefined : (update.toolName ?? previous.toolName)
  const toolInput =
    clearsUnpreviewableInput ||
    (update.toolName !== undefined &&
      update.toolName !== previous.toolName &&
      update.toolInput === undefined)
      ? undefined
      : (update.toolInput ?? previous.toolInput)
  const merged: ToolSnapshot = {
    toolName,
    toolInput,
    // Why: don't inherit previous.interactivePrompt — valid only for its one AskUserQuestion event; carrying it forward leaves a stale live card.
    interactivePrompt: update.interactivePrompt,
    lastAssistantMessage: update.clearLastAssistantMessage
      ? undefined
      : (update.lastAssistantMessage ?? previous.lastAssistantMessage)
  }
  state.lastToolByPaneKey.set(paneKey, merged)
  return merged
}

export const TOOL_INPUT_KEYS_BY_TOOL: Record<string, readonly string[]> = {
  Read: ['file_path', 'filePath', 'path'],
  Write: ['file_path', 'filePath', 'path'],
  Create: ['file_path', 'filePath', 'path'],
  Edit: ['file_path', 'filePath', 'path'],
  Execute: ['command'],
  MultiEdit: ['file_path', 'filePath', 'path'],
  NotebookEdit: ['file_path', 'filePath', 'path'],
  Bash: ['command'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  FetchUrl: ['url'],
  read_file: ['file_path', 'path'],
  write_file: ['file_path', 'path'],
  read_many_files: ['file_path', 'paths', 'path'],
  edit_file: ['file_path', 'path'],
  replace: ['file_path', 'path'],
  run_shell_command: ['command'],
  run_command: ['CommandLine', 'command', 'cmd'],
  glob: ['pattern'],
  search_file_content: ['pattern'],
  web_fetch: ['url'],
  google_web_search: ['query'],
  exec_command: ['cmd', 'command'],
  shell_command: ['cmd', 'command'],
  run_terminal_cmd: ['command'],
  // Why: Grok maps Bash/Edit/Write to snake_case tool names; without these keys the status row shows blank toolInput for most Grok turns.
  run_terminal_command: ['command'],
  search_replace: ['file_path', 'path', 'filePath'],
  write_to_file: ['TargetFile', 'path', 'file_path'],
  execute_code: ['code', 'command', 'cmd'],
  apply_patch: ['path', 'file_path'],
  view_image: ['path', 'file_path'],
  AskUser: ['question', 'prompt', 'message'],
  ask_user: ['question', 'prompt', 'message'],
  AskUserQuestion: ['questions', 'question', 'prompt', 'message'],
  ask_user_question: ['questions', 'question', 'prompt', 'message'],
  bash: ['command'],
  powershell: ['command'],
  create: ['path', 'file_path'],
  read: ['path', 'file_path'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  view: ['path', 'file_path'],
  grep: ['pattern'],
  web_search: ['query'],
  fetch_content: ['url'],
  terminal: ['command'],
  patch: ['path', 'file_path'],
  search_files: ['query', 'pattern', 'path'],
  browser_navigate: ['url'],
  browser_click: ['target', 'selector', 'text'],
  browser_type: ['text', 'target', 'selector'],
  session_search: ['query'],
  skill_manage: ['action', 'name', 'file_path'],
  delegate_task: ['task', 'prompt', 'description'],
  view_file: ['AbsolutePath', 'path', 'file_path'],
  replace_file_content: ['TargetFile', 'path', 'file_path'],
  multi_replace_file_content: ['TargetFile', 'path', 'file_path'],
  list_dir: ['DirectoryPath', 'path'],
  find_by_name: ['SearchDirectory', 'Pattern', 'query'],
  grep_search: ['SearchPath', 'Query', 'query', 'pattern'],
  search_web: ['query'],
  read_url_content: ['Url', 'url'],
  manage_task: ['TaskId', 'Action'],
  schedule: ['Prompt', 'DurationSeconds', 'CronExpression'],
  ask_question: ['question', 'questions'],
  ask_permission: ['Action', 'Target', 'Reason'],
  spawn_subagent: ['prompt', 'description', 'subagent_type'],
  open_page: ['url']
}

export const FALLBACK_TOOL_INPUT_KEYS = [
  'command',
  'cmd',
  'code',
  'query',
  'pattern',
  'url',
  'path',
  'file_path',
  'filePath',
  'target',
  'selector',
  'text',
  'action',
  'name',
  'description',
  'CommandLine',
  'AbsolutePath',
  'TargetFile',
  'DirectoryPath',
  'SearchPath',
  'Query',
  'Url',
  'Prompt'
] as const

export function deriveToolInputPreview(
  toolName: string | undefined,
  toolInput: unknown
): string | undefined {
  if (typeof toolInput === 'string') {
    return toolInput
  }
  if (typeof toolInput !== 'object' || toolInput === null) {
    return undefined
  }
  if (!toolName) {
    return undefined
  }
  const keys = TOOL_INPUT_KEYS_BY_TOOL[toolName]
  if (!keys) {
    return undefined
  }
  const record = toolInput as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

export function deriveFallbackToolInputPreview(toolInput: unknown): string | undefined {
  if (typeof toolInput === 'string') {
    return toolInput
  }
  if (typeof toolInput !== 'object' || toolInput === null) {
    return undefined
  }
  const record = toolInput as Record<string, unknown>
  for (const key of FALLBACK_TOOL_INPUT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function hasOwnField(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

export function hasAnyOwnField(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => hasOwnField(record, key))
}

export function toolUpdate(
  fields: Pick<ToolSnapshot, 'toolName' | 'toolInput' | 'interactivePrompt'>,
  options?: { hasToolInputField?: boolean }
): ToolSnapshot {
  return {
    ...fields,
    hasToolUpdate: true,
    hasToolInputField: options?.hasToolInputField === true
  }
}

/** Clear active-tool metadata so a failed tool stops looking in-flight (else the compact sidebar hides the error behind the tool name). */
export function clearActiveToolFieldsUpdate(): ToolSnapshot {
  return toolUpdate(
    { toolName: undefined, toolInput: undefined, interactivePrompt: undefined },
    { hasToolInputField: true }
  )
}

/** Drop the hook envelope keys a plugin merges into event properties so the serialized prompt holds only the question structure. */
export function stripHookEnvelopeKeys(record: Record<string, unknown>): Record<string, unknown> {
  const { hook_event_name: _h, hookEventName: _he, ...rest } = record
  return rest
}

/** One-line description of a tool call for an approval card (Bash command, file path, else clipped JSON). */
export function summarizeApprovalInput(toolInput: unknown): string {
  if (toolInput && typeof toolInput === 'object') {
    const obj = toolInput as Record<string, unknown>
    const direct = obj.command ?? obj.file_path ?? obj.path ?? obj.url ?? obj.pattern
    if (typeof direct === 'string' && direct.length > 0) {
      return direct.length > 200 ? `${direct.slice(0, 200)}…` : direct
    }
  }
  try {
    const json = JSON.stringify(toolInput) ?? ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

/** Normalized JSON envelope for a pending prompt: AskUserQuestion → `{ questions }` (shape kept stable for back-compat); other tool on PermissionRequest → `{ approval }`; else undefined. */
export function deriveInteractivePrompt(
  toolName: string | undefined,
  toolInput: unknown,
  eventName?: unknown
): string | undefined {
  // Why: providers vary casing; any post-tool event means the question is no longer pending — don't recreate its answered card.
  const normalizedEventName = normalizeHookEventName(eventName)
  const isPostToolEvent =
    normalizedEventName === 'post_tool_use' || normalizedEventName === 'post_tool_use_failure'
  if (
    isAskUserQuestionTool(toolName) &&
    !isPostToolEvent &&
    toolInput !== undefined &&
    toolInput !== null
  ) {
    try {
      return JSON.stringify(toolInput)
    } catch {
      // Why: circular/unserializable input from a buggy agent — a missing live card beats throwing in the hook hot path.
      return undefined
    }
  }
  if (eventName === 'PermissionRequest' && typeof toolName === 'string' && toolName.length > 0) {
    try {
      return JSON.stringify({
        approval: { tool: toolName, summary: summarizeApprovalInput(toolInput) }
      })
    } catch {
      return undefined
    }
  }
  return undefined
}

export function readFirstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(record, key)
    if (value) {
      return value
    }
  }
  return undefined
}

export function parseJsonObjectString(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }
  try {
    const parsed = parseAgentHookJson(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function extractToolResponseText(toolResponse: unknown): string | undefined {
  if (typeof toolResponse === 'string' && toolResponse.length > 0) {
    return toolResponse
  }
  if (typeof toolResponse !== 'object' || toolResponse === null) {
    return undefined
  }
  const record = toolResponse as Record<string, unknown>
  const directText = readFirstString(record, ['text_result_for_llm', 'textResultForLlm', 'text'])
  if (directText) {
    return directText
  }
  const content = record.content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string' && text.trim().length > 0) {
          return text
        }
      }
    }
  }
  return undefined
}
