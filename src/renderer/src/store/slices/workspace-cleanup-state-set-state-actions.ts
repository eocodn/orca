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
import { RECENT_VISIBLE_CONTEXT_MS, VIEWED_FROM_CLEANUP_MS, WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY, WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS, SHELL_PROCESS_NAMES, AGENT_PROCESS_NAMES } from './workspace-cleanup-state'
import type { WorkspaceCleanupFailure, WorkspaceCleanupRemoveResult, WorkspaceCleanupRemoveOptions, WorkspaceCleanupViewedCandidate, WorkspaceCleanupSlice, EnrichOptions, WorkspaceCleanupEnrichmentCacheEntry } from './workspace-cleanup-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createWorkspaceCleanupSliceSetStateActions2(set: SliceSet, get: SliceGet) {
  return {
  setState: (
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
    replace?: false
  ) => void
): Promise<void> {
  if (
    scanToken !== latestWorkspaceCleanupScanToken ||
    scanToken === finalizedWorkspaceCleanupScanToken
  ) {
    return
  }
  const state = getState()
  const previousCandidates =
    progress.candidateMode === 'append' &&
    state.workspaceCleanupProgress?.scanId === progress.scanId
      ? state.workspaceCleanupProgress.candidates
      : []
  const enrichedProgressCandidates = await enrichWorkspaceCleanupCandidatesForScan(
    progress.candidates,
    state,
    scanToken
  )
  if (
    scanToken !== latestWorkspaceCleanupScanToken ||
    scanToken === finalizedWorkspaceCleanupScanToken
  ) {
    return
  }
  const candidates = mergeWorkspaceCleanupProgressCandidates({
    previousCandidates,
    nextCandidates: enrichedProgressCandidates,
    progress,
    scanToken
  })
  if (
    scanToken !== latestWorkspaceCleanupScanToken ||
    scanToken === finalizedWorkspaceCleanupScanToken
  ) {
    workspaceCleanupProgressCandidateIndex = null
    return
  }
  setState((state) => {
    if (
      state.workspaceCleanupProgress?.scanId === progress.scanId &&
      state.workspaceCleanupProgress.scannedWorktreeCount > progress.scannedWorktreeCount
    ) {
      return {}
    }
    return {
      workspaceCleanupScan: {
        scannedAt: progress.scannedAt,
        candidates,
        errors: progress.errors
      },
      workspaceCleanupProgress: { ...progress, candidates }
    }
  })
}

async function enrichWorkspaceCleanupCandidatesForScan(
  candidates: readonly WorkspaceCleanupCandidate[],
  state: AppState,
  scanToken: number
): Promise<WorkspaceCleanupCandidate[]> {
  if (workspaceCleanupEnrichmentCache?.scanToken !== scanToken) {
    workspaceCleanupEnrichmentCache = { scanToken, entries: new Map() }
  }
  return enrichWorkspaceCleanupCandidatesWithCache(
    candidates,
    state,
    workspaceCleanupEnrichmentCache.entries
  )
}

function mergeWorkspaceCleanupProgressCandidates({
  previousCandidates,
  nextCandidates,
  progress,
  scanToken
}: {
  previousCandidates: readonly WorkspaceCleanupCandidate[]
  nextCandidates: readonly WorkspaceCleanupCandidate[]
  progress: WorkspaceCleanupScanProgress
  scanToken: number
  }
}