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
export function createAgentStatusSliceDropAgentStatusByTabPrefixActions5(set: SliceSet, get: SliceGet, runtime: AgentStatusRuntime) {
  return {
    dropAgentStatusByTabPrefix: (tabIdPrefix, opts) => {
      const prefix = `${tabIdPrefix}:`
      const retiredAliasPaneKeys = retireAgentPaneAuthorityAliasesByOwnerTab(tabIdPrefix)
      let hadLive = false
      set((s) => {
        const completedOrphanKeys = findCompletedOrphanPaneKeysForTabClose(
          s,
          opts?.worktreeId,
          prefix
        )
        const completedOrphanKeySet = new Set(completedOrphanKeys)
        const liveKeys = [
          ...Object.keys(s.agentStatusByPaneKey).filter((k) => k.startsWith(prefix)),
          ...completedOrphanKeys
        ]
        const launchConfigKeys = Object.keys(s.agentLaunchConfigByPaneKey).filter(
          (k) => k.startsWith(prefix) || completedOrphanKeySet.has(k)
        )
        const retainedKeys = Object.keys(s.retainedAgentsByPaneKey).filter(
          (k) => k.startsWith(prefix) || completedOrphanKeySet.has(k)
        )
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey?.startsWith(prefix) ?? false
        )
        // See removeAgentStatus for ack-cleanup rationale; ack entries are owned by the pane lifecycle regardless of live/retained state.
        let nextAck = s.acknowledgedAgentsByPaneKey
        const ackKeys = Object.keys(nextAck).filter(
          (k) => k.startsWith(prefix) || completedOrphanKeySet.has(k)
        )
        if (ackKeys.length > 0) {
          nextAck = { ...nextAck }
          for (const k of ackKeys) {
            delete nextAck[k]
          }
        }
        const nextClosedTabs = boundRecentlyClosedAgentStatusTabIds(
          s.recentlyClosedAgentStatusTabIds,
          tabIdPrefix
        )
        const nextRetiredPaneKeys = boundRecentlyRetiredAgentStatusPaneKeys(
          s.recentlyRetiredAgentStatusPaneKeys,
          retiredAliasPaneKeys
        )

        if (
          liveKeys.length === 0 &&
          launchConfigKeys.length === 0 &&
          retainedKeys.length === 0 &&
          !migrationUnsupported.changed
        ) {
          if (nextAck !== s.acknowledgedAgentsByPaneKey) {
            return {
              acknowledgedAgentsByPaneKey: nextAck,
              recentlyClosedAgentStatusTabIds: nextClosedTabs,
              recentlyRetiredAgentStatusPaneKeys: nextRetiredPaneKeys
            }
          }
          return {
            recentlyClosedAgentStatusTabIds: nextClosedTabs,
            recentlyRetiredAgentStatusPaneKeys: nextRetiredPaneKeys
          }
        }
        hadLive = liveKeys.length > 0

        const nextLive =
          liveKeys.length > 0 ? { ...s.agentStatusByPaneKey } : s.agentStatusByPaneKey
        for (const key of liveKeys) {
          delete nextLive[key]
        }
        const nextLaunchConfigs =
          launchConfigKeys.length > 0
            ? { ...s.agentLaunchConfigByPaneKey }
            : s.agentLaunchConfigByPaneKey
        for (const key of launchConfigKeys) {
          delete nextLaunchConfigs[key]
        }

        const nextRetained =
          retainedKeys.length > 0 ? { ...s.retainedAgentsByPaneKey } : s.retainedAgentsByPaneKey
        for (const key of retainedKeys) {
          delete nextRetained[key]
        }

        // Why: a suppressor is only consumed on a live→gone transition, so plant one only for live paneKeys and skip already-suppressed and completed-orphan keys — otherwise it leaks (mirrors dropAgentStatus).
        const suppressorAdds = liveKeys.filter(
          (k) => !completedOrphanKeySet.has(k) && !(k in s.retentionSuppressedPaneKeys)
        )
        let nextRetentionSuppressedPaneKeys = s.retentionSuppressedPaneKeys
        if (suppressorAdds.length > 0) {
          nextRetentionSuppressedPaneKeys = { ...s.retentionSuppressedPaneKeys }
          for (const key of suppressorAdds) {
            nextRetentionSuppressedPaneKeys[key] = true
          }
        }

        return {
          agentStatusByPaneKey: nextLive,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          retainedAgentsByPaneKey: nextRetained,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          retentionSuppressedPaneKeys: nextRetentionSuppressedPaneKeys,
          recentlyClosedAgentStatusTabIds: nextClosedTabs,
          recentlyRetiredAgentStatusPaneKeys: nextRetiredPaneKeys,
          ...(nextAck !== s.acknowledgedAgentsByPaneKey
            ? { acknowledgedAgentsByPaneKey: nextAck }
            : {}),
          // Why: mirrors removeAgentStatusByTabPrefix — only bump epochs when the live map changed; retained-only sweeps don't affect sort/runtime.freshness.
          agentStatusEpoch:
            hadLive || migrationUnsupported.changed ? s.agentStatusEpoch + 1 : s.agentStatusEpoch,
          sortEpoch: hadLive || migrationUnsupported.changed ? s.sortEpoch + 1 : s.sortEpoch
        }
      })
      if (hadLive) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
      if (typeof window !== 'undefined') {
        window.api?.agentStatus?.dropByTabPrefix?.(tabIdPrefix)
      }
    },
    dropHibernatedAgentStatusPane: (worktreeId, paneKey, opts) => {
      let hadLive = false
      set((s) => {
        const liveEntry = s.agentStatusByPaneKey[paneKey]
        const hasLive = liveEntry !== undefined
        const hasRetained = paneKey in s.retainedAgentsByPaneKey
        const hasLaunchConfig = paneKey in s.agentLaunchConfigByPaneKey
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey === paneKey
        )
        const retainedEvidence = new Map<string, RetainedAgentEntry>()
        for (const retained of opts?.retainedCompletionEvidence ?? []) {
          if (
            retained.entry.paneKey === paneKey &&
            !liveEntry &&
            shouldReplaceRetainedWithLive(retainedEvidence.get(paneKey), retained)
          ) {
            retainedEvidence.set(paneKey, retained)
          }
        }
        if (
          liveEntry?.state === 'done' &&
          liveEntry.agentType !== undefined &&
          liveEntry.interrupted !== true
        ) {
          retainedEvidence.set(
            paneKey,
            retainedAgentEntryFromLive(s, worktreeId, liveEntry, liveEntry.agentType)
          )
        }
        const keepsCompletionEvidence = retainedEvidence.has(paneKey)
        let nextAck = s.acknowledgedAgentsByPaneKey
        if (!keepsCompletionEvidence && paneKey in nextAck) {
          nextAck = { ...nextAck }
          delete nextAck[paneKey]
        }
        if (
          !hasLive &&
          !hasRetained &&
          !hasLaunchConfig &&
          !migrationUnsupported.changed &&
          !keepsCompletionEvidence
        ) {
          if (nextAck !== s.acknowledgedAgentsByPaneKey) {
            return { acknowledgedAgentsByPaneKey: nextAck }
          }
          return s
        }
        hadLive = hasLive

        const nextLive = hasLive ? { ...s.agentStatusByPaneKey } : s.agentStatusByPaneKey
        if (hasLive) {
          delete nextLive[paneKey]
        }
        const nextLaunchConfigs = hasLaunchConfig
          ? { ...s.agentLaunchConfigByPaneKey }
          : s.agentLaunchConfigByPaneKey
        if (hasLaunchConfig) {
          delete nextLaunchConfigs[paneKey]
        }

        const nextRetained =
          hasRetained || keepsCompletionEvidence
            ? { ...s.retainedAgentsByPaneKey }
            : s.retainedAgentsByPaneKey
        if (hasRetained && !keepsCompletionEvidence) {
          delete nextRetained[paneKey]
        }
        for (const [key, retained] of retainedEvidence) {
          if (shouldReplaceRetainedWithLive(nextRetained[key], retained)) {
            nextRetained[key] = retained
          }
        }

        const needsSuppressor =
          hasLive && !keepsCompletionEvidence && !(paneKey in s.retentionSuppressedPaneKeys)

        return {
          agentStatusByPaneKey: nextLive,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          retainedAgentsByPaneKey: nextRetained,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          ...(nextAck !== s.acknowledgedAgentsByPaneKey
            ? { acknowledgedAgentsByPaneKey: nextAck }
            : {}),
          ...(needsSuppressor
            ? {
                retentionSuppressedPaneKeys: {
                  ...s.retentionSuppressedPaneKeys,
                  [paneKey]: true
                }
              }
            : {}),
          agentStatusEpoch:
            hasLive || migrationUnsupported.changed ? s.agentStatusEpoch + 1 : s.agentStatusEpoch,
          sortEpoch: hasLive || migrationUnsupported.changed ? s.sortEpoch + 1 : s.sortEpoch
        }
      })
      if (hadLive) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
    },
  }
}