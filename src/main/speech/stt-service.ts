import type { Worker } from 'node:worker_threads'
import type { ModelManager } from './model-manager'
import type { OpenAiTranscriptionSession } from './openai-transcription-client'
import type { StopInFlight, SttEventSink } from './stt-service-foundation'

import { SttServiceMethods1, type SttServiceMethods1Surface } from './stt-service-start-dictation-stop-dictation'
import { SttServiceMethods2, type SttServiceMethods2Surface } from './stt-service-create-stop-promise-prepare-model-for-deletion'
import { SttServiceMethods3, type SttServiceMethods3Surface } from './stt-service-get-worker-path-teardown-idle-worker'
import { SttServiceMethods4, type SttServiceMethods4Surface } from './stt-service-teardown-worker-get-sherpa-module-path'

export * from './stt-service-foundation'

export class SttService {

  private worker: Worker | null = null
  private cloudSession: OpenAiTranscriptionSession | null = null
  private modelManager: ModelManager
  private activeModelId: string | null = null
  private activeHotwordsFilePath: string | undefined
  private activeOwner: string | null = null
  private startingOwner: string | null = null
  private startingModelId: string | null = null
  private starting = false
  private canceledOwners = new Set<string>()
  private eventSink: SttEventSink | null = null
  private idleTeardownTimer: NodeJS.Timeout | null = null
  private stopInFlight: StopInFlight | null = null
  // Why: stop resolves only after the worker flushes; in-flight feedAudio IPC
  // must not enqueue samples after that flush or they stick on the warm worker
  // and contaminate the next dictation session.
  private stopping = false
  // Why: warm workers intentionally keep lifecycle listeners while reusable;
  // stale workers must not retain this service after error, exit, or teardown.
  private cleanupWorkerLifecycleListeners: (() => void) | null = null


  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager
  }
}

export interface SttService extends SttServiceMethods1Surface, SttServiceMethods2Surface, SttServiceMethods3Surface, SttServiceMethods4Surface {}

Object.assign(SttService.prototype, SttServiceMethods1, SttServiceMethods2, SttServiceMethods3, SttServiceMethods4)
