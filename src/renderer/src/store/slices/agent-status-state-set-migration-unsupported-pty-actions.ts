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
export function createAgentStatusSliceSetMigrationUnsupportedPtyActions4(set: SliceSet, get: SliceGet, runtime: AgentStatusRuntime) {
  return {
    setMigrationUnsupportedPty: (entry) => {
      set((s) => {
        const existing = s.migrationUnsupportedByPtyId[entry.ptyId]
        if (existing && entry.updatedAt < existing.updatedAt) {
          return s
        }
        return {
          migrationUnsupportedByPtyId: {
            ...s.migrationUnsupportedByPtyId,
            [entry.ptyId]: entry
          },
          agentStatusEpoch: s.agentStatusEpoch + 1,
          sortEpoch: s.sortEpoch + 1
        }
      })
    },
    clearMigrationUnsupportedPty: (ptyId) => {
      if (!(ptyId in get().migrationUnsupportedByPtyId)) {
        return
      }
      set((s) => {
        const next = { ...s.migrationUnsupportedByPtyId }
        delete next[ptyId]
        return {
          migrationUnsupportedByPtyId: next,
          agentStatusEpoch: s.agentStatusEpoch + 1,
          sortEpoch: s.sortEpoch + 1
        }
      })
    },
    removeAgentStatus: (paneKey) => {
      if (
        !(paneKey in get().agentStatusByPaneKey) &&
        !(paneKey in get().agentLaunchConfigByPaneKey) &&
        !Object.values(get().migrationUnsupportedByPtyId).some((entry) => entry.paneKey === paneKey)
      ) {
        return
      }
      set((s) => {
        const hasLive = paneKey in s.agentStatusByPaneKey
        const next = hasLive ? { ...s.agentStatusByPaneKey } : s.agentStatusByPaneKey
        if (hasLive) {
          delete next[paneKey]
        }
        const hasLaunchConfig = paneKey in s.agentLaunchConfigByPaneKey
        const nextLaunchConfigs = hasLaunchConfig
          ? { ...s.agentLaunchConfigByPaneKey }
          : s.agentLaunchConfigByPaneKey
        if (hasLaunchConfig) {
          delete nextLaunchConfigs[paneKey]
        }
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey === paneKey
        )
        // Why: drop the ack entry with the pane so a future paneKey collision can't inherit a stale ack that suppresses "unvisited" signals.
        let nextAck = s.acknowledgedAgentsByPaneKey
        if (paneKey in nextAck) {
          nextAck = { ...nextAck }
          delete nextAck[paneKey]
        }
        // Why: bump sortEpoch with agentStatusEpoch — removing an agent can change worktree sort order (same as setAgentStatus).
        return {
          agentStatusByPaneKey: next,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          ...(nextAck !== s.acknowledgedAgentsByPaneKey
            ? { acknowledgedAgentsByPaneKey: nextAck }
            : {}),
          agentStatusEpoch: s.agentStatusEpoch + 1,
          sortEpoch: s.sortEpoch + 1
        }
      })
      queueMicrotask(() => runtime.freshness.schedule())
    },
    removeAgentStatusByTabPrefix: (tabIdPrefix) => {
      const prefix = `${tabIdPrefix}:`
      const currentKeys = Object.keys(get().agentStatusByPaneKey)
      const toRemove = currentKeys.filter((k) => k.startsWith(prefix))
      const launchConfigKeys = Object.keys(get().agentLaunchConfigByPaneKey).filter((k) =>
        k.startsWith(prefix)
      )
      const hasMigrationUnsupported = Object.values(get().migrationUnsupportedByPtyId).some(
        (entry) => entry.paneKey?.startsWith(prefix)
      )
      if (toRemove.length === 0 && launchConfigKeys.length === 0 && !hasMigrationUnsupported) {
        return
      }
      set((s) => {
        const next = { ...s.agentStatusByPaneKey }
        for (const key of toRemove) {
          delete next[key]
        }
        const nextLaunchConfigs = { ...s.agentLaunchConfigByPaneKey }
        for (const key of launchConfigKeys) {
          delete nextLaunchConfigs[key]
        }
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey?.startsWith(prefix) ?? false
        )
        // See removeAgentStatus for rationale on ack cleanup.
        let nextAck = s.acknowledgedAgentsByPaneKey
        const ackKeys = Object.keys(nextAck).filter((k) => k.startsWith(prefix))
        if (ackKeys.length > 0) {
          nextAck = { ...nextAck }
          for (const k of ackKeys) {
            delete nextAck[k]
          }
        }
        // Why: bump sortEpoch with agentStatusEpoch — removing agents can change worktree sort order (same as setAgentStatus).
        return {
          agentStatusByPaneKey: next,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          ...(nextAck !== s.acknowledgedAgentsByPaneKey
            ? { acknowledgedAgentsByPaneKey: nextAck }
            : {}),
          agentStatusEpoch: s.agentStatusEpoch + 1,
          sortEpoch: s.sortEpoch + 1
        }
      })
      queueMicrotask(() => runtime.freshness.schedule())
    },
    clearTransientAgentStatuses: (connectionId, clearedAt) => {
      if (connectionId.length === 0 || !Number.isFinite(clearedAt)) {
        return
      }
      let removed = false
      set((s) => {
        const worktreeIdsOnConnection = collectWorktreeIdsForConnection(s, connectionId)
        let next: Record<string, AgentStatusEntry> | null = null
        for (const [paneKey, existing] of Object.entries(s.agentStatusByPaneKey)) {
          if (existing.updatedAt > clearedAt) {
            continue
          }
          // Why: clear rows stamped for this connection, plus UNSTAMPED (never-stamped) worktree
          // rows unambiguously on it (#9030). An explicit stamp — another host's connectionId, or a
          // local `null` — is authoritative and never overridden by worktree inference.
          const belongsToConnection =
            existing.connectionId === connectionId ||
            (existing.connectionId === undefined &&
              existing.worktreeId !== undefined &&
              worktreeIdsOnConnection.has(existing.worktreeId))
          if (!belongsToConnection) {
            continue
          }
          next ??= { ...s.agentStatusByPaneKey }
          delete next[paneKey]
        }
        const wasAlreadyBlocked = connectionId in s.transientClearedAgentStatusConnectionIds
        if (!next && wasAlreadyBlocked) {
          return s
        }
        removed = next !== null
        // Why: transport loss is reversible. Keep launch, resume, retention,
        // and acknowledgement maps intact for same-pane relay replay.
        return {
          ...(next
            ? {
                agentStatusByPaneKey: next,
                agentStatusEpoch: s.agentStatusEpoch + 1,
                sortEpoch: s.sortEpoch + 1
              }
            : {}),
          transientClearedAgentStatusConnectionIds: wasAlreadyBlocked
            ? s.transientClearedAgentStatusConnectionIds
            : { ...s.transientClearedAgentStatusConnectionIds, [connectionId]: true }
        }
      })
      if (removed) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
    },
    dropAgentStatus: (paneKey) => {
      // Why: zustand set is synchronous, so capture liveExisted once inside the callback instead of double-reading the store.
      let liveExisted = false
      set((s) => {
        const hasLive = paneKey in s.agentStatusByPaneKey
        liveExisted = hasLive
        const hasRetained = paneKey in s.retainedAgentsByPaneKey
        const migrationUnsupported = pruneMigrationUnsupportedEntries(
          s.migrationUnsupportedByPtyId,
          (entry) => entry.paneKey === paneKey
        )
        // See removeAgentStatus for ack-cleanup rationale; the ack entry is owned by the pane lifecycle regardless of live/retained state.
        let nextAck = s.acknowledgedAgentsByPaneKey
        if (paneKey in nextAck) {
          nextAck = { ...nextAck }
          delete nextAck[paneKey]
        }
        const hasLaunchConfig = paneKey in s.agentLaunchConfigByPaneKey
        const nextLaunchConfigs = hasLaunchConfig
          ? { ...s.agentLaunchConfigByPaneKey }
          : s.agentLaunchConfigByPaneKey
        if (hasLaunchConfig) {
          delete nextLaunchConfigs[paneKey]
        }
        // Why: short-circuit when there's nothing to change, but still flush a pending ack or launch-config cleanup if one is present.
        if (!hasLive && !hasRetained && !migrationUnsupported.changed) {
          if (hasLaunchConfig) {
            return {
              agentLaunchConfigByPaneKey: nextLaunchConfigs,
              ...(nextAck !== s.acknowledgedAgentsByPaneKey
                ? { acknowledgedAgentsByPaneKey: nextAck }
                : {})
            }
          }
          if (nextAck !== s.acknowledgedAgentsByPaneKey) {
            return { acknowledgedAgentsByPaneKey: nextAck }
          }
          return s
        }

        const nextLive = hasLive ? { ...s.agentStatusByPaneKey } : s.agentStatusByPaneKey
        if (hasLive) {
          delete nextLive[paneKey]
        }
        const nextRetained = hasRetained
          ? { ...s.retainedAgentsByPaneKey }
          : s.retainedAgentsByPaneKey
        if (hasRetained) {
          delete nextRetained[paneKey]
        }

        // Why: explicit teardown must not let retention sync resurrect this row — plant a one-shot suppressor, but only when hasLive (a retained-only key has no live→gone transition to consume it, so it leaks) and not already present (re-spreading spuriously re-renders subscribers).
        const needsSuppressorWrite = hasLive && !(paneKey in s.retentionSuppressedPaneKeys)

        return {
          agentStatusByPaneKey: nextLive,
          agentLaunchConfigByPaneKey: nextLaunchConfigs,
          retainedAgentsByPaneKey: nextRetained,
          migrationUnsupportedByPtyId: migrationUnsupported.next,
          ...(nextAck !== s.acknowledgedAgentsByPaneKey
            ? { acknowledgedAgentsByPaneKey: nextAck }
            : {}),
          ...(needsSuppressorWrite
            ? {
                retentionSuppressedPaneKeys: {
                  ...s.retentionSuppressedPaneKeys,
                  [paneKey]: true
                }
              }
            : {}),
          agentStatusEpoch:
            hasLive || migrationUnsupported.changed ? s.agentStatusEpoch + 1 : s.agentStatusEpoch,
          // Why: mirrors removeAgentStatus — dropping a live agent changes its worktree sort score, so bump sortEpoch to recompute the sidebar smart-sort.
          sortEpoch: hasLive || migrationUnsupported.changed ? s.sortEpoch + 1 : s.sortEpoch
        }
      })
      // Why: runtime.freshness.schedule only matters when the live map changed, so gate on the live presence observed inside set() — no-op/retained-only drops skip it.
      if (liveExisted) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
      // Why: propagate the dismissal to the main-process hook cache so the on-disk cache doesn't re-hydrate this row on next launch. Fire-and-forget.
      // Why: the typeof window guard keeps the slice usable from the node test env, where window is undefined.
      if (typeof window !== 'undefined') {
        window.api?.agentStatus?.drop?.(paneKey)
      }
    },
  }
}