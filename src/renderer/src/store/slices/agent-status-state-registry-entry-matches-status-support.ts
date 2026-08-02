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
import { MAX_RETAINED_AGENTS, capRetainedAgents, MAX_LIVE_AGENT_STATUSES, classifyPaneKeyLiveness, capLiveAgentStatusesInPlace, paneKeyMatchesAnyTabPrefix, isAgentCompletionState, getTabIdFromPaneKey, agentStatusTabAlreadyHasProtectedOrGeneratedTitle, getLeafIdFromPaneKey, findCompletedOrphanPaneKeysForTabClose, isRecentlyClosedAgentStatusTab, findAgentPaneWorktreeId, findTabForAgentEntry, getRetainedFallbackTab, retainedAgentEntryFromLive, shouldReplaceRetainedWithLive, normalizePaneKeySet, sleepingRecordFromEntry, normalizeSleepingAgentSessionCollectOptions, isValidManualSleepLiveAgentEntry, isValidCompletedAgentHibernationEntry, removeSleepingRecordsReplacedByManualWorktreeSleep, collectSleepingAgentSessionRecordsForWorktree, collectHibernatedCompletionEvidenceForWorktree, sleepingRecordsEquivalentIgnoringCaptureTime, recoveryRecordMatches, recoveryRecordTargetsSameSession, copyLaunchConfig, launchConfigsEqual, normalizeLaunchConfigRegistrationMetadata, launchConfigRegistryEntriesEqual } from './agent-status-state'
import type { RetainedAgentEntry, AgentStatusWorktreeShutdownReason, AllAgentSessionCaptureMode, DropAgentStatusByWorktreeOptions, DropHibernatedAgentPaneOptions, DropAgentStatusByTabPrefixOptions, AgentLaunchConfigRegistrationMetadata, AgentLaunchConfigStatusMetadata, AgentLaunchConfigRegistryEntry, AgentStatusSlice, PaneLiveness, CollectSleepingAgentSessionRecordsOptions } from './agent-status-state'
export function registryEntryMatchesStatus(args: {
  entry: AgentLaunchConfigRegistryEntry | undefined
  paneKey: string
  agentType: AgentType | undefined
  tabId: string | undefined
  terminalHandle: string | undefined
  launchToken: string | undefined
  providerSession: AgentProviderSessionMetadata | undefined
  existingProviderSession: AgentProviderSessionMetadata | undefined
  providerSessionChanged: boolean
}): boolean {
  const entry = args.entry
  if (!entry || args.providerSessionChanged) {
    return false
  }
  const identity = entry.identity
  if (identity.agentType !== undefined && identity.agentType !== args.agentType) {
    return false
  }
  if (identity.tabId !== undefined && identity.tabId !== args.tabId) {
    return false
  }
  if (identity.leafId !== undefined && identity.leafId !== getLeafIdFromPaneKey(args.paneKey)) {
    return false
  }
  if (
    identity.terminalHandle !== undefined &&
    (args.terminalHandle === undefined || identity.terminalHandle !== args.terminalHandle)
  ) {
    return false
  }
  if (
    identity.launchToken !== undefined &&
    (args.launchToken === undefined || identity.launchToken !== args.launchToken)
  ) {
    // Why: a missing/mismatched launch token is stale proof even if a later manual/mixed Codex run reused the provider session id.
    return false
  }
  if (identity.providerSession !== undefined) {
    return agentProviderSessionsEqual(
      args.agentType,
      identity.providerSession,
      args.providerSession
    )
  }
  if (identity.launchToken !== undefined) {
    return true
  }
  if (identity.terminalHandle !== undefined) {
    return true
  }
  if (args.existingProviderSession && args.providerSession) {
    return agentProviderSessionsEqual(
      args.agentType,
      args.existingProviderSession,
      args.providerSession
    )
  }
  return false
}
export function getLaunchConfigForEntry(
  state: AppState,
  entry: AgentStatusEntry
): SleepingAgentLaunchConfig | undefined {
  const registryEntry = state.agentLaunchConfigByPaneKey[entry.paneKey]
  const registryLaunchConfig = registryEntryMatchesStatus({
    entry: registryEntry,
    paneKey: entry.paneKey,
    agentType: entry.agentType,
    tabId: entry.tabId ?? getTabIdFromPaneKey(entry.paneKey) ?? undefined,
    terminalHandle: entry.terminalHandle,
    launchToken: undefined,
    providerSession: entry.providerSession,
    existingProviderSession: entry.providerSession,
    providerSessionChanged: false
  })
    ? registryEntry?.launchConfig
    : undefined
  if (registryLaunchConfig) {
    return registryLaunchConfig
  }
  const sleepingRecord = state.sleepingAgentSessionsByPaneKey[entry.paneKey]
  return sleepingRecord?.launchConfig &&
    sleepingRecord.agent === entry.agentType &&
    entry.providerSession &&
    agentProviderSessionsEqual(
      entry.agentType,
      sleepingRecord.providerSession,
      entry.providerSession
    )
    ? sleepingRecord.launchConfig
    : undefined
}

// Why: renderer twin of main's #7561 FIFO-capped closedAgentStatusTabIds — suppresses late
// events for a just-closed tab, but was add-only and grew unbounded, hence this cap.
export const RECENTLY_CLOSED_AGENT_STATUS_TAB_IDS_MAX = 1024
export const RECENTLY_RETIRED_AGENT_STATUS_PANE_KEYS_MAX = 1024

// delete-then-set for LRU recency, then evict oldest keys past the cap (Record iterates
// insertion order); safe because a status for a tab closed >MAX tabs ago cannot still arrive.
export function boundRecentlyClosedAgentStatusTabIds(
  existing: Record<string, true>,
  tabId: string
): Record<string, true> {
  const next: Record<string, true> = {}
  for (const key of Object.keys(existing)) {
    if (key !== tabId) {
      next[key] = true
    }
  }
  next[tabId] = true
  const keys = Object.keys(next)
  if (keys.length > RECENTLY_CLOSED_AGENT_STATUS_TAB_IDS_MAX) {
    for (const stale of keys.slice(0, keys.length - RECENTLY_CLOSED_AGENT_STATUS_TAB_IDS_MAX)) {
      delete next[stale]
    }
  }
  return next
}
export function boundRecentlyRetiredAgentStatusPaneKeys(
  existing: Record<string, true>,
  paneKeys: readonly string[]
): Record<string, true> {
  const additions = new Set(paneKeys)
  const next: Record<string, true> = {}
  for (const key of Object.keys(existing)) {
    if (!additions.has(key)) {
      next[key] = true
    }
  }
  for (const paneKey of additions) {
    next[paneKey] = true
  }
  const keys = Object.keys(next)
  for (const stale of keys.slice(0, -RECENTLY_RETIRED_AGENT_STATUS_PANE_KEYS_MAX)) {
    delete next[stale]
  }
  return next
}
export function movePaneKeyedRecord<T>(
  record: Record<string, T>,
  fromPaneKey: string,
  toPaneKey: string,
  transform: (value: T) => T = (value) => value
): Record<string, T> {
  const value = record[fromPaneKey]
  if (value === undefined || fromPaneKey === toPaneKey) {
    return record
  }
  const next = { ...record }
  delete next[fromPaneKey]
  next[toPaneKey] = transform(value)
  return next
}
export function removePaneKeys<T>(
  record: Record<string, T>,
  paneKeys: ReadonlySet<string>
): Record<string, T> {
  const matchingKeys = Object.keys(record).filter((key) => paneKeys.has(key))
  if (matchingKeys.length === 0) {
    return record
  }
  const next = { ...record }
  for (const key of matchingKeys) {
    delete next[key]
  }
  return next
}
export function getLaunchConfigForStatusMetadata(
  state: AppState,
  metadata: AgentLaunchConfigStatusMetadata
): SleepingAgentLaunchConfig | undefined {
  const registryEntry = state.agentLaunchConfigByPaneKey[metadata.paneKey]
  return registryEntryMatchesStatus({
    entry: registryEntry,
    paneKey: metadata.paneKey,
    agentType: metadata.agentType,
    tabId: metadata.tabId ?? getTabIdFromPaneKey(metadata.paneKey) ?? undefined,
    terminalHandle: metadata.terminalHandle,
    launchToken: metadata.launchToken,
    providerSession: metadata.providerSession,
    existingProviderSession: metadata.existingProviderSession,
    providerSessionChanged: metadata.providerSessionChanged ?? false
  })
    ? registryEntry?.launchConfig
    : undefined
}
export function pruneMigrationUnsupportedEntries(
  entries: Record<string, MigrationUnsupportedPtyEntry>,
  predicate: (entry: MigrationUnsupportedPtyEntry) => boolean
): { next: Record<string, MigrationUnsupportedPtyEntry>; changed: boolean } {
  let changed = false
  const next: Record<string, MigrationUnsupportedPtyEntry> = {}
  for (const [ptyId, entry] of Object.entries(entries)) {
    if (predicate(entry)) {
      changed = true
      continue
    }
    next[ptyId] = entry
  }
  return { next: changed ? next : entries, changed }
}
export function orchestrationContextsEqual(
  a: AgentStatusOrchestrationContext,
  b: AgentStatusOrchestrationContext
): boolean {
  return (
    a.taskId === b.taskId &&
    a.dispatchId === b.dispatchId &&
    a.taskTitle === b.taskTitle &&
    a.displayName === b.displayName &&
    a.parentTerminalHandle === b.parentTerminalHandle &&
    a.parentPaneKey === b.parentPaneKey &&
    a.coordinatorHandle === b.coordinatorHandle &&
    a.orchestrationRunId === b.orchestrationRunId
  )
}
export function orchestrationMapsEqual(
  a: Record<string, AgentStatusOrchestrationContext>,
  b: Record<string, AgentStatusOrchestrationContext>
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every((key) => b[key] !== undefined && orchestrationContextsEqual(a[key]!, b[key]!))
}
export function mergeCurrentOrchestrationContext(
  existing: AgentStatusOrchestrationContext | undefined,
  current: AgentStatusOrchestrationContext
): AgentStatusOrchestrationContext {
  if (!existing) {
    return current
  }
  const sameDispatch =
    existing.taskId === current.taskId && existing.dispatchId === current.dispatchId
  if (!sameDispatch) {
    return current
  }
  const merged = { ...existing, ...current }
  return orchestrationContextsEqual(existing, merged) ? existing : merged
}

// Why: relay/daemon teardown drops main's rows, but renderer entries whose connectionId stamp never
// matched (unstamped over SSH) survive and stay "fresh" 30 min (#9030). Resolve each worktree's host
// via the canonical hostId-first precedence and keep only ids UNAMBIGUOUSLY on this connection — a
// worktree id is `${repoId}::${path}` (no host component), so the same project mirrored at the same
// path on two hosts yields one shared id that must not clear another host's live rows.
export function collectWorktreeIdsForConnection(state: AppState, connectionId: string): Set<string> {
  const hostIdsOnConnection = new Set(
    state.repos
      .filter((repo) => repo.connectionId === connectionId)
      .map((repo) => getRepoExecutionHostId(repo))
  )
  if (hostIdsOnConnection.size === 0) {
    return new Set()
  }
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo] as const))
  const onConnection = new Set<string>()
  const onOtherHost = new Set<string>()
  for (const [repoId, worktrees] of Object.entries(state.worktreesByRepo)) {
    const repo = repoById.get(repoId)
    for (const worktree of worktrees) {
      const bucket = hostIdsOnConnection.has(getWorktreeExecutionHostId(worktree, repo))
        ? onConnection
        : onOtherHost
      bucket.add(worktree.id)
    }
  }
  // A worktree id that also lives on another host is ambiguous — leave it rather than hide a live row.
  for (const id of onOtherHost) {
    onConnection.delete(id)
  }
  return onConnection
}
