import { useCallback } from 'react'
import { buildNestedRepoScanTelemetry } from '../../../../shared/nested-repo-telemetry'
import type { NestedRepoScanResult } from '../../../../shared/types'

export function useAddRepoRemoteNestedScan({
  setActiveNestedScanId,
  showNestedRepoReview
}: {
  setActiveNestedScanId: (scanId: string | null, runtimeEnvironmentId?: string | null) => void
  showNestedRepoReview: (options: {
    scan: NestedRepoScanResult
    selectedPath: string
    connectionId: string
    attemptId: string
    runtimeKind: 'ssh'
    inProgress: boolean
    scanId: string | null
    runtimeEnvironmentId?: string | null
  }) => void
}) {
  const showRemoteNestedRepoReview = useCallback(
    (
      scan: NestedRepoScanResult,
      selectedPath: string,
      connectionId: string,
      attemptId: string,
      inProgress: boolean,
      scanId: string | null
    ) => {
      setActiveNestedScanId(inProgress ? scanId : null, null)
      showNestedRepoReview({
        scan,
        selectedPath,
        connectionId,
        attemptId,
        runtimeKind: 'ssh',
        inProgress,
        scanId,
        runtimeEnvironmentId: null
      })
    },
    [setActiveNestedScanId, showNestedRepoReview]
  )

  const trackRemoteNestedScanResult = useCallback(
    (scan: NestedRepoScanResult | null, attemptId: string) => {},
    []
  )

  return { showRemoteNestedRepoReview, trackRemoteNestedScanResult }
}
