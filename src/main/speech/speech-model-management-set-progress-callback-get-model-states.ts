import { mkdirSync } from 'node:fs'
import type { SpeechModelState } from '../../shared/speech-types'
import { SPEECH_MODEL_CATALOG } from './model-catalog'
import { getSpeechModelCacheDirCandidates, type SpeechModelCacheDir } from './model-cache-path'
import type { ProgressCallback } from './speech-model-management-foundation'

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
