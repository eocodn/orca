/*    enrichment, dismissals, and destructive preflight/delete orchestration share
   one store state contract. */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import {
  WORKSPACE_CLEANUP_CLASSIFIER_VERSION,
  applyWorkspaceCleanupPolicy,
  canQueueWorkspaceCleanupCandidate,
  canSelectWorkspaceCleanupCandidate,
  shouldForceWorkspaceCleanupRemoval,
  shouldHideWorkspaceCleanupCandidate,
  type WorkspaceCleanupBlocker,
  type WorkspaceCleanupCandidate,
  type WorkspaceCleanupDismissal,
  type WorkspaceCleanupScanArgs,
  type WorkspaceCleanupScanProgress,
  type WorkspaceCleanupScanResult
} from '../../../../shared/workspace-cleanup'
import { mapWithConcurrency } from '../../../../shared/map-with-concurrency'
import { classifyTitleActivity, isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { translate } from '@/i18n/i18n'

import { RECENT_VISIBLE_CONTEXT_MS, VIEWED_FROM_CLEANUP_MS, WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY, WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS, SHELL_PROCESS_NAMES, AGENT_PROCESS_NAMES } from './workspace-cleanup-state-workspace-cleanup-failure-support'
import type { WorkspaceCleanupFailure, WorkspaceCleanupRemoveResult, WorkspaceCleanupRemoveOptions, WorkspaceCleanupViewedCandidate, WorkspaceCleanupSlice, EnrichOptions, WorkspaceCleanupEnrichmentCacheEntry } from './workspace-cleanup-state-workspace-cleanup-failure-support'
export { RECENT_VISIBLE_CONTEXT_MS, VIEWED_FROM_CLEANUP_MS, WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY, WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS, SHELL_PROCESS_NAMES, AGENT_PROCESS_NAMES }
export type { WorkspaceCleanupFailure, WorkspaceCleanupRemoveResult, WorkspaceCleanupRemoveOptions, WorkspaceCleanupViewedCandidate, WorkspaceCleanupSlice, EnrichOptions, WorkspaceCleanupEnrichmentCacheEntry }
import { createWorkspaceCleanupSliceWorkspaceCleanupScanActions } from './workspace-cleanup-state-workspace-cleanup-scan-actions'
import { createWorkspaceCleanupSliceSetStateActions2 } from './workspace-cleanup-state-set-state-actions'

let workspaceCleanupProgressCandidateIndex: {
  scanToken: number
  scanId: string
  candidates: WorkspaceCleanupCandidate[]
  indexesByWorktreeId: Map<string, number>
} | null = null

export const createWorkspaceCleanupSlice: StateCreator<AppState, [], [], WorkspaceCleanupSlice> = (
  set,
  get
) => ({
  ...createWorkspaceCleanupSliceWorkspaceCleanupScanActions(set, get),
  ...createWorkspaceCleanupSliceSetStateActions2(set, get),
})

export function mergeWorkspaceCleanupProgressCandidates({
  previousCandidates,
  nextCandidates,
  progress,
  scanToken
}: {
  previousCandidates: readonly WorkspaceCleanupCandidate[]
  nextCandidates: readonly WorkspaceCleanupCandidate[]
  progress: WorkspaceCleanupScanProgress
  scanToken: number
}): WorkspaceCleanupCandidate[] {
  if (progress.candidateMode !== 'append') {
    workspaceCleanupProgressCandidateIndex = null
    return [...nextCandidates]
  }

  if (nextCandidates.length === 0) {
    return previousCandidates as WorkspaceCleanupCandidate[]
  }

  const indexCache = getWorkspaceCleanupProgressCandidateIndex(
    previousCandidates,
    progress.scanId,
    scanToken
  )
  const merged = [...indexCache.candidates]
  for (const candidate of nextCandidates) {
    const existingIndex = indexCache.indexesByWorktreeId.get(candidate.worktreeId)
    if (existingIndex === undefined) {
      indexCache.indexesByWorktreeId.set(candidate.worktreeId, merged.length)
      merged.push(candidate)
      continue
    }
    merged[existingIndex] = candidate
  }
  workspaceCleanupProgressCandidateIndex = {
    scanToken,
    scanId: progress.scanId,
    candidates: merged,
    indexesByWorktreeId: indexCache.indexesByWorktreeId
  }
  return merged
}

function getWorkspaceCleanupProgressCandidateIndex(
  candidates: readonly WorkspaceCleanupCandidate[],
  scanId: string,
  scanToken: number
): {
  candidates: WorkspaceCleanupCandidate[]
  indexesByWorktreeId: Map<string, number>
} {
  if (
    workspaceCleanupProgressCandidateIndex?.scanToken === scanToken &&
    workspaceCleanupProgressCandidateIndex.scanId === scanId &&
    workspaceCleanupProgressCandidateIndex.candidates === candidates
  ) {
    return workspaceCleanupProgressCandidateIndex
  }

  return {
    candidates: [...candidates],
    indexesByWorktreeId: new Map(
      candidates.map((candidate, index) => [candidate.worktreeId, index])
    )
  }
}

export function getInitialWorkspaceCleanupGitDeferrals(state: AppState): string[] {
  const ids = new Set<string>()
  if (state.activeWorktreeId) {
    ids.add(state.activeWorktreeId)
  }

  for (const file of state.openFiles) {
    if (file.isDirty || state.editorDrafts[file.id] !== undefined) {
      ids.add(file.worktreeId)
    }
  }

  const openEditorWorktreeIds = new Set(state.openFiles.map((file) => file.worktreeId))
  for (const [worktreeId, tabs] of Object.entries(state.tabsByWorktree)) {
    const tabIds = new Set(tabs.map((tab) => tab.id))
    if (tabs.some((tab) => (state.ptyIdsByTabId[tab.id]?.length ?? 0) > 0)) {
      ids.add(worktreeId)
    }
    if (hasFreshLiveAgent(state, tabIds) || hasWorkingTitleAgent(state, tabs)) {
      ids.add(worktreeId)
    }
  }

  for (const worktreeId of new Set([
    ...openEditorWorktreeIds,
    ...Object.keys(state.browserTabsByWorktree)
  ])) {
    const hasVisibleContext =
      openEditorWorktreeIds.has(worktreeId) ||
      (state.browserTabsByWorktree[worktreeId]?.length ?? 0) > 0
    const lastVisitedAt = state.lastVisitedAtByWorktreeId[worktreeId] ?? 0
    if (
      hasVisibleContext &&
      lastVisitedAt > 0 &&
      Date.now() - lastVisitedAt <= RECENT_VISIBLE_CONTEXT_MS
    ) {
      ids.add(worktreeId)
    }
  }

  // Why: these rows must stay visible, but they already need user attention.
  // Defer expensive git reads until a focused refresh/remove preflight.
  return [...ids]
}

export async function enrichWorkspaceCleanupCandidates(
  candidates: readonly WorkspaceCleanupCandidate[],
  state: AppState,
  options: EnrichOptions = {}
): Promise<WorkspaceCleanupCandidate[]> {
  return Promise.all(
    candidates.map((candidate) => enrichWorkspaceCleanupCandidate(candidate, state, options))
  )
}

export async function enrichWorkspaceCleanupCandidatesWithCache(
  candidates: readonly WorkspaceCleanupCandidate[],
  state: AppState,
  cache: Map<string, WorkspaceCleanupEnrichmentCacheEntry>,
  options: EnrichOptions = {}
): Promise<WorkspaceCleanupCandidate[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      const inputSignature = getWorkspaceCleanupCandidateInputSignature(candidate)
      const localSignature = getWorkspaceCleanupLocalStateSignature(
        candidate.worktreeId,
        state,
        options
      )
      const cached = cache.get(candidate.worktreeId)
      if (cached?.inputSignature === inputSignature && cached.localSignature === localSignature) {
        return cached.candidate
      }

      const enriched = await enrichWorkspaceCleanupCandidate(candidate, state, options)
      cache.set(candidate.worktreeId, {
        inputSignature,
        localSignature,
        candidate: enriched
      })
      return enriched
    })
  )
}

function getWorkspaceCleanupCandidateInputSignature(candidate: WorkspaceCleanupCandidate): string {
  return JSON.stringify({
    fingerprint: candidate.fingerprint,
    blockers: candidate.blockers,
    reasons: candidate.reasons,
    git: candidate.git,
    lastActivityAt: candidate.lastActivityAt,
    createdAt: candidate.createdAt,
    path: candidate.path,
    branch: candidate.branch
  })
}

function getWorkspaceCleanupLocalStateSignature(
  worktreeId: string,
  state: AppState,
  options: EnrichOptions
): string {
  const tabs = state.tabsByWorktree[worktreeId] ?? []
  const tabIds = tabs.map((tab) => tab.id)
  const tabIdSet = new Set(tabIds)
  const openFiles = state.openFiles
    .filter((file) => file.worktreeId === worktreeId)
    .map((file) => ({
      id: file.id,
      isDirty: file.isDirty,
      hasDraft: state.editorDrafts[file.id] !== undefined
    }))
  const retainedDoneAgentPaneKeys = Object.entries(state.retainedAgentsByPaneKey)
    .filter(([, entry]) => entry.worktreeId === worktreeId && entry.entry.state === 'done')
    .map(([paneKey]) => paneKey)
    .sort()
  const agentStatuses = Object.values(state.agentStatusByPaneKey)
    .filter((entry) => tabIdSet.has(getPaneKeyTabId(entry.paneKey)))
    .map((entry) => ({
      paneKey: entry.paneKey,
      state: entry.state,
      updatedAt: entry.updatedAt
    }))
    .sort((a, b) => a.paneKey.localeCompare(b.paneKey))
  const ptyIdsByTabId = Object.fromEntries(
    tabIds.map((tabId) => [tabId, state.ptyIdsByTabId[tabId] ?? []])
  )
  const runtimePaneTitlesByTabId = Object.fromEntries(
    tabIds.map((tabId) => [tabId, state.runtimePaneTitlesByTabId[tabId] ?? {}])
  )
  const terminalLayoutsByTabId = Object.fromEntries(
    tabIds.map((tabId) => [tabId, state.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId ?? {}])
  )
  const dismissal =
    options.applyDismissals === false
      ? null
      : (state.workspaceCleanupDismissals[worktreeId] ?? null)

  return JSON.stringify({
    active: state.activeWorktreeId === worktreeId,
    tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title })),
    ptyIdsByTabId,
    runtimePaneTitlesByTabId,
    terminalLayoutsByTabId,
    openFiles,
    browserTabCount: (state.browserTabsByWorktree[worktreeId] ?? []).length,
    retainedDoneAgentPaneKeys,
    agentStatuses,
    lastVisitedAt: state.lastVisitedAtByWorktreeId[worktreeId] ?? 0,
    viewed: state.workspaceCleanupViewedCandidates[worktreeId] ?? null,
    dismissal
  })
}

async function enrichWorkspaceCleanupCandidate(
  candidate: WorkspaceCleanupCandidate,
  state: AppState,
  options: EnrichOptions
): Promise<WorkspaceCleanupCandidate> {
  const tabs = state.tabsByWorktree[candidate.worktreeId] ?? []
  const tabIds = new Set(tabs.map((tab) => tab.id))
  const openFiles = state.openFiles.filter((file) => file.worktreeId === candidate.worktreeId)
  const dirtyEditorBuffers = openFiles.filter(
    (file) => file.isDirty || state.editorDrafts[file.id] !== undefined
  )
  const cleanEditorTabCount = openFiles.length - dirtyEditorBuffers.length
  const browserTabCount = (state.browserTabsByWorktree[candidate.worktreeId] ?? []).length
  const retainedDoneAgentCount = Object.values(state.retainedAgentsByPaneKey).filter(
    (entry) => entry.worktreeId === candidate.worktreeId && entry.entry.state === 'done'
  ).length
  const blockers = candidate.blockers.filter((blocker) => blocker !== 'dismissed')
  const preserveCleanupInspection = shouldPreserveCleanupInspection(candidate, state)

  if (state.activeWorktreeId === candidate.worktreeId) {
    blockers.push('active-workspace')
  }
  if (dirtyEditorBuffers.length > 0) {
    blockers.push('dirty-editor-buffer')
  }
  if (hasFreshLiveAgent(state, tabIds)) {
    blockers.push('live-agent')
  }
  if (hasWorkingTitleAgent(state, tabs)) {
    blockers.push('live-agent')
  }

  const terminalProbe = await probeTerminalLiveness(state, tabs)
  if (terminalProbe === 'running') {
    blockers.push('running-terminal')
  } else if (terminalProbe === 'unknown') {
    blockers.push('terminal-liveness-unknown')
  }

  const lastVisitedAt = state.lastVisitedAtByWorktreeId[candidate.worktreeId] ?? 0
  const hasVisibleContext = cleanEditorTabCount > 0 || browserTabCount > 0
  if (
    hasVisibleContext &&
    !preserveCleanupInspection &&
    lastVisitedAt > 0 &&
    Date.now() - lastVisitedAt <= RECENT_VISIBLE_CONTEXT_MS
  ) {
    blockers.push('recent-visible-context')
  }

  const enriched = applyWorkspaceCleanupPolicy({
    ...candidate,
    blockers: [...new Set(blockers)],
    localContext: {
      ...candidate.localContext,
      terminalTabCount: tabs.length,
      cleanEditorTabCount,
      browserTabCount,
      retainedDoneAgentCount
    }
  })

  return options.applyDismissals === false
    ? enriched
    : applyDismissal(enriched, state.workspaceCleanupDismissals)
}

function shouldPreserveCleanupInspection(
  candidate: WorkspaceCleanupCandidate,
  state: AppState
): boolean {
  const viewed = state.workspaceCleanupViewedCandidates[candidate.worktreeId]
  if (!viewed?.wasSuggested || viewed.fingerprint !== candidate.fingerprint) {
    return false
  }
  // Why: View is part of cleanup review. It should not make the same
  // suggested row vanish on the next scan, but this exception must expire.
  return Date.now() - viewed.viewedAt <= VIEWED_FROM_CLEANUP_MS
}

export function applyDismissal(
  candidate: WorkspaceCleanupCandidate,
  dismissals: Record<string, WorkspaceCleanupDismissal>
): WorkspaceCleanupCandidate {
  if (!shouldHideWorkspaceCleanupCandidate(candidate, dismissals[candidate.worktreeId])) {
    return candidate
  }
  return applyWorkspaceCleanupPolicy({
    ...candidate,
    blockers: [...new Set<WorkspaceCleanupBlocker>([...candidate.blockers, 'dismissed'])]
  })
}

export async function preflightWorkspaceCleanupCandidate(
  worktreeId: string,
  getState: () => AppState,
  approvedCandidate?: WorkspaceCleanupCandidate
): Promise<
  | { ok: true; candidate: WorkspaceCleanupCandidate }
  | { ok: false; failure: WorkspaceCleanupFailure }
> {
  const scan = await window.api.workspaceCleanup.scan({ worktreeId })
  const [candidate] = await enrichWorkspaceCleanupCandidates(scan.candidates, getState(), {
    applyDismissals: false
  })
  if (!candidate) {
    return {
      ok: false,
      failure: {
        worktreeId,
        displayName: worktreeId,
        message: translate(
          'auto.store.slices.workspace.cleanup.9d6e531da6',
          'Workspace no longer exists.'
        )
      }
    }
  }
  if (!canQueueWorkspaceCleanupCandidate(candidate)) {
    return {
      ok: false,
      failure: {
        worktreeId,
        displayName: candidate.displayName,
        message: candidate.blockers.length
          ? candidate.blockers.join(', ')
          : 'Workspace needs another look before removal.'
      }
    }
  }
  // Why: this row may be removed minutes after the confirm click. If it now
  // needs a force removal the user never approved (new dirt, unpushed work,
  // or a git error since confirmation), fail it instead of force-deleting.
  if (approvedCandidate) {
    const escalatedToForce =
      shouldForceWorkspaceCleanupRemoval(candidate) &&
      !shouldForceWorkspaceCleanupRemoval(approvedCandidate)
    // Why: an approved row that was already force-flagged for an unverifiable
    // reason must still fail when real dirt/unpushed work is now visible.
    const revealedConcreteRisk = WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS.some(
      (blocker) =>
        candidate.blockers.includes(blocker) && !approvedCandidate.blockers.includes(blocker)
    )
    if (escalatedToForce || revealedConcreteRisk) {
      return {
        ok: false,
        failure: {
          worktreeId,
          displayName: candidate.displayName,
          message: translate(
            'auto.store.slices.workspace.cleanup.changedSinceConfirmation',
            'Workspace changed after confirmation. Refresh to review it before removing.'
          )
        }
      }
    }
  }
  return { ok: true, candidate }
}

function hasFreshLiveAgent(state: AppState, tabIds: Set<string>): boolean {
  const now = Date.now()
  return Object.values(state.agentStatusByPaneKey).some(
    (entry) =>
      tabIds.has(getPaneKeyTabId(entry.paneKey)) &&
      isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS) &&
      (entry.state === 'working' || entry.state === 'blocked' || entry.state === 'waiting')
  )
}

function hasWorkingTitleAgent(state: AppState, tabs: { id: string; title: string }[]): boolean {
  for (const tab of tabs) {
    if ((state.ptyIdsByTabId[tab.id]?.length ?? 0) === 0) {
      continue
    }
    const paneTitles = state.runtimePaneTitlesByTabId[tab.id]
    const titles =
      paneTitles && Object.keys(paneTitles).length > 0 ? Object.values(paneTitles) : [tab.title]
    for (const title of titles) {
      const status = classifyTitleActivity(title)
      if (status === 'working' || status === 'permission') {
        return true
      }
    }
  }
  return false
}

async function probeTerminalLiveness(
  state: AppState,
  tabs: { id: string; title: string }[]
): Promise<'idle' | 'running' | 'unknown'> {
  const ptyChecks = tabs.flatMap((tab) =>
    (state.ptyIdsByTabId[tab.id] ?? []).map((ptyId) => ({ tab, ptyId }))
  )
  if (ptyChecks.length === 0) {
    return 'idle'
  }

  let unknown = false
  for (const { tab, ptyId } of ptyChecks) {
    try {
      const [hasChildProcesses, foregroundProcess] = await Promise.all([
        window.api.pty.hasChildProcesses(ptyId),
        window.api.pty.getForegroundProcess(ptyId)
      ])
      const processName = normalizeProcessName(foregroundProcess)
      if (!hasChildProcesses && (!processName || SHELL_PROCESS_NAMES.has(processName))) {
        continue
      }
      if (
        processName &&
        AGENT_PROCESS_NAMES.has(processName) &&
        hasIdleAgentTitleForPty(state, tab, ptyId)
      ) {
        continue
      }
      return 'running'
    } catch {
      unknown = true
    }
  }

  return unknown ? 'unknown' : 'idle'
}

function hasIdleAgentTitleForPty(
  state: AppState,
  tab: { id: string; title: string },
  ptyId: string
): boolean {
  const paneTitles = state.runtimePaneTitlesByTabId[tab.id] ?? {}
  const layoutPtyIds = state.terminalLayoutsByTabId?.[tab.id]?.ptyIdsByLeafId ?? {}
  const matchingTitles = Object.entries(layoutPtyIds)
    .filter(([, leafPtyId]) => leafPtyId === ptyId)
    .map(([leafId]) => paneTitles[leafId.replace(/^pane:/, '')])
    .filter((title): title is string => typeof title === 'string')

  if (matchingTitles.length > 0) {
    return matchingTitles.some(isIdleAgentTitle)
  }

  // Why: without a pane->PTY binding, a tab-level idle title is safe evidence
  // only when this tab has a single live PTY. Multi-pane tabs stay protected.
  const tabPtyIds = state.ptyIdsByTabId[tab.id] ?? []
  if (tabPtyIds.length !== 1) {
    return false
  }

  const titles = Object.keys(paneTitles).length > 0 ? Object.values(paneTitles) : [tab.title]
  return titles.some(isIdleAgentTitle)
}

function isIdleAgentTitle(title: string): boolean {
  return classifyTitleActivity(title) === 'idle'
}

function getPaneKeyTabId(paneKey: AgentStatusEntry['paneKey']): string {
  const separatorIndex = paneKey.lastIndexOf(':')
  return separatorIndex === -1 ? paneKey : paneKey.slice(0, separatorIndex)
}

function normalizeProcessName(value: string | null): string | null {
  if (!value) {
    return null
  }
  const normalizedPath = value.replace(/\\/g, '/')
  const name = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1).toLowerCase()
  return name.replace(/\.exe$/i, '.exe')
}
