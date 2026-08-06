import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import {
  getOpenFilesForExternalFileChange,
  isExternalReloadableEditorTab
} from '@/components/editor/editor-autosave'
import {
  clearSelfWrite,
  type RecentSelfWrite
} from '@/components/editor/editor-self-write-registry'
import {
  scheduleDebouncedExternalReload,
  openFileRuntimeOwner,
  type ExternalWatchNotification,
  type WatchedTarget
} from './editor-external-watch-targets'
import { readFileForEchoVerification } from './editor-external-watch-echo'

export function scheduleSelfWriteAwareExternalReload(
  target: WatchedTarget,
  notification: ExternalWatchNotification,
  file: OpenFile,
  recentSelfWrite: RecentSelfWrite
): void {
  if (recentSelfWrite.content === null) {
    scheduleDebouncedExternalReload(notification)
    return
  }

  const runtimeEnvironmentId = file.runtimeEnvironmentId ?? target.runtimeEnvironmentId
  // Why: compare disk content so only Orca's own echo is suppressed, not a newer agent write in the same TTL.
  void readFileForEchoVerification({
    runtimeEnvironmentId,
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    connectionId: target.connectionId,
    expectedExternalSshTargetId: file.externalSshTargetId
  })
    .then((result) => {
      if (
        (result.isBinary || result.content !== recentSelfWrite.content) &&
        hasCleanExternalReloadTarget(notification)
      ) {
        clearSelfWrite(file.filePath, runtimeEnvironmentId)
        scheduleDebouncedExternalReload(notification)
      }
    })
    .catch(() => {
      if (hasCleanExternalReloadTarget(notification)) {
        clearSelfWrite(file.filePath, runtimeEnvironmentId)
        scheduleDebouncedExternalReload(notification)
      }
    })
}

function hasCleanExternalReloadTarget(notification: ExternalWatchNotification): boolean {
  const matching = getOpenFilesForExternalFileChange(useAppStore.getState().openFiles, notification)
  return matching.some((file) => !file.isDirty)
}

export function getOverflowExternalReloadTargets(
  target: Pick<WatchedTarget, 'worktreeId' | 'worktreePath'> & {
    runtimeEnvironmentId?: string | null
  }
): ExternalWatchNotification[] {
  const state = useAppStore.getState()
  const notifications: ExternalWatchNotification[] = []

  for (const file of state.openFiles) {
    if (
      file.worktreeId !== target.worktreeId ||
      openFileRuntimeOwner(file) !== (target.runtimeEnvironmentId ?? null) ||
      !isExternalReloadableEditorTab(file) ||
      file.isDirty
    ) {
      continue
    }
    if (file.externalMutation) {
      // Why: overflow has no per-path resurrection signal, so clear stale tombstones before reload.
      state.setExternalMutation(file.id, null)
    }
    notifications.push({
      worktreeId: target.worktreeId,
      worktreePath: target.worktreePath,
      relativePath: file.relativePath,
      runtimeEnvironmentId: target.runtimeEnvironmentId ?? null
    })
  }

  return notifications
}
