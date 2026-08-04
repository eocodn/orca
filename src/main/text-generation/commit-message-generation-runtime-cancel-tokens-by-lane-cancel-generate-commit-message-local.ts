
import type { TextGenerationOperation } from './commit-message-generation-runtime-discover-commit-message-models-result-text-generation-operation'

export const cancelTokensByLane = new Map<string, () => void>()

export const WSL_LAUNCHER_ENV_KEYS = [
  'ComSpec',
  'COMSPEC',
  'Path',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'WINDIR'
] as const


export function localLaneKey(operation: TextGenerationOperation, cwd: string): string {
  return `${operation}:local:${cwd}`
}


export function cancelGenerateCommitMessageLocal(cwd: string): void {
  cancelTokensByLane.get(localLaneKey('commit-message', cwd))?.()
}
