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

export const SttServiceMethods1 = {
  async startDictation(this: any,
    modelId: string,
    sink: SttEventSink,
    hotwordsFilePath?: string,
    owner = 'desktop'
  ): Promise<void> {
    if (this.starting) {
      if (this.startingOwner !== owner) {
        throw new Error('dictation_already_active')
      }
      return
    }
    if ((this.worker || this.cloudSession) && this.activeOwner && this.activeOwner !== owner) {
      throw new Error('dictation_already_active')
    }
    this.starting = true
    this.startingOwner = owner
    this.startingModelId = modelId
    this.clearIdleTeardownTimer()

    try {
      await this._startDictation(modelId, sink, hotwordsFilePath, owner)
      if (this.canceledOwners.delete(owner)) {
        await this.stopDictation(owner, { cancelStarting: false })
        throw new Error('dictation_canceled')
      }
      this.activeOwner = owner
    } finally {
      this.starting = false
      this.startingOwner = null
      this.startingModelId = null
      this.canceledOwners.delete(owner)
    }
  }
  async _startDictation(this: any,
    modelId: string,
    sink: SttEventSink,
    hotwordsFilePath?: string,
    owner = 'desktop'
  ): Promise<void> {
    const manifest = getCatalogModel(modelId)
    if (!manifest) {
      throw new Error(`Unknown model: ${modelId}`)
    }

    if (manifest.provider === 'openai') {
      if (this.worker) {
        const existingWorker = this.worker
        await this.stopDictation(owner, { cancelStarting: false })
        await this.teardownWorker(existingWorker)
      }

      const modelState = await this.modelManager.getModelState(modelId)
      if (modelState.status !== 'ready') {
        throw new Error(`Model not ready: ${modelState.status}`)
      }

      this.cloudSession = new OpenAiTranscriptionSession(modelId, readOpenAiSpeechApiKey)
      this.activeModelId = modelId
      this.activeHotwordsFilePath = undefined
      this.eventSink = sink
      sink({ type: 'ready' })
      return
    }

    if (this.cloudSession) {
      await this.stopDictation(owner, { cancelStarting: false })
    }

    const reusableWorker = this.worker
    if (
      reusableWorker &&
      this.activeModelId === modelId &&
      this.activeHotwordsFilePath === hotwordsFilePath &&
      this.stopInFlight?.worker !== reusableWorker
    ) {
      const worker = reusableWorker
      if (!this.activeOwner) {
        const modelState = await this.modelManager.getModelState(modelId)
        if (modelState.status !== 'ready') {
          await this.teardownWorker(worker)
          throw new Error(`Model not ready: ${modelState.status}`)
        }
      }
      if (
        this.worker === worker &&
        this.activeModelId === modelId &&
        this.activeHotwordsFilePath === hotwordsFilePath &&
        this.stopInFlight?.worker !== worker
      ) {
        this.eventSink = sink
        sink({ type: 'ready' })
        return
      }
    }

    if (this.worker) {
      const existingWorker = this.worker
      await this.stopDictation(owner, { cancelStarting: false })
      await this.teardownWorker(existingWorker)
    }

    const modelState = await this.modelManager.getModelState(modelId)
    if (modelState.status !== 'ready') {
      throw new Error(`Model not ready: ${modelState.status}`)
    }

    const workerPath = this.getWorkerPath()
    const sherpaModulePath = this.getSherpaModulePath()

    this.worker = new Worker(workerPath, {
      workerData: { sherpaModulePath }
    })
    const worker = this.worker

    this.activeModelId = modelId
    this.activeHotwordsFilePath = hotwordsFilePath
    this.eventSink = sink

    const readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      let startupTimeout: ReturnType<typeof setTimeout> | null = null
      const cleanup = () => {
        if (startupTimeout) {
          clearTimeout(startupTimeout)
          startupTimeout = null
        }
        worker.off('message', onReadyOrError)
        worker.off('error', onStartupError)
        worker.off('exit', onStartupExit)
      }
      const failStartup = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      }
      const onReadyOrError = (msg: { type: string; text?: string; error?: string }) => {
        if (settled) {
          return
        }
        if (msg.type === 'ready') {
          settled = true
          cleanup()
          resolve()
        } else if (msg.type === 'error') {
          failStartup(new Error(msg.error ?? 'Speech worker failed to initialize'))
        }
      }
      const onStartupError = (err: Error) => {
        failStartup(err)
      }
      const onStartupExit = (code: number) => {
        failStartup(new Error(`Speech worker exited before ready: ${code}`))
      }
      worker.on('message', onReadyOrError)
      worker.on('error', onStartupError)
      worker.on('exit', onStartupExit)
      // Why: a native STT worker can wedge while loading model bindings without
      // emitting ready/error/exit; startup must leave the UI's Starting state.
      startupTimeout = setTimeout(() => {
        failStartup(new Error('Speech worker timed out while starting.'))
      }, START_DICTATION_TIMEOUT_MS)
      startupTimeout.unref?.()
    })

    const onWorkerMessage = (msg: SttEvent) => {
      if (this.worker === worker) {
        this.eventSink?.(msg)
      }
    }

    const onWorkerError = (err: Error) => {
      if (this.worker === worker) {
        this.eventSink?.({ type: 'error', error: String(err) })
        this.cleanupActiveWorkerLifecycleListeners()
        this.worker = null
        this.activeModelId = null
        this.activeHotwordsFilePath = undefined
        this.activeOwner = null
        this.eventSink = null
      }
    }

    const onWorkerExit = () => {
      if (this.worker === worker) {
        this.cleanupActiveWorkerLifecycleListeners()
        this.worker = null
        this.activeModelId = null
        this.activeHotwordsFilePath = undefined
        this.activeOwner = null
        this.eventSink = null
      }
    }

    worker.on('message', onWorkerMessage)
    worker.on('error', onWorkerError)
    worker.on('exit', onWorkerExit)
    this.cleanupWorkerLifecycleListeners = () => {
      worker.off('message', onWorkerMessage)
      worker.off('error', onWorkerError)
      worker.off('exit', onWorkerExit)
    }

    const modelDir = this.modelManager.getModelDir(modelId)
    worker.postMessage({
      type: 'init',
      modelDir,
      modelType: manifest.type,
      streaming: manifest.streaming,
      sampleRate: manifest.sampleRate,
      files: manifest.files ?? [],
      hotwordsFilePath,
      modelingUnit: manifest.modelingUnit
    })

    try {
      await readyPromise
    } catch (error) {
      this.cleanupActiveWorkerLifecycleListeners()
      worker.removeAllListeners()
      void worker.terminate()
      if (this.worker === worker) {
        this.worker = null
        this.activeModelId = null
        this.activeHotwordsFilePath = undefined
        this.activeOwner = null
        this.eventSink = null
      }
      throw error
    }
  }
  feedAudio(this: any, samples: Float32Array, sampleRate: number, owner = 'desktop'): void {
    if (this.stopping) {
      return
    }
    const currentOwner = this.activeOwner ?? this.startingOwner
    if (!currentOwner) {
      return
    }
    if (currentOwner !== owner) {
      throw new Error('dictation_owner_mismatch')
    }
    if (this.cloudSession) {
      this.cloudSession.feedAudio(samples, sampleRate)
      return
    }
    this.worker?.postMessage({ type: 'feed', samples, sampleRate }, [samples.buffer as ArrayBuffer])
  }
  async stopDictation(this: any,
    owner = 'desktop',
    options: { cancelStarting?: boolean } = { cancelStarting: true }
  ): Promise<void> {
    if (options.cancelStarting !== false && this.startingOwner === owner) {
      this.canceledOwners.add(owner)
    }
    if (!this.worker && !this.cloudSession) {
      return
    }
    const currentOwner = this.activeOwner ?? this.startingOwner
    if (currentOwner && currentOwner !== owner) {
      throw new Error('dictation_owner_mismatch')
    }

    if (this.cloudSession) {
      this.stopping = true
      try {
        const session = this.cloudSession
        this.cloudSession = null
        try {
          const text = await session.finish()
          if (text) {
            this.eventSink?.({ type: 'final', text })
          }
        } catch (error) {
          this.eventSink?.({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          })
        } finally {
          this.eventSink?.({ type: 'stopped' })
          this.activeModelId = null
          this.activeHotwordsFilePath = undefined
          this.activeOwner = null
          this.eventSink = null
        }
      } finally {
        this.stopping = false
      }
      return
    }

    const worker = this.worker
    if (!worker) {
      return
    }
    if (this.stopInFlight?.worker === worker) {
      if (this.stopInFlight.owner !== owner) {
        throw new Error('dictation_owner_mismatch')
      }
      return this.stopInFlight.promise
    }

    const capturedSink = this.eventSink
    let stopPromise!: Promise<void>
    stopPromise = this.createStopPromise(worker, capturedSink).finally(() => {
      if (this.stopInFlight?.worker === worker && this.stopInFlight.promise === stopPromise) {
        this.stopInFlight = null
      }
    })
    this.stopInFlight = { worker, owner, promise: stopPromise }
    this.stopping = true
    try {
      // Why: keep the stop message inside the try so a postMessage throw still
      // clears `stopping` — otherwise feedAudio silently drops all future audio.
      worker.postMessage({ type: 'stop' })
      await stopPromise
    } finally {
      this.stopping = false
    }
  }
}
export type SttServiceMethods1Surface = typeof SttServiceMethods1
