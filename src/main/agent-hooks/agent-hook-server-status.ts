import { AgentHookServerBase } from './agent-hook-server-base'
import * as hookShared from './agent-hook-server-shared'
import type { AgentHookEventPayload } from '../../shared/agent-status-event'

type EnrichedAgentHookEventPayload = hookShared.EnrichedAgentHookEventPayload

/** Generic OSC/PTY status authority. Provider HTTP enrichment is intentionally absent. */
export class AgentHookServerStatus extends AgentHookServerBase {
  protected applyNormalizedStatus(payload: AgentHookEventPayload): EnrichedAgentHookEventPayload {
    const previous = this.state.lastStatusByPaneKey.get(payload.paneKey) as
      | EnrichedAgentHookEventPayload
      | undefined
    const now = Math.max(
      Date.now(),
      payload.connectionId
        ? (this.connectionTimestampWatermarkById.get(payload.connectionId) ?? -1) + 1
        : 0
    )
    if (payload.connectionId) this.connectionTimestampWatermarkById.set(payload.connectionId, now)
    const enriched = this.attachStatusTiming(payload, now)
    if (
      previous &&
      previous.payload.state === 'done' &&
      previous.payload.interrupted === true &&
      enriched.payload.state === 'working' &&
      previous.payload.agentType === enriched.payload.agentType &&
      previous.payload.prompt === enriched.payload.prompt &&
      now - previous.receivedAt < 15_000
    ) {
      return previous
    }
    this.runtimeObservedStatusPaneKeys.add(enriched.paneKey)
    this.state.lastStatusByPaneKey.set(enriched.paneKey, enriched)
    this.scheduleStatusPersist()
    this.notifyStatusChangeListeners()
    this.emitEnrichedStatus(enriched)
    return enriched
  }

  protected emitEnrichedStatus(enriched: EnrichedAgentHookEventPayload): void {
    this.onAgentStatus?.(enriched)
    for (const listener of this.enrichedStatusListeners) {
      try {
        listener(enriched)
      } catch (err) {
        console.error('[agent-status] listener threw', err)
      }
    }
  }

  protected clearAssistantMessageRetry(paneKey: string): void {
    const timer = this.assistantMessageRetryTimers.get(paneKey)
    if (timer) clearTimeout(timer)
    this.assistantMessageRetryTimers.delete(paneKey)
  }

  protected clearCodexSubagentPoll(paneKey: string): void {
    const timer = this.codexSubagentPollTimers.get(paneKey)
    if (timer) clearTimeout(timer)
    this.codexSubagentPollTimers.delete(paneKey)
  }

  protected scheduleCodexSubagentPoll(): void {}
  protected scheduleAssistantMessageRetry(): void {}
}
