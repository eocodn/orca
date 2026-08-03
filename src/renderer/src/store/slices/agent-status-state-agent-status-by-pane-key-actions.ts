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
export function createAgentStatusSliceAgentStatusByPaneKeyActions(set: SliceSet, get: SliceGet, runtime: AgentStatusRuntime) {
  return {
    agentStatusByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    agentStatusEpoch: 0,
    transientClearedAgentStatusConnectionIds: {},
    retainedAgentsByPaneKey: {},
    sleepingAgentSessionsByPaneKey: {},
    agentLaunchConfigByPaneKey: {},
    retentionSuppressedPaneKeys: {},
    recentlyClosedAgentStatusTabIds: {},
    recentlyRetiredAgentStatusPaneKeys: {},
    scheduleAgentStatusFreshness: () => runtime.freshness.schedule(),
    retireAgentPaneAuthority: (paneKey, options) => {
      const ownerPaneKey = resolveAgentPaneAuthorityKey(paneKey)
      const retiredPaneKeys = retireAgentPaneAuthorityAliases(paneKey)
      const retiredPaneKeySet = new Set(retiredPaneKeys)
      let hadLive = false
      set((s) => {
        const retiredLivePaneKeys = retiredPaneKeys.filter((key) => key in s.agentStatusByPaneKey)
        hadLive = retiredLivePaneKeys.length > 0
        let nextRetentionSuppressedPaneKeys = removePaneKeys(
          s.retentionSuppressedPaneKeys,
          retiredPaneKeySet
        )
        if (
          retiredLivePaneKeys.length > 0 &&
          nextRetentionSuppressedPaneKeys === s.retentionSuppressedPaneKeys
        ) {
          nextRetentionSuppressedPaneKeys = { ...nextRetentionSuppressedPaneKeys }
        }
        for (const key of retiredLivePaneKeys) {
          nextRetentionSuppressedPaneKeys[key] = true
        }
        return {
          agentStatusByPaneKey: removePaneKeys(s.agentStatusByPaneKey, retiredPaneKeySet),
          runtimeAgentOrchestrationByPaneKey: removePaneKeys(
            s.runtimeAgentOrchestrationByPaneKey,
            retiredPaneKeySet
          ),
          retainedAgentsByPaneKey: removePaneKeys(s.retainedAgentsByPaneKey, retiredPaneKeySet),
          sleepingAgentSessionsByPaneKey: options?.preserveSleepingAgentSession
            ? s.sleepingAgentSessionsByPaneKey
            : removePaneKeys(s.sleepingAgentSessionsByPaneKey, retiredPaneKeySet),
          agentLaunchConfigByPaneKey: removePaneKeys(
            s.agentLaunchConfigByPaneKey,
            retiredPaneKeySet
          ),
          acknowledgedAgentsByPaneKey: removePaneKeys(
            s.acknowledgedAgentsByPaneKey,
            retiredPaneKeySet
          ),
          paneForegroundAgentByPaneKey: removePaneKeys(
            s.paneForegroundAgentByPaneKey,
            retiredPaneKeySet
          ),
          unreadTerminalPanes: removePaneKeys(s.unreadTerminalPanes, retiredPaneKeySet),
          unreadAgentCompletionPanes: removePaneKeys(
            s.unreadAgentCompletionPanes,
            retiredPaneKeySet
          ),
          lastTerminalInputAtByPaneKey: removePaneKeys(
            s.lastTerminalInputAtByPaneKey,
            retiredPaneKeySet
          ),
          cacheTimerByKey: removePaneKeys(s.cacheTimerByKey, retiredPaneKeySet),
          retentionSuppressedPaneKeys: nextRetentionSuppressedPaneKeys,
          recentlyRetiredAgentStatusPaneKeys: boundRecentlyRetiredAgentStatusPaneKeys(
            s.recentlyRetiredAgentStatusPaneKeys,
            retiredPaneKeys
          ),
          agentStatusEpoch: hadLive ? s.agentStatusEpoch + 1 : s.agentStatusEpoch,
          sortEpoch: hadLive ? s.sortEpoch + 1 : s.sortEpoch
        }
      })
      if (hadLive) {
        queueMicrotask(() => runtime.freshness.schedule())
      }
      if (typeof window !== 'undefined') {
        window.api?.agentStatus?.retirePaneAuthority?.(ownerPaneKey)
      }
    },
    transferAgentPaneAuthority: ({ fromPaneKey, toPaneKey, ptyId }) => {
      const transfer = transferAgentPaneAuthorityAlias({ fromPaneKey, toPaneKey, ptyId })
      if (!transfer || transfer.previousOwnerPaneKey === transfer.ownerPaneKey) {
        return
      }
      const from = transfer.previousOwnerPaneKey
      const to = transfer.ownerPaneKey
      const targetTabId = getTabIdFromPaneKey(to) ?? undefined
      const targetLeafId = getLeafIdFromPaneKey(to) ?? undefined
      set((s) => ({
        agentStatusByPaneKey: movePaneKeyedRecord(s.agentStatusByPaneKey, from, to, (entry) => ({
          ...entry,
          paneKey: to,
          tabId: targetTabId
        })),
        // Why: retention/sidebar consumers gate on the epoch; a moved live row is a
        // pane-key change they must observe, not a silent remap.
        ...(from in s.agentStatusByPaneKey
          ? { agentStatusEpoch: s.agentStatusEpoch + 1, sortEpoch: s.sortEpoch + 1 }
          : {}),
        runtimeAgentOrchestrationByPaneKey: movePaneKeyedRecord(
          s.runtimeAgentOrchestrationByPaneKey,
          from,
          to
        ),
        retainedAgentsByPaneKey: movePaneKeyedRecord(
          s.retainedAgentsByPaneKey,
          from,
          to,
          (retained) => ({
            ...retained,
            entry: { ...retained.entry, paneKey: to, tabId: targetTabId },
            tab: targetTabId ? { ...retained.tab, id: targetTabId } : retained.tab
          })
        ),
        sleepingAgentSessionsByPaneKey: movePaneKeyedRecord(
          s.sleepingAgentSessionsByPaneKey,
          from,
          to,
          (record) => ({ ...record, paneKey: to, tabId: targetTabId })
        ),
        agentLaunchConfigByPaneKey: movePaneKeyedRecord(
          s.agentLaunchConfigByPaneKey,
          from,
          to,
          (entry) => ({
            ...entry,
            identity: { ...entry.identity, tabId: targetTabId, leafId: targetLeafId }
          })
        ),
        acknowledgedAgentsByPaneKey: movePaneKeyedRecord(s.acknowledgedAgentsByPaneKey, from, to),
        paneForegroundAgentByPaneKey: movePaneKeyedRecord(s.paneForegroundAgentByPaneKey, from, to),
        unreadTerminalPanes: movePaneKeyedRecord(s.unreadTerminalPanes, from, to),
        unreadAgentCompletionPanes: movePaneKeyedRecord(s.unreadAgentCompletionPanes, from, to),
        lastTerminalInputAtByPaneKey: movePaneKeyedRecord(s.lastTerminalInputAtByPaneKey, from, to),
        cacheTimerByKey: movePaneKeyedRecord(s.cacheTimerByKey, from, to),
        retentionSuppressedPaneKeys: movePaneKeyedRecord(s.retentionSuppressedPaneKeys, from, to)
      }))
      if (typeof window !== 'undefined') {
        window.api?.agentStatus?.transferPaneAuthority?.({
          fromPaneKey: from,
          toPaneKey: to,
          ...(transfer.ptyId ? { ptyId: transfer.ptyId } : {})
        })
      }
    },
    setRuntimeAgentOrchestrationByPaneKey: (entries) => {
      const generatedTitleUpdates: AgentStatusEntry[] = []
      set((s) => {
        const runtimeMapChanged = !orchestrationMapsEqual(
          s.runtimeAgentOrchestrationByPaneKey,
          entries
        )
        let nextLive = s.agentStatusByPaneKey
        let liveChanged = false
        let nextRetained = s.retainedAgentsByPaneKey
        let retainedChanged = false

        for (const [paneKey, runtimeOrchestration] of Object.entries(entries)) {
          const liveEntry = nextLive[paneKey]
          if (liveEntry) {
            const merged = mergeCurrentOrchestrationContext(
              liveEntry.orchestration,
              runtimeOrchestration
            )
            if (merged !== liveEntry.orchestration) {
              if (!liveChanged) {
                nextLive = { ...nextLive }
                liveChanged = true
              }
              const nextEntry = { ...liveEntry, orchestration: merged }
              nextLive[paneKey] = nextEntry
              // Why: only replace titles when labels match the live dispatch taskId; sticky completed context must not rename a later turn.
              if (
                (merged.displayName?.trim() || merged.taskTitle?.trim()) &&
                orchestrationLabelsMatchLiveDispatch({
                  prompt: nextEntry.prompt,
                  orchestration: merged
                })
              ) {
                generatedTitleUpdates.push(nextEntry)
              }
            }
          }

          const retainedEntry = nextRetained[paneKey]
          if (retainedEntry) {
            const merged = mergeCurrentOrchestrationContext(
              retainedEntry.entry.orchestration,
              runtimeOrchestration
            )
            if (merged !== retainedEntry.entry.orchestration) {
              if (!retainedChanged) {
                nextRetained = { ...nextRetained }
                retainedChanged = true
              }
              nextRetained[paneKey] = {
                ...retainedEntry,
                entry: { ...retainedEntry.entry, orchestration: merged }
              }
            }
          }
        }

        if (!runtimeMapChanged && !liveChanged && !retainedChanged) {
          return s
        }

        return {
          ...(runtimeMapChanged ? { runtimeAgentOrchestrationByPaneKey: entries } : {}),
          ...(liveChanged ? { agentStatusByPaneKey: nextLive } : {}),
          ...(retainedChanged ? { retainedAgentsByPaneKey: nextRetained } : {}),
          ...(liveChanged ? { agentStatusEpoch: s.agentStatusEpoch + 1 } : {})
        }
      })
      for (const entry of generatedTitleUpdates) {
        get().setGeneratedTabTitleFromAgentPrompt(
          entry.paneKey,
          getAgentRowGeneratedTitleText(entry),
          {
            replaceExistingGeneratedTitle: true
          }
        )
      }
    },
    registerAgentLaunchConfig: (paneKey, launchConfig, metadata) => {
      set((s) => {
        const copiedLaunchConfig = copyLaunchConfig(launchConfig)
        const nextRegistryEntry: AgentLaunchConfigRegistryEntry = {
          launchConfig: copiedLaunchConfig,
          registeredAt: Date.now(),
          identity: normalizeLaunchConfigRegistrationMetadata(paneKey, metadata)
        }
        const existingRegistryEntry = s.agentLaunchConfigByPaneKey[paneKey]
        const registryChanged = !launchConfigRegistryEntriesEqual(
          existingRegistryEntry,
          nextRegistryEntry
        )
        const existingEntry = s.agentStatusByPaneKey[paneKey]
        const entryMatchesRegistry = registryEntryMatchesStatus({
          entry: nextRegistryEntry,
          paneKey,
          agentType: existingEntry?.agentType,
          tabId: existingEntry?.tabId ?? getTabIdFromPaneKey(paneKey) ?? undefined,
          terminalHandle: existingEntry?.terminalHandle,
          launchToken: metadata?.launchToken,
          providerSession: existingEntry?.providerSession,
          existingProviderSession: existingEntry?.providerSession,
          providerSessionChanged: false
        })
        const existingSleepingRecord = s.sleepingAgentSessionsByPaneKey[paneKey]
        let nextSleepingAgentSessions = s.sleepingAgentSessionsByPaneKey
        if (existingSleepingRecord && entryMatchesRegistry && existingEntry) {
          const worktreeId =
            existingEntry.worktreeId ??
            existingSleepingRecord.worktreeId ??
            findAgentPaneWorktreeId(s, paneKey)
          const refreshedRecord = worktreeId
            ? sleepingRecordFromEntry({
                state: s,
                entry: existingEntry,
                worktreeId,
                capturedAt: existingSleepingRecord.capturedAt,
                launchConfig: copiedLaunchConfig,
                origin: existingSleepingRecord.origin
              })
            : null
          if (refreshedRecord) {
            nextSleepingAgentSessions = {
              ...s.sleepingAgentSessionsByPaneKey,
              [paneKey]: {
                ...refreshedRecord,
                capturedAt: existingSleepingRecord.capturedAt
              }
            }
          }
        }
        if (!registryChanged && nextSleepingAgentSessions === s.sleepingAgentSessionsByPaneKey) {
          return s
        }
        return {
          ...(registryChanged
            ? {
                agentLaunchConfigByPaneKey: {
                  ...s.agentLaunchConfigByPaneKey,
                  [paneKey]: nextRegistryEntry
                }
              }
            : {}),
          ...(nextSleepingAgentSessions !== s.sleepingAgentSessionsByPaneKey
            ? { sleepingAgentSessionsByPaneKey: nextSleepingAgentSessions }
            : {})
        }
      })
    },
    getAgentLaunchConfigForStatusEntry: (entry) => getLaunchConfigForEntry(get(), entry),
    getAgentLaunchConfigForStatusMetadata: (metadata) =>
      getLaunchConfigForStatusMetadata(get(), metadata),
  }
}
