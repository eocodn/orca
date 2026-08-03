import {
  createTomlLineScanState,
  isTomlStructuralLine,
  updateTomlLineScanState
} from './config-toml-line-scan'
import {
  type CodexProjectTrustLevel,
  getCodexCanonicalProjectPath,
  normalizeHookTrustKeyForLookup,
  parseTrustKey,
  usesWindowsPathSeparators
} from './codex-trust-toml-foundation'
import {
  findNextTableHeader,
  parseHookStateHeaderKey,
  findProjectHeaderLineEnd
} from './codex-trust-toml-structure'

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
