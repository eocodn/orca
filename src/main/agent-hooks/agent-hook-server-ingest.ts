import { AgentHookServerAuthority } from './agent-hook-server-authority'
import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../shared/agent-status-types'
import { MAX_PANE_KEY_LEN, type AgentHookEventPayload } from '../../shared/agent-status-event'
import { equivalentParsedAgentStatusPayload } from './agent-status-core'
import { parsePaneKey } from '../../shared/stable-pane-id'
import type * as hookShared from './agent-hook-server-shared'

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload

/** Accepts only generic OSC/PTY status observations. Provider HTTP and relay envelopes are retired. */
export class AgentHookServerIngest extends AgentHookServerAuthority {
  ingestTerminalStatus(event: {
    paneKey: string
    tabId?: string
    worktreeId?: string
    connectionId?: string | null
    launchToken?: string
    isReplay?: boolean
    receivedAt?: number
    payload: ParsedAgentStatusPayload
  }): void {
    const physicalPaneKey = event.paneKey.trim()
    const paneKey = this.resolvePaneKeyAlias(physicalPaneKey)
    const parsedPaneKey = parsePaneKey(paneKey)
    if (!paneKey || paneKey.length > MAX_PANE_KEY_LEN || !parsedPaneKey) return
    const tabId = parsedPaneKey.tabId
    if (paneKey === physicalPaneKey && tabId !== parsedPaneKey.tabId) return
    if (this.shouldSuppressClosedTabStatus(paneKey)) return
    const payload = normalizeAgentStatusPayload(event.payload)
    if (!payload) return
    const connectionId = event.connectionId?.trim() || null
    const previous = this.state.lastStatusByPaneKey.get(paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    // Replayed snapshots are observations for listeners, never an authority update.
    if (event.isReplay && previous) return
    if (
      previous?.connectionId === connectionId &&
      previous.tabId === tabId &&
      previous.worktreeId === event.worktreeId &&
      equivalentParsedAgentStatusPayload(previous.payload, payload)
    )
      return
    const status: AgentHookEventPayload = {
      paneKey,
      tabId,
      worktreeId: event.worktreeId?.trim() || undefined,
      connectionId,
      launchToken: event.launchToken?.trim() || undefined,
      receivedAt: event.receivedAt,
      isReplay: event.isReplay,
      payload
    }
    this.recordCurrentAuthorityObservation(status)
    this.applyNormalizedStatus(status)
  }

  /** Generic remote OSC status path; provider envelopes and replay metadata are not accepted. */
  ingestRemoteStatus(
    event: Omit<Parameters<AgentHookServerIngest['ingestTerminalStatus']>[0], 'connectionId'>,
    connectionId: string
  ): void {
    const normalizedConnectionId = connectionId.trim()
    if (!normalizedConnectionId) return
    this.ingestTerminalStatus({ ...event, connectionId: normalizedConnectionId })
  }

  /** Compatibility entry for legacy callers; only accepts a generic status payload. */
  ingestRemote(envelope: unknown, connectionId: string): void {
    if (!envelope || typeof envelope !== 'object') return
    const value = envelope as Record<string, unknown>
    if (typeof value.paneKey !== 'string' || !value.payload || typeof value.payload !== 'object')
      return
    this.ingestRemoteStatus(
      {
        paneKey: value.paneKey,
        tabId: typeof value.tabId === 'string' ? value.tabId : undefined,
        worktreeId: typeof value.worktreeId === 'string' ? value.worktreeId : undefined,
        launchToken: typeof value.launchToken === 'string' ? value.launchToken : undefined,
        isReplay: value.isReplay === true,
        receivedAt: typeof value.receivedAt === 'number' ? value.receivedAt : undefined,
        payload: value.payload as ParsedAgentStatusPayload
      },
      connectionId
    )
  }
}
