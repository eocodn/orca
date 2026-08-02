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

// Why: Codex 0.129+ gates each hook on a `trusted_hash` in config.toml under [hooks.state."<key>"]; without it the hook never fires (agent-status goes blank).
// Hash algorithm reverse-engineered from codex-rs/hooks/src/engine/discovery.rs (command_hook_hash) + config/src/fingerprint.rs (version_for_toml).

export type CodexEventLabel =
  | 'pre_tool_use'
  | 'permission_request'
  | 'post_tool_use'
  | 'pre_compact'
  | 'post_compact'
  | 'session_start'
  | 'user_prompt_submit'
  | 'subagent_start'
  | 'subagent_stop'
  | 'stop'

export type CodexTrustEntry = {
  /** Path on disk to the hooks.json that declares the hook (the "key_source"). */
  sourcePath: string
  /** Codex event label (snake_case). */
  eventLabel: CodexEventLabel
  /** 0-based index of the matcher group within the event array. */
  groupIndex: number
  /** 0-based index of the handler within the matcher group's `hooks` array. */
  handlerIndex: number
  /** The exact `command` string written to hooks.json. */
  command: string
  /** Effective timeout in seconds; defaults to 600 when undefined, explicit values clamped to a minimum of 1. */
  timeoutSec?: number
  /** Whether the handler is async. Defaults to false. */
  async?: boolean
  /** Optional matcher pattern (only meaningful for events that support it). */
  matcher?: string
  /** Optional statusMessage field. */
  statusMessage?: string
  /** Verbatim hash to write instead of computing one (survives Codex hash-algorithm drift). Never fed into hashing. */
  trustedHash?: string
  /** Explicit enabled state to write; when absent, a pre-existing `enabled = false` is preserved. */
  enabled?: boolean
}

export type CodexHookTrustState = {
  trustedHash?: string
  enabled?: boolean
}

export type CodexProjectTrustLevel = 'trusted' | 'untrusted'

// Why: normalize keys at the Map edge so Codex-written separator/casing variants match computeTrustKey() lookups.
export class HookTrustEntryMap extends Map<string, CodexHookTrustState> {
  override get(key: string): CodexHookTrustState | undefined {
    return super.get(normalizeHookTrustKeyForLookup(key))
  }

  override has(key: string): boolean {
    return super.has(normalizeHookTrustKeyForLookup(key))
  }

  override delete(key: string): boolean {
    return super.delete(normalizeHookTrustKeyForLookup(key))
  }

  override set(key: string, value: CodexHookTrustState): this {
    return super.set(normalizeHookTrustKeyForLookup(key), value)
  }
}

// Why: matches Codex's canonical_json — recursively sorts object keys before hashing; arrays keep order.
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

// Why: mirrors codex-rs matcher_pattern_for_event (hooks/src/events/common.rs) — Codex drops matchers on user_prompt_submit/stop before hashing, so including one yields a hash it never writes → endless re-trust.
export function matcherPatternForEvent(
  eventLabel: CodexEventLabel,
  matcher: string | undefined
): string | undefined {
  switch (eventLabel) {
    case 'user_prompt_submit':
    case 'stop':
      return undefined
    case 'pre_tool_use':
    case 'permission_request':
    case 'post_tool_use':
    case 'pre_compact':
    case 'post_compact':
    case 'session_start':
    case 'subagent_start':
    case 'subagent_stop':
      return matcher
  }
}

// Why: reproduces Codex's command_hook_hash; wire shape is { event_name, matcher?, hooks:[handler] } with matcher omitted (not null) when absent.
export function computeTrustedHash(entry: CodexTrustEntry): string {
  const handler: Record<string, unknown> = {
    type: 'command',
    command: entry.command,
    timeout: Math.max(1, entry.timeoutSec ?? 600),
    async: entry.async ?? false
  }
  if (entry.statusMessage !== undefined) {
    handler.statusMessage = entry.statusMessage
  }
  const identity: Record<string, unknown> = {
    event_name: entry.eventLabel,
    hooks: [handler]
  }
  const matcher = matcherPatternForEvent(entry.eventLabel, entry.matcher)
  if (matcher !== undefined) {
    identity.matcher = matcher
  }
  const serialized = JSON.stringify(canonicalize(identity))
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`
}

// Why: key_source is already home-derived by discovery. Realpath here would
// change default-home keys; explicit-home callers canonicalize the home first.
export function computeTrustKey(entry: CodexTrustEntry): string {
  return `${normalizeCodexHookSourcePath(entry.sourcePath)}:${entry.eventLabel}:${entry.groupIndex}:${entry.handlerIndex}`
}

/**
 * Returns the hook source path Codex derives after an explicit CODEX_HOME is
 * canonicalized. The source leaf remains logical because hook discovery only
 * normalizes the joined path lexically.
 */
export function getCodexExplicitHomeHookSourcePath(sourcePath: string): string {
  if (process.platform !== 'win32' && isUnambiguousWindowsPath(sourcePath)) {
    return normalizeCodexHookSourcePath(sourcePath)
  }
  try {
    // Why: explicit CODEX_HOME resolves the home directory before hooks.json
    // is appended, so a symlinked leaf must remain logical in the reported key.
    return normalizeCodexHookSourcePath(
      join(realpathSync.native(dirname(sourcePath)), basename(sourcePath))
    )
  } catch {
    return normalizeCodexHookSourcePath(sourcePath)
  }
}

/** Matches the platform-native lexical path displayed by hook discovery. */
export function normalizeCodexHookSourcePath(sourcePath: string): string {
  if (isWindowsPathForTrustSource(sourcePath)) {
    const withoutDevicePrefix = stripWindowsDevicePrefix(sourcePath)
    const normalized = pathWin32.isAbsolute(withoutDevicePrefix)
      ? pathWin32.normalize(withoutDevicePrefix)
      : pathWin32.resolve(withoutDevicePrefix)
    return trimNonRootTrailingSeparators(normalized, pathWin32.parse(normalized).root, /[\\/]/)
  }
  const normalized = pathPosix.isAbsolute(sourcePath)
    ? pathPosix.normalize(sourcePath)
    : pathPosix.resolve(sourcePath)
  return trimNonRootTrailingSeparators(normalized, pathPosix.parse(normalized).root, /\//)
}

export function trimNonRootTrailingSeparators(path: string, root: string, separators: RegExp): string {
  let end = path.length
  while (end > root.length && separators.test(path[end - 1]!)) {
    end -= 1
  }
  return path.slice(0, end)
}

export function stripWindowsDevicePrefix(sourcePath: string): string {
  const unc = /^(?:\\\\\?|\\\\\.)\\UNC\\/i.exec(sourcePath)
  if (unc) {
    return `\\\\${sourcePath.slice(unc[0].length)}`
  }
  const drive = /^(?:\\\\\?|\\\\\.)\\(?=[A-Za-z]:[\\/])/i.exec(sourcePath)
  return drive ? sourcePath.slice(drive[0].length) : sourcePath
}

export function getCodexCanonicalProjectPath(projectPath: string): string {
  try {
    // Why: local trust needs Codex's realpath shape, but remote SSH callers already pass a canonical path.
    return realpathSync.native(projectPath)
  } catch {
    return projectPath
  }
}

export function normalizeWindowsPathSeparators(sourcePath: string): string {
  if (!usesWindowsPathSeparators(sourcePath)) {
    return sourcePath
  }
  return sourcePath.replace(/\\/g, '/')
}

export function usesWindowsPathSeparators(sourcePath: string): boolean {
  return isUnambiguousWindowsPath(sourcePath) || sourcePath.startsWith('//')
}

export function isUnambiguousWindowsPath(sourcePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(sourcePath) || sourcePath.startsWith('\\\\')
}

export function isWindowsPathForTrustSource(sourcePath: string): boolean {
  return (
    isUnambiguousWindowsPath(sourcePath) ||
    (process.platform === 'win32' &&
      (sourcePath.startsWith('//') || !pathPosix.isAbsolute(sourcePath)))
  )
}

// Why: Codex and Orca can disagree on quote style, separators, and casing for the same Windows project.
export function normalizeCodexProjectPathForLookup(projectPath: string): string {
  if (!usesWindowsPathSeparators(projectPath)) {
    return projectPath
  }
  // Why: the Linux tail under a WSL share is case-sensitive, so folding it would conflate distinct dirs onto one key.
  const slashedPath = normalizeWindowsPathSeparators(projectPath)
  return foldWslUncPathCaseInsensitiveParts(slashedPath) ?? slashedPath.toLowerCase()
}

export function codexHookSourcePathsEqual(left: string, right: string): boolean {
  // Why: TrustMap iteration yields lookup-normalized keys, so Windows paths
  // may be lowercase even when the live filesystem preserves mixed casing.
  const normalizeForLookup = (sourcePath: string): string =>
    normalizeCodexProjectPathForLookup(
      sourcePath.startsWith('//') ? sourcePath : normalizeCodexHookSourcePath(sourcePath)
    )
  return normalizeForLookup(left) === normalizeForLookup(right)
}

// Why: trust revocations recorded before WSL tails compared case-sensitively
// can carry drifted casing; fold fully so matching errs toward revoked.
export function normalizeCodexProjectPathForRevocationLookup(projectPath: string): string {
  const normalized = normalizeCodexProjectPathForLookup(projectPath)
  return usesWindowsPathSeparators(projectPath) ? normalized.toLowerCase() : normalized
}

export function parseTrustKey(key: string): {
  sourcePath: string
  eventLabel: CodexEventLabel
  groupIndex: number
  handlerIndex: number
} | null {
  // Why: sourcePath may contain `:` (Windows drive letters), so anchor the parse at the last three colons.
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) {
    return null
  }
  const handlerStr = key.slice(lastColon + 1)
  if (!isCanonicalNonNegativeInt(handlerStr)) {
    return null
  }
  const secondLast = key.lastIndexOf(':', lastColon - 1)
  if (secondLast === -1) {
    return null
  }
  const groupStr = key.slice(secondLast + 1, lastColon)
  if (!isCanonicalNonNegativeInt(groupStr)) {
    return null
  }
  const thirdLast = key.lastIndexOf(':', secondLast - 1)
  if (thirdLast === -1) {
    return null
  }
  const eventLabel = key.slice(thirdLast + 1, secondLast)
  if (!isCodexEventLabel(eventLabel)) {
    return null
  }
  const sourcePath = key.slice(0, thirdLast)
  if (sourcePath.length === 0) {
    return null
  }
  return {
    sourcePath,
    eventLabel,
    groupIndex: Number(groupStr),
    handlerIndex: Number(handlerStr)
  }
}

// Why: Number('') === 0 and Number('1e2') === 100 both pass Number.isInteger, so reject non-canonical decimal forms first.
export function isCanonicalNonNegativeInt(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value)
}

export function isCodexEventLabel(value: string): value is CodexEventLabel {
  return (
    value === 'pre_tool_use' ||
    value === 'permission_request' ||
    value === 'post_tool_use' ||
    value === 'pre_compact' ||
    value === 'post_compact' ||
    value === 'session_start' ||
    value === 'user_prompt_submit' ||
    value === 'subagent_start' ||
    value === 'subagent_stop' ||
    value === 'stop'
  )
}

// Why: strip a leading BOM (some Windows editors write one) so header regexes anchored at `^[ \t]*\[` still match.
export function readTomlFile(configPath: string): string {
  const raw = readFileSync(configPath, 'utf-8')
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

// Why: regex-edit config.toml (not parse+reserialize) to byte-preserve user comments, key ordering, and inline-table style.
// Why: this read-modify-write has no lock and races Codex's /hooks writer, but idempotent install() repairs any lost update.
export function upsertHookTrustEntries(
  configPath: string,
  entries: readonly CodexTrustEntry[]
): void {
  const existing = existsSync(configPath) ? readTomlFile(configPath) : ''
  const updated = upsertHookTrustEntriesInContent(existing, entries)
  if (updated === existing) {
    return
  }
  writeConfigAtomically(configPath, updated)
}

export function upsertHookTrustEntriesInContent(
  existingContent: string,
  entries: readonly CodexTrustEntry[]
): string {
  const existing =
    existingContent.charCodeAt(0) === 0xfeff ? existingContent.slice(1) : existingContent
  let updated = entries.some((entry) =>
    usesWindowsPathSeparators(normalizeCodexHookSourcePath(entry.sourcePath))
  )
    ? ensureHooksStateParentTable(existing)
    : existing
  for (const entry of entries) {
    updated = upsertTrustBlocks(
      updated,
      getTrustKeyWriteVariants(computeTrustKey(entry)),
      entry.trustedHash ?? computeTrustedHash(entry),
      entry.enabled
    )
  }
  return updated
}

export function upsertProjectTrustLevel(
  configPath: string,
  projectPath: string,
  trustLevel: CodexProjectTrustLevel
): void {
  const existing = existsSync(configPath) ? readTomlFile(configPath) : ''
  const updated = upsertProjectTrustLevelInContent(existing, projectPath, trustLevel)
  if (updated === existing) {
    return
  }
  writeConfigAtomically(configPath, updated)
}

