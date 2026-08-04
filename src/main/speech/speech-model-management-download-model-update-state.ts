import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import type { SpeechModelState, SpeechModelStatus } from '../../shared/speech-types'
import { getCatalogModel, isLocalSpeechModel } from './model-catalog'
import type { DownloadHandle } from './speech-model-management-foundation'

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
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    const handle: DownloadHandle = {
      abort: () => {
        aborted = true
        // Why: a stalled HTTPS request may never deliver another chunk, so tear it down immediately.
        abortController.abort()
      },
      completion
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
      resolveCompletion()
    }
  },
  cancelDownload(this: any, modelId: string): void {
    const handle = this.activeDownloads.get(modelId)
    if (handle) {
      handle.abort()
      this.updateState(modelId, 'not-downloaded')
    }
  },
  async deleteModel(this: any, modelId: string): Promise<void> {
    await this.migrationReady
    if (!getCatalogModel(modelId)) {
      throw new Error(`Unknown model: ${modelId}`)
    }
    const manifest = getCatalogModel(modelId)
    if (!manifest || !isLocalSpeechModel(manifest)) {
      throw new Error(`Model does not support deletion: ${modelId}`)
    }
    const download = this.activeDownloads.get(modelId)
    this.cancelDownload(modelId)
    if (download) {
      await download.completion
    }
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
  },
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
