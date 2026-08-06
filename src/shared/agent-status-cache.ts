import { AGENT_STATUS_STALE_AFTER_MS } from './agent-status-types'
import {
  clearPaneCacheState,
  type AgentStatusEventPayload,
  type AgentStatusEventState
} from './agent-status-event'

export const MAX_AGENT_STATUS_CACHE_PANES = 500

export type AgentStatusCacheEviction = { paneKey: string; entry: AgentStatusEventPayload }

export function upsertBoundedAgentStatus(
  state: AgentStatusEventState,
  entry: AgentStatusEventPayload,
  options: { maxPanes?: number; now?: number } = {}
): AgentStatusCacheEviction[] {
  const maxPanes = options.maxPanes ?? MAX_AGENT_STATUS_CACHE_PANES
  if (!Number.isSafeInteger(maxPanes) || maxPanes < 1) {
    throw new RangeError('Agent status cache limit must be a positive safe integer')
  }
  state.lastStatusByPaneKey.delete(entry.paneKey)
  state.lastStatusByPaneKey.set(entry.paneKey, entry)
  const evicted: AgentStatusCacheEviction[] = []
  const now = options.now ?? Date.now()
  while (state.lastStatusByPaneKey.size > maxPanes) {
    const entries = Array.from(state.lastStatusByPaneKey.entries()).filter(
      ([key]) => key !== entry.paneKey
    )
    const candidate =
      entries.find(([, value]) => {
        const receivedAt = value.receivedAt
        return (
          value.payload.state === 'done' ||
          (typeof receivedAt === 'number' && now - receivedAt > AGENT_STATUS_STALE_AFTER_MS)
        )
      })?.[0] ?? entries[0]?.[0]
    if (!candidate) break
    const cached = state.lastStatusByPaneKey.get(candidate)
    if (!cached) break
    evicted.push({ paneKey: candidate, entry: cached })
    clearPaneCacheState(state, candidate)
  }
  return evicted
}
