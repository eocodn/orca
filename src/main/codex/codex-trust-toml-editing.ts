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

import { upsertProjectTrustLevelInContent,
  buildTrustBlock,
  formatHookStateTableKey,
  getTrustKeyWriteVariants,
  escapeTomlString,
  upsertTrustBlocks,
  buildTrustBlocks,
  ensureHooksStateParentTable,
  type TrustBlockRange,
  normalizeHookTrustKeyForLookup,
  findTrustBlockRanges,
  findTrustBlockRangesForNormalizedKeys,
  type ParsedTomlString,
  parseHookStateHeaderKey,
  parseCodexProjectHeaderPath,
  findProjectHeaderLineEnd,
  parseTomlSingleLineString,
  parseTomlBasicSingleLineString,
  parseTomlLiteralSingleLineString,
  skipTomlInlineWhitespace } from './codex-trust-toml-normalization'

export function findNextTableHeader(text: string): number {
  let cursor = 0
  let scanState = createTomlLineScanState()
  while (cursor < text.length) {
    const newlineIdx = text.indexOf('\n', cursor)
    const lineEnd = newlineIdx === -1 ? text.length : newlineIdx
    const rawLine = text.slice(cursor, lineEnd)
    const line = rawLine.replace(/\r$/, '')
    if (isTomlStructuralLine(scanState)) {
      const trimmed = line.trimStart()
      // Why: stop at both `[table]` and `[[array.of.tables]]`; skipping `[[ ]]` would let the slice consume unrelated content.
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
  let i = isArrayHeader ? 2 : 1
  let inBasicQuote = false
  let inLiteralQuote = false
  while (i < line.length) {
    const ch = line[i]
    if (inBasicQuote) {
      if (ch === '\\' && i + 1 < line.length) {
        i += 2
        continue
      }
      if (ch === '"') {
        inBasicQuote = false
      }
      i++
      continue
    }
    if (inLiteralQuote) {
      if (ch === "'") {
        inLiteralQuote = false
      }
      i++
      continue
    }
    if (ch === '"') {
      inBasicQuote = true
      i++
      continue
    }
    if (ch === "'") {
      inLiteralQuote = true
      i++
      continue
    }
    if (ch === ']') {
      if (isArrayHeader) {
        if (line[i + 1] !== ']') {
          return false
        }
        const tail = line.slice(i + 2)
        return /^\s*(#.*)?$/.test(tail)
      }
      const tail = line.slice(i + 1)
      return /^\s*(#.*)?$/.test(tail)
    }
    i++
  }
  return false
}

// Why: a half-written config.toml can brick Codex, so write to a random-suffix tmp then rename (.bak rotation), avoiding cross-process races.
export function writeConfigAtomically(configPath: string, contents: string): void {
  let writePath = configPath
  let isSymlink = false
  try {
    isSymlink = lstatSync(configPath).isSymbolicLink()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  if (isSymlink) {
    // Why: atomic rename at the lexical path replaces the user's dotfiles
    // link. A dangling link must fail closed rather than be replaced.
    writePath = realpathSync.native(configPath)
  }
  const dir = dirname(writePath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = join(dir, `.${Date.now()}-${randomUUID()}.tmp`)
  const existingMode = existsSync(writePath) ? statSync(writePath).mode : undefined
  let renamed = false
  try {
    // Why: real-home trust cleanup must not widen a dotfiles-managed config's
    // restrictive permissions when the atomic rename installs new bytes.
    writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: existingMode })
    if (existsSync(writePath)) {
      writeRollingFileBackup(writePath, `${writePath}.bak`)
    }
    renameFileWithWindowsRetry(tmpPath, writePath)
    renamed = true
  } finally {
    if (!renamed && existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // best effort — surfacing the cleanup failure would mask the original write error
      }
    }
  }
}

export function removeHookTrustEntries(configPath: string, keys: readonly string[]): void {
  if (!existsSync(configPath)) {
    return
  }
  const existing = readTomlFile(configPath)
  const updated = removeHookTrustEntriesFromContent(existing, keys)
  if (updated === existing) {
    return
  }
  writeConfigAtomically(configPath, updated)
}

export function removeHookTrustEntriesFromContent(
  content: string,
  keys: readonly string[]
): string {
  const normalizedKeys = new Set(keys.map(normalizeHookTrustKeyForLookup))
  const ranges = findTrustBlockRangesForNormalizedKeys(content, normalizedKeys)
  if (ranges.length === 0) {
    return content
  }

  let cursor = 0
  let updated = ''
  for (const range of ranges) {
    updated += content.slice(cursor, range.start)
    cursor = range.end
  }
  return updated + content.slice(cursor)
}

export function readHookTrustEntries(configPath: string): Map<string, CodexHookTrustState> {
  if (!existsSync(configPath)) {
    return new HookTrustEntryMap()
  }
  return readHookTrustEntriesFromContent(readTomlFile(configPath))
}

export function readHookTrustBlockState(block: string): {
  trustedHashes: Set<string>
  enabled?: boolean
} {
  const trustedHashes = new Set<string>()
  let enabled: boolean | undefined
  let cursor = 0
  let scanState = createTomlLineScanState()
  while (cursor < block.length) {
    const newlineIdx = block.indexOf('\n', cursor)
    const lineEnd = newlineIdx === -1 ? block.length : newlineIdx
    const line = block.slice(cursor, lineEnd).replace(/\r$/, '')
    if (isTomlStructuralLine(scanState)) {
      const hashMatch = /^[ \t]*trusted_hash[ \t]*=[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*(?:#.*)?$/.exec(
        line
      )
      if (hashMatch) {
        trustedHashes.add(unescapeTomlString(hashMatch[1]))
      }
      const enabledMatch = /^[ \t]*enabled[ \t]*=[ \t]*(true|false)[ \t]*(?:#.*)?$/.exec(line)
      if (enabledMatch) {
        enabled = enabled !== false && enabledMatch[1] === 'true'
      }
    }
    scanState = updateTomlLineScanState(scanState, line)
    cursor = newlineIdx === -1 ? block.length : newlineIdx + 1
  }
  return { trustedHashes, enabled }
}

export function readHookTrustEntriesFromContent(content: string): Map<string, CodexHookTrustState> {
  const result = new HookTrustEntryMap()
  const conflictingTrustedHashKeys = new Set<string>()
  // Why: walk line-by-line so `[hooks.state."..."]` inside a `"""..."""` or
  // `'''...'''` multi-line string isn't mistaken for a real header.
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
    const key = isTomlStructuralLine(scanState) ? parseHookStateHeaderKey(line) : null
    if (key !== null) {
      const after = content.slice(nextCursor)
      const nextHeaderRel = findNextTableHeader(after)
      const blockEnd = nextHeaderRel === -1 ? content.length : nextCursor + nextHeaderRel
      const block = content.slice(nextCursor, blockEnd)
      const blockState = readHookTrustBlockState(block)
      const normalizedKey = normalizeHookTrustKeyForLookup(key)
      const existingState = result.get(normalizedKey)
      const trustedHash =
        blockState.trustedHashes.size === 1
          ? blockState.trustedHashes.values().next().value
          : undefined
      if (
        blockState.trustedHashes.size > 1 ||
        (trustedHash !== undefined &&
          existingState?.trustedHash !== undefined &&
          existingState.trustedHash !== trustedHash)
      ) {
        // Why: conflicting normalized duplicates are malformed and cannot prove
        // which block is owned, so trust cleanup must preserve them all.
        conflictingTrustedHashKeys.add(normalizedKey)
      }
      result.set(normalizedKey, {
        trustedHash: conflictingTrustedHashKeys.has(normalizedKey)
          ? undefined
          : (trustedHash ?? existingState?.trustedHash),
        // Why: Windows writes both slash variants for one hook; a disabled copy
        // must remain authoritative regardless of which variant appears last.
        enabled:
          existingState?.enabled === false || blockState.enabled === false
            ? false
            : (blockState.enabled ?? existingState?.enabled)
      })
      cursor = nextCursor
      continue
    }
    scanState = updateTomlLineScanState(scanState, line)
    cursor = nextCursor
  }
  return result
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
  // Why: unknown escapes round-trip — preserve the backslash so info isn't dropped.
  return `\\${next}`
}

export function unescapeTomlString(escaped: string): string {
  let result = ''
  let i = 0
  while (i < escaped.length) {
    const ch = escaped[i]
    if (ch === '\\' && i + 1 < escaped.length) {
      result += unescapeTomlBasicStringEscape(escaped[i + 1])
      i += 2
    } else {
      result += ch
      i++
    }
  }
  return result
}

