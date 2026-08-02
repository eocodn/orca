import type {
  OpenCodeUsageAttributedEvent,
  OpenCodeUsageDailyAggregate,
  OpenCodeUsageLocationBreakdown,
  OpenCodeUsageLocationModelBreakdown,
  OpenCodeUsageModelBreakdown,
  OpenCodeUsageSession
} from './types'

function addCost(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null
  }
  return (left ?? 0) + (right ?? 0)
}

function createEmptySession(event: OpenCodeUsageAttributedEvent): OpenCodeUsageSession {
  return {
    sessionId: event.sessionId,
    firstTimestamp: event.timestamp,
    lastTimestamp: event.timestamp,
    primaryModel: event.model,
    hasMixedModels: false,
    primaryProjectLabel: event.projectLabel,
    hasMixedLocations: false,
    primaryWorktreeId: event.worktreeId,
    primaryRepoId: event.repoId,
    eventCount: 0,
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: null,
    locationBreakdown: [],
    modelBreakdown: [],
    locationModelBreakdown: []
  }
}

function createEmptyDailyAggregate(
  event: OpenCodeUsageAttributedEvent
): OpenCodeUsageDailyAggregate {
  return {
    day: event.day,
    model: event.model,
    projectKey: event.projectKey,
    projectLabel: event.projectLabel,
    repoId: event.repoId,
    worktreeId: event.worktreeId,
    eventCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: null
  }
}

function mergeLocationBreakdown(
  target: OpenCodeUsageLocationBreakdown[],
  event: OpenCodeUsageAttributedEvent
): void {
  const existing = target.find((entry) => entry.locationKey === event.projectKey) ?? null
  if (existing) {
    existing.eventCount++
    existing.inputTokens += event.inputTokens
    existing.cachedInputTokens += event.cachedInputTokens
    existing.outputTokens += event.outputTokens
    existing.reasoningOutputTokens += event.reasoningOutputTokens
    existing.totalTokens += event.totalTokens
    existing.estimatedCostUsd = addCost(existing.estimatedCostUsd, event.estimatedCostUsd)
    return
  }

  target.push({
    locationKey: event.projectKey,
    projectLabel: event.projectLabel,
    repoId: event.repoId,
    worktreeId: event.worktreeId,
    eventCount: 1,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
    estimatedCostUsd: event.estimatedCostUsd
  })
}

function mergeModelBreakdown(
  target: OpenCodeUsageModelBreakdown[],
  event: OpenCodeUsageAttributedEvent
): void {
  const key = event.model ?? 'unknown'
  const existing = target.find((entry) => entry.modelKey === key) ?? null
  if (existing) {
    existing.eventCount++
    existing.inputTokens += event.inputTokens
    existing.cachedInputTokens += event.cachedInputTokens
    existing.outputTokens += event.outputTokens
    existing.reasoningOutputTokens += event.reasoningOutputTokens
    existing.totalTokens += event.totalTokens
    existing.estimatedCostUsd = addCost(existing.estimatedCostUsd, event.estimatedCostUsd)
    return
  }

  target.push({
    modelKey: key,
    modelLabel: event.model ?? 'Unknown model',
    eventCount: 1,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
    estimatedCostUsd: event.estimatedCostUsd
  })
}

function mergeLocationModelBreakdown(
  target: OpenCodeUsageLocationModelBreakdown[],
  event: OpenCodeUsageAttributedEvent
): void {
  const modelKey = event.model ?? 'unknown'
  const existing =
    target.find((entry) => entry.locationKey === event.projectKey && entry.modelKey === modelKey) ??
    null
  if (existing) {
    existing.eventCount++
    existing.inputTokens += event.inputTokens
    existing.cachedInputTokens += event.cachedInputTokens
    existing.outputTokens += event.outputTokens
    existing.reasoningOutputTokens += event.reasoningOutputTokens
    existing.totalTokens += event.totalTokens
    existing.estimatedCostUsd = addCost(existing.estimatedCostUsd, event.estimatedCostUsd)
    return
  }

  target.push({
    locationKey: event.projectKey,
    modelKey,
    modelLabel: event.model ?? 'Unknown model',
    repoId: event.repoId,
    worktreeId: event.worktreeId,
    eventCount: 1,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
    estimatedCostUsd: event.estimatedCostUsd
  })
}

export function aggregateOpenCodeUsage(events: OpenCodeUsageAttributedEvent[]): {
  sessions: OpenCodeUsageSession[]
  dailyAggregates: OpenCodeUsageDailyAggregate[]
} {
  const sessionsById = new Map<string, OpenCodeUsageSession>()
  const dailyByKey = new Map<string, OpenCodeUsageDailyAggregate>()

  for (const event of events) {
    const session = sessionsById.get(event.sessionId) ?? createEmptySession(event)
    if (!sessionsById.has(event.sessionId)) {
      sessionsById.set(event.sessionId, session)
    }
    if (event.timestamp < session.firstTimestamp) {
      session.firstTimestamp = event.timestamp
    }
    if (event.timestamp >= session.lastTimestamp) {
      session.lastTimestamp = event.timestamp
    }
    session.eventCount++
    session.totalInputTokens += event.inputTokens
    session.totalCachedInputTokens += event.cachedInputTokens
    session.totalOutputTokens += event.outputTokens
    session.totalReasoningOutputTokens += event.reasoningOutputTokens
    session.totalTokens += event.totalTokens
    session.estimatedCostUsd = addCost(session.estimatedCostUsd, event.estimatedCostUsd)
    mergeLocationBreakdown(session.locationBreakdown, event)
    mergeModelBreakdown(session.modelBreakdown, event)
    mergeLocationModelBreakdown(session.locationModelBreakdown, event)

    const dailyKey = [event.day, event.model ?? 'unknown', event.projectKey].join('::')
    const daily = dailyByKey.get(dailyKey) ?? createEmptyDailyAggregate(event)
    if (!dailyByKey.has(dailyKey)) {
      dailyByKey.set(dailyKey, daily)
    }
    daily.eventCount++
    daily.inputTokens += event.inputTokens
    daily.cachedInputTokens += event.cachedInputTokens
    daily.outputTokens += event.outputTokens
    daily.reasoningOutputTokens += event.reasoningOutputTokens
    daily.totalTokens += event.totalTokens
    daily.estimatedCostUsd = addCost(daily.estimatedCostUsd, event.estimatedCostUsd)
  }

  return {
    sessions: finalizeSessions(sessionsById),
    dailyAggregates: [...dailyByKey.values()].sort((left, right) =>
      left.day === right.day
        ? left.projectLabel.localeCompare(right.projectLabel)
        : left.day.localeCompare(right.day)
    )
  }
}

export function finalizeSessions(sessionsById: Map<string, OpenCodeUsageSession>): OpenCodeUsageSession[] {
  for (const session of sessionsById.values()) {
    session.locationBreakdown.sort((left, right) => right.totalTokens - left.totalTokens)
    session.modelBreakdown.sort((left, right) => right.totalTokens - left.totalTokens)
    const primaryLocation = session.locationBreakdown[0] ?? null
    const primaryModel = session.modelBreakdown[0] ?? null
    session.primaryProjectLabel =
      session.locationBreakdown.length <= 1
        ? (primaryLocation?.projectLabel ?? 'Unknown location')
        : 'Multiple locations'
    session.hasMixedLocations = session.locationBreakdown.length > 1
    session.primaryWorktreeId = primaryLocation?.worktreeId ?? null
    session.primaryRepoId = primaryLocation?.repoId ?? null
    session.primaryModel =
      session.modelBreakdown.length <= 1 ? (primaryModel?.modelLabel ?? null) : 'Mixed models'
    session.hasMixedModels = session.modelBreakdown.length > 1
  }

  return [...sessionsById.values()].sort((left, right) =>
    right.lastTimestamp.localeCompare(left.lastTimestamp)
  )
}

export function mergeSessions(
  target: Map<string, OpenCodeUsageSession>,
  sessions: OpenCodeUsageSession[]
): void {
  for (const session of sessions) {
    const existing = target.get(session.sessionId)
    if (!existing) {
      target.set(session.sessionId, structuredClone(session))
      continue
    }

    existing.firstTimestamp =
      session.firstTimestamp < existing.firstTimestamp
        ? session.firstTimestamp
        : existing.firstTimestamp
    existing.lastTimestamp =
      session.lastTimestamp > existing.lastTimestamp
        ? session.lastTimestamp
        : existing.lastTimestamp
    existing.eventCount += session.eventCount
    existing.totalInputTokens += session.totalInputTokens
    existing.totalCachedInputTokens += session.totalCachedInputTokens
    existing.totalOutputTokens += session.totalOutputTokens
    existing.totalReasoningOutputTokens += session.totalReasoningOutputTokens
    existing.totalTokens += session.totalTokens
    existing.estimatedCostUsd = addCost(existing.estimatedCostUsd, session.estimatedCostUsd)

    for (const location of session.locationBreakdown) {
      const existingLocation =
        existing.locationBreakdown.find((entry) => entry.locationKey === location.locationKey) ??
        null
      if (existingLocation) {
        existingLocation.eventCount += location.eventCount
        existingLocation.inputTokens += location.inputTokens
        existingLocation.cachedInputTokens += location.cachedInputTokens
        existingLocation.outputTokens += location.outputTokens
        existingLocation.reasoningOutputTokens += location.reasoningOutputTokens
        existingLocation.totalTokens += location.totalTokens
        existingLocation.estimatedCostUsd = addCost(
          existingLocation.estimatedCostUsd,
          location.estimatedCostUsd
        )
      } else {
        existing.locationBreakdown.push({ ...location })
      }
    }

    for (const model of session.modelBreakdown) {
      const existingModel =
        existing.modelBreakdown.find((entry) => entry.modelKey === model.modelKey) ?? null
      if (existingModel) {
        existingModel.eventCount += model.eventCount
        existingModel.inputTokens += model.inputTokens
        existingModel.cachedInputTokens += model.cachedInputTokens
        existingModel.outputTokens += model.outputTokens
        existingModel.reasoningOutputTokens += model.reasoningOutputTokens
        existingModel.totalTokens += model.totalTokens
        existingModel.estimatedCostUsd = addCost(
          existingModel.estimatedCostUsd,
          model.estimatedCostUsd
        )
      } else {
        existing.modelBreakdown.push({ ...model })
      }
    }

    for (const locationModel of session.locationModelBreakdown) {
      const existingLocationModel =
        existing.locationModelBreakdown.find(
          (entry) =>
            entry.locationKey === locationModel.locationKey &&
            entry.modelKey === locationModel.modelKey
        ) ?? null
      if (existingLocationModel) {
        existingLocationModel.eventCount += locationModel.eventCount
        existingLocationModel.inputTokens += locationModel.inputTokens
        existingLocationModel.cachedInputTokens += locationModel.cachedInputTokens
        existingLocationModel.outputTokens += locationModel.outputTokens
        existingLocationModel.reasoningOutputTokens += locationModel.reasoningOutputTokens
        existingLocationModel.totalTokens += locationModel.totalTokens
        existingLocationModel.estimatedCostUsd = addCost(
          existingLocationModel.estimatedCostUsd,
          locationModel.estimatedCostUsd
        )
      } else {
        existing.locationModelBreakdown.push({ ...locationModel })
      }
    }
  }
}

export function mergeDailyAggregates(
  target: Map<string, OpenCodeUsageDailyAggregate>,
  dailyAggregates: OpenCodeUsageDailyAggregate[]
): void {
  for (const aggregate of dailyAggregates) {
    const key = [aggregate.day, aggregate.model ?? 'unknown', aggregate.projectKey].join('::')
    const existing = target.get(key)
    if (!existing) {
      target.set(key, { ...aggregate })
      continue
    }
    existing.eventCount += aggregate.eventCount
    existing.inputTokens += aggregate.inputTokens
    existing.cachedInputTokens += aggregate.cachedInputTokens
    existing.outputTokens += aggregate.outputTokens
    existing.reasoningOutputTokens += aggregate.reasoningOutputTokens
    existing.totalTokens += aggregate.totalTokens
    existing.estimatedCostUsd = addCost(existing.estimatedCostUsd, aggregate.estimatedCostUsd)
  }
}



