/* import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  AGENT_STATE_HISTORY_MAX,
  agentSubagentsEqual,
  type AgentStateHistoryEntry,
  type AgentStatusEntry,
  type AgentStatusOrchestrationContext,
  type AgentType,
  type MigrationUnsupportedPtyEntry,
  type ParsedAgentStatusPayload
} from '../../../../shared/agent-status-types'
import {
  agentProviderSessionsEqual,
  getAgentResumeArgv,
  isResumableTuiAgent,
  type AgentProviderSessionMetadata,
  type ResumableTuiAgent,
  type SleepingAgentLaunchConfig,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import {
  resolveAgentStatusIdentity,
  shouldSuppressInheritedTerminalStatus
} from '../../../../shared/agent-status-identity'
import { isCommandCodeNewTurnWhileWorking } from '../../../../shared/command-code-turn-boundary'
import type { TerminalPaneLayoutNode, TerminalTab } from '../../../../shared/types'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId
} from '../../../../shared/execution-host'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'
import { readLastTerminalInputAt } from '@/lib/terminal-input-activity-coalescing'
import {
  getAgentRowGeneratedTitleText,
  getOrcaDispatchTaskId,
  isOrcaDispatchPrompt,
  orchestrationLabelsMatchLiveDispatch
} from '@/lib/agent-row-primary-text'
import { isCompletedPiCompatibleAgentWithLiveRecoveryRecord } from '@/lib/pi-compatible-live-recovery-record'
import {
  resolveAgentPaneAuthorityKey,
  retireAgentPaneAuthorityAliases,
  retireAgentPaneAuthorityAliasesByOwnerTab,
  transferAgentPaneAuthorityAlias
} from './agent-pane-authority'
import { createFreshnessScheduler } from './agent-status-freshness-scheduler'

/** Snapshot of a finished/vanished agent status entry, kept so the dashboard and sidebar hover
 *  keep showing the completion until the user clicks the worktree. `worktreeId` is stamped at
 *  retention time so the row's home is known even after its tab/pty is gone. */
import { MAX_RETAINED_AGENTS, capRetainedAgents, MAX_LIVE_AGENT_STATUSES, classifyPaneKeyLiveness, capLiveAgentStatusesInPlace, paneKeyMatchesAnyTabPrefix, isAgentCompletionState, getTabIdFromPaneKey, agentStatusTabAlreadyHasProtectedOrGeneratedTitle, getLeafIdFromPaneKey, findCompletedOrphanPaneKeysForTabClose, isRecentlyClosedAgentStatusTab, findAgentPaneWorktreeId, findTabForAgentEntry, getRetainedFallbackTab, retainedAgentEntryFromLive, shouldReplaceRetainedWithLive, normalizePaneKeySet, sleepingRecordFromEntry, normalizeSleepingAgentSessionCollectOptions, isValidManualSleepLiveAgentEntry, isValidCompletedAgentHibernationEntry, removeSleepingRecordsReplacedByManualWorktreeSleep, collectSleepingAgentSessionRecordsForWorktree, collectHibernatedCompletionEvidenceForWorktree, sleepingRecordsEquivalentIgnoringCaptureTime, recoveryRecordMatches, recoveryRecordTargetsSameSession, copyLaunchConfig, launchConfigsEqual, normalizeLaunchConfigRegistrationMetadata, launchConfigRegistryEntriesEqual, registryEntryMatchesStatus, getLaunchConfigForEntry, RECENTLY_CLOSED_AGENT_STATUS_TAB_IDS_MAX, RECENTLY_RETIRED_AGENT_STATUS_PANE_KEYS_MAX, boundRecentlyClosedAgentStatusTabIds, boundRecentlyRetiredAgentStatusPaneKeys, movePaneKeyedRecord, removePaneKeys, getLaunchConfigForStatusMetadata, pruneMigrationUnsupportedEntries, orchestrationContextsEqual, orchestrationMapsEqual, mergeCurrentOrchestrationContext, collectWorktreeIdsForConnection } from './agent-status-state'
import type { RetainedAgentEntry, AgentStatusWorktreeShutdownReason, AllAgentSessionCaptureMode, DropAgentStatusByWorktreeOptions, DropHibernatedAgentPaneOptions, DropAgentStatusByTabPrefixOptions, AgentLaunchConfigRegistrationMetadata, AgentLaunchConfigStatusMetadata, AgentLaunchConfigRegistryEntry, AgentStatusSlice, PaneLiveness, CollectSleepingAgentSessionRecordsOptions } from './agent-status-state'
type AgentStatusRuntime = {\n  freshness: { schedule: () => void }\n  clearSleepingAgentSessionsByPaneKey: (paneKeys: readonly string[]) => void\n}
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createAgentStatusSliceSetAgentStatusActions3(set: SliceSet, get: SliceGet, runtime: AgentStatusRuntime) {
  return {
    setAgentStatus: (paneKey, payload, terminalTitle, timing, routing, metadata) => {
      paneKey = resolveAgentPaneAuthorityKey(paneKey)
      const updatedAt = timing?.updatedAt ?? Date.now()
      if (
        paneKey in get().recentlyRetiredAgentStatusPaneKeys ||
        // Why: a closed tab is no longer a valid destination for hook replays or late status events.
        isRecentlyClosedAgentStatusTab(
          get().recentlyClosedAgentStatusTabIds,
          getTabIdFromPaneKey(paneKey)
        )
      ) {
        return
      }
      let completionRefreshWorktreeId: string | null = null
      let suppressedInheritedTerminalStatus = false
      const generatedTitleEntry: { current: AgentStatusEntry | null } = { current: null }
      set((s) => {
        const existing = s.agentStatusByPaneKey[paneKey]
        // Why: snapshots and live pushes share one timestamp source, so equal timestamps carry
        // identical data; strict < preserves same-millisecond live-after-live updates.
        if (existing && updatedAt < existing.updatedAt) {
          return s
        }
        // Why: terminalTitle labels the pane itself, not the turn, so a missing title means "no update" —
        // preserve the prior value to avoid flicker (unlike tool/prompt fields, which clear on a fresh turn).
        const effectiveTitle = terminalTitle ?? existing?.terminalTitle

        // Rolling log of state transitions for the dashboard's activity blocks; push only on
        // real state changes to avoid dupes from prompt-only pings within the same state.
        let history: AgentStateHistoryEntry[] = existing?.stateHistory ?? []
        if (existing && existing.state !== payload.state) {
          history = [
            ...history,
            {
              state: existing.state,
              prompt: existing.prompt,
              // Why: use stateStartedAt (not updatedAt) so the row reflects when the state was first reported, not the latest within-state ping.
              startedAt: existing.stateStartedAt,
              // Why: preserve the interrupt flag on the historical `done` entry so activity-block views can render past cancellations.
              interrupted: existing.interrupted
            }
          ]
          if (history.length > AGENT_STATE_HISTORY_MAX) {
            history = history.slice(history.length - AGENT_STATE_HISTORY_MAX)
          }
        }

        const identity = resolveAgentStatusIdentity({
          existing: existing
            ? {
                agentType: existing.agentType,
                state: existing.state,
                updatedAt: existing.updatedAt
              }
            : undefined,
          incoming: payload.agentType,
          now: updatedAt
        })
        // Why: Command Code has no UserPromptSubmit; a fresh transcript prompt while still `working` is the smart-sort turn boundary.
        const commandCodeNewTurn =
          existing !== undefined &&
          isCommandCodeNewTurnWhileWorking({
            agentType: identity.agentType,
            previousState: existing.state,
            incomingState: payload.state,
            previousPrompt: existing.prompt,
            incomingPrompt: payload.prompt,
            previousPromptInteractionKey: existing.promptInteractionKey,
            incomingPromptInteractionKey: payload.promptInteractionKey
          })
        const promptInteractionKey =
          payload.promptInteractionKey ??
          (payload.prompt === existing?.prompt ? existing?.promptInteractionKey : undefined)
        // Why: prefer main's authoritative stateStartedAt (attachStatusTiming persists it across
        // same-state pings and restart); fall back to existing only when main sent no timing, updatedAt for a new pane.
        const stateStartedAt =
          timing?.stateStartedAt ??
          (commandCodeNewTurn
            ? updatedAt
            : existing && existing.state === payload.state
              ? existing.stateStartedAt
              : updatedAt)
        if (
          existing &&
          shouldSuppressInheritedTerminalStatus({
            inheritedFromActivePane: identity.inheritedFromActivePane,
            incomingState: payload.state
          })
        ) {
          suppressedInheritedTerminalStatus = true
          return s
        }

        // Why: tool/assistant fields arrive pre-merged and authoritative from main (resolveToolState
        // in server.ts), so write them through directly — no fallback — so UserPromptSubmit clears stale tool lines.
        const runtimeOrchestration = s.runtimeAgentOrchestrationByPaneKey[paneKey]
        const runtimeMergedOrchestration = runtimeOrchestration
          ? mergeCurrentOrchestrationContext(existing?.orchestration, runtimeOrchestration)
          : undefined
        const payloadMergedOrchestration = payload.orchestration
          ? mergeCurrentOrchestrationContext(
              runtimeMergedOrchestration ?? existing?.orchestration,
              payload.orchestration
            )
          : undefined
        const completedFallbackOrchestration =
          payload.state === 'done' ? existing?.orchestration : undefined
        const orchestration =
          payloadMergedOrchestration ?? runtimeMergedOrchestration ?? completedFallbackOrchestration
        // Why: waiting/blocked are still the same resumable turn; child permission hooks omit the root session id.
        // Completing a turn does not end the provider session either — the TUI stays alive and resumable at its
        // prompt — so `done` must carry the id through, including done→done (OSC 9999 repaints and reconnect
        // snapshot replays both re-deliver a metadata-less `done` onto an already-done row). Without that, every
        // surface keyed on the id — mobile Chat UI transcripts, the resumable recovery anchor below — loses the
        // session while the agent sits idle, which is precisely when it is read (#10630). Only a new turn
        // (done→working) still drops it, so a reused pane cannot inherit a finished session.
        const canReuseExistingProviderSession =
          existing?.agentType === identity.agentType &&
          (existing.state !== 'done' || payload.state === 'done')
        const providerSession =
          metadata?.providerSession ??
          (canReuseExistingProviderSession ? existing.providerSession : undefined)
        const existingProviderSession = canReuseExistingProviderSession
          ? existing.providerSession
          : undefined
        const providerSessionChanged =
          Boolean(metadata?.providerSession && existingProviderSession) &&
          !agentProviderSessionsEqual(
            identity.agentType,
            metadata?.providerSession,
            existingProviderSession
          )
        const statusTabId =
          routing?.tabId ?? existing?.tabId ?? getTabIdFromPaneKey(paneKey) ?? undefined
        const statusTerminalHandle = routing?.terminalHandle ?? existing?.terminalHandle
        const registryEntry = s.agentLaunchConfigByPaneKey[paneKey]
        const matchedRegistryLaunchConfig = registryEntryMatchesStatus({
          entry: registryEntry,
          paneKey,
          agentType: identity.agentType,
          tabId: statusTabId,
          terminalHandle: statusTerminalHandle,
          launchToken: metadata?.launchToken,
          providerSession,
          existingProviderSession,
          providerSessionChanged
        })
          ? registryEntry?.launchConfig
          : undefined
        const existingSleepingRecord = s.sleepingAgentSessionsByPaneKey[paneKey]
        // Why: a completed turn leaves the TUI session alive and resumable at its prompt for any
        // resumable agent (Claude/Codex/Pi/…), not just Pi — so keep its persisted recovery anchor
        // even when done. Else a cold restore after an abrupt app death (macOS logout, #9454) drops
        // the pane to a bare shell instead of `--resume`-ing the agent logged in.
        const retainsResumableRecoveryIdentity =
          payload.state === 'done' &&
          isResumableTuiAgent(identity.agentType) &&
          providerSession !== undefined &&
          getAgentResumeArgv(identity.agentType, providerSession) !== null
        const matchedSleepingLaunchConfig =
          (payload.state !== 'done' || retainsResumableRecoveryIdentity) &&
          existingSleepingRecord?.launchConfig &&
          existingSleepingRecord.agent === identity.agentType &&
          providerSession &&
          agentProviderSessionsEqual(
            identity.agentType,
            existingSleepingRecord.providerSession,
            providerSession
          )
            ? existingSleepingRecord.launchConfig
            : undefined
        // Why: on a reused pane key, once the provider session changes the old launch registry must not bleed options into the new session.
        const launchConfigSource =
          (payload.state !== 'done' && !providerSessionChanged && metadata?.launchToken
            ? metadata?.launchConfig
            : undefined) ??
          matchedRegistryLaunchConfig ??
          matchedSleepingLaunchConfig
        const entry: AgentStatusEntry = {
          state: payload.state,
          prompt: payload.prompt,
          updatedAt,
          stateStartedAt,
          agentType: identity.agentType,
          model:
            payload.model ??
            (existing?.agentType === identity.agentType ? existing.model : undefined),
          paneKey,
          terminalHandle: statusTerminalHandle,
          worktreeId:
            routing?.worktreeId ??
            existing?.worktreeId ??
            findAgentPaneWorktreeId(s, paneKey) ??
            undefined,
          ...(routing?.connectionId !== undefined
            ? { connectionId: routing.connectionId }
            : existing?.connectionId !== undefined
              ? { connectionId: existing.connectionId }
              : {}),
          tabId: statusTabId,
          terminalTitle: effectiveTitle,
          stateHistory: history,
          toolName: payload.toolName,
          toolInput: payload.toolInput,
          // Why: full untruncated AskUserQuestion JSON so mobile/web can render the live prompt
          // card; parseAgentStatusPayload clears it on tool/state change.
          interactivePrompt: payload.interactivePrompt,
          lastAssistantMessage: payload.lastAssistantMessage,
          // Why: reused panes can start non-orchestrated work; only final done rows keep the
          // previous lineage fallback so completed children stay grouped.
          orchestration,
          // Why: reuse the prior array ref when the roster is unchanged so identity-comparing subscribers skip re-renders.
          subagents: agentSubagentsEqual(existing?.subagents, payload.subagents)
            ? existing?.subagents
            : payload.subagents,
          ...(providerSession ? { providerSession } : {}),
          ...(promptInteractionKey ? { promptInteractionKey } : {}),
          // Why: `interrupted` is done-only; parseAgentStatusPayload already clamps it for non-done states, so write it through directly.
          interrupted: payload.interrupted
        }
        generatedTitleEntry.current = entry
        if (
          isAgentCompletionState(entry.state) &&
          existing !== undefined &&
          !isAgentCompletionState(existing.state)
        ) {
          completionRefreshWorktreeId = entry.worktreeId ?? findAgentPaneWorktreeId(s, paneKey)
        }
        // Why: emit a global tick only when an entry appears, changes state, crosses stale→fresh,
        // or is a same-state `done` update — same-state working pings must not fan out to aggregates.
        const wasFresh =
          !!existing && isExplicitAgentStatusFresh(existing, updatedAt, AGENT_STATUS_STALE_AFTER_MS)
        // Why: a late main-process attribution stamp can change which workspace stays visible without changing agent state.
        const attributionChanged =
          existing?.worktreeId !== entry.worktreeId || existing?.tabId !== entry.tabId
        // Why: main can advance stateStartedAt on a same-state turn boundary the renderer
        // missed; treat that as sort-relevant so smart sort never goes stale.
        // Non-Command-Code agents never advance stateStartedAt at a fixed state, so this stays CC-scoped.
        const sameStateStateStartedAtChanged =
          !!existing &&
          existing.state === payload.state &&
          entry.stateStartedAt !== existing.stateStartedAt
        const sortRelevantChange =
          !existing ||
          existing.state !== payload.state ||
          !wasFresh ||
          attributionChanged ||
          commandCodeNewTurn ||
          sameStateStateStartedAtChanged
        const doneRetentionFieldsChanged =
          existing?.state === 'done' &&
          entry.state === 'done' &&
          (entry.prompt !== existing.prompt ||
            entry.updatedAt !== existing.updatedAt ||
            entry.stateStartedAt !== existing.stateStartedAt ||
            entry.agentType !== existing.agentType ||
            entry.model !== existing.model ||
            entry.terminalTitle !== existing.terminalTitle ||
            entry.toolName !== existing.toolName ||
            entry.toolInput !== existing.toolInput ||
            entry.lastAssistantMessage !== existing.lastAssistantMessage ||
            entry.orchestration !== existing.orchestration ||
            entry.subagents !== existing.subagents ||
            entry.providerSession !== existing.providerSession ||
            entry.interrupted !== existing.interrupted)
        const retentionRelevantChange =
          sortRelevantChange || attributionChanged || doneRetentionFieldsChanged
        // Why: a fresh status means the agent is live again — lift its one-shot retention suppressor.
        // Clone the map only when a suppressor exists, else every high-frequency ping churns the ref.
        const hasSuppressor = paneKey in s.retentionSuppressedPaneKeys
        let nextRetentionSuppressedPaneKeys = s.retentionSuppressedPaneKeys
        if (hasSuppressor) {
          nextRetentionSuppressedPaneKeys = { ...s.retentionSuppressedPaneKeys }
          delete nextRetentionSuppressedPaneKeys[paneKey]
        }
        // Why: pane keys are reused across turns, so a fresh live row makes any retained snapshot stale — drop it so it doesn't render beside the live row.
        const hasRetainedSnapshot = paneKey in s.retainedAgentsByPaneKey
        const nextRetainedAgents = hasRetainedSnapshot
          ? { ...s.retainedAgentsByPaneKey }
          : s.retainedAgentsByPaneKey
        if (hasRetainedSnapshot) {
          delete nextRetainedAgents[paneKey]
        }
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey === paneKey
        )
        const liveRecoveryWorktreeId =
          entry.state === 'done' && !retainsResumableRecoveryIdentity
            ? null
            : (entry.worktreeId ?? findAgentPaneWorktreeId(s, entry.paneKey))
        const liveRecoveryRecord = liveRecoveryWorktreeId
          ? sleepingRecordFromEntry({
              state: s,
              // Why: a completed resumable-agent turn leaves the TUI session alive — keep resume identity active without representing done as pending work.
              entry: retainsResumableRecoveryIdentity
                ? { ...entry, state: 'working', prompt: '', lastAssistantMessage: undefined }
                : entry,
              worktreeId: liveRecoveryWorktreeId,
              capturedAt: updatedAt,
              launchConfig: launchConfigSource,
              origin: 'live'
            })
          : null
        let nextSleepingAgentSessions = s.sleepingAgentSessionsByPaneKey
        let nextLaunchConfigs = s.agentLaunchConfigByPaneKey
        if (
          matchedRegistryLaunchConfig &&
          registryEntry &&
          providerSession &&
          !agentProviderSessionsEqual(
            identity.agentType,
            registryEntry.identity.providerSession,
            providerSession
          )
        ) {
          nextLaunchConfigs = {
            ...nextLaunchConfigs,
            [paneKey]: {
              ...registryEntry,
              identity: {
                ...registryEntry.identity,
                providerSession
              }
            }
          }
        }
        // Why: launch tokens can outlive an Orca-started TUI in the shell; once the session is done they must no longer authorize config reuse.
        if (
          (providerSessionChanged || entry.state === 'done') &&
          paneKey in s.agentLaunchConfigByPaneKey
        ) {
          nextLaunchConfigs = { ...s.agentLaunchConfigByPaneKey }
          delete nextLaunchConfigs[paneKey]
        }
        if (liveRecoveryRecord) {
          if (!recoveryRecordMatches(existingSleepingRecord, liveRecoveryRecord)) {
            nextSleepingAgentSessions = {
              ...s.sleepingAgentSessionsByPaneKey,
              [paneKey]: liveRecoveryRecord
            }
          }
        } else if (existingSleepingRecord) {
          nextSleepingAgentSessions = { ...s.sleepingAgentSessionsByPaneKey }
          delete nextSleepingAgentSessions[paneKey]
        }
        const nextLive = { ...s.agentStatusByPaneKey, [paneKey]: entry }
        // Why: cap the live map so a huge map's per-ping spread copy can't OOM the renderer (#9872).
        const evictedPaneKeys = capLiveAgentStatusesInPlace(
          nextLive,
          paneKey,
          () => classifyPaneKeyLiveness(s),
          updatedAt
        )
        const evictedOrphans = evictedPaneKeys.length > 0
        if (evictedOrphans) {
          const evictedPaneKeySet = new Set(evictedPaneKeys)
          nextSleepingAgentSessions = removePaneKeys(nextSleepingAgentSessions, evictedPaneKeySet)
          nextLaunchConfigs = removePaneKeys(nextLaunchConfigs, evictedPaneKeySet)
        }
        return {
          agentStatusByPaneKey: nextLive,
          retainedAgentsByPaneKey: nextRetainedAgents,
          sleepingAgentSessionsByPaneKey: nextSleepingAgentSessions,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          retentionSuppressedPaneKeys: nextRetentionSuppressedPaneKeys,
          agentStatusEpoch:
            retentionRelevantChange || migrationUnsupported.changed || evictedOrphans
              ? s.agentStatusEpoch + 1
              : s.agentStatusEpoch,
          sortEpoch:
            sortRelevantChange || migrationUnsupported.changed || evictedOrphans
              ? s.sortEpoch + 1
              : s.sortEpoch
        }
      })
      if (suppressedInheritedTerminalStatus) {
        return
      }
      const entryForGeneratedTitle = generatedTitleEntry.current
      if (entryForGeneratedTitle) {
        // Why: sticky orchestration (~30m) can outlive the dispatch turn, so replace the title on matching labels or a re-dispatch's mismatched taskId.
        const hasMatchingOrchestrationLabels = Boolean(
          (entryForGeneratedTitle.orchestration?.displayName?.trim() ||
            entryForGeneratedTitle.orchestration?.taskTitle?.trim()) &&
          orchestrationLabelsMatchLiveDispatch(entryForGeneratedTitle)
        )
        const liveIsDispatchPrompt = isOrcaDispatchPrompt(entryForGeneratedTitle.prompt)
        const liveDispatchTaskId = liveIsDispatchPrompt
          ? getOrcaDispatchTaskId(entryForGeneratedTitle.prompt)
          : null
        const stickyOrchestrationTaskId =
          entryForGeneratedTitle.orchestration?.taskId?.trim() || null
        const isNewDispatchAgainstStickyOrchestration = Boolean(
          liveDispatchTaskId &&
          stickyOrchestrationTaskId &&
          liveDispatchTaskId !== stickyOrchestrationTaskId
        )
        const shouldReplaceGeneratedTitle =
          hasMatchingOrchestrationLabels || isNewDispatchAgainstStickyOrchestration
        // Why: setAgentStatus is high-frequency, so only parse dispatch preambles when a title write is actually possible.
        const mayWriteGeneratedTitle =
          get().settings?.tabAutoGenerateTitle === true &&
          (shouldReplaceGeneratedTitle ||
            !agentStatusTabAlreadyHasProtectedOrGeneratedTitle(
              get(),
              entryForGeneratedTitle.tabId ?? getTabIdFromPaneKey(paneKey),
              entryForGeneratedTitle.worktreeId
            ))
        const generatedTitlePrompt =
          liveIsDispatchPrompt && mayWriteGeneratedTitle
            ? getAgentRowGeneratedTitleText(entryForGeneratedTitle)
            : entryForGeneratedTitle.prompt
        if (shouldReplaceGeneratedTitle) {
          get().setGeneratedTabTitleFromAgentPrompt(paneKey, generatedTitlePrompt, {
            replaceExistingGeneratedTitle: true
          })
        } else {
          get().setGeneratedTabTitleFromAgentPrompt(paneKey, generatedTitlePrompt)
        }
      }
      // Why: schedule via queueMicrotask after set so the timer reads the updated map without re-entering the store during set.
      queueMicrotask(() => runtime.freshness.schedule())
      if (completionRefreshWorktreeId) {
        const worktreeId = completionRefreshWorktreeId
        // Why: agents can create a PR via `gh pr create`, bypassing Orca's flow and leaving a stale "no PR" cache entry in place.
        queueMicrotask(() => get().refreshGitHubForWorktreeIfStale(worktreeId))
      }
    },
  }
}