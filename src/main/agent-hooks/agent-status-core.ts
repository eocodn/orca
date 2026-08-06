import type {
  AgentStatusIpcPayload,
  ParsedAgentStatusPayload
} from '../../shared/agent-status-types'

/**
 * Main-process status envelope shared by OSC/PTY ingestion and IPC snapshots.
 * Provider hook metadata is intentionally absent here; hook-specific layers may
 * carry it on their own envelope without making the generic status core depend
 * on a provider.
 */
export type AgentStatusCoreEntry = {
  paneKey: string
  tabId?: string
  worktreeId?: string
  connectionId: string | null
  launchToken?: string
  providerSession?: AgentStatusIpcPayload['providerSession']
  providerSessionOnly?: boolean
  promptInteractionKey?: string
  receivedAt: number
  stateStartedAt: number
  payload: ParsedAgentStatusPayload
}

/** Flatten generic status fields into the IPC wire shape. */
export function toAgentStatusIpcPayload(entry: AgentStatusCoreEntry): AgentStatusIpcPayload {
  return {
    paneKey: entry.paneKey,
    ...(entry.launchToken ? { launchToken: entry.launchToken } : {}),
    tabId: entry.tabId,
    worktreeId: entry.worktreeId,
    connectionId: entry.connectionId,
    receivedAt: entry.receivedAt,
    stateStartedAt: entry.stateStartedAt,
    ...(entry.providerSession ? { providerSession: entry.providerSession } : {}),
    ...(entry.providerSessionOnly ? { providerSessionOnly: true } : {}),
    ...(entry.promptInteractionKey ? { promptInteractionKey: entry.promptInteractionKey } : {}),
    ...entry.payload
  }
}

export function snapshotAgentStatusEntries(
  entries: Iterable<AgentStatusCoreEntry>
): AgentStatusIpcPayload[] {
  return Array.from(entries, toAgentStatusIpcPayload)
}

export function snapshotAgentStatusEntry(
  entry: AgentStatusCoreEntry | undefined,
  paneKey: string
): AgentStatusIpcPayload[] {
  return entry?.paneKey === paneKey ? [toAgentStatusIpcPayload(entry)] : []
}

/** OSC does not carry model or child rows, so compare only wire-level fields. */
export function equivalentParsedAgentStatusPayload(
  a: ParsedAgentStatusPayload,
  b: ParsedAgentStatusPayload
): boolean {
  return (
    a.state === b.state &&
    a.prompt === b.prompt &&
    a.agentType === b.agentType &&
    a.toolName === b.toolName &&
    a.toolInput === b.toolInput &&
    a.interactivePrompt === b.interactivePrompt &&
    a.lastAssistantMessage === b.lastAssistantMessage &&
    a.interrupted === b.interrupted
  )
}
