import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { readSync, statSync } from 'node:fs'
import type { AgentHookSource } from './agent-hook-relay'
import { readFirstString } from './agent-hook-prompt-tools'

export const TRANSCRIPT_CHUNK_BYTES = 64 * 1024
export const TRANSCRIPT_MAX_SCAN_BYTES = 4 * 1024 * 1024
export const EMPTY_TRANSCRIPT_REGION = Buffer.alloc(0)
export const AMP_THREAD_ID_MAX_LENGTH = 256
export const AMP_MAX_SCOPED_THREAD_CACHE_KEYS = 32
export const GROK_SESSION_CWD_MAX_LENGTH = 4096
export const GROK_HOME_ENVELOPE_MAX_LENGTH = 4096

export function extractAssistantTextFromLine(line: string): string | undefined {
  let entry: unknown
  try {
    entry = parseAgentHookJson(line)
  } catch {
    return undefined
  }
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  if (record.type === 'assistant.message') {
    const data = record.data
    if (typeof data === 'object' && data !== null) {
      const text = extractAssistantContentText((data as Record<string, unknown>).content)
      if (text) {
        return text
      }
    }
  }
  if (
    record.source === 'MODEL' &&
    record.type === 'PLANNER_RESPONSE' &&
    typeof record.content === 'string' &&
    record.content.trim().length > 0
  ) {
    return record.content
  }
  const nestedMessage = record.message as Record<string, unknown> | undefined
  const role =
    record.role ?? nestedMessage?.role ?? (record.type === 'assistant' ? 'assistant' : undefined)
  if (role !== 'assistant') {
    return undefined
  }
  const content = (nestedMessage ?? record).content
  return extractAssistantContentText(content)
}

export function extractAssistantContentText(content: unknown): string | undefined {
  if (typeof content === 'string' && content.trim().length > 0) {
    return content
  }
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

export function extractAntigravityUserRequest(content: string): string | undefined {
  const opener = '<USER_REQUEST>'
  const startIndex = content.indexOf(opener)
  const bodyStartIndex = startIndex === -1 ? -1 : startIndex + opener.length
  const endIndex = bodyStartIndex === -1 ? -1 : content.indexOf('</USER_REQUEST>', bodyStartIndex)
  const text =
    bodyStartIndex === -1 || endIndex === -1 ? content : content.slice(bodyStartIndex, endIndex)
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function extractUserPromptTextFromLine(line: string): string | undefined {
  let entry: unknown
  try {
    entry = parseAgentHookJson(line)
  } catch {
    return undefined
  }
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  if (
    (record.source === 'USER_EXPLICIT' || record.source === 'USER') &&
    (record.type === 'USER_INPUT' || record.type === 'REQUEST') &&
    typeof record.content === 'string'
  ) {
    return extractAntigravityUserRequest(record.content)
  }
  return undefined
}

export function readLastAssistantFromTranscript(transcriptPath: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return undefined
  }
  return readLastAssistantFromTranscriptOnce(transcriptPath)
}

export function readLastUserPromptFromTranscript(transcriptPath: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return undefined
  }
  return readLastTextFromTranscriptOnce(transcriptPath, extractUserPromptTextFromLine)
}

export function extractCommandCodeUserPromptFromLine(line: string): string | undefined {
  let entry: unknown
  try {
    entry = parseAgentHookJson(line)
  } catch {
    return undefined
  }
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  return record.role === 'user' ? extractAssistantContentText(record.content) : undefined
}

export function hashInteractionKeyPart(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

// Why byte offsets: the caller's interactionKey embeds the prompt's absolute
// position, so the backward scan has to report the same offset the old
// read-everything-then-take-the-last-match pass produced.
export function findLastCommandCodePromptInRegion(
  region: Buffer
): { prompt: string; byteOffset: number } | undefined {
  let lineEnd = region.length
  for (let index = region.length - 1; index >= -1; index--) {
    if (index >= 0 && region[index] !== 0x0a) {
      continue
    }
    const lineStart = index + 1
    if (lineEnd > lineStart) {
      const prompt = extractCommandCodeUserPromptFromLine(
        region.subarray(lineStart, lineEnd).toString('utf8').trim()
      )
      if (prompt !== undefined) {
        return { prompt, byteOffset: lineStart }
      }
    }
    lineEnd = index
  }
  return undefined
}

export function readLastCommandCodeUserPromptEntryFromTranscript(
  transcriptPath: unknown
): { text: string; interactionKey: string } | undefined {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return undefined
  }
  try {
    const stats = statSync(transcriptPath)
    const size = stats.size
    if (size <= 0) {
      return undefined
    }
    const fd = openSync(transcriptPath, 'r')
    try {
      // Why scan backward: the answer is the LAST user line, so walking up from
      // EOF returns on the first hit instead of parsing every line of a
      // multi-megabyte transcript on every hook event.
      // Why a chunk list: carry holds a partial line, and re-concatenating it per
      // block made one oversized line (a big tool result) cost O(line^2).
      let carryChunks: Buffer[] = []
      let bytesRead = 0
      let scanEnd = size
      while (scanEnd > 0 && bytesRead < TRANSCRIPT_MAX_SCAN_BYTES) {
        const chunkSize = Math.min(
          scanEnd,
          TRANSCRIPT_CHUNK_BYTES,
          TRANSCRIPT_MAX_SCAN_BYTES - bytesRead
        )
        const position = scanEnd - chunkSize
        const buffer = Buffer.alloc(chunkSize)
        let filled = 0
        while (filled < chunkSize) {
          const n = readSync(fd, buffer, filled, chunkSize - filled, position + filled)
          if (n === 0) {
            break
          }
          filled += n
        }
        // Why bail on a short read: the file shrank under us, so the bytes above
        // this block no longer line up and any stitched offset would be wrong.
        if (filled < chunkSize) {
          break
        }
        bytesRead += filled
        scanEnd = position
        // Why search only the new block: carry is always the run before a newline,
        // so it holds none of its own.
        const firstNewline = buffer.indexOf(0x0a)
        // Why only at a true file start: a scan that stops on the size cap must
        // discard its leading partial line, exactly as the capped read did.
        const atStart = position === 0
        let completeRegion: Buffer
        let regionPosition: number
        if (atStart) {
          completeRegion =
            carryChunks.length === 0 ? buffer : Buffer.concat([buffer, ...carryChunks])
          regionPosition = position
          carryChunks = []
        } else if (firstNewline === -1) {
          completeRegion = EMPTY_TRANSCRIPT_REGION
          regionPosition = position
          carryChunks.unshift(buffer)
        } else {
          const afterNewline = buffer.subarray(firstNewline + 1)
          completeRegion =
            carryChunks.length === 0 ? afterNewline : Buffer.concat([afterNewline, ...carryChunks])
          regionPosition = position + firstNewline + 1
          carryChunks = [buffer.subarray(0, firstNewline)]
        }
        if (completeRegion.length > 0) {
          const found = findLastCommandCodePromptInRegion(completeRegion)
          if (found) {
            return {
              text: found.prompt,
              interactionKey: [
                'command-code-transcript',
                hashInteractionKeyPart(transcriptPath),
                String(regionPosition + found.byteOffset),
                hashInteractionKeyPart(found.prompt)
              ].join('-')
            }
          }
        }
      }
      return undefined
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

export function extractCommandCodeAssistantTextFromLine(line: string): string | undefined {
  let entry: unknown
  try {
    entry = parseAgentHookJson(line)
  } catch {
    return undefined
  }
  if (typeof entry !== 'object' || entry === null) {
    return undefined
  }
  const record = entry as Record<string, unknown>
  if (record.role !== 'assistant') {
    return undefined
  }
  const content = record.content
  if (typeof content === 'string' && content.trim().length > 0) {
    return content
  }
  if (Array.isArray(content)) {
    const textPart = content.find(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        (part as Record<string, unknown>).type === 'text' &&
        typeof (part as Record<string, unknown>).text === 'string' &&
        ((part as Record<string, unknown>).text as string).trim().length > 0
    ) as Record<string, unknown> | undefined
    if (typeof textPart?.text === 'string') {
      return textPart.text
    }
  }
  return extractAssistantContentText(content)
}

export function readLastCommandCodeAssistantFromTranscript(transcriptPath: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
    return undefined
  }
  return readLastTextFromTranscriptOnce(transcriptPath, extractCommandCodeAssistantTextFromLine)
}

export function parseHookBodyPayloadRecord(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const rawPayload = (body as Record<string, unknown>).payload
  const payload =
    typeof rawPayload === 'string'
      ? (() => {
          try {
            return parseAgentHookJson(rawPayload)
          } catch {
            return null
          }
        })()
      : rawPayload
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null
}

export function readBoundedString(
  record: Record<string, unknown>,
  keys: readonly string[],
  maxLength: number
): string | undefined {
  const value = readFirstString(record, keys)
  return value && value.length <= maxLength ? value : undefined
}

export function readGrokHomeEnvelope(record: Record<string, unknown>): string | undefined {
  const value = readBoundedString(record, ['grokHome'], GROK_HOME_ENVELOPE_MAX_LENGTH)
  if (!value || value !== value.trim() || !isAbsolute(value) || hasControlCharacter(value)) {
    return undefined
  }
  return value
}

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

export type GrokSessionMetadata = {
  sessionId: string
  cwd?: string
  sessionsDir: string
}

export function readGrokSessionMetadata(
  hookPayload: Record<string, unknown>,
  grokHome?: string
): GrokSessionMetadata | undefined {
  const sessionId = readBoundedString(
    hookPayload,
    ['sessionId', 'session_id'],
    GROK_SESSION_ID_MAX_LENGTH
  )
  if (!sessionId || !isSafeGrokSessionId(sessionId)) {
    return undefined
  }
  const cwd = readBoundedString(
    hookPayload,
    ['cwd', 'workspaceRoot', 'workspace_root'],
    GROK_SESSION_CWD_MAX_LENGTH
  )
  // Why: hook scripts report the effective per-PTY/remote Grok home; old scripts fall back to the runtime's for compatibility.
  const sessionsDir = grokHome
    ? join(grokHome, 'sessions')
    : resolveGrokSessionsDir(process.env, homedir())
  return { sessionId, cwd, sessionsDir }
}

export function getGrokChatHistoryPath(
  hookPayload: Record<string, unknown>,
  grokHome?: string
): string | undefined {
  const metadata = readGrokSessionMetadata(hookPayload, grokHome)
  if (!metadata) {
    return undefined
  }
  const resolved = resolveGrokChatHistoryPathSync({
    sessionId: metadata.sessionId,
    cwd: metadata.cwd ?? null,
    sessionsDir: metadata.sessionsDir
  })
  if (resolved) {
    return resolved
  }
  const cached = getCachedGrokChatHistoryBySessionId(metadata.sessionsDir, metadata.sessionId)
  if (cached) {
    return cached
  }
  // Why: SessionEnd can race the last write; return a plausible on-disk candidate (short-cwd preferred) even if the file doesn't exist yet.
  if (!metadata.cwd) {
    return undefined
  }
  return (
    buildGrokChatHistoryPathCandidates({
      sessionId: metadata.sessionId,
      cwd: metadata.cwd,
      sessionsDir: metadata.sessionsDir
    })[0] ?? undefined
  )
}

export function readLastAssistantFromGrokChatHistory(
  hookPayload: Record<string, unknown>,
  grokHome?: string
): string | undefined {
  const chatHistoryPath = getGrokChatHistoryPath(hookPayload, grokHome)
  if (!chatHistoryPath) {
    return undefined
  }
  return readLastAssistantFromTranscriptOnce(chatHistoryPath)
}

export function hasPendingAgentResultText(source: AgentHookSource, body: unknown): boolean {
  const envelope =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const record = parseHookBodyPayloadRecord(body)
  if (!record) {
    return false
  }
  if (hasExplicitLastAssistantResult(record)) {
    return false
  }
  if (source === 'copilot') {
    // Why: Copilot Stop uses generic `message` as final assistant text; Grok/Antigravity use that field for status instead.
    if (hasNonEmptyString(record.message)) {
      return false
    }
    const transcriptPath = record.transcript_path ?? record.transcriptPath
    return typeof transcriptPath === 'string' && transcriptPath.trim().length > 0
  }
  const eventName =
    envelope?.hook_event_name ??
    envelope?.hookEventName ??
    record.hook_event_name ??
    record.hookEventName
  if (source === 'antigravity' && eventName === 'Stop') {
    if (isAntigravityStopStillBusy(record)) {
      return false
    }
    const transcriptPath = record.transcriptPath ?? record.transcript_path
    return typeof transcriptPath === 'string' && transcriptPath.trim().length > 0
  }
  const pendingGrokDiscovery = preparePendingGrokResultDiscovery(source, body)
  if (pendingGrokDiscovery) {
    void pendingGrokDiscovery
    return true
  }
  return false
}

export function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function hasExplicitLastAssistantResult(record: Record<string, unknown>): boolean {
  return (
    hasNonEmptyString(record.last_assistant_message) ||
    hasNonEmptyString(record.lastAssistantMessage)
  )
}

/** Start bounded discovery only for a Grok completion that still needs result text. */
export function preparePendingGrokResultDiscovery(
  source: AgentHookSource,
  body: unknown
): Promise<void> | null {
  if (source !== 'grok') {
    return null
  }
  const envelope =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const record = parseHookBodyPayloadRecord(body)
  if (!record || hasExplicitLastAssistantResult(record)) {
    return null
  }
  const eventName =
    envelope?.hook_event_name ??
    envelope?.hookEventName ??
    record.hook_event_name ??
    record.hookEventName
  if (!isGrokEvent(eventName, 'stop', 'session_end')) {
    return null
  }
  const metadata = readGrokSessionMetadata(
    record,
    envelope ? readGrokHomeEnvelope(envelope) : undefined
  )
  if (!metadata) {
    return null
  }
  // Why: lets the server await discovery without moving filesystem I/O back into synchronous hook normalization.
  return findGrokChatHistoryBySessionId(metadata.sessionsDir, metadata.sessionId).then(
    () => undefined
  )
}

export function readLastAssistantFromTranscriptOnce(transcriptPath: string): string | undefined {
  return readLastTextFromTranscriptOnce(transcriptPath, extractAssistantTextFromLine)
}

export function readLastTextFromTranscriptOnce(
  transcriptPath: string,
  extractLineText: (line: string) => string | undefined
): string | undefined {
  try {
    const stats = statSync(transcriptPath)
    const size = stats.size
    if (size <= 0) {
      return undefined
    }
    const fd = openSync(transcriptPath, 'r')
    try {
      // Why a chunk list: carry holds a partial line, and re-joining it per block
      // made one oversized line (a big tool result or pasted prompt) cost O(line^2).
      let carryChunks: Buffer[] = []
      let bytesRead = 0
      let scanEnd = size
      while (scanEnd > 0 && bytesRead < TRANSCRIPT_MAX_SCAN_BYTES) {
        const chunkSize = Math.min(scanEnd, TRANSCRIPT_CHUNK_BYTES)
        const position = scanEnd - chunkSize
        const buffer = Buffer.alloc(chunkSize)
        let filled = 0
        while (filled < chunkSize) {
          const n = readSync(fd, buffer, filled, chunkSize - filled, position + filled)
          if (n === 0) {
            break
          }
          filled += n
        }
        // Why bail on a short read: the file shrank under us, so the bytes above
        // this block no longer line up with what the earlier ones assumed.
        if (filled < chunkSize) {
          break
        }
        bytesRead += filled
        scanEnd = position
        // Why search only the new block: carry is always the run before a newline,
        // so it holds none of its own.
        const firstNewline = buffer.indexOf(0x0a)
        const atStart = position === 0
        let completeRegion: Buffer
        if (atStart) {
          completeRegion =
            carryChunks.length === 0 ? buffer : Buffer.concat([buffer, ...carryChunks])
          carryChunks = []
        } else if (firstNewline === -1) {
          completeRegion = EMPTY_TRANSCRIPT_REGION
          carryChunks.unshift(buffer)
        } else {
          const afterNewline = buffer.subarray(firstNewline + 1)
          completeRegion =
            carryChunks.length === 0 ? afterNewline : Buffer.concat([afterNewline, ...carryChunks])
          carryChunks = [buffer.subarray(0, firstNewline)]
        }
        if (completeRegion.length > 0) {
          const extracted = findLastExtractedTranscriptLineText(
            completeRegion.toString('utf8'),
            extractLineText
          )
          if (extracted !== undefined) {
            return extracted
          }
        }
      }
      return undefined
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

export function findLastExtractedTranscriptLineText(
  text: string,
  extractLineText: (line: string) => string | undefined
): string | undefined {
  let lineEnd = text.length

  for (let index = text.length - 1; index >= -1; index--) {
    if (index >= 0 && text.charCodeAt(index) !== 10) {
      continue
    }

    const line = text.slice(index + 1, lineEnd).trim()
    if (line.length > 0) {
      const extracted = extractLineText(line)
      if (extracted !== undefined) {
        return extracted
      }
    }
    lineEnd = index
  }

  return undefined
}
