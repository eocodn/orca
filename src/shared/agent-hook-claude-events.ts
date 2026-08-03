import type { ClaudeLeadTurnState, HookListenerState } from './agent-hook-state'

import { normalizeAgentStatusPayload, type AgentStatusState, type ParsedAgentStatusPayload } from './agent-status-types'
import * as state from './agent-hook-state'
import * as request from './agent-hook-request-body'
import * as prompt from './agent-hook-prompt-tools'
import * as transcript from './agent-hook-transcript'
import * as policy from './agent-hook-event-policy'
const { resolvePrompt, resolveToolState, readString } = prompt
const { isNewTurnEvent, extractToolFields } = policy
import {
  claudeRosterHasWorkingSubagent,
  claudeRosterToSnapshots,
  claudeTeammateIdMatchesName,
  foldClaudeBackgroundTasksIntoRoster,
  idleClaudeTeammateByName,
  readClaudeBackgroundAgentTasks,
  reapRestoredClaudeSubagentsWithoutLiveAgent,
  stopClaudeSubagent,
  upsertWorkingClaudeSubagent
} from './claude-subagent-roster'

export function getOrCreateClaudeSubagentRoster(
  state: HookListenerState,
  paneKey: string
): ClaudeSubagentRoster {
  let roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = new Map()
    state.claudeSubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

/** SubagentStart/Stop/TeammateIdle update the roster and re-emit the lead's last known state with the fresh child list, so the sidebar reflects spawn/finish even when a background child outlives the lead turn with no other hook traffic. */
export function normalizeClaudeSubagentLifecycleEvent(
  state: HookListenerState,
  eventName: 'SubagentStart' | 'SubagentStop' | 'TeammateIdle',
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const lifecycleField = eventName === 'TeammateIdle' ? 'teammate_name' : 'agent_id'
  const lifecycleId = readString(hookPayload, lifecycleField)
  if (!lifecycleId) {
    return null
  }
  const roster = getOrCreateClaudeSubagentRoster(state, paneKey)
  if (eventName === 'TeammateIdle') {
    const teammateName = lifecycleId
    // Why: on claude 2.1.21x teammates are turn-based — TeammateIdle means "turn over, awaiting mail", not finished. The row parks as idle (confirmed teammate) instead of leaving, so the sidebar keeps showing resumable children.
    idleClaudeTeammateByName(roster, teammateName)
    clearClaudePendingWaitForAgent(state, paneKey, (waitingAgentId) =>
      claudeTeammateIdMatchesName(waitingAgentId, teammateName)
    )
  } else {
    const agentId = lifecycleId
    if (eventName === 'SubagentStart') {
      upsertWorkingClaudeSubagent(
        roster,
        agentId,
        { agentType: readString(hookPayload, 'agent_type') },
        Date.now()
      )
    } else {
      // Why: one-shot stops are true finishes (row removed); teammate-shaped stops are turn ends on 2.1.21x — the row parks idle and a later SubagentStart revives it.
      stopClaudeSubagent(roster, agentId)
      // Why: a blocked child that dies without another tool event would pin its permission/question wait on the pane forever — nothing else references that agent again.
      clearClaudePendingWaitForAgent(state, paneKey, (waitingAgentId) => waitingAgentId === agentId)
    }
  }
  return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
}

/** Sync the Claude lead-turn record when the SERVER infers an interrupt outside the hook stream (Ctrl+C with a missed Stop); else a later child lifecycle event resurrects the cancelled pane. */
export function markClaudeLeadTurnInterrupted(state: HookListenerState, paneKey: string): void {
  state.claudeLeadStateByPaneKey.set(paneKey, { state: 'done', interrupted: true })
}

/** Rebuild a pane's working roster from a persisted snapshot; live activity confirms a seed, a complete task inventory may reap an unconfirmed one whose finish hook arrived while Orca was offline. */
export function seedClaudeSubagentRosterFromSnapshots(
  state: HookListenerState,
  paneKey: string,
  snapshots: readonly AgentSubagentSnapshot[]
): void {
  if (snapshots.length === 0 || state.claudeSubagentRosterByPaneKey.has(paneKey)) {
    return
  }
  const roster = getOrCreateClaudeSubagentRoster(state, paneKey)
  for (const snapshot of snapshots) {
    // Why: idle-teammate liveness can't be proven across a restart (its TeammateIdle confirmation is gone); only working seeds restore, and a live teammate re-earns its row via SubagentStart.
    if (snapshot.state !== 'working') {
      continue
    }
    roster.set(snapshot.id, {
      state: 'working',
      startedAt: snapshot.startedAt,
      agentType: snapshot.agentType,
      description: snapshot.description,
      // Why: the seed can be a phantom (child finished while Orca was down, SubagentStop lost); let a PRESENT background_tasks list omitting the id remove it, not gate the pane 'working' forever.
      backgroundTasksAuthoritative: true,
      // Why: an idle parent never emits that list, so the inventory reap alone can strand the seed; mark it for the liveness reap below.
      restoredFromSnapshot: true
    })
  }
}

/** Reap this pane's unconfirmed restored seeds because no live agent process backs
 *  the pane any more (its PTY died while Orca was down, so no finish hook could
 *  arrive). Callers must have proven the pane is LOCAL-launched — a remote/SSH
 *  agent runs on the far host and can never appear in a local process index.
 *  Returns whether the roster changed. */
export function reapRestoredClaudeSubagentsForDeadPane(
  state: HookListenerState,
  paneKey: string
): boolean {
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  if (!roster || !reapRestoredClaudeSubagentsWithoutLiveAgent(roster)) {
    return false
  }
  if (roster.size === 0) {
    state.claudeSubagentRosterByPaneKey.delete(paneKey)
  }
  return true
}

/** Drop a child-owned waiting state when the child stops/idles, restoring the displaced lead state; without a stash, fall back to 'working' (a transient spinner beats a permanently stuck card). */
export function clearClaudePendingWaitForAgent(
  state: HookListenerState,
  paneKey: string,
  ownsWait: (waitingAgentId: string) => boolean
): void {
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  if (lead?.state !== 'waiting' || !lead.waitingAgentId || !ownsWait(lead.waitingAgentId)) {
    return
  }
  state.claudeLeadStateByPaneKey.set(paneKey, lead.stateBeforeWait ?? { state: 'working' })
}

/** Clear an AskUserQuestion wait after the answer is typed (answering emits no hook event; the caller infers it from the submit keystroke). Restores the stashed pre-wait lead state or 'working', drops the cached card, and returns the pane state to emit (gated up to 'working' while children run). */
export function clearClaudeAnsweredQuestionWait(
  state: HookListenerState,
  paneKey: string
): Pick<ClaudeLeadTurnState, 'state' | 'interrupted'> {
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  const restored =
    lead?.state === 'waiting'
      ? (lead.stateBeforeWait ?? { state: 'working' as const })
      : { state: 'working' as const }
  state.claudeLeadStateByPaneKey.set(paneKey, { ...restored })
  const previousTool = state.lastToolByPaneKey.get(paneKey)
  state.lastToolByPaneKey.set(
    paneKey,
    previousTool?.lastAssistantMessage
      ? { lastAssistantMessage: previousTool.lastAssistantMessage }
      : {}
  )
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  return restored.state === 'done' && claudeRosterHasWorkingSubagent(roster)
    ? { state: 'working' }
    : restored
}

/** Re-emit the lead's cached state on child activity — gated up to 'working' while a child works — without touching the lead's tool/prompt caches, so a live card or permission wait survives child churn. */
export function buildClaudeChildDrivenStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  // Why: default 'working' — a spawn proves activity even before the lead's first state-bearing event (e.g. Orca restarted mid-session).
  const lead = state.claudeLeadStateByPaneKey.get(paneKey)
  const leadState = lead?.state ?? 'working'
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  return buildClaudeStatusPayload(state, eventName, '', paneKey, hookPayload, {
    stateName:
      leadState === 'done' && claudeRosterHasWorkingSubagent(roster) ? 'working' : leadState,
    updateToolSnapshot: false,
    interrupted: lead?.interrupted
  })
}

export function normalizeClaudeEvent(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (
    eventName === 'SubagentStart' ||
    eventName === 'SubagentStop' ||
    eventName === 'TeammateIdle'
  ) {
    return normalizeClaudeSubagentLifecycleEvent(state, eventName, paneKey, hookPayload)
  }

  // Why: Claude's auto-allowed AskUserQuestion emits PreToolUse (not PermissionRequest; its Notification hook isn't registered) while blocked on a human answer.
  // Treat that PreToolUse as waiting so the sidebar shows amber attention, not a spinner that decays to grey. Mirrors normalizeKimiEvent.
  const isAskUserQuestion =
    eventName === 'PreToolUse' && isAskUserQuestionTool(readString(hookPayload, 'tool_name'))
  const stateName =
    eventName === 'UserPromptSubmit' ||
    eventName === 'PostToolUse' ||
    eventName === 'PostToolUseFailure' ||
    (eventName === 'PreToolUse' && !isAskUserQuestion)
      ? 'working'
      : eventName === 'PermissionRequest' || isAskUserQuestion
        ? 'waiting'
        : eventName === 'Stop' || eventName === 'StopFailure'
          ? 'done'
          : null

  if (!stateName) {
    return null
  }

  const eventAgentId = readString(hookPayload, 'agent_id')
  // Why: subagent/teammate events carry `agent_id` (lead's don't); child tool activity keeps its row live but must not become the lead's state or overwrite its tool/prompt caches (a live card would vanish).
  // Two exceptions take the full path below: waiting-inducing events (a child needs human attention on this pane) and the blocked child's own next tool event (approval granted — clear the wait as for the lead).
  const isWaitingInducing = stateName === 'waiting'
  const subagentOriginId =
    !isWaitingInducing &&
    (eventName === 'PreToolUse' ||
      eventName === 'PostToolUse' ||
      eventName === 'PostToolUseFailure')
      ? eventAgentId
      : undefined
  if (eventAgentId && (subagentOriginId || isWaitingInducing)) {
    upsertWorkingClaudeSubagent(
      getOrCreateClaudeSubagentRoster(state, paneKey),
      eventAgentId,
      { agentType: readString(hookPayload, 'agent_type') },
      Date.now()
    )
  }
  if (subagentOriginId) {
    const lead = state.claudeLeadStateByPaneKey.get(paneKey)
    if (lead?.state !== 'waiting' || lead.waitingAgentId !== subagentOriginId) {
      return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
    }
    // Why: approval granted — update the tool snapshot (drop the pending card) as the lead's own next tool event would.
    // Restore the stashed lead state, not this child's 'working': the lead may already be done, and the done-gate never upgrades working back to done once the roster drains.
    const restored = lead.stateBeforeWait ?? { state: 'working' as const }
    state.claudeLeadStateByPaneKey.set(paneKey, restored)
    const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
    return buildClaudeStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
      stateName:
        restored.state === 'done' && claudeRosterHasWorkingSubagent(roster)
          ? 'working'
          : restored.state,
      updateToolSnapshot: true,
      interrupted: restored.interrupted
    })
  }

  // Why: lead events never carry agent_id, so a known child's id on a turn-boundary event must not retire/resurrect the pane as if the lead spoke — re-emit as child activity.
  if (
    eventAgentId &&
    !isWaitingInducing &&
    state.claudeSubagentRosterByPaneKey.get(paneKey)?.has(eventAgentId)
  ) {
    return buildClaudeChildDrivenStatusPayload(state, eventName, paneKey, hookPayload)
  }

  if (eventName === 'Stop' || eventName === 'StopFailure') {
    // Why: background_tasks is trusted only where unambiguous (see foldClaudeBackgroundTasksIntoRoster) — teammates report "running" here even while idle.
    // Older Claude builds without the field keep the incrementally tracked roster.
    const backgroundTasks = readClaudeBackgroundAgentTasks(hookPayload)
    if (backgroundTasks.present) {
      foldClaudeBackgroundTasksIntoRoster(
        getOrCreateClaudeSubagentRoster(state, paneKey),
        backgroundTasks.tasks,
        Date.now(),
        { inventoryComplete: !backgroundTasks.truncated }
      )
    }
  }
  const interrupted =
    eventName === 'Stop' && hookPayload['is_interrupt'] === true ? true : undefined
  // Why: a child-induced wait displaces the lead state; stash it so clearing restores reality (lead may be done). A 2nd child wait carries the ORIGINAL stash, not the intermediate waiting state.
  const previousLead = state.claudeLeadStateByPaneKey.get(paneKey)
  const stateBeforeWait =
    isWaitingInducing && eventAgentId && previousLead
      ? previousLead.state === 'waiting'
        ? previousLead.stateBeforeWait
        : {
            state: previousLead.state,
            ...(previousLead.interrupted ? { interrupted: true as const } : {})
          }
      : undefined
  state.claudeLeadStateByPaneKey.set(paneKey, {
    state: stateName,
    ...(interrupted ? { interrupted } : {}),
    ...(isWaitingInducing && eventAgentId ? { waitingAgentId: eventAgentId } : {}),
    ...(stateBeforeWait ? { stateBeforeWait } : {})
  })

  // Why: a lead Stop isn't "done" while subagents/teammates run (would show a finished row mid-flight); Claude re-wakes the lead, so a later empty-roster Stop resolves to done.
  const roster = state.claudeSubagentRosterByPaneKey.get(paneKey)
  const effectiveState =
    stateName === 'done' && claudeRosterHasWorkingSubagent(roster) ? 'working' : stateName

  return buildClaudeStatusPayload(state, eventName, promptText, paneKey, hookPayload, {
    stateName: effectiveState,
    updateToolSnapshot: true,
    interrupted
  })
}

export function buildClaudeStatusPayload(
  state: HookListenerState,
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>,
  options: { stateName: AgentStatusState; updateToolSnapshot: boolean; interrupted?: boolean }
): ParsedAgentStatusPayload | null {
  // Why: child-driven refreshes are roster bookkeeping, not lead tool activity; read the cached snapshot without merging so they can't clear a live AskUserQuestion card or clobber the tool preview.
  const snapshot = options.updateToolSnapshot
    ? resolveToolState(state, paneKey, extractToolFields('claude', eventName, hookPayload), {
        resetOnNewTurn: isNewTurnEvent('claude', eventName)
      })
    : (state.lastToolByPaneKey.get(paneKey) ?? {})

  // Why: validate directly — the JSON stringify/parse round trip other normalizers use is pure overhead on this hot per-hook path.
  // The normalizer clamps `interrupted` to done payloads, so a gated 'working' emit drops it; claudeLeadStateByPaneKey preserves it for the eventual done.
  return normalizeAgentStatusPayload({
    state: options.stateName,
    // Why: only lead-origin events may reset the prompt cache; a child-driven refresh must not blank the lead's prompt label.
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: options.updateToolSnapshot && isNewTurnEvent('claude', eventName)
    }),
    agentType: 'claude',
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    interrupted: options.interrupted,
    subagents: claudeRosterToSnapshots(state.claudeSubagentRosterByPaneKey.get(paneKey))
  })
}

// Why: Devin uses Claude-compatible payloads but its own lifecycle event set; normalize those event names while keeping Devin attribution.
