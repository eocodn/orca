import { useAppStore } from '../store'
import type { RateLimitState } from '../../../shared/rate-limit-types'
type RateLimitSurfaceContext = {
  unsubs: Array<() => void>
}
export function registerRateLimitEvents({ unsubs }: RateLimitSurfaceContext): void {
let initialRateLimitsSnapshotPending = true
let receivedRateLimitsPushBeforeInitialSnapshot = false
unsubs.push(
  window.api.rateLimits.onUpdate((state) => {
    if (initialRateLimitsSnapshotPending) {
      receivedRateLimitsPushBeforeInitialSnapshot = true
    }
    useAppStore.getState().setRateLimitsFromPush(state as RateLimitState)
  })
)
// Why: the startup get is a fallback; a live push may already include account snapshots the get result lacks.
window.api.rateLimits.get().then((state) => {
  initialRateLimitsSnapshotPending = false
  if (receivedRateLimitsPushBeforeInitialSnapshot) {
    return
  }
  useAppStore.getState().setRateLimitsFromPush(state as RateLimitState)
})

const unsubscribeWorkspaceSpaceProgress = window.api.workspaceSpace?.onProgress?.(
  (progress) => {
    useAppStore.getState().applyWorkspaceSpaceProgress(progress)
  }
)
if (unsubscribeWorkspaceSpaceProgress) {
  unsubs.push(unsubscribeWorkspaceSpaceProgress)
}

}
