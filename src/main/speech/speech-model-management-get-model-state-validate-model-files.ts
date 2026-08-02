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

export const ModelManagerMethods2 = {
  async getModelState(this: any, modelId: string): Promise<SpeechModelState> {
    await this.migrationReady
    const cached = this.modelStates.get(modelId)
    if (cached && (cached.status === 'downloading' || cached.status === 'extracting')) {
      return cached
    }

    const manifest = getCatalogModel(modelId)
    if (!manifest) {
      return { id: modelId, status: 'error', error: 'Unknown model' }
    }

    if (manifest.provider === 'openai') {
      return {
        id: modelId,
        status: hasOpenAiSpeechApiKey() ? 'ready' : 'not-downloaded'
      }
    }

    const modelDir = this.getModelDir(modelId)
    if (existsSync(modelDir) && this.validateModelFiles(manifest, modelDir)) {
      const state: SpeechModelState = { id: modelId, status: 'ready' }
      this.modelStates.set(modelId, state)
      return state
    }

    return { id: modelId, status: 'not-downloaded' }
  },
  getModelDir(this: any, modelId: string): string {
    return this.getSafeModelDir(modelId)
  },
  getSafeModelDir(this: any, modelId: string, root: string = this.modelsDir): string {
    const manifest = getCatalogModel(modelId)
    if (!manifest) {
      throw new Error(`Unknown model: ${modelId}`)
    }
    const modelsRoot = resolve(root)
    const modelDir = resolve(modelsRoot, modelId)
    const rel = relative(modelsRoot, modelDir)
    if (rel.startsWith('..') || rel === '' || rel.includes('..') || resolve(rel) === rel) {
      throw new Error(`Invalid model id: ${modelId}`)
    }
    return modelDir
  },
  validateModelFiles(this: any, manifest: SpeechModelManifest, modelDir: string): boolean {
    if (!manifest.downloadFiles) {
      return false
    }
    return manifest.downloadFiles.every(({ name, sizeBytes }) => {
      try {
        return statSync(join(modelDir, name)).size === sizeBytes
      } catch {
        return false
      }
    })
  }
}
export type ModelManagerMethods2Surface = typeof ModelManagerMethods2
