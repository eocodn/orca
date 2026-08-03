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

import { ModelManagerMethods1, type ModelManagerMethods1Surface } from './speech-model-management-set-progress-callback-get-model-states'
import { ModelManagerMethods2, type ModelManagerMethods2Surface } from './speech-model-management-get-model-state-validate-model-files'
import { ModelManagerMethods3, type ModelManagerMethods3Surface } from './speech-model-management-download-model-update-state'
import { ModelManagerMethods4, type ModelManagerMethods4Surface } from './speech-model-management-download-model-files-download-file'
import { ModelManagerMethods5, type ModelManagerMethods5Surface } from './speech-model-management-verify-file-sha256-remove-model-download-files'

export * from './speech-model-management-foundation'

export class ModelManager {

  private modelsDir: string
  private migrationSourceDir: string | null
  private migrationReady: Promise<void>
  private activeDownloads = new Map<string, DownloadHandle>()
  private modelStates = new Map<string, SpeechModelState>()
  private progressCallbacks = new Set<ProgressCallback>()


  constructor(customModelsDir?: string) {
    const requestedModelsDir = customModelsDir || join(app.getPath('userData'), 'speech-models')
    const prepared = this.prepareModelsDir(requestedModelsDir)
    this.modelsDir = prepared.modelsDir
    this.migrationSourceDir = prepared.migrationSourceDir
    // Why: migration copies large model files, so run it async and gate state reads on it to keep the UI responsive.
    this.migrationReady = migrateSpeechModelCacheIfNeeded(
      prepared.migrationSourceDir,
      prepared.modelsDir
    )
  }
}

export interface ModelManager extends ModelManagerMethods1Surface, ModelManagerMethods2Surface, ModelManagerMethods3Surface, ModelManagerMethods4Surface, ModelManagerMethods5Surface {}

Object.assign(ModelManager.prototype, ModelManagerMethods1, ModelManagerMethods2, ModelManagerMethods3, ModelManagerMethods4, ModelManagerMethods5)
