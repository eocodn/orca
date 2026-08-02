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

export const ModelManagerMethods1 = {
  setProgressCallback(this: any, cb: ProgressCallback): () => void {
    // Why: return an unsubscribe so concurrent settings windows don't replace each other's callback.
    this.progressCallbacks.add(cb)
    return () => {
      this.progressCallbacks.delete(cb)
    }
  },
  getModelsDir(this: any): string {
    return this.modelsDir
  },
  prepareModelsDir(this: any, requestedModelsDir: string): SpeechModelCacheDir {
    let lastError: unknown = null
    for (const candidate of getSpeechModelCacheDirCandidates(requestedModelsDir)) {
      try {
        mkdirSync(candidate.modelsDir, { recursive: true })
        return candidate
      } catch (error) {
        lastError = error
        if (candidate.migrationSourceDir) {
          console.warn('[speech] Failed to prepare ASCII speech model cache:', error)
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  },
  async getModelStates(this: any): Promise<SpeechModelState[]> {
    const states: SpeechModelState[] = []
    for (const manifest of SPEECH_MODEL_CATALOG) {
      const state = await this.getModelState(manifest.id)
      states.push(state)
    }
    return states
  }
}
export type ModelManagerMethods1Surface = typeof ModelManagerMethods1
