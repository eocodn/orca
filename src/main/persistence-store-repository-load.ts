import { existsSync } from 'node:fs'
import { loadPrimaryRepositoryState } from './persistence-store-repository-load-primary'
import { finalizeLoadedRepositoryState } from './persistence-store-repository-load-finalization'

export function loadRepositoryState(context: any, allowBackupRecovery = true): any {
  const fileExistedOnLoad = existsSync(context.dataFile)
  const result = loadPrimaryRepositoryState(context, context.dataFile, fileExistedOnLoad)
  return finalizeLoadedRepositoryState(context, result, fileExistedOnLoad, allowBackupRecovery)
}
