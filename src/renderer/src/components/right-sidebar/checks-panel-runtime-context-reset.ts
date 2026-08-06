import { useCallback, useState } from 'react'
import type { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'

type Foundation = ReturnType<typeof useChecksPanelRuntimeFoundation>

export function useChecksPanelRuntimeContextReset(foundation: Foundation): {
  clearTitleInputFocusTimer: () => void
  setChecksPanelContentRef: (node: HTMLDivElement | null) => void
  prRefreshStateNow: number
  setPrRefreshStateNow: (value: number) => void
} {
  const { panelContextKey, titleInputFocusTimerRef } = foundation
  const clearTitleInputFocusTimer = useCallback((): void => {
    if (titleInputFocusTimerRef.current !== null) {
      clearTimeout(titleInputFocusTimerRef.current)
      titleInputFocusTimerRef.current = null
    }
  }, [titleInputFocusTimerRef])
  const setChecksPanelContentRef = useCallback(
    (node: HTMLDivElement | null): void => {
      if (node === null) {
        clearTitleInputFocusTimer()
      }
    },
    [clearTitleInputFocusTimer]
  )
  const [previousPanelContextKey, setPreviousPanelContextKey] = useState(panelContextKey)
  const [prRefreshStateNow, setPrRefreshStateNow] = useState(() => Date.now())
  if (panelContextKey !== previousPanelContextKey) {
    setPreviousPanelContextKey(panelContextKey)
    foundation.setEditingTitle(false)
    foundation.setTitleDraft('')
    foundation.setTitleSaving(false)
    clearTitleInputFocusTimer()
    foundation.setChecks([])
    foundation.setChecksLoading(false)
    foundation.setComments([])
    foundation.setCommentsLoading(false)
    foundation.setIsRefreshing(false)
    foundation.setEmptyRefreshing(false)
    foundation.setConflictDetailsRefreshing(false)
    setPrRefreshStateNow(Date.now())
    foundation.createPrInFlightRef.current = null
    foundation.setIsCreatingPr(false)
    foundation.setCreatePrError(null)
    foundation.setIsPublishingBranch(false)
    foundation.setAgentComposerState(null)
    foundation.setHostedReviewCreationSnapshot(null)
    foundation.setHardRefreshError(null)
    foundation.setGitStatusSnapshot(null)
    foundation.setGitStatusProbeErrorContextKey(null)
    foundation.setGitStatusRefreshNonce((value) => value + 1)
    foundation.pollIntervalRef.current = 30_000
    foundation.prevChecksRef.current = ''
    foundation.conflictSummaryRefreshKeyRef.current = null
    foundation.refreshInFlightRef.current = false
    foundation.refreshRequestKeyRef.current = null
    if (foundation.gitStatusSnapshotRetryTimerRef.current) {
      clearTimeout(foundation.gitStatusSnapshotRetryTimerRef.current)
      foundation.gitStatusSnapshotRetryTimerRef.current = null
    }
  }
  return {
    clearTitleInputFocusTimer,
    setChecksPanelContentRef,
    prRefreshStateNow,
    setPrRefreshStateNow
  }
}
