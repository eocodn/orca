import { getAutomationRerunPendingRemainingMs } from './automation-run-view-state'

export async function waitForAutomationRerunPendingVisibility(
  pendingStartedAt: number
): Promise<void> {
  const remainingMs = getAutomationRerunPendingRemainingMs({ pendingStartedAt })
  if (remainingMs <= 0) {
    return
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs))
}
