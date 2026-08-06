import { useEffect } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { installWindowVisibilityTimeoutPoller } from '@/lib/window-visibility-timeout-poller'
import {
  shouldCoalesceChecksPanelGitStatusSnapshotRefresh,
  shouldPollChecksPanelRuntimeSshStatus
} from './checks-panel-git-status-snapshot'
import type { ChecksPanelReview } from './checks-panel-review'
import type { PRCheckDetail } from '../../../../shared/types'

const RUNTIME_SSH_STATUS_REFRESH_MS = 3000

export function useChecksPanelRuntimePolling(args: {
  activeGitLabReview: (ChecksPanelReview & { provider: 'gitlab' }) | null
  fetchChecks: () => Promise<void>
  fetchGitLabDetails: () => Promise<void>
  gitStatusSnapshotInFlightContextRef: { current: string | null }
  gitStatusSnapshotRerunContextRef: { current: string | null }
  isPanelVisible: boolean
  panelContextKeyRef: { current: string }
  pollIntervalRef: { current: number }
  prevChecksRef: { current: string }
  prNumber: number | null
  runtimeEnvironmentId: string | null
  repoConnectionId: string | null
  setGitStatusRefreshNonce: (updater: (value: number) => number) => void
  setChecks: (value: PRCheckDetail[]) => void
}): void {
  const {
    activeGitLabReview,
    fetchChecks,
    fetchGitLabDetails,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    isPanelVisible,
    panelContextKeyRef,
    pollIntervalRef,
    prevChecksRef,
    prNumber,
    runtimeEnvironmentId,
    repoConnectionId,
    setGitStatusRefreshNonce,
    setChecks
  } = args
  useEffect(() => {
    if (
      !shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible,
        runtimeEnvironmentId,
        repoConnectionId
      })
    ) {
      return undefined
    }
    let skippedInitialRun = false
    return installWindowVisibilityInterval({
      run: () => {
        if (!skippedInitialRun) {
          skippedInitialRun = true
          return
        }
        const currentContextKey = panelContextKeyRef.current
        if (
          shouldCoalesceChecksPanelGitStatusSnapshotRefresh(
            gitStatusSnapshotInFlightContextRef.current,
            currentContextKey
          )
        ) {
          gitStatusSnapshotRerunContextRef.current = currentContextKey
          return
        }
        setGitStatusRefreshNonce((value) => value + 1)
      },
      intervalMs: RUNTIME_SSH_STATUS_REFRESH_MS
    })
  }, [
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    isPanelVisible,
    panelContextKeyRef,
    repoConnectionId,
    runtimeEnvironmentId,
    setGitStatusRefreshNonce
  ])

  useEffect(() => {
    if (activeGitLabReview) {
      return undefined
    }
    if (!prNumber || !isPanelVisible) {
      setChecks([])
      return undefined
    }
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    return installWindowVisibilityTimeoutPoller({
      run: () => fetchChecks(),
      getDelayMs: () => pollIntervalRef.current
    })
  }, [
    activeGitLabReview,
    fetchChecks,
    isPanelVisible,
    pollIntervalRef,
    prevChecksRef,
    prNumber,
    setChecks
  ])

  useEffect(() => {
    if (!activeGitLabReview || !isPanelVisible) {
      return undefined
    }
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    return installWindowVisibilityTimeoutPoller({
      run: () => fetchGitLabDetails(),
      getDelayMs: () => pollIntervalRef.current
    })
  }, [activeGitLabReview, fetchGitLabDetails, isPanelVisible, pollIntervalRef, prevChecksRef])
}
