import { open, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { HERMES_HOME, MAX_REFERENCED_LOG_BYTES, REFERENCED_LOG_HEADING, RUN_PREVIEW_LIMIT, LATEST_LOG_PATH_PATTERN } from "./hermes-cron-primitives"

type ContentRange = {
  start: number
  end: number
}

function cleanRunPreview(value: string, startIndex = 0, endIndex = value.length): string | null {
  const normalized = foldRunPreviewText(value, startIndex, endIndex)
  if (!normalized.text) {
    return null
  }
  return normalized.truncated
    ? `${normalized.text.slice(0, RUN_PREVIEW_LIMIT - 3)}...`
    : normalized.text
}

function foldRunPreviewText(
  value: string,
  startIndex: number,
  endIndex: number
): { text: string; truncated: boolean } {
  let text = ''
  let pendingSpace = false
  let index = Math.max(0, startIndex)
  const end = Math.min(value.length, endIndex)
  while (index < end && text.length <= RUN_PREVIEW_LIMIT) {
    if (startsWithAt(value, '```', index)) {
      if (text.length > 0) {
        pendingSpace = true
      }
      index = skipFencedBlock(value, index, end)
      continue
    }

    const code = value.charCodeAt(index)
    if (isPreviewSeparator(code)) {
      if (text.length > 0) {
        pendingSpace = true
      }
      index += 1
      continue
    }

    if (pendingSpace) {
      text += ' '
      pendingSpace = false
      if (text.length > RUN_PREVIEW_LIMIT) {
        break
      }
    }
    text += value[index]
    index += 1
  }
  return { text, truncated: text.length > RUN_PREVIEW_LIMIT }
}

function isPreviewSeparator(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 35 ||
    code === 40 ||
    code === 41 ||
    code === 42 ||
    code === 62 ||
    code === 91 ||
    code === 93 ||
    code === 95 ||
    code === 96
  )
}

export function parseHermesOutput(content: string): {
  status: 'completed' | 'failed' | 'unknown'
  outputPreview: string | null
  outputContent: string
  error: string | null
} {
  const errorHeading = findMarkdownHeading(content, '## Error')
  const responseHeading = findMarkdownHeading(content, '## Response')
  const errorRange = errorHeading ? errorContentRange(content, errorHeading.bodyStart) : null
  const failed = hasFailedCronHeading(content) || errorHeading !== null
  const error = errorRange ? cleanRunPreview(content, errorRange.start, errorRange.end) : null
  const previewRange = responseHeading
    ? { start: responseHeading.bodyStart, end: content.length }
    : (errorRange ?? { start: 0, end: content.length })
  return {
    status: failed ? 'failed' : responseHeading ? 'completed' : 'unknown',
    outputPreview: cleanRunPreview(content, previewRange.start, previewRange.end),
    outputContent: content,
    error
  }
}

function hasFailedCronHeading(content: string): boolean {
  let lineStart = 0
  while (lineStart < content.length) {
    const lineEnd = lineEndIndex(content, lineStart)
    if (
      startsWithAt(content, '#', lineStart) &&
      lineContains(content, lineStart, lineEnd, 'Cron Job:') &&
      lineContains(content, lineStart, lineEnd, '(FAILED)')
    ) {
      return true
    }
    lineStart = nextLineStart(content, lineEnd)
  }
  return false
}

function findMarkdownHeading(
  content: string,
  heading: '## Error' | '## Response'
): { bodyStart: number } | null {
  let lineStart = 0
  while (lineStart < content.length) {
    const lineEnd = lineEndIndex(content, lineStart)
    if (
      startsWithAt(content, heading, lineStart) &&
      isHeadingBoundary(content.charCodeAt(lineStart + heading.length))
    ) {
      return { bodyStart: nextLineStart(content, lineEnd) }
    }
    lineStart = nextLineStart(content, lineEnd)
  }
  return null
}

function errorContentRange(content: string, bodyStart: number): ContentRange {
  const start = skipPreviewWhitespace(content, bodyStart, content.length)
  if (!startsWithAt(content, '```', start)) {
    return { start, end: nextMarkdownHeadingStart(content, start) ?? content.length }
  }

  const fencedStart = nextLineStart(content, lineEndIndex(content, start))
  const fencedEnd = findClosingFence(content, fencedStart) ?? content.length
  return { start: fencedStart, end: fencedEnd }
}

function skipFencedBlock(content: string, fenceStart: number, endIndex: number): number {
  const bodyStart = nextLineStart(content, lineEndIndex(content, fenceStart))
  const closeStart = findClosingFence(content, bodyStart)
  if (closeStart === null || closeStart > endIndex) {
    return endIndex
  }
  return nextLineStart(content, lineEndIndex(content, closeStart))
}

function findClosingFence(content: string, fromIndex: number): number | null {
  let lineStart = fromIndex
  while (lineStart < content.length) {
    const lineEnd = lineEndIndex(content, lineStart)
    const textStart = skipPreviewWhitespace(content, lineStart, lineEnd)
    if (startsWithAt(content, '```', textStart)) {
      return textStart
    }
    lineStart = nextLineStart(content, lineEnd)
  }
  return null
}

function nextMarkdownHeadingStart(content: string, fromIndex: number): number | null {
  let lineStart = fromIndex
  while (lineStart < content.length) {
    const lineEnd = lineEndIndex(content, lineStart)
    if (startsWithAt(content, '## ', lineStart)) {
      return lineStart
    }
    lineStart = nextLineStart(content, lineEnd)
  }
  return null
}

function lineEndIndex(value: string, startIndex: number): number {
  const newline = value.indexOf('\n', startIndex)
  return newline === -1 ? value.length : newline
}

function nextLineStart(value: string, lineEnd: number): number {
  return lineEnd < value.length ? lineEnd + 1 : value.length
}

function lineContains(
  value: string,
  startIndex: number,
  endIndex: number,
  needle: string
): boolean {
  const index = value.indexOf(needle, startIndex)
  return index !== -1 && index < endIndex
}

function skipPreviewWhitespace(value: string, startIndex: number, endIndex: number): number {
  let index = startIndex
  while (index < endIndex && isPreviewWhitespace(value.charCodeAt(index))) {
    index += 1
  }
  return index
}

function isPreviewWhitespace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13)
}

function isHeadingBoundary(code: number): boolean {
  return Number.isNaN(code) || isPreviewWhitespace(code)
}

function startsWithAt(value: string, search: string, startIndex: number): boolean {
  if (startIndex + search.length > value.length) {
    return false
  }
  for (let offset = 0; offset < search.length; offset += 1) {
    if (value.charCodeAt(startIndex + offset) !== search.charCodeAt(offset)) {
      return false
    }
  }
  return true
}

function extractLatestLogPath(content: string): string | null {
  const rawPath = LATEST_LOG_PATH_PATTERN.exec(content)?.groups?.path?.trim()
  if (!rawPath) {
    return null
  }
  return rawPath.replace(/^`|`$/g, '').trim()
}

async function readReferencedLogFile(content: string): Promise<{
  path: string
  content: string
  truncated: boolean
} | null> {
  const logPath = extractLatestLogPath(content)
  if (!logPath || !isAbsolute(logPath)) {
    return null
  }
  try {
    const homeRealPath = await realpath(HERMES_HOME)
    const logRealPath = await realpath(logPath)
    const relativeToHermesHome = relative(resolve(homeRealPath), resolve(logRealPath))
    // Why: the output body can contain agent-authored text, so only hydrate
    // referenced files that resolve inside Hermes' own data directory.
    if (
      relativeToHermesHome === '..' ||
      relativeToHermesHome.startsWith(`..${sep}`) ||
      isAbsolute(relativeToHermesHome)
    ) {
      return null
    }
    const logStat = await stat(logPath)
    if (!logStat.isFile()) {
      return null
    }
    if (logStat.size <= MAX_REFERENCED_LOG_BYTES) {
      return {
        path: logPath,
        content: await readFile(logPath, 'utf-8'),
        truncated: false
      }
    }
    const file = await open(logPath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_REFERENCED_LOG_BYTES)
      await file.read(buffer, 0, MAX_REFERENCED_LOG_BYTES, logStat.size - MAX_REFERENCED_LOG_BYTES)
      return {
        path: logPath,
        content: buffer.toString('utf-8'),
        truncated: true
      }
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

export async function appendReferencedLogFile(content: string): Promise<string> {
  if (content.includes(REFERENCED_LOG_HEADING)) {
    return content
  }
  const logFile = await readReferencedLogFile(content)
  if (!logFile) {
    return content
  }
  const note = logFile.truncated
    ? `Showing the last ${MAX_REFERENCED_LOG_BYTES} bytes because the log file is larger.`
    : null
  return [
    content,
    '---',
    REFERENCED_LOG_HEADING,
    '',
    `Path: ${logFile.path}`,
    note,
    '```text',
    logFile.content.trimEnd(),
    '```'
  ]
    .filter((part) => part !== null)
    .join('\n\n')
}

export function formatSessionMessages(messages: Record<string, unknown>[]): string | null {
  if (messages.length === 0) {
    return null
  }
  return messages
    .map((message) => {
      const role = typeof message.role === 'string' ? message.role : 'message'
      const content = typeof message.content === 'string' ? message.content.trim() : ''
      const toolName = typeof message.tool_name === 'string' ? message.tool_name.trim() : ''
      const reasoning =
        typeof message.reasoning_content === 'string'
          ? message.reasoning_content.trim()
          : typeof message.reasoning === 'string'
            ? message.reasoning.trim()
            : ''
      const parts = [
        `## ${role}${toolName ? ` / ${toolName}` : ''}`,
        reasoning ? `### Reasoning\n\n${reasoning}` : null,
        content || '(empty)'
      ].filter(Boolean)
      return parts.join('\n\n')
    })
    .join('\n\n---\n\n')
}
