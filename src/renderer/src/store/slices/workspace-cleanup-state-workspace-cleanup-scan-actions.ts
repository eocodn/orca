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
import {
  applyDismissal,
  enrichWorkspaceCleanupCandidates,
  enrichWorkspaceCleanupCandidatesWithCache,
  getInitialWorkspaceCleanupGitDeferrals,
  preflightWorkspaceCleanupCandidate
} from './workspace-cleanup-state'
import {
  AGENT_PROCESS_NAMES,
  RECENT_VISIBLE_CONTEXT_MS,
  SHELL_PROCESS_NAMES,
  VIEWED_FROM_CLEANUP_MS,
  WORKSPACE_CLEANUP_CONCRETE_RISK_BLOCKERS,
  WORKSPACE_CLEANUP_PREFLIGHT_CONCURRENCY,
  type WorkspaceCleanupEnrichmentCacheEntry,
  type WorkspaceCleanupFailure,
  type WorkspaceCleanupRemoveOptions,
  type WorkspaceCleanupSlice
} from './workspace-cleanup-state-workspace-cleanup-failure-support'

let inFlightWorkspaceCleanupScan: {
  key: string
  promise: Promise<WorkspaceCleanupScanResult>
} | null = null
let latestWorkspaceCleanupScanToken = 0
let finalizedWorkspaceCleanupScanToken = 0
let workspaceCleanupProgressQueue: {
  scanToken: number
  promise: Promise<void>
} | null = null
let workspaceCleanupEnrichmentCache: {
  scanToken: number
  entries: Map<string, WorkspaceCleanupEnrichmentCacheEntry>
} | null = null
let workspaceCleanupProgressCandidateIndex: {
  scanToken: number
  scanId: string
  candidates: WorkspaceCleanupCandidate[]
  indexesByWorktreeId: Map<string, number>
} | null = null
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
  }
}
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
