import type { DirectSshPaneRetryAttemptId } from '@/store/slices/direct-ssh-terminal-recovery'

type PtyConnectionReattachBindingControllerArgs = {
  isVisible: () => boolean
  setPanePtyFitBinding: (ptyId: string) => void
  reportPanePtyVisibility: (ptyId: string, visible: boolean) => void
  registerSideEffectFactConsumerForPty: (ptyId: string) => void
  syncHiddenRendererPtyDelivery: () => void
  syncPanePtyLayoutBinding: (ptyId: string) => void
  notifyCodexPaneBoundForStaleSweep: (ptyId: string) => void
  updateTabPtyId: (ptyId: string, directSshRetryAttemptId?: DirectSshPaneRetryAttemptId) => void
  startProcessTracking: () => void
  sampleVisiblePaneForegroundAgent: () => void
  registerPaneSerializerFor: (ptyId: string) => void
  scheduleReattachIdleAgentCursorReset: () => void
  scheduleRuntimeGraphSync: () => void
}

export function createPtyConnectionReattachBindingController({
  isVisible,
  setPanePtyFitBinding,
  reportPanePtyVisibility,
  registerSideEffectFactConsumerForPty,
  syncHiddenRendererPtyDelivery,
  syncPanePtyLayoutBinding,
  notifyCodexPaneBoundForStaleSweep,
  updateTabPtyId,
  startProcessTracking,
  sampleVisiblePaneForegroundAgent,
  registerPaneSerializerFor,
  scheduleReattachIdleAgentCursorReset,
  scheduleRuntimeGraphSync
}: PtyConnectionReattachBindingControllerArgs) {
  return {
    bind(
      ptyId: string,
      options: { directSshRetryAttemptId?: DirectSshPaneRetryAttemptId } = {}
    ): void {
      setPanePtyFitBinding(ptyId)
      reportPanePtyVisibility(ptyId, isVisible())
      registerSideEffectFactConsumerForPty(ptyId)
      syncHiddenRendererPtyDelivery()
      syncPanePtyLayoutBinding(ptyId)
      notifyCodexPaneBoundForStaleSweep(ptyId)
      updateTabPtyId(ptyId, options.directSshRetryAttemptId)
      startProcessTracking()
      sampleVisiblePaneForegroundAgent()
      registerPaneSerializerFor(ptyId)
    },
    complete(): void {
      // Why: reattach publishes runtime ownership only after replay and fit settle.
      scheduleReattachIdleAgentCursorReset()
      scheduleRuntimeGraphSync()
    }
  }
}
