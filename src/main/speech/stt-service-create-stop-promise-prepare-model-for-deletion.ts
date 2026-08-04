import type { Worker } from 'node:worker_threads'

import * as foundation from './stt-service-foundation'
const { IDLE_WORKER_TEARDOWN_MS, START_DICTATION_TIMEOUT_MS, STOP_DICTATION_TIMEOUT_MS } = foundation
type StopInFlight = foundation.StopInFlight
type StopOutcome = foundation.StopOutcome
type SttEvent = foundation.SttEvent
type SttEventSink = foundation.SttEventSink

export const SttServiceMethods2 = {
  createStopPromise(this: any, worker: Worker, capturedSink: SttEventSink | null): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false
      let receivedStopped = false
      let timeout: ReturnType<typeof setTimeout> | null = null

      const cleanup = (): void => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        worker.off('message', onStopped)
        worker.off('error', onError)
        worker.off('exit', onExit)
      }

      const finish = (outcome: StopOutcome): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (outcome === 'stopped') {
          if (this.worker === worker) {
            this.activeOwner = null
            this.eventSink = null
            this.scheduleIdleTeardown()
          }
          resolve()
          return
        }

        if (!receivedStopped) {
          capturedSink?.({ type: 'stopped' })
        }
        // Why: a worker that cannot finish dictation is no longer reusable; drop
        // its lifecycle listeners so a stale worker can't retain this service.
        this.cleanupActiveWorkerLifecycleListeners()
        worker.removeAllListeners()
        if (outcome !== 'exit') {
          void worker.terminate().catch(() => undefined)
        }
        if (this.worker === worker) {
          this.worker = null
          this.activeModelId = null
          this.activeHotwordsFilePath = undefined
          this.activeOwner = null
          this.eventSink = null
        }
        resolve()
      }

      const onStopped = (msg: { type: string; text?: string; error?: string }) => {
        if (msg.type === 'stopped') {
          receivedStopped = true
          finish('stopped')
        }
      }

      const onError = (): void => {
        finish('error')
      }

      const onExit = (): void => {
        finish('exit')
      }

      timeout = setTimeout(() => {
        finish('timeout')
      }, STOP_DICTATION_TIMEOUT_MS)
      timeout.unref?.()

      worker.on('message', onStopped)
      worker.on('error', onError)
      worker.on('exit', onExit)
    })
  },
  isActive(this: any): boolean {
    return this.worker !== null || this.cloudSession !== null
  },
  getActiveModelId(this: any): string | null {
    return this.activeModelId
  },
  async prepareModelForDeletion(this: any, modelId: string): Promise<void> {
    if (this.startingModelId === modelId || (this.activeOwner && this.activeModelId === modelId)) {
      throw new Error('voice_model_in_use')
    }
    if (this.worker && this.activeModelId === modelId) {
      await this.teardownIdleWorker({ ignoreTerminateErrors: false })
      if (this.worker && this.activeModelId === modelId) {
        throw new Error('voice_model_in_use')
      }
    }
  }
}
export type SttServiceMethods2Surface = typeof SttServiceMethods2
