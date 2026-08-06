import type { AppState } from '../store/types'

type AgentStatusProjectionCacheEntry = {
  entry: AppState['agentStatusByPaneKey'][string]
  projection: string
}
type AgentStatusProjectionCache = {
  source: AppState['agentStatusByPaneKey']
  entries: Map<string, AgentStatusProjectionCacheEntry>
  projection: string
}

const AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS = 30_000
let cachedAgentStatusProjection: AgentStatusProjectionCache | null = null

function serializeRuntimeMobileAgentStatusEntry(
  paneKey: string,
  entry: AppState['agentStatusByPaneKey'][string]
): string {
  return JSON.stringify({
    paneKey,
    entryPaneKey: entry.paneKey,
    state: entry.state,
    prompt: entry.prompt,
    updatedAtBucket: Math.floor(entry.updatedAt / AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS),
    stateStartedAt: entry.stateStartedAt,
    agentType: entry.agentType ?? null,
    terminalTitle: entry.terminalTitle ?? null,
    stateHistory: entry.stateHistory.map((history) => ({
      state: history.state,
      prompt: history.prompt,
      startedAt: history.startedAt,
      interrupted: history.interrupted ?? null
    })),
    toolName: entry.toolName ?? null,
    toolInput: entry.toolInput ?? null,
    // Why: include so a newly-captured AskUserQuestion prompt re-fires the mobile republish even when no other field changed.
    interactivePrompt: entry.interactivePrompt ?? null,
    lastAssistantMessage: entry.lastAssistantMessage ?? null,
    interrupted: entry.interrupted ?? null
  })
}

export function buildRuntimeMobileAgentStatusProjection(
  agentStatusByPaneKey: AppState['agentStatusByPaneKey']
): string {
  if (cachedAgentStatusProjection?.source === agentStatusByPaneKey) {
    return cachedAgentStatusProjection.projection
  }

  // Why per-entry: a status ping replaces one entry and re-spreads the map, so
  // without this every other live agent — each carrying a 20-entry history and an
  // 8 KB message — is re-serialized to discover it did not change.
  const previousEntries = cachedAgentStatusProjection?.entries
  const entries = new Map<string, AgentStatusProjectionCacheEntry>()
  const parts: string[] = []

  for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const previous = previousEntries?.get(paneKey)
    const cached =
      previous?.entry === entry
        ? previous
        : { entry, projection: serializeRuntimeMobileAgentStatusEntry(paneKey, entry) }
    entries.set(paneKey, cached)
    parts.push(cached.projection)
  }

  const projection = `[${parts.join(',')}]`
  cachedAgentStatusProjection = { source: agentStatusByPaneKey, entries, projection }
  return projection
}

export function buildRuntimeMobileAgentStatusProjectionForTests(
  agentStatusByPaneKey: AppState['agentStatusByPaneKey']
): string {
  return buildRuntimeMobileAgentStatusProjection(agentStatusByPaneKey)
}

export const AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS_FOR_TESTS =
  AGENT_STATUS_SYNC_UPDATED_AT_BUCKET_MS

export function resetRuntimeMobileAgentStatusProjectionCacheForTests(): void {
  cachedAgentStatusProjection = null
}
