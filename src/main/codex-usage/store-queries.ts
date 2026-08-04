import type {
  CodexUsageBreakdownKind,
  CodexUsageBreakdownRow,
  CodexUsageDailyPoint,
  CodexUsageRange,
  CodexUsageScanState,
  CodexUsageScope,
  CodexUsageSessionRow,
  CodexUsageSnapshot,
  CodexUsageSummary
} from '../../shared/codex-usage-types'
import type { CodexUsagePersistedState } from './types'
import { createWorktreeRefs, scanCodexUsageFiles } from './scanner'
import { estimateCostUsd } from './model-pricing'
import {
  CodexUsageStoreBase,
  getLocalDay,
  getRangeCutoff,
  getWorktreeFingerprint,
  STALE_MS,
  type ScopedCodexUsageModelRow
} from './store-state'
import { loadKnownUsageWorktreesByRepo } from '../usage-worktree-metadata'

export class CodexUsageStore extends CodexUsageStoreBase {
  getSnapshot(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    recentSessionLimit = 10
  ): CodexUsageSnapshot {
    return {
      scanState: this.getScanState(),
      summary: this.buildSummary(scope, range),
      daily: this.buildDaily(scope, range),
      modelBreakdown: this.buildBreakdown(scope, range, 'model'),
      projectBreakdown: this.buildBreakdown(scope, range, 'project'),
      recentSessions: this.buildRecentSessions(scope, range, recentSessionLimit)
    }
  }

  async refresh(force = false): Promise<CodexUsageScanState> {
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

    this.scanPromise = (async () => {
      try {
        const repos = this.store.getRepos()
        const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
        const worktreeFingerprint = getWorktreeFingerprint(worktreesByRepo)
        const result = await scanCodexUsageFiles(
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

  async getSummary(scope: CodexUsageScope, range: CodexUsageRange): Promise<CodexUsageSummary> {
    await this.refresh(false)
    return this.buildSummary(scope, range)
  }

  private buildSummary(scope: CodexUsageScope, range: CodexUsageRange): CodexUsageSummary {
    const filteredDaily = this.getFilteredDaily(scope, range)
    const filteredSessions = this.getFilteredSessions(scope, range)

    let inputTokens = 0
    let cachedInputTokens = 0
    let outputTokens = 0
    let reasoningOutputTokens = 0
    let totalTokens = 0
    let events = 0
    let estimatedCostUsd = 0
    let hasAnyBillableCost = false
    const byModel = new Map<string, number>()
    const byProject = new Map<string, number>()

    for (const row of filteredDaily) {
      inputTokens += row.inputTokens
      cachedInputTokens += row.cachedInputTokens
      outputTokens += row.outputTokens
      reasoningOutputTokens += row.reasoningOutputTokens
      totalTokens += row.totalTokens
      events += row.eventCount
      byModel.set(
        row.model ?? 'Unknown model',
        (byModel.get(row.model ?? 'Unknown model') ?? 0) + row.totalTokens
      )
      byProject.set(row.projectLabel, (byProject.get(row.projectLabel) ?? 0) + row.totalTokens)
      const cost = estimateCostUsd(
        row.model,
        row.inputTokens,
        row.cachedInputTokens,
        row.outputTokens
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
      events,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
      estimatedCostUsd: hasAnyBillableCost ? estimatedCostUsd : null,
      topModel,
      topProject,
      hasAnyCodexData: filteredSessions.length > 0 || filteredDaily.length > 0
    }
  }

  async getDaily(scope: CodexUsageScope, range: CodexUsageRange): Promise<CodexUsageDailyPoint[]> {
    await this.refresh(false)
    return this.buildDaily(scope, range)
  }

  private buildDaily(scope: CodexUsageScope, range: CodexUsageRange): CodexUsageDailyPoint[] {
    const byDay = new Map<string, CodexUsageDailyPoint>()
    for (const row of this.getFilteredDaily(scope, range)) {
      const existing = byDay.get(row.day) ?? {
        day: row.day,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
      }
      existing.inputTokens += row.inputTokens
      existing.cachedInputTokens += row.cachedInputTokens
      existing.outputTokens += row.outputTokens
      existing.reasoningOutputTokens += row.reasoningOutputTokens
      existing.totalTokens += row.totalTokens
      byDay.set(row.day, existing)
    }
    return [...byDay.values()].sort((left, right) => left.day.localeCompare(right.day))
  }

  async getBreakdown(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    kind: CodexUsageBreakdownKind
  ): Promise<CodexUsageBreakdownRow[]> {
    await this.refresh(false)
    return this.buildBreakdown(scope, range, kind)
  }

  private buildBreakdown(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    kind: CodexUsageBreakdownKind
  ): CodexUsageBreakdownRow[] {
    const rows = new Map<string, CodexUsageBreakdownRow>()
    const filteredDaily = this.getFilteredDaily(scope, range)
    const filteredSessions = this.getFilteredSessions(scope, range)

    for (const daily of filteredDaily) {
      const key = kind === 'model' ? (daily.model ?? 'unknown') : daily.projectKey
      const label = kind === 'model' ? (daily.model ?? 'Unknown model') : daily.projectLabel
      const existing = rows.get(key) ?? {
        key,
        label,
        sessions: 0,
        events: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: null,
        hasInferredPricing: false
      }
      existing.events += daily.eventCount
      existing.inputTokens += daily.inputTokens
      existing.cachedInputTokens += daily.cachedInputTokens
      existing.outputTokens += daily.outputTokens
      existing.reasoningOutputTokens += daily.reasoningOutputTokens
      existing.totalTokens += daily.totalTokens
      existing.hasInferredPricing ||= daily.hasInferredPricing
      rows.set(key, existing)
    }

    for (const session of filteredSessions) {
      if (kind === 'model') {
        const seen = new Set<string>()
        for (const model of this.getScopedSessionModels(session, scope)) {
          if (seen.has(model.modelKey)) {
            continue
          }
          seen.add(model.modelKey)
          const row = rows.get(model.modelKey)
          if (row) {
            row.sessions++
          }
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
      row.estimatedCostUsd = estimateCostUsd(
        kind === 'model' ? row.key : null,
        row.inputTokens,
        row.cachedInputTokens,
        row.outputTokens
      )
    }

    return [...rows.values()].sort((left, right) => right.totalTokens - left.totalTokens)
  }

  async getRecentSessions(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    limit = 12
  ): Promise<CodexUsageSessionRow[]> {
    await this.refresh(false)
    return this.buildRecentSessions(scope, range, limit)
  }

  private buildRecentSessions(
    scope: CodexUsageScope,
    range: CodexUsageRange,
    limit = 12
  ): CodexUsageSessionRow[] {
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
            acc.events += entry.eventCount
            acc.inputTokens += entry.inputTokens
            acc.cachedInputTokens += entry.cachedInputTokens
            acc.outputTokens += entry.outputTokens
            acc.reasoningOutputTokens += entry.reasoningOutputTokens
            acc.totalTokens += entry.totalTokens
            acc.hasInferredPricing ||= entry.hasInferredPricing
            return acc
          },
          {
            events: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 0,
            hasInferredPricing: false
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
          projectLabel:
            scopedLocations.length > 1
              ? 'Multiple locations'
              : (scopedLocations[0]?.projectLabel ?? session.primaryProjectLabel),
          model: this.getScopedSessionPrimaryModel(session, scope),
          events: totals.events,
          inputTokens: totals.inputTokens,
          cachedInputTokens: totals.cachedInputTokens,
          outputTokens: totals.outputTokens,
          reasoningOutputTokens: totals.reasoningOutputTokens,
          totalTokens: totals.totalTokens,
          hasInferredPricing: session.hasInferredPricing || totals.hasInferredPricing
        }
      })
  }

  private getFilteredDaily(scope: CodexUsageScope, range: CodexUsageRange) {
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

  private getFilteredSessions(scope: CodexUsageScope, range: CodexUsageRange) {
    const cutoff = getRangeCutoff(range)
    return this.state.sessions.filter((session) => {
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

  private getScopedSessionModels(
    session: CodexUsagePersistedState['sessions'][number],
    scope: CodexUsageScope
  ): ScopedCodexUsageModelRow[] {
    if (scope === 'all' || session.locationModelBreakdown.length === 0) {
      return session.modelBreakdown
    }

    const rows = new Map<string, ScopedCodexUsageModelRow>()
    for (const entry of session.locationModelBreakdown) {
      if (entry.worktreeId === null) {
        continue
      }
      const existing = rows.get(entry.modelKey) ?? {
        modelKey: entry.modelKey,
        modelLabel: entry.modelLabel,
        hasInferredPricing: false,
        eventCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
      }
      existing.hasInferredPricing ||= entry.hasInferredPricing
      existing.eventCount += entry.eventCount
      existing.inputTokens += entry.inputTokens
      existing.cachedInputTokens += entry.cachedInputTokens
      existing.outputTokens += entry.outputTokens
      existing.reasoningOutputTokens += entry.reasoningOutputTokens
      existing.totalTokens += entry.totalTokens
      rows.set(entry.modelKey, existing)
    }
    return [...rows.values()].sort((left, right) => right.totalTokens - left.totalTokens)
  }

  private getScopedSessionPrimaryModel(
    session: CodexUsagePersistedState['sessions'][number],
    scope: CodexUsageScope
  ): string | null {
    const scopedModels = this.getScopedSessionModels(session, scope)
    if (scopedModels.length === 0) {
      return session.primaryModel
    }
    if (scopedModels.length === 1) {
      return scopedModels[0]?.modelLabel ?? null
    }
    return 'Mixed models'
  }

  protected async getCurrentWorktreeFingerprint(): Promise<string> {
    const repos = this.store.getRepos()
    const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
    return getWorktreeFingerprint(worktreesByRepo)
  }
}
