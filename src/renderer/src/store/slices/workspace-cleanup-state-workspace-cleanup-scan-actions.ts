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
export function createWorkspaceCleanupSliceWorkspaceCleanupScanActions(set: SliceSet, get: SliceGet) {
  return {
  workspaceCleanupScan: null,
  workspaceCleanupProgress: null,
  workspaceCleanupLoading: false,
  workspaceCleanupError: null,
  workspaceCleanupDismissals: {},
  workspaceCleanupViewedCandidates: {},
  scanWorkspaceCleanup: async (args) => {
    if (args?.worktreeId !== undefined) {
      const scan = await window.api.workspaceCleanup.scan(args)
      const enriched = await enrichWorkspaceCleanupCandidates(scan.candidates, get(), {
        applyDismissals: false
      })
      return { ...scan, candidates: enriched }
    }

    const scanArgs = {
      ...args,
      skipGitWorktreeIds: [
        ...new Set([
          ...(args?.skipGitWorktreeIds ?? []),
          ...getInitialWorkspaceCleanupGitDeferrals(get())
        ])
      ]
    }
    const scanKey = getWorkspaceCleanupScanKey(scanArgs)

    if (inFlightWorkspaceCleanupScan?.key === scanKey) {
      set({ workspaceCleanupLoading: true, workspaceCleanupError: null })
      try {
        return await inFlightWorkspaceCleanupScan.promise
      } finally {
        if (!inFlightWorkspaceCleanupScan) {
          set({ workspaceCleanupLoading: false })
        }
      }
    }

    set({
      workspaceCleanupLoading: true,
      workspaceCleanupProgress: null,
      workspaceCleanupError: null
    })
    const scanToken = ++latestWorkspaceCleanupScanToken
    finalizedWorkspaceCleanupScanToken = 0
    workspaceCleanupProgressQueue = null
    workspaceCleanupEnrichmentCache = { scanToken, entries: new Map() }
    workspaceCleanupProgressCandidateIndex = null
    const promise = (async () => {
      const scan = await window.api.workspaceCleanup.scan(scanArgs, (progress) => {
        enqueueWorkspaceCleanupProgress(progress, scanToken, get, set)
      })
      const enriched = await enrichWorkspaceCleanupCandidatesForScan(
        scan.candidates,
        get(),
        scanToken
      )
      const result = { ...scan, candidates: enriched }
      if (scanToken === latestWorkspaceCleanupScanToken) {
        finalizedWorkspaceCleanupScanToken = scanToken
        workspaceCleanupEnrichmentCache = null
        workspaceCleanupProgressCandidateIndex = null
        set({
          workspaceCleanupScan: result,
          workspaceCleanupProgress: {
            scanId: get().workspaceCleanupProgress?.scanId ?? scanArgs.scanId ?? '',
            scannedAt: result.scannedAt,
            scannedWorktreeCount: result.candidates.length,
            totalWorktreeCount: result.candidates.length,
            candidates: result.candidates,
            errors: result.errors
          },
          workspaceCleanupLoading: false
        })
      }
      return result
    })()
    inFlightWorkspaceCleanupScan = { key: scanKey, promise }

    try {
      return await promise
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (scanToken === latestWorkspaceCleanupScanToken) {
        set({ workspaceCleanupError: message, workspaceCleanupLoading: false })
      }
      throw error
    } finally {
      if (inFlightWorkspaceCleanupScan?.promise === promise) {
        inFlightWorkspaceCleanupScan = null
      }
    }
  },
  markWorkspaceCleanupCandidateViewed: (candidate) => {
    set((state) => ({
      workspaceCleanupViewedCandidates: {
        ...state.workspaceCleanupViewedCandidates,
        [candidate.worktreeId]: {
          viewedAt: Date.now(),
          fingerprint: candidate.fingerprint,
          wasSuggested: candidate.tier === 'ready' && canSelectWorkspaceCleanupCandidate(candidate)
        }
      }
    }))
  },
  dismissWorkspaceCleanupCandidates: async (candidates) => {
    const now = Date.now()
    const dismissals = candidates.map((candidate) => ({
      worktreeId: candidate.worktreeId,
      dismissedAt: now,
      fingerprint: candidate.fingerprint,
      classifierVersion: WORKSPACE_CLEANUP_CLASSIFIER_VERSION
    }))

    set((state) => {
      const nextDismissals = { ...state.workspaceCleanupDismissals }
      for (const dismissal of dismissals) {
        nextDismissals[dismissal.worktreeId] = dismissal
      }
      const nextScan = state.workspaceCleanupScan
        ? {
            ...state.workspaceCleanupScan,
            candidates: state.workspaceCleanupScan.candidates.map((candidate) =>
              applyDismissal(candidate, nextDismissals)
            )
          }
        : state.workspaceCleanupScan
      return {
        workspaceCleanupDismissals: nextDismissals,
        workspaceCleanupScan: nextScan
      }
    })

    await window.api.workspaceCleanup.dismiss({ dismissals })
  },
  resetWorkspaceCleanupDismissals: async () => {
    set((state) => ({
      workspaceCleanupDismissals: {},
      workspaceCleanupScan: state.workspaceCleanupScan
        ? {
            ...state.workspaceCleanupScan,
            candidates: state.workspaceCleanupScan.candidates.map((candidate) =>
              applyWorkspaceCleanupPolicy({
                ...candidate,
                blockers: candidate.blockers.filter((blocker) => blocker !== 'dismissed')
              })
            )
          }
        : state.workspaceCleanupScan
    }))
    await window.api.workspaceCleanup.clearDismissals()
  },
  removeWorkspaceCleanupCandidates: async (worktreeIds, options) => {
    const removedIds: string[] = []
    const failures: WorkspaceCleanupFailure[] = []
    const approvedCandidatesByWorktreeId = new Map(
      (options?.approvedCandidates ?? []).map((candidate) => [candidate.worktreeId, candidate])
    )

    const preflights = await mapWithConcurrency(
      worktreeIds,
      WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY,
      (worktreeId) =>
        preflightWorkspaceCleanupCandidate(
          worktreeId,
          get,
          approvedCandidatesByWorktreeId.get(worktreeId)
        )
    )
    const candidatesToRemove: WorkspaceCleanupCandidate[] = []

    for (const preflight of preflights) {
      if (!preflight.ok) {
        failures.push(preflight.failure)
        continue
      }
      candidatesToRemove.push(preflight.candidate)
    }

    // Why: nested workspaces can belong to different repos; parent removal must
    // not race child cleanup hooks, PTY teardown, or metadata deletion.
    for (const candidate of [...candidatesToRemove].sort((a, b) => b.path.length - a.path.length)) {
      const result = await get().removeWorktree(
        candidate.worktreeId,
        shouldForceWorkspaceCleanupRemoval(candidate),
        // Why: cleanup reports outcomes in its own summary toasts; per-row
        // preserved-branch warnings would stack one toast per removed row.
        { suppressPreservedBranchToast: true }
      )
      if (result.ok) {
        removedIds.push(candidate.worktreeId)
      } else {
        failures.push({
          worktreeId: candidate.worktreeId,
          displayName: candidate.displayName,
          message: result.error
        })
      }
    }

    if (removedIds.length > 0) {
      invalidateWorkspaceCleanupScanProgress()
      const removedIdSet = new Set(removedIds)
      set((state) => ({
        workspaceCleanupLoading: false,
        workspaceCleanupScan: state.workspaceCleanupScan
          ? {
              ...state.workspaceCleanupScan,
              candidates: state.workspaceCleanupScan.candidates.filter(
                (candidate) => !removedIdSet.has(candidate.worktreeId)
              )
            }
          : state.workspaceCleanupScan
      }))
    }

    return { removedIds, failures }
  }
})

function getWorkspaceCleanupScanKey(args: WorkspaceCleanupScanArgs): string {
  return JSON.stringify({
    skipGitWorktreeIds: [...new Set(args.skipGitWorktreeIds ?? [])].sort()
  })
}

function invalidateWorkspaceCleanupScanProgress(): void {
  latestWorkspaceCleanupScanToken += 1
  finalizedWorkspaceCleanupScanToken = 0
  inFlightWorkspaceCleanupScan = null
  workspaceCleanupProgressQueue = null
  workspaceCleanupEnrichmentCache = null
  workspaceCleanupProgressCandidateIndex = null
}

function enqueueWorkspaceCleanupProgress(
  progress: WorkspaceCleanupScanProgress,
  scanToken: number,
  getState: () => AppState,
  setState: (
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>),
    replace?: false
  ) => void
): void {
  if (
    scanToken !== latestWorkspaceCleanupScanToken ||
    scanToken === finalizedWorkspaceCleanupScanToken
  ) {
    return
  }
  const previous =
    workspaceCleanupProgressQueue?.scanToken === scanToken
      ? workspaceCleanupProgressQueue.promise
      : Promise.resolve()
  const promise = previous
    .catch(() => undefined)
    .then(() => applyWorkspaceCleanupProgress(progress, scanToken, getState, setState))
    .catch((error: unknown) => {
      console.error('Workspace cleanup progress update failed', error)
    })
  workspaceCleanupProgressQueue = { scanToken, promise }
}

async function applyWorkspaceCleanupProgress(
  progress: WorkspaceCleanupScanProgress,
  scanToken: number,
  getState: () => AppState,
  }
}