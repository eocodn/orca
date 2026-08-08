import type { PtyDataMeta } from './pty-dispatcher'
import type { PtyTransport, PtyTransportRecoveryState } from './pty-transport-types'

type CapturedTransportOutputCallbacks = {
  generation: number
  callbacks: Parameters<PtyTransport['connect']>[0]['callbacks']
}

type PtyConnectionTransportStreamCallbackControllerArgs = {
  cancelPendingFits: () => void
  advanceGeneration: () => number
  isGenerationCurrent: (generation: number) => boolean
  isDisposed: () => boolean
  onConnect: () => void
  onData: (data: string, meta: PtyDataMeta | undefined, generation: number) => void
  onReplayData: (
    data: string,
    meta: { clearBeforeReplay?: boolean; pendingEscapeTailAnsi?: string } | undefined,
    generation: number
  ) => void
  onWriteUnavailable: () => void
  onRecoveryStateChange: (state: PtyTransportRecoveryState) => void
  onOutputPauseChanged: (paused: boolean, supported: boolean) => void
}

export function createPtyConnectionTransportStreamCallbackController({
  cancelPendingFits,
  advanceGeneration,
  isGenerationCurrent,
  isDisposed,
  onConnect,
  onData,
  onReplayData,
  onWriteUnavailable,
  onRecoveryStateChange,
  onOutputPauseChanged
}: PtyConnectionTransportStreamCallbackControllerArgs) {
  return {
    capture(onError: (message: string) => void): CapturedTransportOutputCallbacks {
      // Why: a replacement stream must retire destination-fit work before its new generation becomes authoritative.
      cancelPendingFits()
      const generation = advanceGeneration()
      const isCurrent = (): boolean => !isDisposed() && isGenerationCurrent(generation)
      return {
        generation,
        callbacks: {
          onConnect: (): void => {
            if (isCurrent()) {
              onConnect()
            }
          },
          onData: (data, meta): void => {
            if (isCurrent()) {
              onData(data, meta, generation)
            }
          },
          onReplayData: (data, meta): void => {
            if (isCurrent()) {
              onReplayData(data, meta, generation)
            }
          },
          onError: (message): void => {
            if (isCurrent()) {
              onError(message)
            }
          },
          onWriteUnavailable: (): void => {
            if (isCurrent()) {
              onWriteUnavailable()
            }
          },
          onRecoveryStateChange: (state): void => {
            if (isCurrent()) {
              onRecoveryStateChange(state)
            }
          },
          onOutputPauseChanged: (paused, supported): void => {
            if (isCurrent()) {
              onOutputPauseChanged(paused, supported)
            }
          }
        }
      }
    }
  }
}
