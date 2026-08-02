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
import { MAX_RETAINED_AGENTS, capRetainedAgents, MAX_LIVE_AGENT_STATUSES, classifyPaneKeyLiveness, capLiveAgentStatusesInPlace, paneKeyMatchesAnyTabPrefix, isAgentCompletionState, getTabIdFromPaneKey, agentStatusTabAlreadyHasProtectedOrGeneratedTitle, getLeafIdFromPaneKey, findCompletedOrphanPaneKeysForTabClose, isRecentlyClosedAgentStatusTab, findAgentPaneWorktreeId, findTabForAgentEntry, getRetainedFallbackTab, retainedAgentEntryFromLive, shouldReplaceRetainedWithLive, normalizePaneKeySet, sleepingRecordFromEntry, normalizeSleepingAgentSessionCollectOptions, isValidManualSleepLiveAgentEntry, isValidCompletedAgentHibernationEntry, removeSleepingRecordsReplacedByManualWorktreeSleep, registryEntryMatchesStatus, getLaunchConfigForEntry, RECENTLY_CLOSED_AGENT_STATUS_TAB_IDS_MAX, RECENTLY_RETIRED_AGENT_STATUS_PANE_KEYS_MAX, boundRecentlyClosedAgentStatusTabIds, boundRecentlyRetiredAgentStatusPaneKeys, movePaneKeyedRecord, removePaneKeys, getLaunchConfigForStatusMetadata, pruneMigrationUnsupportedEntries, orchestrationContextsEqual, orchestrationMapsEqual, mergeCurrentOrchestrationContext, collectWorktreeIdsForConnection } from './agent-status-state'
import type { RetainedAgentEntry, AgentStatusWorktreeShutdownReason, AllAgentSessionCaptureMode, DropAgentStatusByWorktreeOptions, DropHibernatedAgentPaneOptions, DropAgentStatusByTabPrefixOptions, AgentLaunchConfigRegistrationMetadata, AgentLaunchConfigStatusMetadata, AgentLaunchConfigRegistryEntry, AgentStatusSlice, PaneLiveness, CollectSleepingAgentSessionRecordsOptions } from './agent-status-state'
export function collectSleepingAgentSessionRecordsForWorktree(
  state: AppState,
  worktreeId: string,
  options?: readonly string[] | CollectSleepingAgentSessionRecordsOptions
): Record<string, SleepingAgentSessionRecord> {
  const capturedAt = Date.now()
  const collectOptions = normalizeSleepingAgentSessionCollectOptions(options)
  const allowedPaneKeys = collectOptions.paneKeys ? new Set(collectOptions.paneKeys) : null
  const isManualWorktreeSleep = collectOptions.captureMode === 'manual-worktree-sleep'
  const isCompletedAgentHibernation = collectOptions.captureMode === 'completed-agent-hibernation'
  const isWorktreeOwnedCapture = isManualWorktreeSleep || isCompletedAgentHibernation
  // Why: hibernated completions are intentional worktree-owned records; wake treats
  // originless completed records as ambiguous legacy captures.
  const origin: SleepingAgentSessionRecord['origin'] | undefined = isWorktreeOwnedCapture
    ? 'worktree-sleep'
    : undefined
  const tabPrefixes = (state.tabsByWorktree[worktreeId] ?? []).map((tab) => `${tab.id}:`)
  const records: Record<string, SleepingAgentSessionRecord> = {}

  if (isManualWorktreeSleep) {
    for (const existing of Object.values(state.sleepingAgentSessionsByPaneKey)) {
      const liveEntry = state.agentStatusByPaneKey[existing.paneKey]
      if (
        existing.worktreeId !== worktreeId ||
        existing.origin !== 'live' ||
        (liveEntry !== undefined &&
          !isCompletedPiCompatibleAgentWithLiveRecoveryRecord(liveEntry, existing)) ||
        (allowedPaneKeys && !allowedPaneKeys.has(existing.paneKey)) ||
        !getAgentResumeArgv(existing.agent, existing.providerSession)
      ) {
        continue
      }
      // Why: Pi identity is resumable with no turn row and while idle after done, so manual
      // sleep must promote both instead of deleting the checkpoint.
      records[existing.paneKey] = {
        ...existing,
        state: 'working',
        capturedAt,
        updatedAt: capturedAt,
        origin: 'worktree-sleep'
      }
    }
  }

  for (const retained of Object.values(state.retainedAgentsByPaneKey)) {
    if (isCompletedAgentHibernation) {
      continue
    }
    if (allowedPaneKeys && !allowedPaneKeys.has(retained.entry.paneKey)) {
      continue
    }
    if (retained.worktreeId !== worktreeId) {
      continue
    }
    const record = sleepingRecordFromEntry({
      state,
      entry: retained.entry,
      worktreeId,
      tab: retained.tab,
      capturedAt,
      launchConfig: getLaunchConfigForEntry(state, retained.entry),
      origin
    })
    if (record) {
      records[record.paneKey] = record
    }
  }

  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    if (allowedPaneKeys && !allowedPaneKeys.has(paneKey)) {
      continue
    }
    const belongsToWorktree =
      entry.worktreeId === worktreeId || paneKeyMatchesAnyTabPrefix(paneKey, tabPrefixes)
    if (!belongsToWorktree) {
      continue
    }
    if (isManualWorktreeSleep && !isValidManualSleepLiveAgentEntry(state, entry, capturedAt)) {
      continue
    }
    if (isCompletedAgentHibernation && !isValidCompletedAgentHibernationEntry(entry)) {
      continue
    }
    const record = sleepingRecordFromEntry({
      state,
      entry,
      worktreeId,
      capturedAt,
      launchConfig: getLaunchConfigForEntry(state, entry),
      origin
    })
    if (record) {
      records[record.paneKey] = record
    }
  }

  return records
}
export function collectHibernatedCompletionEvidenceForWorktree(
  state: AppState,
  worktreeId: string,
  paneKeys?: readonly string[]
): RetainedAgentEntry[] {
  const allowedPaneKeys = normalizePaneKeySet(paneKeys)
  if (!allowedPaneKeys || allowedPaneKeys.size === 0) {
    return []
  }
  const tabPrefixes = (state.tabsByWorktree[worktreeId] ?? []).map((tab) => `${tab.id}:`)
  const retained: RetainedAgentEntry[] = []
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    const agentType = entry.agentType
    if (
      !allowedPaneKeys.has(paneKey) ||
      entry.state !== 'done' ||
      agentType === undefined ||
      entry.interrupted === true
    ) {
      continue
    }
    const belongsToWorktree =
      entry.worktreeId === worktreeId || paneKeyMatchesAnyTabPrefix(paneKey, tabPrefixes)
    if (!belongsToWorktree) {
      continue
    }
    retained.push(retainedAgentEntryFromLive(state, worktreeId, entry, agentType))
  }
  return retained
}

// Why: comparing all fields except capturedAt lets an unchanged agent skip the store write,
// so periodic idle re-captures never dirty session persistence.
export function sleepingRecordsEquivalentIgnoringCaptureTime(
  existing: SleepingAgentSessionRecord | undefined,
  next: SleepingAgentSessionRecord
): boolean {
  if (!existing) {
    return false
  }
  return (
    existing.paneKey === next.paneKey &&
    existing.tabId === next.tabId &&
    existing.worktreeId === next.worktreeId &&
    existing.agent === next.agent &&
    agentProviderSessionsEqual(existing.agent, existing.providerSession, next.providerSession) &&
    existing.prompt === next.prompt &&
    existing.state === next.state &&
    existing.updatedAt === next.updatedAt &&
    existing.terminalTitle === next.terminalTitle &&
    existing.lastAssistantMessage === next.lastAssistantMessage &&
    existing.interrupted === next.interrupted &&
    existing.origin === next.origin &&
    launchConfigsEqual(existing.launchConfig, next.launchConfig)
  )
}
export function recoveryRecordMatches(
  existing: SleepingAgentSessionRecord | undefined,
  next: SleepingAgentSessionRecord
): boolean {
  if (!existing) {
    return false
  }
  return (
    existing.origin === next.origin &&
    existing.agent === next.agent &&
    existing.worktreeId === next.worktreeId &&
    existing.tabId === next.tabId &&
    agentProviderSessionsEqual(existing.agent, existing.providerSession, next.providerSession) &&
    launchConfigsEqual(existing.launchConfig, next.launchConfig)
  )
}
export function recoveryRecordTargetsSameSession(
  existing: SleepingAgentSessionRecord | undefined,
  next: SleepingAgentSessionRecord
): boolean {
  if (!existing) {
    return false
  }
  return (
    existing.agent === next.agent &&
    existing.worktreeId === next.worktreeId &&
    existing.tabId === next.tabId &&
    agentProviderSessionsEqual(existing.agent, existing.providerSession, next.providerSession)
  )
}
export function copyLaunchConfig(config: SleepingAgentLaunchConfig): SleepingAgentLaunchConfig {
  return {
    ...(config.agentCommand ? { agentCommand: config.agentCommand } : {}),
    agentArgs: config.agentArgs,
    agentEnv: { ...config.agentEnv },
    ...(config.ompResumeFilePath ? { ompResumeFilePath: config.ompResumeFilePath } : {})
  }
}
export function launchConfigsEqual(
  a: SleepingAgentLaunchConfig | undefined,
  b: SleepingAgentLaunchConfig | undefined
): boolean {
  if (a === undefined || b === undefined) {
    return a === b
  }
  if (
    a.agentCommand !== b.agentCommand ||
    a.agentArgs !== b.agentArgs ||
    a.ompResumeFilePath !== b.ompResumeFilePath
  ) {
    return false
  }
  const aKeys = Object.keys(a.agentEnv)
  const bKeys = Object.keys(b.agentEnv)
  return aKeys.length === bKeys.length && aKeys.every((key) => a.agentEnv[key] === b.agentEnv[key])
}
export function normalizeLaunchConfigRegistrationMetadata(
  paneKey: string,
  metadata: AgentLaunchConfigRegistrationMetadata | undefined
): AgentLaunchConfigRegistrationMetadata {
  return {
    ...(metadata?.agentType ? { agentType: metadata.agentType } : {}),
    ...(metadata?.launchToken ? { launchToken: metadata.launchToken } : {}),
    tabId: metadata?.tabId ?? getTabIdFromPaneKey(paneKey) ?? undefined,
    leafId: metadata?.leafId ?? getLeafIdFromPaneKey(paneKey) ?? undefined,
    ...(metadata?.terminalHandle ? { terminalHandle: metadata.terminalHandle } : {}),
    ...(metadata?.providerSession ? { providerSession: metadata.providerSession } : {})
  }
}
export function launchConfigRegistryEntriesEqual(
  a: AgentLaunchConfigRegistryEntry | undefined,
  b: AgentLaunchConfigRegistryEntry
): boolean {
  return (
    a !== undefined &&
    launchConfigsEqual(a.launchConfig, b.launchConfig) &&
    a.identity.agentType === b.identity.agentType &&
    a.identity.launchToken === b.identity.launchToken &&
    a.identity.tabId === b.identity.tabId &&
    a.identity.leafId === b.identity.leafId &&
    a.identity.terminalHandle === b.identity.terminalHandle &&
    agentProviderSessionsEqual(
      a.identity.agentType ?? b.identity.agentType,
      a.identity.providerSession,
      b.identity.providerSession
    )
  )
}
