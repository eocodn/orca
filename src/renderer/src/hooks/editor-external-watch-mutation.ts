import { basename } from '@/lib/path'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import type { FsChangedPayload } from '../../../shared/types'
import type { OpenFile } from '@/store/slices/editor'
import { openFileRuntimeOwner } from './editor-external-watch-targets'

export function buildDeletePathByFileId(
  payload: FsChangedPayload,
  worktreeId: string,
  runtimeEnvironmentId: string | null,
  deletedOpenEditorIds: string[],
  openFiles: OpenFile[]
): Map<string, string> {
  const deletePaths = new Set<string>()
  for (const event of payload.events) {
    if (event.kind === 'delete') {
      deletePaths.add(normalizeRuntimePathForComparison(event.absolutePath))
    }
  }
  const result = new Map<string, string>()
  if (deletePaths.size === 0) {
    return result
  }
  const deletedIdSet = new Set(deletedOpenEditorIds)
  for (const file of openFiles) {
    if (
      !deletedIdSet.has(file.id) ||
      file.worktreeId !== worktreeId ||
      openFileRuntimeOwner(file) !== runtimeEnvironmentId
    ) {
      continue
    }
    const normalized = normalizeRuntimePathForComparison(file.filePath)
    if (deletePaths.has(normalized)) {
      result.set(file.id, normalized)
    }
  }
  return result
}

export function collectDeletedOpenEditorIds(
  payload: FsChangedPayload,
  worktreeId: string,
  runtimeEnvironmentId: string | null,
  openFiles: OpenFile[]
): string[] {
  const deletePaths = new Set<string>()
  for (const event of payload.events) {
    if (event.kind === 'delete') {
      deletePaths.add(normalizeRuntimePathForComparison(event.absolutePath))
    }
  }
  if (deletePaths.size === 0) {
    return []
  }
  const result: string[] = []
  for (const file of openFiles) {
    if (
      file.worktreeId !== worktreeId ||
      openFileRuntimeOwner(file) !== runtimeEnvironmentId ||
      (file.mode !== 'edit' && file.mode !== 'markdown-preview')
    ) {
      continue
    }
    if (deletePaths.has(normalizeRuntimePathForComparison(file.filePath))) {
      result.push(file.id)
    }
  }
  return result
}

export function hasRenameCorrelatedCreate(
  payload: FsChangedPayload,
  worktreeId: string,
  deletedOpenEditorIds: string[],
  openFiles: OpenFile[]
): boolean {
  if (deletedOpenEditorIds.length === 0) {
    return false
  }
  const deletedIdSet = new Set(deletedOpenEditorIds)
  const deletedBasenames = new Set<string>()
  for (const file of openFiles) {
    if (
      file.worktreeId !== worktreeId ||
      (file.mode !== 'edit' && file.mode !== 'markdown-preview') ||
      !deletedIdSet.has(file.id)
    ) {
      continue
    }
    deletedBasenames.add(basename(file.filePath))
  }
  if (deletedBasenames.size === 0) {
    return false
  }
  return payload.events.some(
    (event) =>
      event.kind === 'create' &&
      event.isDirectory !== true &&
      deletedBasenames.has(basename(event.absolutePath))
  )
}
