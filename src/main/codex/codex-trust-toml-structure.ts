import {
  createTomlLineScanState,
  isTomlStructuralLine,
  updateTomlLineScanState
} from './config-toml-line-scan'
import { normalizeCodexProjectPathForLookup } from './codex-trust-toml-foundation'

export function findNextTableHeader(text: string): number {
  let cursor = 0
  let scanState = createTomlLineScanState()
  while (cursor < text.length) {
    const newlineIdx = text.indexOf('\n', cursor)
    const lineEnd = newlineIdx === -1 ? text.length : newlineIdx
    const line = text.slice(cursor, lineEnd).replace(/\r$/, '')
    if (isTomlStructuralLine(scanState)) {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('[') && isCompleteTableHeader(trimmed)) {
        return cursor
      }
    }
    scanState = updateTomlLineScanState(scanState, line)
    if (newlineIdx === -1) {
      return -1
    }
    cursor = newlineIdx + 1
  }
  return -1
}

// Why: walk byte-by-byte so a `]` inside a quoted key segment doesn't terminate the header early.
export function isCompleteTableHeader(line: string): boolean {
  if (!line.startsWith('[')) {
    return false
  }
  const isArrayHeader = line.startsWith('[[')
  let index = isArrayHeader ? 2 : 1
  let inBasicQuote = false
  let inLiteralQuote = false
  while (index < line.length) {
    const char = line[index]
    if (inBasicQuote) {
      if (char === '\\' && index + 1 < line.length) {
        index += 2
        continue
      }
      if (char === '"') {
        inBasicQuote = false
      }
      index += 1
      continue
    }
    if (inLiteralQuote) {
      if (char === "'") {
        inLiteralQuote = false
      }
      index += 1
      continue
    }
    if (char === '"') {
      inBasicQuote = true
      index += 1
      continue
    }
    if (char === "'") {
      inLiteralQuote = true
      index += 1
      continue
    }
    if (char === ']') {
      const closeLength = isArrayHeader ? 2 : 1
      if (isArrayHeader && line[index + 1] !== ']') {
        return false
      }
      return /^\s*(#.*)?$/.test(line.slice(index + closeLength))
    }
    index += 1
  }
  return false
}

export type ParsedTomlString = {
  value: string
  endIndex: number
}

// Why: hook-state keys appear as both TOML basic strings and equivalent literal-string keys.
export function parseHookStateHeaderKey(line: string): string | null {
  const trimmed = line.trimStart()
  const prefixMatch = /^\[[ \t]*hooks[ \t]*\.[ \t]*state[ \t]*\.[ \t]*/.exec(trimmed)
  if (!prefixMatch) {
    return null
  }
  const parsedKey = parseTomlSingleLineString(trimmed, prefixMatch[0].length)
  if (!parsedKey) {
    return null
  }
  let index = skipTomlInlineWhitespace(trimmed, parsedKey.endIndex)
  if (trimmed[index] !== ']') {
    return null
  }
  index = skipTomlInlineWhitespace(trimmed, index + 1)
  return index === trimmed.length || trimmed[index] === '#' ? parsedKey.value : null
}

export function parseCodexProjectHeaderPath(line: string): string | null {
  // Why: mirror section headers retain a terminal CR while direct upserts scan CR-stripped lines.
  const trimmed = line.replace(/\r$/, '').trimStart()
  const prefixMatch = /^\[[ \t]*projects[ \t]*\.[ \t]*/.exec(trimmed)
  if (!prefixMatch) {
    return null
  }
  const parsedPath = parseTomlSingleLineString(trimmed, prefixMatch[0].length)
  if (!parsedPath) {
    return null
  }
  let index = skipTomlInlineWhitespace(trimmed, parsedPath.endIndex)
  if (trimmed[index] !== ']') {
    return null
  }
  index = skipTomlInlineWhitespace(trimmed, index + 1)
  return index === trimmed.length || trimmed[index] === '#' ? parsedPath.value : null
}

export function findProjectHeaderLineEnd(content: string, projectPath: string): number | null {
  const lookupPath = normalizeCodexProjectPathForLookup(projectPath)
  let cursor = 0
  let scanState = createTomlLineScanState()
  while (cursor < content.length) {
    const newlineIndex = content.indexOf('\n', cursor)
    const lineEnd = newlineIndex === -1 ? content.length : newlineIndex
    const rawLine = content.slice(cursor, lineEnd)
    const line = rawLine.replace(/\r$/, '')
    const existingPath = isTomlStructuralLine(scanState) ? parseCodexProjectHeaderPath(line) : null
    if (existingPath !== null && normalizeCodexProjectPathForLookup(existingPath) === lookupPath) {
      return rawLine.endsWith('\r') ? lineEnd - 1 : lineEnd
    }
    scanState = updateTomlLineScanState(scanState, line)
    if (newlineIndex === -1) {
      return null
    }
    cursor = newlineIndex + 1
  }
  return null
}

export function parseTomlSingleLineString(
  line: string,
  startIndex: number
): ParsedTomlString | null {
  if (line[startIndex] === '"') {
    return parseTomlBasicSingleLineString(line, startIndex + 1)
  }
  if (line[startIndex] === "'") {
    return parseTomlLiteralSingleLineString(line, startIndex + 1)
  }
  return null
}

export function unescapeTomlBasicStringEscape(next: string): string {
  if (next === 'n') {
    return '\n'
  }
  if (next === 'r') {
    return '\r'
  }
  if (next === 't') {
    return '\t'
  }
  if (next === 'b') {
    return '\b'
  }
  if (next === 'f') {
    return '\f'
  }
  if (next === '"') {
    return '"'
  }
  if (next === '\\') {
    return '\\'
  }
  return `\\${next}`
}

export function parseTomlBasicSingleLineString(
  line: string,
  startIndex: number
): ParsedTomlString | null {
  let value = ''
  let index = startIndex
  while (index < line.length) {
    const char = line[index]
    if (char === '"') {
      return { value, endIndex: index + 1 }
    }
    if (char === '\\' && index + 1 < line.length) {
      value += unescapeTomlBasicStringEscape(line[index + 1])
      index += 2
      continue
    }
    value += char
    index++
  }
  return null
}

export function parseTomlLiteralSingleLineString(
  line: string,
  startIndex: number
): ParsedTomlString | null {
  const endIndex = line.indexOf("'", startIndex)
  if (endIndex === -1) {
    return null
  }
  return { value: line.slice(startIndex, endIndex), endIndex: endIndex + 1 }
}

export function skipTomlInlineWhitespace(line: string, startIndex: number): number {
  let index = startIndex
  while (line[index] === ' ' || line[index] === '\t') {
    index++
  }
  return index
}
