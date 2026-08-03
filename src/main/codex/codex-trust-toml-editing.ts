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
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameFileWithWindowsRetry } from '../codex-accounts/fs-utils'
import { writeRollingFileBackup } from '../rolling-file-backup'
import {
  createTomlLineScanState,
  isTomlStructuralLine,
  updateTomlLineScanState
} from './config-toml-line-scan'

import {
  type CodexHookTrustState,
  type CodexProjectTrustLevel,
  HookTrustEntryMap,
  type CodexTrustEntry,
  normalizeHookTrustKeyForLookup,
  upsertHookTrustEntriesInContent
} from './codex-trust-toml-foundation'
import {
  findTrustBlockRangesForNormalizedKeys,
  upsertProjectTrustLevelInContent
} from './codex-trust-toml-normalization'
import {
  findNextTableHeader,
  parseHookStateHeaderKey,
  unescapeTomlBasicStringEscape
} from './codex-trust-toml-structure'

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

// Why: strip a leading BOM so header scanners see the first TOML table.
export function readTomlFile(configPath: string): string {
  const raw = readFileSync(configPath, 'utf-8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

// Why: keep file I/O here; normalization remains pure and byte-preserving.
export function upsertHookTrustEntries(
  configPath: string,
  entries: readonly CodexTrustEntry[]
): void {
  const existing = existsSync(configPath) ? readTomlFile(configPath) : ''
  const updated = upsertHookTrustEntriesInContent(existing, entries)
  if (updated !== existing) {
    writeConfigAtomically(configPath, updated)
  }
}

export function upsertProjectTrustLevel(
  configPath: string,
  projectPath: string,
  trustLevel: CodexProjectTrustLevel
): void {
  const existing = existsSync(configPath) ? readTomlFile(configPath) : ''
  const updated = upsertProjectTrustLevelInContent(existing, projectPath, trustLevel)
  if (updated !== existing) {
    writeConfigAtomically(configPath, updated)
  }
}

export function unescapeTomlString(escaped: string): string {
  let result = ''
  let index = 0
  while (index < escaped.length) {
    const char = escaped[index]
    if (char === '\\' && index + 1 < escaped.length) {
      const next = escaped[index + 1]
      result += unescapeTomlBasicStringEscape(next)
      index += 2
    } else {
      result += char
      index += 1
    }
  }
  return result
}
