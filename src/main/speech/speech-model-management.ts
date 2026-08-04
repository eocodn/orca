import { app } from 'electron'
import { join } from 'node:path'
import type { SpeechModelState } from '../../shared/speech-types'
import { migrateSpeechModelCacheIfNeeded } from './model-cache-path'

import type { DownloadHandle,ProgressCallback } from './speech-model-management-foundation'

import { ModelManagerMethods4,type ModelManagerMethods4Surface } from './speech-model-management-download-model-files-download-file'
import { ModelManagerMethods3,type ModelManagerMethods3Surface } from './speech-model-management-download-model-update-state'
import { ModelManagerMethods2,type ModelManagerMethods2Surface } from './speech-model-management-get-model-state-validate-model-files'
import { ModelManagerMethods1,type ModelManagerMethods1Surface } from './speech-model-management-set-progress-callback-get-model-states'
import { ModelManagerMethods5,type ModelManagerMethods5Surface } from './speech-model-management-verify-file-sha256-remove-model-download-files'

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
