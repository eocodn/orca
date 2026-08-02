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

export const ModelManagerMethods5 = {
  verifyFileSha256(this: any, filePath: string, expectedSha256: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      let settled = false

      const cleanup = (): void => {
        stream.off('data', onData)
        stream.off('error', onError)
        stream.off('end', onEnd)
      }
      const settleResolve = (): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve()
      }
      const settleReject = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      }
      const onData = (chunk: Buffer): void => {
        hash.update(chunk)
      }
      const onError = (error: Error): void => {
        settleReject(error)
      }
      const onEnd = (): void => {
        const actualSha256 = hash.digest('hex')
        if (actualSha256 !== expectedSha256.toLowerCase()) {
          // Why: model artifacts feed native runtimes, so verify every downloaded file before installation.
          settleReject(new Error('Downloaded model file failed integrity verification'))
          return
        }
        settleResolve()
      }

      stream.on('data', onData)
      stream.on('error', onError)
      stream.on('end', onEnd)
    })
  }
  removeModelDownloadStaging(this: any, stagingDir: string, legacyArchivePath: string): void {
    for (const path of [stagingDir, legacyArchivePath]) {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  }
  removeModelDownloadFiles(this: any,
    modelDir: string,
    stagingDir: string,
    legacyArchivePath: string
  ): void {
    this.removeModelDownloadStaging(stagingDir, legacyArchivePath)
    try {
      rmSync(modelDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}
export type ModelManagerMethods5Surface = typeof ModelManagerMethods5
