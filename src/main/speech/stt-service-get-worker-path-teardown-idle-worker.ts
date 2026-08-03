import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getCatalogModel } from './model-catalog'
import type { ModelManager } from './model-manager'
import { OpenAiTranscriptionSession } from './openai-transcription-client'
import { readOpenAiSpeechApiKey } from './openai-api-key-store'

import * as foundation from './stt-service-foundation'
const { IDLE_WORKER_TEARDOWN_MS, START_DICTATION_TIMEOUT_MS, STOP_DICTATION_TIMEOUT_MS } = foundation
type StopInFlight = foundation.StopInFlight
type StopOutcome = foundation.StopOutcome
type SttEvent = foundation.SttEvent
type SttEventSink = foundation.SttEventSink

export const SttServiceMethods3 = {
  getWorkerPath(this: any): string {
    if (app.isPackaged) {
      return join(process.resourcesPath, 'app.asar', 'out', 'main', 'stt-worker.js')
    }
    return join(__dirname, 'stt-worker.js')
  },
  clearIdleTeardownTimer(this: any): void {
    if (this.idleTeardownTimer) {
      clearTimeout(this.idleTeardownTimer)
      this.idleTeardownTimer = null
    }
  },
  scheduleIdleTeardown(this: any): void {
    this.clearIdleTeardownTimer()
    // Why: keep the native recognizer warm for repeated dictations, but release
    // the ONNX model after a quiet period so long-running Orca sessions don't
    // pin speech memory forever.
    this.idleTeardownTimer = setTimeout(() => {
      void this.teardownIdleWorker()
    }, IDLE_WORKER_TEARDOWN_MS)
    this.idleTeardownTimer.unref?.()
  },
  async teardownIdleWorker(this: any,
    options: { ignoreTerminateErrors?: boolean } = { ignoreTerminateErrors: true }
  ): Promise<void> {
    this.clearIdleTeardownTimer()
    if (!this.worker || this.activeOwner || this.startingOwner) {
      return
    }
    await this.teardownWorker(this.worker, options)
  }
}
export type SttServiceMethods3Surface = typeof SttServiceMethods3
