import type { PtyDataMeta } from './pty-dispatcher'

type LiveDataAdmissionResult =
  | { action: 'stop' }
  | { action: 'continue'; data: string; meta: PtyDataMeta | undefined }

type PtyConnectionLiveDataAdmissionControllerArgs = {
  isGenerationCurrent: (generation: number) => boolean
  deferLiveData: (data: string, meta: PtyDataMeta | undefined, generation: number) => boolean
  markTerminalOutputActivity: () => void
  recordHibernationOutput: () => void
  observeAgentOutputActivity: () => void
  scanSshShellReady: ((data: string) => { matched: boolean; output: string }) | null
  markSshStartupShellReady: () => void
  observeStartupDraftReadiness: (data: string) => void
  resetHiddenRestoreIfPtyChanged: () => void
  observeLiveMode2031: (data: string) => void
  isForegroundRestoreBackpressureContext: () => boolean
  noteForegroundRestoreBackpressure: () => void
  markHiddenRestoreNeeded: () => void
  salvageDiscardedQueries: (data: string) => void
}

export function createPtyConnectionLiveDataAdmissionController({
  isGenerationCurrent,
  deferLiveData,
  markTerminalOutputActivity,
  recordHibernationOutput,
  observeAgentOutputActivity,
  scanSshShellReady,
  markSshStartupShellReady,
  observeStartupDraftReadiness,
  resetHiddenRestoreIfPtyChanged,
  observeLiveMode2031,
  isForegroundRestoreBackpressureContext,
  noteForegroundRestoreBackpressure,
  markHiddenRestoreNeeded,
  salvageDiscardedQueries
}: PtyConnectionLiveDataAdmissionControllerArgs) {
  return {
    admit(
      data: string,
      meta: PtyDataMeta | undefined,
      streamGeneration: number
    ): LiveDataAdmissionResult {
      if (!isGenerationCurrent(streamGeneration)) {
        return { action: 'stop' }
      }
      if (deferLiveData(data, meta, streamGeneration)) {
        return { action: 'stop' }
      }
      if (data.length > 0) {
        markTerminalOutputActivity()
        recordHibernationOutput()
        observeAgentOutputActivity()
      }
      if (scanSshShellReady) {
        const scanned = scanSshShellReady(data)
        if (scanned.matched) {
          markSshStartupShellReady()
        }
        data = scanned.output
      }
      observeStartupDraftReadiness(data)
      resetHiddenRestoreIfPtyChanged()
      observeLiveMode2031(data)
      if (meta?.droppedOutput === true) {
        // Why: a foreground restore can cause its own cap drop; latch one repaint instead of re-arming per sentinel.
        if (meta.background !== true && isForegroundRestoreBackpressureContext()) {
          noteForegroundRestoreBackpressure()
        } else {
          // Why: a real cap gap needs an authoritative snapshot, while carved-out query bytes still need replies.
          markHiddenRestoreNeeded()
          if (data) {
            salvageDiscardedQueries(data)
          }
          return { action: 'stop' }
        }
      }
      return { action: 'continue', data, meta }
    }
  }
}
