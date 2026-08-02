import { basename } from "node:path"
import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import type { CodexUsageAttributedEvent, CodexUsageParsedEvent, CodexUsagePersistedFile } from "./types"
import { attributeCodexUsageEvent, type CodexUsageWorktreeRef } from "./scanner-attribution"
import { aggregateCodexUsage } from "./scanner-aggregation"
import { ensureNumber, getProcessedFileInfo, type CodexUsageDeltaResolution, type CodexUsageParseContext, type CodexUsageRawRecord, type CodexUsageRawUsage } from "./scanner-io"

export function normalizeRawUsage(value: unknown): CodexUsageRawUsage | null {
  if (value == null || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const inputTokens = ensureNumber(record.input_tokens)
  const cachedInputTokens = ensureNumber(
    record.cached_input_tokens ?? record.cache_read_input_tokens
  )
  const outputTokens = ensureNumber(record.output_tokens)
  const reasoningOutputTokens = ensureNumber(record.reasoning_output_tokens)
  const totalTokens = ensureNumber(record.total_tokens)

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    // Why: legacy Codex logs can omit total_tokens. Reasoning is already billed
    // inside output, so synthesizing input+output matches Codex pricing instead
    // of double-counting reasoning as another billable bucket.
    totalTokens: totalTokens > 0 ? totalTokens : inputTokens + outputTokens
  }
}

function subtractRawUsage(
  current: CodexUsageRawUsage,
  previous: CodexUsageRawUsage | null
): CodexUsageRawUsage {
  return {
    inputTokens: Math.max(current.inputTokens - (previous?.inputTokens ?? 0), 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - (previous?.cachedInputTokens ?? 0), 0),
    outputTokens: Math.max(current.outputTokens - (previous?.outputTokens ?? 0), 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0),
      0
    ),
    totalTokens: Math.max(current.totalTokens - (previous?.totalTokens ?? 0), 0)
  }
}

function addRawUsage(left: CodexUsageRawUsage, right: CodexUsageRawUsage): CodexUsageRawUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  }
}

function rawUsageEquals(left: CodexUsageRawUsage, right: CodexUsageRawUsage): boolean {
  return (
    left.inputTokens === right.inputTokens &&
    left.cachedInputTokens === right.cachedInputTokens &&
    left.outputTokens === right.outputTokens &&
    left.reasoningOutputTokens === right.reasoningOutputTokens
  )
}

function rawUsageIsMonotonic(current: CodexUsageRawUsage, previous: CodexUsageRawUsage): boolean {
  return (
    current.inputTokens >= previous.inputTokens &&
    current.cachedInputTokens >= previous.cachedInputTokens &&
    current.outputTokens >= previous.outputTokens &&
    current.reasoningOutputTokens >= previous.reasoningOutputTokens
  )
}

function rawUsageMagnitude(usage: CodexUsageRawUsage): number {
  return (
    usage.inputTokens + usage.cachedInputTokens + usage.outputTokens + usage.reasoningOutputTokens
  )
}

function looksLikeStaleRegression(
  current: CodexUsageRawUsage,
  previous: CodexUsageRawUsage,
  last: CodexUsageRawUsage
): boolean {
  const previousTotal = rawUsageMagnitude(previous)
  const currentTotal = rawUsageMagnitude(current)
  const lastTotal = rawUsageMagnitude(last)
  if (previousTotal <= 0 || currentTotal <= 0 || lastTotal <= 0) {
    return false
  }
  return currentTotal * 100 >= previousTotal * 98 || currentTotal + lastTotal * 2 >= previousTotal
}

export function resolveCodexUsageDelta(
  totalUsage: CodexUsageRawUsage | null,
  lastUsage: CodexUsageRawUsage | null,
  previousTotals: CodexUsageRawUsage | null
): CodexUsageDeltaResolution | null {
  if (totalUsage && lastUsage && previousTotals) {
    if (rawUsageEquals(totalUsage, previousTotals)) {
      return null
    }
    if (
      !rawUsageIsMonotonic(totalUsage, previousTotals) &&
      looksLikeStaleRegression(totalUsage, previousTotals, lastUsage)
    ) {
      return null
    }
    // Why: Codex totals are mutable snapshots after compaction/resume. The
    // last_token_usage payload is the billable increment; totals are the baseline.
    return { kind: 'event', delta: lastUsage, nextTotals: totalUsage }
  }

  if (totalUsage && lastUsage) {
    return { kind: 'event', delta: lastUsage, nextTotals: totalUsage }
  }

  if (totalUsage && previousTotals) {
    if (rawUsageEquals(totalUsage, previousTotals)) {
      return null
    }
    if (!rawUsageIsMonotonic(totalUsage, previousTotals)) {
      return { kind: 'baseline', nextTotals: totalUsage }
    }
    return {
      kind: 'event',
      delta: subtractRawUsage(totalUsage, previousTotals),
      nextTotals: totalUsage
    }
  }

  if (totalUsage) {
    return { kind: 'event', delta: totalUsage, nextTotals: totalUsage }
  }

  if (lastUsage && previousTotals) {
    return { kind: 'event', delta: lastUsage, nextTotals: addRawUsage(previousTotals, lastUsage) }
  }

  if (lastUsage) {
    return { kind: 'event', delta: lastUsage, nextTotals: null }
  }

  return null
}

export function buildCodexUsageEventKey(
  timestamp: string,
  totalUsage: CodexUsageRawUsage | null,
  lastUsage: CodexUsageRawUsage | null
): string {
  // Why: fork/resume copies token_count records byte-for-byte into a new
  // rollout file, but session_meta.id is often rewritten to the new session.
  // Key only on the raw record fields (timestamp + usage tuples) so the copy
  // matches the original regardless of surrounding parse context / session id.
  const tupleOf = (usage: CodexUsageRawUsage | null): string =>
    usage
      ? [
          usage.inputTokens,
          usage.cachedInputTokens,
          usage.outputTokens,
          usage.reasoningOutputTokens,
          usage.totalTokens
        ].join(',')
      : ''
  return [timestamp, tupleOf(totalUsage), tupleOf(lastUsage)].join('|')
}

export function extractString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function extractModel(value: unknown): string | null {
  if (value == null || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const direct = [extractString(record.model), extractString(record.model_name)].find(
    (candidate) => candidate !== null
  )
  if (direct) {
    return direct
  }

  if (record.info && typeof record.info === 'object') {
    const info = record.info as Record<string, unknown>
    const infoDirect = [extractString(info.model), extractString(info.model_name)].find(
      (candidate) => candidate !== null
    )
    if (infoDirect) {
      return infoDirect
    }
    if (info.metadata && typeof info.metadata === 'object') {
      const metadata = info.metadata as Record<string, unknown>
      const metadataModel = extractString(metadata.model)
      if (metadataModel) {
        return metadataModel
      }
    }
  }

  if (record.metadata && typeof record.metadata === 'object') {
    const metadata = record.metadata as Record<string, unknown>
    return extractString(metadata.model)
  }

  return null
}

function getDefaultProjectLabel(cwd: string | null): string {
export function parseCodexUsageRecord(
  line: string,
  context: CodexUsageParseContext
): CodexUsageParsedEvent | null {
  let parsed: CodexUsageRawRecord
  try {
    parsed = JSON.parse(line) as CodexUsageRawRecord
  } catch {
    return null
  }

  if (!parsed.type || !parsed.payload) {
    return null
  }

  if (parsed.type === 'session_meta') {
    context.sessionId = extractString(parsed.payload.id) ?? context.sessionId
    context.sessionCwd = extractString(parsed.payload.cwd)
    if (!context.currentCwd && context.sessionCwd) {
      context.currentCwd = context.sessionCwd
    }
    return null
  }

  if (parsed.type === 'turn_context') {
    context.currentCwd =
      extractString(parsed.payload.cwd) ?? context.currentCwd ?? context.sessionCwd
    context.currentModel = extractModel(parsed.payload) ?? context.currentModel
    return null
  }

  if (parsed.type !== 'event_msg' || parsed.payload.type !== 'token_count' || !parsed.timestamp) {
    return null
  }

  const info = parsed.payload.info
  if (info == null || typeof info !== 'object') {
    // Why: Codex emits token_count snapshots with null info for rate-limit
    // updates. Treating them as malformed usage would make active sessions look
    // flaky and create false scan errors for perfectly valid logs.
    return null
  }

  const record = info as Record<string, unknown>
  const totalUsage = normalizeRawUsage(record.total_token_usage)
  const lastUsage = normalizeRawUsage(record.last_token_usage)
  if (context.totalOnlyBaselinePending) {
    context.totalOnlyBaselinePending = false
    if (totalUsage && !lastUsage && !context.previousTotals) {
      context.previousTotals = totalUsage
      return null
    }
  }
  const resolvedUsage = resolveCodexUsageDelta(totalUsage, lastUsage, context.previousTotals)
  if (!resolvedUsage) {
    return null
  }
  if (resolvedUsage.kind === 'baseline') {
    context.previousTotals = resolvedUsage.nextTotals
    return null
  }

  let delta = {
    ...resolvedUsage.delta,
    cachedInputTokens: Math.min(
      resolvedUsage.delta.cachedInputTokens,
      resolvedUsage.delta.inputTokens
    )
  }

  if (
    delta.inputTokens === 0 &&
    delta.cachedInputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.reasoningOutputTokens === 0 &&
    delta.totalTokens === 0
  ) {
    return null
  }

  context.previousTotals = resolvedUsage.nextTotals

  const resolvedModel = extractModel(parsed.payload) ?? context.currentModel
  const hasInferredPricing = resolvedModel === null

  return {
    sessionId: context.sessionId,
    timestamp: parsed.timestamp,
    eventKey: buildCodexUsageEventKey(parsed.timestamp, totalUsage, lastUsage),
    cwd: context.currentCwd ?? context.sessionCwd,
    model: resolvedModel,
    hasInferredPricing,
    inputTokens: delta.inputTokens,
    cachedInputTokens: delta.cachedInputTokens,
    outputTokens: delta.outputTokens,
    reasoningOutputTokens: delta.reasoningOutputTokens,
    totalTokens: delta.totalTokens
  }
}

export async function parseCodexUsageFile(
  filePath: string,
  worktrees: (CodexUsageWorktreeRef & { canonicalPath: string })[],
  options: { skipInitialBytes?: number; claimEventKey?: (eventKey: string) => boolean } = {}
): Promise<CodexUsagePersistedFile> {
  const processedFile = await getProcessedFileInfo(filePath)
  const lines = createInterface({
    input: createReadStream(filePath, {
      encoding: 'utf-8',
      start: options.skipInitialBytes ?? 0
    }),
    crlfDelay: Infinity
  })
  const events: CodexUsageAttributedEvent[] = []
  const context: CodexUsageParseContext = {
    sessionId: basename(filePath, '.jsonl'),
    sessionCwd: null,
    currentCwd: null,
    currentModel: null,
    previousTotals: null,
    // Why: suffix-only legacy copy parsing lacks the copied prefix context. A
    // leading total-only snapshot is a baseline, not the suffix's billable delta.
    totalOnlyBaselinePending: (options.skipInitialBytes ?? 0) > 0
  }

  const ownedEventKeys = new Set<string>()
  let hasDeferredClaims = false
  for await (const line of lines) {
    const parsed = parseCodexUsageRecord(line, context)
    if (!parsed) {
      continue
    }
    // Why: fork/resume rollouts start with a copied prefix of the parent file.
    // Events another file already owns are dropped here, but the record still
    // advanced context.previousTotals above, so later deltas stay correct.
    if (options.claimEventKey && !options.claimEventKey(parsed.eventKey)) {
      hasDeferredClaims = true
      continue
    }
    ownedEventKeys.add(parsed.eventKey)
    const attributed = await attributeCodexUsageEvent(parsed, worktrees)
    if (attributed) {
      events.push(attributed)
    }
  }

  return {
    ...processedFile,
    ...aggregateCodexUsage(events),
    ownedEventKeys: [...ownedEventKeys],
    hasDeferredClaims
  }
}

export async function scanCodexUsageFiles(
