import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'

export function clearPendingPtyDataForPty(
  state: PtyRendererDeliveryContext,
  id: string
): void {
  const pending = state.pendingData.delete(id)
  if (!pending) {
    return
  }
  // Why: clear notification starts a new renderer buffer epoch; old queued bytes must not cross it.
  if (pending.projectionAdmissionIds) {
    state.sshOutputIntake?.transferProjections(pending.projectionAdmissionIds, 'pty-buffer-cleared')
  }
  state.pendingOverflowMarkedPtys.delete(id)
  state.updateProducerFlowControl(id)
  state.clearFlushTimerIfIdle()
}
