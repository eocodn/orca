 import type { StateCreator } from 'zustand'
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
type AgentStatusRuntime = {
  freshness: { schedule: () => void }
  clearSleepingAgentSessionsByPaneKey: (paneKeys: readonly string[]) => void
}
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createAgentStatusSliceClearAgentLaunchConfigActions2(set: SliceSet, get: SliceGet, runtime: AgentStatusRuntime) {
  return {
    clearAgentLaunchConfig: (paneKey) => {
      set((s) => {
        if (!(paneKey in s.agentLaunchConfigByPaneKey)) {
          return s
        }
        const nextLaunchConfigs = { ...s.agentLaunchConfigByPaneKey }
        delete nextLaunchConfigs[paneKey]
        return { agentLaunchConfigByPaneKey: nextLaunchConfigs }
      })
    },
    recordAgentProviderSession: (paneKey, agent, providerSession, timing, routing, metadata) => {
      paneKey = resolveAgentPaneAuthorityKey(paneKey)
      const updatedAt = timing?.updatedAt ?? Date.now()
      if (
        paneKey in get().recentlyRetiredAgentStatusPaneKeys ||
        isRecentlyClosedAgentStatusTab(
          get().recentlyClosedAgentStatusTabIds,
          getTabIdFromPaneKey(paneKey)
        ) ||
        !getAgentResumeArgv(agent, providerSession)
      ) {
        return
      }
      let removedLiveStatus = false
      set((s) => {
        const existingStatus = s.agentStatusByPaneKey[paneKey]
        const existingRecord = s.sleepingAgentSessionsByPaneKey[paneKey]
        if (
          (existingStatus && updatedAt < existingStatus.updatedAt) ||
          (existingRecord && updatedAt < existingRecord.updatedAt)
        ) {
          return s
        }
        const tabId = routing?.tabId ?? getTabIdFromPaneKey(paneKey) ?? existingRecord?.tabId
        const worktreeId =
          routing?.worktreeId ??
          existingStatus?.worktreeId ??
          existingRecord?.worktreeId ??
          findAgentPaneWorktreeId(s, paneKey)
        if (!worktreeId) {
          return s
        }
        const registryEntry = s.agentLaunchConfigByPaneKey[paneKey]
        const registryMatches = registryEntryMatchesStatus({
          entry: registryEntry,
          paneKey,
          agentType: agent,
          tabId,
          terminalHandle: undefined,
          launchToken: metadata?.launchToken,
          providerSession,
          existingProviderSession: existingRecord?.providerSession,
          providerSessionChanged: false
        })
        const existingRecordMatchesProviderSession =
          existingRecord?.agent === agent &&
          agentProviderSessionsEqual(agent, existingRecord.providerSession, providerSession)
        const launchConfig =
          (registryMatches ? registryEntry?.launchConfig : undefined) ??
          (existingRecordMatchesProviderSession ? existingRecord.launchConfig : undefined)
        const record: SleepingAgentSessionRecord = {
          paneKey,
          ...(tabId ? { tabId } : {}),
          worktreeId,
          agent,
          providerSession,
          prompt: '',
          // Why: durable process/session identity, not visible turn state; a non-done value keeps cold restore eligible.
          state: 'working',
          capturedAt: updatedAt,
          updatedAt,
          ...(existingStatus?.terminalTitle
            ? { terminalTitle: existingStatus.terminalTitle }
            : existingRecord?.terminalTitle
              ? { terminalTitle: existingRecord.terminalTitle }
              : {}),
          ...(routing?.connectionId !== undefined
            ? { connectionId: routing.connectionId }
            : existingRecord?.connectionId !== undefined
              ? { connectionId: existingRecord.connectionId }
              : {}),
          ...(launchConfig ? { launchConfig: copyLaunchConfig(launchConfig) } : {}),
          ...(existingRecordMatchesProviderSession &&
          existingRecord.automaticResumeBlockedBy === 'legacy-orchestration-worker'
            ? { automaticResumeBlockedBy: 'legacy-orchestration-worker' }
            : {}),
          origin: 'live'
        }
        removedLiveStatus = existingStatus !== undefined
        const nextLive = removedLiveStatus ? { ...s.agentStatusByPaneKey } : s.agentStatusByPaneKey
        if (removedLiveStatus) {
          delete nextLive[paneKey]
        }
        const nextRetained =
          paneKey in s.retainedAgentsByPaneKey
            ? { ...s.retainedAgentsByPaneKey }
            : s.retainedAgentsByPaneKey
        if (nextRetained !== s.retainedAgentsByPaneKey) {
          delete nextRetained[paneKey]
        }
        // Why: on identity mismatch the sleeping record drops its launch config, so clear the stale
        // registry entry too, else a later return to the old identity reuses stale args/env.
        let nextLaunchConfigs = s.agentLaunchConfigByPaneKey
        if (registryMatches && registryEntry) {
          nextLaunchConfigs = {
            ...nextLaunchConfigs,
            [paneKey]: {
              ...registryEntry,
              identity: { ...registryEntry.identity, providerSession }
            }
          }
        } else if (registryEntry) {
          nextLaunchConfigs = { ...nextLaunchConfigs }
          delete nextLaunchConfigs[paneKey]
        }
        return {
          agentStatusByPaneKey: nextLive,
          retainedAgentsByPaneKey: nextRetained,
          sleepingAgentSessionsByPaneKey: {
            ...s.sleepingAgentSessionsByPaneKey,
            [paneKey]: record
          },
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          acknowledgedAgentsByPaneKey: removePaneKeys(
            s.acknowledgedAgentsByPaneKey,
            new Set([paneKey])
          ),
          unreadAgentCompletionPanes: removePaneKeys(
            s.unreadAgentCompletionPanes,
            new Set([paneKey])
          ),
          agentStatusEpoch: removedLiveStatus ? s.agentStatusEpoch + 1 : s.agentStatusEpoch,
          sortEpoch: removedLiveStatus ? s.sortEpoch + 1 : s.sortEpoch
        }
      })
      if (removedLiveStatus) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
    },
  }
}
