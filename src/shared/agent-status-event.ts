import type { ParsedAgentStatusPayload } from './agent-status-types'
import type { AgentProviderSessionMetadata } from './agent-session-resume'

export const MAX_PANE_KEY_LEN = 200
export type AgentHookSource = string

export type AgentStatusEventPayload = {
  paneKey: string
  tabId?: string
  worktreeId?: string
  connectionId: string | null
  launchToken?: string
  hasExplicitPrompt?: boolean
  promptInteractionKey?: string
  hookEventName?: string
  toolAgentId?: string
  toolAgentType?: string
  toolUseId?: string
  providerSession?: AgentProviderSessionMetadata
  providerSessionOnly?: boolean
  subagents?: unknown
  payload: ParsedAgentStatusPayload
  receivedAt?: number
  stateStartedAt?: number
  isReplay?: boolean
}

/** Generic status cache state shared by the main status authority and tests. */
export type AgentStatusEventState = {
  lastStatusByPaneKey: Map<string, AgentStatusEventPayload>
  lastPromptByPaneKey: Map<string, string>
  lastToolByPaneKey: Map<string, unknown>
  warnedVersions: Set<string>
  warnedEnvs: Set<string>
  claudeSubagentRosterByPaneKey: Map<string, Map<string, unknown>>
  claudeLeadStateByPaneKey: Map<string, unknown>
  codexSubagentRosterByPaneKey: Map<string, Map<string, unknown>>
  codexSubagentTranscriptByPaneKey: Map<string, unknown>
  codexLeadStateByPaneKey: Map<string, unknown>
}

export type AgentHookEventPayload = AgentStatusEventPayload

export function createAgentStatusEventState(): AgentStatusEventState {
  return {
    lastStatusByPaneKey: new Map(),
    lastPromptByPaneKey: new Map(),
    lastToolByPaneKey: new Map(),
    warnedVersions: new Set(),
    warnedEnvs: new Set(),
    claudeSubagentRosterByPaneKey: new Map(),
    claudeLeadStateByPaneKey: new Map(),
    codexSubagentRosterByPaneKey: new Map(),
    codexSubagentTranscriptByPaneKey: new Map(),
    codexLeadStateByPaneKey: new Map()
  }
}

function deletePaneScoped<T>(map: Map<string, T>, paneKey: string): void {
  map.delete(paneKey)
  const prefix = `${paneKey}\0`
  for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key)
}

export function clearPaneCacheState(state: AgentStatusEventState, paneKey: string): void {
  deletePaneScoped(state.lastStatusByPaneKey, paneKey)
  deletePaneScoped(state.lastPromptByPaneKey, paneKey)
  deletePaneScoped(state.lastToolByPaneKey, paneKey)
  deletePaneScoped(state.claudeSubagentRosterByPaneKey, paneKey)
  deletePaneScoped(state.claudeLeadStateByPaneKey, paneKey)
  deletePaneScoped(state.codexSubagentRosterByPaneKey, paneKey)
  deletePaneScoped(state.codexSubagentTranscriptByPaneKey, paneKey)
  deletePaneScoped(state.codexLeadStateByPaneKey, paneKey)
}

export function movePaneCacheState(
  state: AgentStatusEventState,
  fromPaneKey: string,
  toPaneKey: string
): void {
  if (fromPaneKey === toPaneKey) return
  for (const map of [
    state.lastStatusByPaneKey,
    state.lastPromptByPaneKey,
    state.lastToolByPaneKey,
    state.claudeSubagentRosterByPaneKey,
    state.claudeLeadStateByPaneKey,
    state.codexSubagentRosterByPaneKey,
    state.codexSubagentTranscriptByPaneKey,
    state.codexLeadStateByPaneKey
  ]) {
    for (const [key, value] of Array.from(map.entries())) {
      if (key !== fromPaneKey && !key.startsWith(`${fromPaneKey}\0`)) continue
      map.delete(key)
      map.set(`${toPaneKey}${key.slice(fromPaneKey.length)}`, value)
    }
  }
}

export function clearAllStatusEventCaches(state: AgentStatusEventState): void {
  state.lastStatusByPaneKey.clear()
  state.lastPromptByPaneKey.clear()
  state.lastToolByPaneKey.clear()
  state.warnedVersions.clear()
  state.warnedEnvs.clear()
  state.claudeSubagentRosterByPaneKey.clear()
  state.claudeLeadStateByPaneKey.clear()
  state.codexSubagentRosterByPaneKey.clear()
  state.codexSubagentTranscriptByPaneKey.clear()
  state.codexLeadStateByPaneKey.clear()
}
