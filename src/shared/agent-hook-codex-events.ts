import type { CodexLeadTurnState, HookListenerState } from './agent-hook-state'

import { normalizeAgentStatusPayload, type ParsedAgentStatusPayload } from './agent-status-types'
import * as state from './agent-hook-state'
import * as request from './agent-hook-request-body'
import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
import * as policy from './agent-hook-event-policy'
const { resolvePrompt, resolveToolState, readString, readFirstString } = prompt
const { isNewTurnEvent, extractToolFields } = policy
import {
  codexRosterEffectiveState,
  codexRosterToSnapshots,
  finishCodexSubagent,
  seedCodexSubagentRoster,
  upsertCodexSubagent
} from './codex-subagent-roster'
import {
  createCodexSubagentTranscriptState,
  hasTrackedCodexTranscriptSubagents,
  reconcileCodexSubagentTranscript
} from './codex-subagent-transcript'

export function getOrCreateCodexSubagentRoster(
  state: HookListenerState,
  paneKey: string
): CodexSubagentRoster {
  let roster = state.codexSubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = new Map()
    state.codexSubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

export function getOrCreateCodexSubagentTranscriptState(
  state: HookListenerState,
  paneKey: string
): CodexSubagentTranscriptState {
  let transcriptState = state.codexSubagentTranscriptByPaneKey.get(paneKey)
  if (!transcriptState) {
    transcriptState = createCodexSubagentTranscriptState()
    state.codexSubagentTranscriptByPaneKey.set(paneKey, transcriptState)
  }
  return transcriptState
}

export function hasCodexTranscriptSubagents(state: HookListenerState, paneKey: string): boolean {
  return hasTrackedCodexTranscriptSubagents(state.codexSubagentTranscriptByPaneKey.get(paneKey))
}

export function seedCodexStateFromSnapshot(
  state: HookListenerState,
  paneKey: string,
  payload: Pick<ParsedAgentStatusPayload, 'model' | 'state' | 'subagents'>
): void {
  const snapshots = payload.subagents ?? []
  if (snapshots.length > 0 && !state.codexSubagentRosterByPaneKey.has(paneKey)) {
    seedCodexSubagentRoster(getOrCreateCodexSubagentRoster(state, paneKey), snapshots)
  }
  if (!state.codexLeadStateByPaneKey.has(paneKey)) {
    // Why: child hooks after restart omit the root model; seed it from durable status before they can overwrite the cache.
    state.codexLeadStateByPaneKey.set(paneKey, {
      // Why: a child wait drives the aggregate waiting state, so it is not evidence that the root itself was waiting.
      state:
        payload.state === 'done'
          ? 'done'
          : payload.state === 'waiting' &&
              !snapshots.some((snapshot) => snapshot.state === 'waiting')
            ? 'waiting'
            : 'working',
      model: payload.model
    })
  }
}

/** Sync the Codex lead record when the server infers an interrupt, so delayed child events cannot restore stale working state. */
export function markCodexLeadTurnInterrupted(state: HookListenerState, paneKey: string): void {
  const lead = state.codexLeadStateByPaneKey.get(paneKey)
  state.codexLeadStateByPaneKey.set(paneKey, { state: 'done', model: lead?.model })
}

export function codexLeadStateForHookEvent(
  eventName: string | undefined
): CodexLeadTurnState['state'] | undefined {
  if (eventName === 'Stop') {
    return 'done'
  }
  if (eventName === 'PermissionRequest') {
    return 'waiting'
  }
  if (
    eventName === 'SessionStart' ||
    eventName === 'UserPromptSubmit' ||
    eventName === 'PreToolUse' ||
    eventName === 'PostToolUse'
  ) {
    return 'working'
  }
  return undefined
}

/** Why: relay restarts lose lead/roster state; merge child events into main's longer-lived cache. */
export function reconcileRemoteCodexState(
  state: HookListenerState,
  paneKey: string,
  eventName: string | undefined,
  agentId: string | undefined,
  payload: ParsedAgentStatusPayload,
  previous: ParsedAgentStatusPayload | undefined
): ParsedAgentStatusPayload {
  if (previous?.agentType === 'codex') {
    seedCodexStateFromSnapshot(state, paneKey, previous)
  } else {
    seedCodexStateFromSnapshot(state, paneKey, payload)
  }

  // Why: older relays send child identity without roster snapshots; keep their already-normalized aggregate authoritative.
  if (agentId && !payload.subagents && !state.codexSubagentRosterByPaneKey.has(paneKey)) {
    return payload
  }
  const roster = getOrCreateCodexSubagentRoster(state, paneKey)
  if (payload.subagents) {
    seedCodexSubagentRoster(roster, payload.subagents)
  }
  if (agentId) {
    if (eventName === 'SubagentStop') {
      finishCodexSubagent(roster, agentId)
    }
  } else {
    const leadState = codexLeadStateForHookEvent(eventName)
    if (eventName === 'SessionStart' || (eventName === 'Stop' && !payload.subagents)) {
      roster.clear()
    }
    if (leadState) {
      const previousLead = state.codexLeadStateByPaneKey.get(paneKey)
      state.codexLeadStateByPaneKey.set(paneKey, {
        state: leadState,
        model: payload.model ?? previousLead?.model
      })
    }
  }

  const lead = state.codexLeadStateByPaneKey.get(paneKey)
  if (!lead) {
    return payload
  }
  return {
    ...payload,
    state: codexRosterEffectiveState(roster, lead.state),
    model: lead.model ?? payload.model,
    subagents: codexRosterToSnapshots(roster)
  }
}

export function buildCodexStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  options: { stateName: 'working' | 'waiting' | 'done'; updateLead: boolean }
): ParsedAgentStatusPayload | null {
  const snapshot = options.updateLead
    ? resolveToolState(state, paneKey, extractToolFields('codex', eventName, hookPayload), {
        resetOnNewTurn: isNewTurnEvent('codex', eventName)
      })
    : (state.lastToolByPaneKey.get(paneKey) ?? {})
  const lead = state.codexLeadStateByPaneKey.get(paneKey)

  return normalizeAgentStatusPayload({
    state: options.stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: options.updateLead && isNewTurnEvent('codex', eventName)
    }),
    agentType: 'codex',
    model: lead?.model,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    subagents: codexRosterToSnapshots(state.codexSubagentRosterByPaneKey.get(paneKey))
  })
}

export function buildCodexChildDrivenStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const leadState = state.codexLeadStateByPaneKey.get(paneKey)?.state ?? 'working'
  const stateName = codexRosterEffectiveState(
    state.codexSubagentRosterByPaneKey.get(paneKey),
    leadState
  )
  return buildCodexStatusPayload(state, eventName, '', paneKey, hookPayload, {
    stateName,
    updateLead: false
  })
}

export function normalizeCodexSubagentLifecycleEvent(
  state: HookListenerState,
  eventName: 'SubagentStart' | 'SubagentStop',
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const agentId = readString(hookPayload, 'agent_id')
  if (!agentId) {
    return null
  }
  const roster = getOrCreateCodexSubagentRoster(state, paneKey)
  if (eventName === 'SubagentStart') {
    upsertCodexSubagent(
      roster,
      agentId,
      {
        agentType: readString(hookPayload, 'agent_type'),
        model: readString(hookPayload, 'model'),
        state: 'working'
      },
      Date.now()
    )
  } else {
    finishCodexSubagent(roster, agentId)
  }
  return buildCodexChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
}

export function normalizeCodexEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (eventName === 'SubagentStart' || eventName === 'SubagentStop') {
    return normalizeCodexSubagentLifecycleEvent(state, eventName, paneKey, hookPayload)
  }

  // Why: Codex's request_user_input (0.145+) is auto-allowed, so it fires PreToolUse while blocked on a human answer; map to waiting like grok's ask_user_question.
  const isUserInputPreTool =
    eventName === 'PreToolUse' &&
    isAskUserQuestionTool(readString(hookPayload, 'tool_name') ?? readString(hookPayload, 'name'))
  const stateName =
    eventName === 'SessionStart' ||
    eventName === 'UserPromptSubmit' ||
    (eventName === 'PreToolUse' && !isUserInputPreTool) ||
    eventName === 'PostToolUse'
      ? 'working'
      : eventName === 'PermissionRequest' || isUserInputPreTool
        ? 'waiting'
        : eventName === 'Stop'
          ? 'done'
          : null
  if (!stateName) {
    return null
  }

  const agentId = readString(hookPayload, 'agent_id')
  if (agentId) {
    upsertCodexSubagent(
      getOrCreateCodexSubagentRoster(state, paneKey),
      agentId,
      {
        agentType: readString(hookPayload, 'agent_type'),
        model: readString(hookPayload, 'model'),
        state: stateName === 'waiting' ? 'waiting' : 'working'
      },
      Date.now()
    )
    return buildCodexChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
  }

  if (eventName === 'SessionStart') {
    // Why: a pane can host a new Codex process after the old one exited without child Stop hooks.
    state.codexSubagentRosterByPaneKey.delete(paneKey)
    state.codexSubagentTranscriptByPaneKey.delete(paneKey)
  }
  const transcriptPath = readFirstString(hookPayload, ['transcript_path', 'transcriptPath'])
  if (transcriptPath) {
    reconcileCodexSubagentTranscript(
      getOrCreateCodexSubagentTranscriptState(state, paneKey),
      getOrCreateCodexSubagentRoster(state, paneKey),
      transcriptPath
    )
  }
  if (eventName === 'Stop' && !hasCodexTranscriptSubagents(state, paneKey)) {
    // Why: Codex CLI 0.144 can omit child Stop hooks; later child activity safely recreates any agent still running.
    state.codexSubagentRosterByPaneKey.delete(paneKey)
  }
  const previousLead = state.codexLeadStateByPaneKey.get(paneKey)
  state.codexLeadStateByPaneKey.set(paneKey, {
    state: stateName,
    model:
      normalizeOptionalField(hookPayload['model'], AGENT_MODEL_MAX_LENGTH) ??
      (eventName === 'SessionStart' ? undefined : previousLead?.model)
  })
  const effectiveState = codexRosterEffectiveState(
    state.codexSubagentRosterByPaneKey.get(paneKey),
    stateName
  )
  return buildCodexStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
    stateName: effectiveState,
    updateLead: true
  })
}
