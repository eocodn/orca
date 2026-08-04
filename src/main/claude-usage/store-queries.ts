import type {
  ClaudeUsageBreakdownKind,
  ClaudeUsageBreakdownRow,
  ClaudeUsageDailyPoint,
  ClaudeUsageRange,
  ClaudeUsageScanState,
  ClaudeUsageSessionRow,
  ClaudeUsageSnapshot,
  ClaudeUsageSummary,
  ClaudeUsageScope
} from '../../shared/claude-usage-types'
import { createWorktreeRefs, getSessionProjectLabel, scanClaudeUsageFiles } from './scanner'
import { estimateCostUsd } from './model-pricing'
import {
  ClaudeUsageStoreBase,
  getLocalDay,
  getRangeCutoff,
  getWorktreeFingerprint,
  STALE_MS
} from './store-state'
import { loadKnownUsageWorktreesByRepo } from '../usage-worktree-metadata'

export class ClaudeUsageStore extends ClaudeUsageStoreBase {
  getSnapshot(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    recentSessionLimit = 10
  ): ClaudeUsageSnapshot {
    return {
      scanState: this.getScanState(),
      summary: this.buildSummary(scope, range),
      daily: this.buildDaily(scope, range),
      modelBreakdown: this.buildBreakdown(scope, range, 'model'),
      projectBreakdown: this.buildBreakdown(scope, range, 'project'),
      recentSessions: this.buildRecentSessions(scope, range, recentSessionLimit)
    }
  }

  async refresh(force = false): Promise<ClaudeUsageScanState> {
    if (!this.state.scanState.enabled) {
      return this.getScanState()
    }
    const currentWorktreeFingerprint = await this.getCurrentWorktreeFingerprint()
    if (!force && this.state.scanState.lastScanCompletedAt) {
      const ageMs = Date.now() - this.state.scanState.lastScanCompletedAt
      if (ageMs < STALE_MS && this.state.worktreeFingerprint === currentWorktreeFingerprint) {
        return this.getScanState()
      }
    }
    await this.runScan()
    return this.getScanState()
  }

  private async runScan(): Promise<void> {
    if (this.scanPromise) {
      await this.scanPromise
      return
    }

    this.state.scanState.lastScanStartedAt = Date.now()
    this.state.scanState.lastScanError = null

    // Why no write here: persisting scan-start would rewrite the whole multi-MB cache before a single
    // result changed. The completion/failure write below persists the same fields.

    // Why: assign scanPromise before any await so concurrent refresh shares one scan.
    this.scanPromise = (async () => {
      try {
        const repos = this.store.getRepos()
        const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
        const worktreeFingerprint = getWorktreeFingerprint(worktreesByRepo)
        const result = await scanClaudeUsageFiles(
          createWorktreeRefs(repos, worktreesByRepo),
          this.state.worktreeFingerprint === worktreeFingerprint ? this.state.processedFiles : []
        )
        this.state.processedFiles = result.processedFiles
        this.state.sessions = result.sessions
        this.state.dailyAggregates = result.dailyAggregates
        this.state.worktreeFingerprint = worktreeFingerprint
        this.state.scanState.lastScanCompletedAt = Date.now()
        this.state.scanState.lastScanError = null
        // Why swallow: persistence is a cache concern. A disk failure must not turn a good scan into
        // a scan error and reject refresh() for every query caller; writeToDisk already logs it.
        await this.writeToDisk().catch(() => {})
      } catch (error) {
        this.state.scanState.lastScanError = error instanceof Error ? error.message : String(error)
        await this.writeToDisk().catch(() => {})
      } finally {
        this.scanPromise = null
      }
    })()

    await this.scanPromise
  }

  async getSummary(scope: ClaudeUsageScope, range: ClaudeUsageRange): Promise<ClaudeUsageSummary> {
    await this.refresh(false)
    return this.buildSummary(scope, range)
  }

  private buildSummary(scope: ClaudeUsageScope, range: ClaudeUsageRange): ClaudeUsageSummary {
    const filteredDaily = this.getFilteredDaily(scope, range)
    const filteredSessions = this.getFilteredSessions(scope, range)

    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let turns = 0
    let zeroCacheReadTurns = 0
    const byModel = new Map<string, number>()
    const byProject = new Map<string, number>()
    let estimatedCostUsd = 0
    let hasAnyBillableCost = false

    for (const row of filteredDaily) {
      inputTokens += row.inputTokens
      outputTokens += row.outputTokens
      cacheReadTokens += row.cacheReadTokens
      cacheWriteTokens += row.cacheWriteTokens
      turns += row.turnCount
      zeroCacheReadTurns += row.zeroCacheReadTurnCount
      const modelKey = row.model ?? 'Unknown model'
      byModel.set(modelKey, (byModel.get(modelKey) ?? 0) + row.inputTokens + row.outputTokens)
      byProject.set(
        row.projectLabel,
        (byProject.get(row.projectLabel) ?? 0) + row.inputTokens + row.outputTokens
      )
      const cost = estimateCostUsd(
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens
      )
      if (cost !== null) {
        hasAnyBillableCost = true
        estimatedCostUsd += cost
      }
    }

    const topModel =
      [...byModel.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
    const topProject =
      [...byProject.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null

    return {
      scope,
      range,
      sessions: filteredSessions.length,
      turns,
      zeroCacheReadTurns,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheReuseRate:
        inputTokens + cacheReadTokens > 0
          ? cacheReadTokens / (inputTokens + cacheReadTokens)
          : null,
      estimatedCostUsd: hasAnyBillableCost ? estimatedCostUsd : null,
      topModel,
      topProject,
      // Why: the empty-state UX is scope/range specific. Using global persisted
      // data here makes the Orca-only view render empty charts instead of the
      // intended "no usage for this scope" message when only off-Orca logs exist.
      hasAnyClaudeData: filteredSessions.length > 0 || filteredDaily.length > 0
    }
  }

  async getDaily(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange
  ): Promise<ClaudeUsageDailyPoint[]> {
    await this.refresh(false)
    return this.buildDaily(scope, range)
  }

  private buildDaily(scope: ClaudeUsageScope, range: ClaudeUsageRange): ClaudeUsageDailyPoint[] {
    const byDay = new Map<string, ClaudeUsageDailyPoint>()
    for (const row of this.getFilteredDaily(scope, range)) {
      const existing = byDay.get(row.day) ?? {
        day: row.day,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      }
      existing.inputTokens += row.inputTokens
      existing.outputTokens += row.outputTokens
      existing.cacheReadTokens += row.cacheReadTokens
      existing.cacheWriteTokens += row.cacheWriteTokens
      byDay.set(row.day, existing)
    }
    return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day))
  }

  async getBreakdown(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    kind: ClaudeUsageBreakdownKind
  ): Promise<ClaudeUsageBreakdownRow[]> {
    await this.refresh(false)
    return this.buildBreakdown(scope, range, kind)
  }

  private buildBreakdown(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    kind: ClaudeUsageBreakdownKind
  ): ClaudeUsageBreakdownRow[] {
    const rows = new Map<string, ClaudeUsageBreakdownRow>()
    const filteredDaily = this.getFilteredDaily(scope, range)
    const filteredSessions = this.getFilteredSessions(scope, range)

    for (const daily of filteredDaily) {
      const key = kind === 'model' ? (daily.model ?? 'unknown') : daily.projectKey
      const label = kind === 'model' ? (daily.model ?? 'Unknown model') : daily.projectLabel
      const existing = rows.get(key) ?? {
        key,
        label,
        sessions: 0,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: null
      }
      existing.turns += daily.turnCount
      existing.inputTokens += daily.inputTokens
      existing.outputTokens += daily.outputTokens
      existing.cacheReadTokens += daily.cacheReadTokens
      existing.cacheWriteTokens += daily.cacheWriteTokens
      rows.set(key, existing)
    }

    for (const session of filteredSessions) {
      if (kind === 'model') {
        const key = session.model ?? 'unknown'
        const row = rows.get(key)
        if (row) {
          row.sessions++
        }
        continue
      }
      const matchingLocations = session.locationBreakdown.filter((entry) =>
        scope === 'all' ? true : entry.worktreeId !== null
      )
      const seen = new Set<string>()
      for (const location of matchingLocations) {
        if (seen.has(location.locationKey)) {
          continue
        }
        seen.add(location.locationKey)
        const row = rows.get(location.locationKey)
        if (row) {
          row.sessions++
        }
      }
    }

    for (const row of rows.values()) {
      if (kind === 'model') {
        row.estimatedCostUsd = estimateCostUsd(
          row.key,
          row.inputTokens,
          row.outputTokens,
          row.cacheReadTokens,
          row.cacheWriteTokens
        )
      }
    }

    return [...rows.values()].sort((left, right) => {
      const leftTotal = left.inputTokens + left.outputTokens
      const rightTotal = right.inputTokens + right.outputTokens
      return rightTotal - leftTotal
    })
  }

  async getRecentSessions(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    limit = 12
  ): Promise<ClaudeUsageSessionRow[]> {
    await this.refresh(false)
    return this.buildRecentSessions(scope, range, limit)
  }

  private buildRecentSessions(
    scope: ClaudeUsageScope,
    range: ClaudeUsageRange,
    limit = 12
  ): ClaudeUsageSessionRow[] {
    return this.getFilteredSessions(scope, range)
      .slice(0, limit)
      .map((session) => {
        const matchingLocations = session.locationBreakdown.filter((entry) =>
          scope === 'all' ? true : entry.worktreeId !== null
        )
        const scopedLocations =
          matchingLocations.length > 0 ? matchingLocations : session.locationBreakdown
        const totals = scopedLocations.reduce(
          (acc, entry) => {
            acc.turns += entry.turnCount
            acc.inputTokens += entry.inputTokens
            acc.outputTokens += entry.outputTokens
            acc.cacheReadTokens += entry.cacheReadTokens
            acc.cacheWriteTokens += entry.cacheWriteTokens
            return acc
          },
          {
            turns: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          }
        )
        const durationMinutes = Math.max(
          0,
          Math.round(
            (new Date(session.lastTimestamp).getTime() -
              new Date(session.firstTimestamp).getTime()) /
              60_000
          )
        )
        return {
          sessionId: session.sessionId,
          lastActiveAt: session.lastTimestamp,
          durationMinutes,
          projectLabel: getSessionProjectLabel(scopedLocations),
          branch: session.lastGitBranch,
          model: session.model,
          turns: totals.turns,
          inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens,
          cacheReadTokens: totals.cacheReadTokens,
          cacheWriteTokens: totals.cacheWriteTokens
        }
      })
  }

  private getFilteredDaily(scope: ClaudeUsageScope, range: ClaudeUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.dailyAggregates.filter((entry) => {
      if (cutoff && entry.day < cutoff) {
        return false
      }
      if (scope === 'orca' && entry.worktreeId === null) {
        return false
      }
      return true
    })
  }

  private getFilteredSessions(scope: ClaudeUsageScope, range: ClaudeUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.sessions.filter((session) => {
      // Why: daily aggregates use local calendar days, so session filtering has
      // to use the same conversion or the sessions table/counts can disagree
      // with the chart around UTC day boundaries.
      const day = getLocalDay(session.lastTimestamp)
      if (!day) {
        return false
      }
      if (cutoff && day < cutoff) {
        return false
      }
      if (scope === 'orca') {
        return session.locationBreakdown.some((entry) => entry.worktreeId !== null)
      }
      return true
    })
  }

  protected async getCurrentWorktreeFingerprint(): Promise<string> {
    const repos = this.store.getRepos()
    const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
    return getWorktreeFingerprint(worktreesByRepo)
  }
}
