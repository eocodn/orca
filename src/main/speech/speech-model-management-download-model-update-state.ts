import { app, net } from 'electron'
import { join, resolve, relative } from 'node:path'
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  createReadStream,
  rmSync,
  statSync
} from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type {
  SpeechModelManifest,
  SpeechModelState,
  SpeechModelStatus
} from '../../shared/speech-types'
import { SPEECH_MODEL_CATALOG, getCatalogModel, isLocalSpeechModel } from './model-catalog'
import { hasOpenAiSpeechApiKey } from './openai-api-key-store'
import {
  getSpeechModelCacheDirCandidates,
  migrateSpeechModelCacheIfNeeded,
  type SpeechModelCacheDir
} from './model-cache-path'

import * as foundation from './speech-model-management-foundation'
const { DOWNLOAD_IDLE_TIMEOUT_MS, DOWNLOAD_RETRY_DELAYS_MS, MAX_NO_PROGRESS_ATTEMPTS, MAX_RETRY_AFTER_MS, MAX_TOTAL_DOWNLOAD_REQUESTS, RETRYABLE_HTTP_STATUSES, RETRYABLE_NET_ERROR, describeInterruptedDownload, getHeaderValue, isRetryableDownloadError, parseContentRange, parseRetryAfterMs, sleepUnlessAborted } = foundation
type ContentRange = foundation.ContentRange
type DownloadHandle = foundation.DownloadHandle
type DownloadIncomingMessage = foundation.DownloadIncomingMessage
type DownloadTotals = foundation.DownloadTotals
type HttpStatusError = foundation.HttpStatusError
type ProgressCallback = foundation.ProgressCallback

export const ModelManagerMethods3 = {
  async downloadModel(this: any, modelId: string): Promise<void> {
    // Why: no migration await — it never races a download, and awaiting would defer setup cancelDownload relies on.
    if (this.activeDownloads.has(modelId)) {
      return
    }

    const manifest = getCatalogModel(modelId)
    if (!manifest) {
      throw new Error(`Unknown model: ${modelId}`)
    }
    if (!isLocalSpeechModel(manifest)) {
      throw new Error(`Model does not support downloads: ${modelId}`)
    }
    if (!manifest.downloadFiles?.length || !manifest.sizeBytes) {
      throw new Error(`Model download metadata missing: ${modelId}`)
    }

    const modelDir = this.getModelDir(modelId)
    if (existsSync(modelDir) && this.validateModelFiles(manifest, modelDir)) {
      this.updateState(modelId, 'ready')
      return
    }

    this.updateState(modelId, 'downloading', 0)

    const stagingDir = `${modelDir}.partial`
    const legacyArchivePath = join(this.modelsDir, `${modelId}.tar.bz2`)
    // Why: resuming an unverified file left by a crashed process could preserve corrupt bytes.
    rmSync(stagingDir, { recursive: true, force: true })
    try {
      rmSync(legacyArchivePath, { force: true })
    } catch {
      // best-effort legacy cleanup
    }
    mkdirSync(stagingDir, { recursive: true })
    let aborted = false
    const abortController = new AbortController()

    const handle: DownloadHandle = {
      abort: () => {
        aborted = true
        // Why: a stalled HTTPS request may never deliver another chunk, so tear it down immediately.
        abortController.abort()
      }
    }
    this.activeDownloads.set(modelId, handle)

    try {
      await this.downloadModelFiles(
        manifest,
        stagingDir,
        modelId,
        () => aborted,
        abortController.signal
      )

      if (aborted) {
        return
      }

      await rm(modelDir, { recursive: true, force: true })
      await rename(stagingDir, modelDir)
      this.updateState(modelId, 'ready')
    } catch (err) {
      if (!aborted) {
        console.error('[speech] Model download failed:', modelId, err)
        this.updateState(modelId, 'error', undefined, String(err))
      }
      this.removeModelDownloadFiles(modelDir, stagingDir, legacyArchivePath)
      if (!aborted) {
        // Why: the settings UI awaits this to surface failures; stay quiet on cancellation, rethrow real errors.
        throw err
      }
    } finally {
      this.activeDownloads.delete(modelId)
      this.removeModelDownloadStaging(stagingDir, legacyArchivePath)
    }
  }
  cancelDownload(this: any, modelId: string): void {
    const handle = this.activeDownloads.get(modelId)
    if (handle) {
      handle.abort()
      this.updateState(modelId, 'not-downloaded')
    }
  }
  async deleteModel(this: any, modelId: string): Promise<void> {
    await this.migrationReady
    if (!getCatalogModel(modelId)) {
      throw new Error(`Unknown model: ${modelId}`)
    }
    const manifest = getCatalogModel(modelId)
    if (!manifest || !isLocalSpeechModel(manifest)) {
      throw new Error(`Model does not support deletion: ${modelId}`)
    }
    this.cancelDownload(modelId)
    const modelDir = this.getModelDir(modelId)
    if (existsSync(modelDir)) {
      await rm(modelDir, { recursive: true, force: true })
    }
    await rm(`${modelDir}.partial`, { recursive: true, force: true })
    await rm(join(this.modelsDir, `${modelId}.tar.bz2`), { force: true })
    // Why: also delete the pre-migration copy, or the next launch re-migrates it and resurrects the model.
    if (this.migrationSourceDir) {
      const sourceModelDir = this.getSafeModelDir(modelId, this.migrationSourceDir)
      if (existsSync(sourceModelDir)) {
        await rm(sourceModelDir, { recursive: true, force: true })
      }
    }
    this.modelStates.delete(modelId)
  }
  updateState(this: any,
    modelId: string,
    status: SpeechModelStatus,
    progress?: number,
    error?: string
  ): void {
    const state: SpeechModelState = { id: modelId, status, progress, error }
    this.modelStates.set(modelId, state)
    // Why: notify on every state change (not just progress) so extracting/ready/error transitions reach the UI.
    const progressValue = progress ?? (status === 'extracting' ? 0.95 : -1)
    for (const callback of this.progressCallbacks) {
      callback(modelId, progressValue)
    }
  }
}
export type ModelManagerMethods3Surface = typeof ModelManagerMethods3
