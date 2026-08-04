import { join, resolve, relative } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import type { SpeechModelManifest, SpeechModelState } from '../../shared/speech-types'
import { getCatalogModel } from './model-catalog'
import { hasOpenAiSpeechApiKey } from './openai-api-key-store'

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
