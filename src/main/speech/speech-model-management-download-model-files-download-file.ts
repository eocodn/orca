import { net } from 'electron'
import { join } from 'node:path'
import { createWriteStream, rmSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { SpeechModelManifest } from '../../shared/speech-types'

import * as foundation from './speech-model-management-foundation'
const { DOWNLOAD_IDLE_TIMEOUT_MS, DOWNLOAD_RETRY_DELAYS_MS, MAX_NO_PROGRESS_ATTEMPTS, MAX_RETRY_AFTER_MS, MAX_TOTAL_DOWNLOAD_REQUESTS, describeInterruptedDownload, getHeaderValue, isRetryableDownloadError, parseContentRange, parseRetryAfterMs, sleepUnlessAborted } = foundation
type DownloadIncomingMessage = foundation.DownloadIncomingMessage
type DownloadTotals = foundation.DownloadTotals
type HttpStatusError = foundation.HttpStatusError

export const ModelManagerMethods4 = {
  async downloadModelFiles(this: any,
    manifest: SpeechModelManifest,
    stagingDir: string,
    modelId: string,
    isAborted: () => boolean,
    signal: AbortSignal
  ): Promise<void> {
    if (!manifest.downloadFiles?.length || !manifest.sizeBytes) {
      throw new Error(`Model download metadata missing: ${modelId}`)
    }

    let completedBytes = 0
    for (const file of manifest.downloadFiles) {
      if (
        !file.name ||
        file.name === '.' ||
        file.name === '..' ||
        file.name.includes('/') ||
        file.name.includes('\\')
      ) {
        throw new Error(`Invalid model download filename: ${file.name}`)
      }
      const filePath = join(stagingDir, file.name)
      await this.downloadFileWithRetry(
        file.url,
        filePath,
        file.sizeBytes,
        modelId,
        isAborted,
        signal,
        completedBytes,
        manifest.sizeBytes
      )
      if (isAborted()) {
        return
      }
      await this.verifyFileSha256(filePath, file.sha256)
      completedBytes += file.sizeBytes
    }

    if (!this.validateModelFiles(manifest, stagingDir)) {
      throw new Error('Model files missing after download')
    }
  },
  getPartialDownloadBytes(this: any, filePath: string): number {
    try {
      return statSync(filePath).size
    } catch {
      return 0
    }
  },
  async downloadFileWithRetry(this: any,
    url: string,
    filePath: string,
    expectedSize: number,
    modelId: string,
    isAborted: () => boolean,
    signal: AbortSignal,
    completedBytes = 0,
    modelTotalBytes = expectedSize
  ): Promise<void> {
    let requestCount = 0
    let noProgressStreak = 0
    const totals: DownloadTotals = { totalBytes: expectedSize, completedBytes, modelTotalBytes }
    for (;;) {
      requestCount += 1
      const offset = this.getPartialDownloadBytes(filePath)
      // Why: transport can fail after the last byte hits disk; the SHA-256 check is the real completion test.
      if (offset === totals.totalBytes) {
        return
      }
      // Why: absolute backstop against a server that never lets the download finish.
      if (requestCount > MAX_TOTAL_DOWNLOAD_REQUESTS) {
        throw describeInterruptedDownload(
          new Error('too many download requests'),
          offset,
          totals.totalBytes,
          requestCount - 1
        )
      }
      try {
        // Why: restart from the canonical URL, not the last redirect, because signed CDN redirect URLs expire.
        await this.downloadFile(
          url,
          filePath,
          expectedSize,
          modelId,
          isAborted,
          signal,
          0,
          offset,
          totals
        )
        const receivedBytes = this.getPartialDownloadBytes(filePath)
        if (receivedBytes === totals.totalBytes) {
          return
        }
        if (receivedBytes > totals.totalBytes) {
          throw new Error(
            `Model download exceeded its expected size (${receivedBytes} of ${totals.totalBytes} bytes)`
          )
        }
        const incompleteResponse = new Error(
          `Model download response ended at ${receivedBytes} of ${totals.totalBytes} bytes`
        )
        if (receivedBytes > offset) {
          // Why: some proxies cap each range segment; request the next immediately and reset the stall counter.
          noProgressStreak = 0
          continue
        }
        const retryableIncompleteResponse = incompleteResponse as HttpStatusError
        retryableIncompleteResponse.retryable = true
        throw retryableIncompleteResponse
      } catch (err) {
        if (isAborted() || signal.aborted) {
          throw err
        }
        const receivedBytes = this.getPartialDownloadBytes(filePath)
        if (receivedBytes === totals.totalBytes) {
          return
        }
        noProgressStreak = receivedBytes > offset ? 0 : noProgressStreak + 1
        if (!isRetryableDownloadError(err)) {
          throw err
        }
        // Why: give up only on a genuine stall; a download still advancing across drops keeps going.
        if (noProgressStreak >= MAX_NO_PROGRESS_ATTEMPTS) {
          throw describeInterruptedDownload(err, receivedBytes, totals.totalBytes, requestCount)
        }
        const retryAfterMs = (err as HttpStatusError).retryAfterMs
        if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) {
          const statusCode = (err as HttpStatusError).httpStatusCode
          throw new Error(
            `HTTP ${statusCode}; server requested retry after ${Math.ceil(retryAfterMs / 1_000)} seconds`
          )
        }
        console.warn(
          `[speech] Model download attempt ${requestCount} failed, retrying:`,
          modelId,
          err
        )
        await sleepUnlessAborted(
          retryAfterMs ??
            DOWNLOAD_RETRY_DELAYS_MS[
              Math.min(Math.max(0, noProgressStreak - 1), DOWNLOAD_RETRY_DELAYS_MS.length - 1)
            ],
          signal
        )
      }
    }
  },
  downloadFile(this: any,
    url: string,
    dest: string,
    expectedSize: number,
    modelId: string,
    isAborted: () => boolean,
    signal?: AbortSignal,
    redirectCount = 0,
    resumeOffset = 0,
    totals?: DownloadTotals
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'))
        return
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        reject(new Error('Invalid download URL'))
        return
      }

      if (parsedUrl.protocol !== 'https:') {
        reject(new Error('Model downloads must use HTTPS'))
        return
      }

      let settled = false
      let request: Electron.ClientRequest | null = null
      let idleTimeout: ReturnType<typeof setTimeout> | null = null
      const onSignalAbort = (): void => {
        const activeRequest = request
        rejectOnce(new Error('Aborted'))
        activeRequest?.abort()
      }
      const clearIdleTimeout = (): void => {
        if (idleTimeout) {
          clearTimeout(idleTimeout)
          idleTimeout = null
        }
      }
      const cleanupRequestListeners = (): void => {
        const activeRequest = request
        clearIdleTimeout()
        if (!activeRequest) {
          return
        }
        activeRequest.off('error', onRequestError)
        activeRequest.off('response', onResponse)
        activeRequest.off('redirect', onRedirect)
        signal?.removeEventListener('abort', onSignalAbort)
        request = null
      }
      const resetIdleTimeout = (): void => {
        clearIdleTimeout()
        idleTimeout = setTimeout(onRequestTimeout, DOWNLOAD_IDLE_TIMEOUT_MS)
      }
      const resolveOnce = (): void => {
        if (settled) {
          return
        }
        settled = true
        cleanupRequestListeners()
        resolve()
      }
      const rejectOnce = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        cleanupRequestListeners()
        reject(error)
      }
      const onRequestError = (error: Error): void => rejectOnce(error)
      const onRequestTimeout = (): void => {
        const activeRequest = request
        rejectOnce(
          new Error(
            `Model download timed out after ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000} seconds without network activity`
          )
        )
        activeRequest?.abort()
      }
      const onRedirect = (_statusCode: number, _method: string, redirectUrl: string): void => {
        if (redirectCount >= 5) {
          const activeRequest = request
          rejectOnce(new Error('Too many redirects'))
          activeRequest?.abort()
          return
        }
        let resolvedRedirect: URL
        try {
          resolvedRedirect = new URL(redirectUrl, parsedUrl)
        } catch {
          const activeRequest = request
          rejectOnce(new Error('Invalid redirect URL'))
          activeRequest?.abort()
          return
        }
        if (resolvedRedirect.protocol !== 'https:') {
          const activeRequest = request
          rejectOnce(new Error('Model download redirect must use HTTPS'))
          activeRequest?.abort()
          return
        }
        const activeRequest = request
        cleanupRequestListeners()
        activeRequest?.abort()
        this.downloadFile(
          resolvedRedirect.toString(),
          dest,
          expectedSize,
          modelId,
          isAborted,
          signal,
          redirectCount + 1,
          resumeOffset,
          totals
        )
          .then(resolveOnce)
          .catch(rejectOnce)
      }
      const onResponse = (incoming: Electron.IncomingMessage): void => {
        const response = incoming as DownloadIncomingMessage
        const contentLength = response.headers['content-length']
        const headerLength = Number.parseInt(getHeaderValue(contentLength) || '0', 10)
        const parsedLength =
          Number.isSafeInteger(headerLength) && headerLength > 0 ? headerLength : 0
        const contentRange = parseContentRange(response.headers['content-range'])
        const resumed =
          resumeOffset > 0 &&
          response.statusCode === 206 &&
          contentRange?.start === resumeOffset &&
          (parsedLength <= 0 || parsedLength === contentRange.end - contentRange.start + 1)

        if (resumeOffset > 0 && response.statusCode === 206 && !resumed) {
          // Why: appending an unverified range can silently corrupt the file; discard and retry from byte zero.
          try {
            rmSync(dest)
          } catch {
            // best-effort
          }
          const activeRequest = request
          const rangeError: HttpStatusError = new Error(
            `Invalid Content-Range for resume at byte ${resumeOffset}`
          )
          rangeError.retryable = true
          rejectOnce(rangeError)
          activeRequest?.abort()
          return
        }

        if (response.statusCode !== 200 && !resumed) {
          if (response.statusCode === 416) {
            // Why: 416 means the server rejected our resume offset; drop the partial to restart from scratch.
            try {
              rmSync(dest)
            } catch {
              // best-effort
            }
          }
          const activeRequest = request
          const statusError: HttpStatusError = new Error(`HTTP ${response.statusCode}`)
          statusError.httpStatusCode = response.statusCode
          statusError.retryAfterMs = parseRetryAfterMs(response.headers['retry-after'])
          rejectOnce(statusError)
          // Why: abort so a retry doesn't leave the error-response body draining unowned.
          activeRequest?.abort()
          return
        }

        // Why: a 200 to our Range request means the server restarted from byte zero, so overwrite the partial.
        const progressBase = resumed ? resumeOffset : 0
        // Why: Content-Length on a 206 is only this segment; on Content-Range '*' keep the known full size.
        const totalSize = resumed
          ? (contentRange?.totalBytes ?? totals?.totalBytes ?? expectedSize)
          : parsedLength > 0
            ? parsedLength
            : expectedSize
        if (totals) {
          totals.totalBytes = totalSize
        }
        let downloaded = 0

        const fileStream = createWriteStream(dest, { flags: resumed ? 'a' : 'w' })

        const cleanupResponseProgressListener = (): void => {
          response.off('data', onResponseData)
        }
        const onResponseData = (chunk: Buffer): void => {
          resetIdleTimeout()
          if (isAborted()) {
            request?.abort()
            response.destroy?.()
            fileStream.destroy()
            return
          }
          downloaded += chunk.length
          const progress = Math.min(
            0.9,
            ((totals?.completedBytes ?? 0) + progressBase + downloaded) /
              (totals?.modelTotalBytes ?? totalSize)
          )
          this.updateState(modelId, 'downloading', progress)
        }

        response.on('data', onResponseData)
        pipeline(response, fileStream)
          .then(() => {
            cleanupResponseProgressListener()
            if (isAborted()) {
              rejectOnce(new Error('Aborted'))
            } else {
              resolveOnce()
            }
          })
          .catch((error: Error) => {
            cleanupResponseProgressListener()
            rejectOnce(error)
          })
      }

      request = net.request({ method: 'GET', url: parsedUrl.toString() })
      if (resumeOffset > 0) {
        request.setHeader('Range', `bytes=${resumeOffset}-`)
      }

      // Why: Electron net honors app proxy settings (unlike Node https) but exposes no setTimeout, so time out manually.
      resetIdleTimeout()
      request.on('error', onRequestError)
      request.on('response', onResponse)
      request.on('redirect', onRedirect)
      if (signal) {
        signal.addEventListener('abort', onSignalAbort, { once: true })
      }
      request.end()
    })
  }
}
export type ModelManagerMethods4Surface = typeof ModelManagerMethods4
