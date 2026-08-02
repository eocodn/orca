import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, posix as pathPosix, win32 as pathWin32 } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { renameFileWithWindowsRetry } from '../codex-accounts/fs-utils'
import { foldWslUncPathCaseInsensitiveParts } from '../../shared/wsl-paths'
import { writeRollingFileBackup } from '../rolling-file-backup'
import {
  createTomlLineScanState,
  isTomlStructuralLine,
  updateTomlLineScanState
} from './config-toml-line-scan'
export import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, posix as pathPosix, win32 as pathWin32 } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { renameFileWithWindowsRetry } from '../codex-accounts/fs-utils'
import { foldWslUncPathCaseInsensitiveParts } from '../../shared/wsl-paths'
import { writeRollingFileBackup } from '../rolling-file-backup'
import {
  createTomlLineScanState,
  isTomlStructuralLine,
  updateTomlLineScanState
} from './config-toml-line-scan'

// Why: Codex 0.129+ gates each hook on a `trusted_hash` in config.toml under [hooks.state."<key>"]; without it the hook never fires (agent-status goes blank).
// Hash algorithm reverse-engineered from codex-rs/hooks/src/engine/discovery.rs (command_hook_hash) + config/src/fingerprint.rs (version_for_toml).

import { type CodexEventLabel,
  type CodexTrustEntry,
  type CodexHookTrustState,
  type CodexProjectTrustLevel,
  HookTrustEntryMap,
  canonicalize,
  matcherPatternForEvent,
  computeTrustedHash,
  computeTrustKey,
  getCodexExplicitHomeHookSourcePath,
  normalizeCodexHookSourcePath,
  trimNonRootTrailingSeparators,
  stripWindowsDevicePrefix,
  getCodexCanonicalProjectPath,
  normalizeWindowsPathSeparators,
  usesWindowsPathSeparators,
  isUnambiguousWindowsPath,
  isWindowsPathForTrustSource,
  normalizeCodexProjectPathForLookup,
  codexHookSourcePathsEqual,
  normalizeCodexProjectPathForRevocationLookup,
  parseTrustKey,
  isCanonicalNonNegativeInt,
  isCodexEventLabel,
  readTomlFile,
  upsertHookTrustEntries,
  upsertHookTrustEntriesInContent,
  upsertProjectTrustLevel } from './codex-trust-toml-foundation'

export function upsertProjectTrustLevelInContent(
  existingContent: string,
  projectPath: string,
  trustLevel: CodexProjectTrustLevel,
  options?: { alreadyCanonical?: boolean }
): string {
  const existing =
    existingContent.charCodeAt(0) === 0xfeff ? existingContent.slice(1) : existingContent
  const trustedProjectPath = options?.alreadyCanonical
    ? projectPath
    : getCodexCanonicalProjectPath(projectPath)
  const headerLineEnd = findProjectHeaderLineEnd(existing, trustedProjectPath)
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const trustLine = `trust_level = "${trustLevel}"`

  if (headerLineEnd === null) {
    const block = [`[projects."${escapeTomlString(trustedProjectPath)}"]`, trustLine].join(eol)
    if (existing.length === 0) {
      return `${block}${eol}`
    }
    const separator = existing.endsWith(`${eol}${eol}`)
      ? ''
      : existing.endsWith(eol)
        ? eol
        : eol + eol
    return `${existing}${separator}${block}${eol}`
  }

  const after = existing.slice(headerLineEnd)
  const nextHeaderRel = findNextTableHeader(after)
  const blockEnd = nextHeaderRel === -1 ? existing.length : headerLineEnd + nextHeaderRel
  const existingBlock = existing.slice(headerLineEnd, blockEnd)
  const trustLevelLinePattern =
    /^[ \t]*trust_level[ \t]*=[ \t]*(?:"(?:trusted|untrusted)"|'(?:trusted|untrusted)')[ \t\r]*(?:#.*)?$/m
  if (trustLevelLinePattern.test(existingBlock)) {
    return (
      existing.slice(0, headerLineEnd) +
      existingBlock.replace(trustLevelLinePattern, trustLine) +
      existing.slice(blockEnd)
    )
  }
  return `${existing.slice(0, headerLineEnd)}${eol}${trustLine}${existing.slice(headerLineEnd)}`
}

// Why: field names mirror Codex's HookStateToml (/hooks approval); `enabled` is plumbed so a user-set `enabled = false` survives reinstall.
export function buildTrustBlock(key: string, hash: string, enabled: boolean): string {
  return [
    `[hooks.state.${formatHookStateTableKey(key)}]`,
    `enabled = ${enabled}`,
    `trusted_hash = "${escapeTomlString(hash)}"`
  ].join('\n')
}

export function formatHookStateTableKey(key: string): string {
  const parsed = parseTrustKey(key)
  if (parsed && usesWindowsPathSeparators(parsed.sourcePath) && !key.includes("'")) {
    // Why: Codex 0.140 trusts Windows hooks only when state table keys match the raw native path shape it writes.
    return `'${key}'`
  }
  return `"${escapeTomlString(key)}"`
}

export function getTrustKeyWriteVariants(key: string): string[] {
  const parsed = parseTrustKey(key)
  if (!parsed || !usesWindowsPathSeparators(parsed.sourcePath)) {
    return [key]
  }
  const suffix = `:${parsed.eventLabel}:${parsed.groupIndex}:${parsed.handlerIndex}`
  return [
    `${parsed.sourcePath.replace(/\//g, '\\')}${suffix}`,
    `${parsed.sourcePath.replace(/\\/g, '/')}${suffix}`
  ].filter((variant, index, variants) => variants.indexOf(variant) === index)
}

// Why: escape backslash first so later substitutions don't double-escape the inserted backslashes.
export function escapeTomlString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')
}

export function upsertTrustBlocks(
  content: string,
  keys: readonly string[],
  hash: string,
  explicitEnabled?: boolean
): string {
  const ranges = keys
    .flatMap((key) => findTrustBlockRanges(content, key))
    .filter(
      (range, index, ranges) =>
        ranges.findIndex(
          (candidate) => candidate.start === range.start && candidate.end === range.end
        ) === index
    )
    .sort((a, b) => a.start - b.start)
  if (ranges.length === 0) {
    const block = buildTrustBlocks(keys, hash, explicitEnabled ?? true)
    if (content.length === 0) {
      return `${block}\n`
    }
    // Why: one blank line before the appended block, without compounding separators when the file already ends blank.
    const separator = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n'
    return `${content}${separator}${block}\n`
  }

  // Why: preserve a user-set `enabled = false` (any disabled duplicate wins) unless an explicit state overrides it.
  const enabled =
    explicitEnabled ??
    !ranges.some((range) => {
      const existingBlock = content.slice(range.headerLineEnd, range.end)
      const enabledMatch = /^[ \t]*enabled[ \t]*=[ \t]*(true|false)[ \t\r]*(?:#.*)?$/m.exec(
        existingBlock
      )
      return enabledMatch?.[1] === 'false'
    })
  const block = buildTrustBlocks(keys, hash, enabled)
  let cursor = 0
  let deduped = ''
  ranges.forEach((range, index) => {
    deduped += content.slice(cursor, range.start)
    if (index === 0) {
      deduped += `${block}\n`
    }
    cursor = range.end
  })
  return deduped + content.slice(cursor)
}

export function buildTrustBlocks(keys: readonly string[], hash: string, enabled: boolean): string {
  // Why: Codex 0.140 exposes Windows hook-state keys with either backslashes or forward slashes depending on startup cwd.
  return keys.map((key) => buildTrustBlock(key, hash, enabled)).join('\n\n')
}

export function ensureHooksStateParentTable(content: string): string {
  if (/^[ \t]*\[hooks\.state\][ \t]*(?:#[^\r\n]*)?$/m.test(content)) {
    return content
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const parent = `[hooks.state]${eol}`
  const hookHeader = /^[ \t]*\[hooks\.state\.(?:"|')/m.exec(content)
  if (hookHeader) {
    return `${content.slice(0, hookHeader.index)}${parent}${eol}${content.slice(hookHeader.index)}`
  }
  if (content.length === 0) {
    return parent
  }
  const separator = content.endsWith(`${eol}${eol}`) ? '' : content.endsWith(eol) ? eol : eol + eol
  return `${content}${separator}${parent}`
}

export type TrustBlockRange = {
  start: number
  headerLineEnd: number
  end: number
}

// Why: separator/casing drift between Codex-written and Orca-built keys must not stop findTrustBlockRanges from matching.
export function normalizeHookTrustKeyForLookup(key: string): string {
  const parsed = parseTrustKey(key)
  // Why: fold by path shape, not host platform — hook sources on WSL and SSH
  // Windows remotes need the same folding when Orca runs on macOS or Linux.
  const foldedPath = normalizeCodexProjectPathForLookup(
    parsed
      ? parsed.sourcePath.startsWith('//')
        ? parsed.sourcePath
        : normalizeCodexHookSourcePath(parsed.sourcePath)
      : key
  )
  return parsed
    ? `${foldedPath}:${parsed.eventLabel}:${parsed.groupIndex}:${parsed.handlerIndex}`
    : foldedPath
}

export function findTrustBlockRanges(content: string, key: string): TrustBlockRange[] {
  return findTrustBlockRangesForNormalizedKeys(
    content,
    new Set([normalizeHookTrustKeyForLookup(key)])
  )
}

export function findTrustBlockRangesForNormalizedKeys(
  content: string,
  normalizedKeys: ReadonlySet<string>
): TrustBlockRange[] {
  const ranges: TrustBlockRange[] = []
  if (normalizedKeys.size === 0) {
    return ranges
  }
  let cursor = 0
  let scanState = createTomlLineScanState()
  while (cursor < content.length) {
    const newlineIdx = content.indexOf('\n', cursor)
    const lineEnd = newlineIdx === -1 ? content.length : newlineIdx
    const rawLine = content.slice(cursor, lineEnd)
    const lineWithoutCr = rawLine.replace(/\r$/, '')
    const line =
      cursor === 0 && lineWithoutCr.charCodeAt(0) === 0xfeff
        ? lineWithoutCr.slice(1)
        : lineWithoutCr
    const nextCursor = newlineIdx === -1 ? content.length : newlineIdx + 1
    const headerKey = isTomlStructuralLine(scanState) ? parseHookStateHeaderKey(line) : null
    if (headerKey !== null && normalizedKeys.has(normalizeHookTrustKeyForLookup(headerKey))) {
      const headerLineEnd = rawLine.endsWith('\r') ? lineEnd - 1 : lineEnd
      const after = content.slice(headerLineEnd)
      const nextHeaderRel = findNextTableHeader(after)
      const blockEnd = nextHeaderRel === -1 ? content.length : headerLineEnd + nextHeaderRel
      ranges.push({ start: cursor, headerLineEnd, end: blockEnd })
      cursor = Math.max(blockEnd, nextCursor)
      continue
    }
    scanState = updateTomlLineScanState(scanState, line)
    cursor = nextCursor
  }
  return ranges
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
  // Why: mirror section headers retain a terminal CR (split CRLF files) while direct upserts scan CR-stripped lines.
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

export function parseTomlSingleLineString(line: string, startIndex: number): ParsedTomlString | null {
  if (line[startIndex] === '"') {
    return parseTomlBasicSingleLineString(line, startIndex + 1)
  }
  if (line[startIndex] === "'") {
    return parseTomlLiteralSingleLineString(line, startIndex + 1)
  }
  return null
}

export function parseTomlBasicSingleLineString(line: string, startIndex: number): ParsedTomlString | null {
  let value = ''
  let index = startIndex
  while (index < line.length) {
    const char = line[index]
    if (char === '"') {
      return { value, endIndex: index + 1 }
    }
    if (char === '\\' && index + 1 < line.length) {
      const next = line[index + 1]
      value += unescapeTomlBasicStringEscape(next)
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
// Why: quoted keys can contain `]` and `[` lines inside multi-line strings aren't headers, so a flat regex misclassifies both — need a stateful scan.
