import { useAppStore } from '@/store'
import { basename, joinPath } from '@/lib/path'
import { getExternalFileChangeRelativePath } from '@/components/right-sidebar/useFileExplorerWatch'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import {
  canAutoSaveOpenFile,
  getOpenFilesForExternalFileChange,
  isExternalReloadableEditorTab,
  isWorkingTreeCombinedDiffTab,
  notifyEditorExternalFileChange
} from '@/components/editor/editor-autosave'
import {
  clearSelfWrite,
  getRecentSelfWrite,
  type RecentSelfWrite
} from '@/components/editor/editor-self-write-registry'
import { hasActiveEditorPathMoves, isActiveMoveSourcePath } from '@/components/editor/editor-path-move-inflight'
import type { FsChangedPayload } from '../../../shared/types'
import type { OpenFile } from '@/store/slices/editor'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { markFileChangedOnDisk } from '@/components/editor/editor-changed-on-disk-mark'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import { scheduleDebouncedExternalReload } from './editor-external-watch-targets'
import { getWatchedTargetKey, openFileRuntimeOwner } from './editor-external-watch-targets'
import { readFileForEchoVerification } from './editor-external-watch-echo'
import type { ExternalWatchNotification, WatchedTarget } from './editor-external-watch-targets'
import type { WorktreeFileChangeEventDetail } from './worktree-file-change-event'
import { ORCA_WORKTREE_FILE_CHANGE_EVENT } from './worktree-file-change-event'
const EXTERNAL_MUTATION_DEBOUNCE_MS = 75

type PendingDeleteTimer = {
  fileId: string
  timer: ReturnType<typeof setTimeout>
}

/**
 * Subscribes to filesystem watcher events for every worktree that currently
 * has an editor tab open, and notifies the editor to reload clean tabs when
 * their on-disk contents change.
 *
 * Why: the File Explorer watcher unmounts when the sidebar leaves Explorer, so lifting this to an always-mounted hook keeps terminal edits noticed everywhere.
 */
export function useEditorExternalWatch(): void {
  const { targets, targetsKey } = useAppStore(getEditorExternalWatchTargets)

  const targetsRef = useRef<WatchedTarget[]>([])
  const latestTargetsRef = useRef<WatchedTarget[]>(targets)
  latestTargetsRef.current = targets
  const remoteWatchUnsubsRef = useRef(new Map<string, () => void>())
  const fsChangedHandlerRef = useRef<
    ((payload: FsChangedPayload, runtimeEnvironmentId?: string | null) => void) | null
  >(null)

  // Why: diff prev vs next targets so unchanged worktrees keep their subscription; tearing down all on every targetsKey change churns watchers and drops events in the gap.
  useEffect(() => {
    const nextTargets = latestTargetsRef.current
    const prev = targetsRef.current
    const prevKeys = new Set(prev.map(getWatchedTargetKey))
    const nextKeys = new Set(nextTargets.map(getWatchedTargetKey))
    const removed = prev.filter((t) => !nextKeys.has(getWatchedTargetKey(t)))
    const added = nextTargets.filter((t) => !prevKeys.has(getWatchedTargetKey(t)))

    for (const target of removed) {
      const key = getWatchedTargetKey(target)
      const remoteUnsubscribe = remoteWatchUnsubsRef.current.get(key)
      if (remoteUnsubscribe) {
        remoteUnsubscribe()
        remoteWatchUnsubsRef.current.delete(key)
      } else {
        void window.api.fs.unwatchWorktree({
          worktreePath: target.worktreePath,
          connectionId: target.connectionId
        })
      }
    }
    for (const target of added) {
      if (target.runtimeEnvironmentId) {
        const key = getWatchedTargetKey(target)
        let cancelled = false
        const pendingUnsubscribe = (): void => {
          cancelled = true
        }
        remoteWatchUnsubsRef.current.set(key, pendingUnsubscribe)
        void subscribeRuntimeFileChanges(
          {
            settings: { activeRuntimeEnvironmentId: target.runtimeEnvironmentId },
            worktreeId: target.worktreeId,
            worktreePath: target.worktreePath,
            connectionId: target.connectionId
          },
          (payload) => fsChangedHandlerRef.current?.(payload, target.runtimeEnvironmentId),
          (err) => warnExternalWatchFailure(target, err)
        )
          .then((unsubscribe) => {
            if (cancelled) {
              unsubscribe()
              return
            }
            if (remoteWatchUnsubsRef.current.get(key) === pendingUnsubscribe) {
              remoteWatchUnsubsRef.current.set(key, unsubscribe)
            } else {
              unsubscribe()
            }
          })
          .catch((err) => {
            if (remoteWatchUnsubsRef.current.get(key) === pendingUnsubscribe) {
              remoteWatchUnsubsRef.current.delete(key)
            }
            warnExternalWatchFailure(target, err)
          })
        continue
      }
      void window.api.fs
        .watchWorktree({
          worktreePath: target.worktreePath,
          connectionId: target.connectionId
        })
        .catch((err) => {
          // Why: remote SSH providers can disappear while tabs still reference the worktree; degrade to a diagnostic, not an uncaught renderer promise.
          warnExternalWatchFailure(target, err)
        })
    }
    targetsRef.current = nextTargets
    // Why: intentionally differential — no unwatch on cleanup; final unmount unwatching lives in the [] effect below so targetsKey changes don't tear down everything.
  }, [targetsKey])

  // Why: keep the fs:changed subscription in an always-mounted [] effect so it doesn't re-subscribe on every targetsKey change and miss events fired during the gap.
  useEffect(() => {
    const remoteWatchUnsubs = remoteWatchUnsubsRef.current
    const { handleFsChanged, dispose } = createExternalWatchEventHandler(
      (worktreePath, runtimeEnvironmentId) =>
        targetsRef.current.find(
          (t) =>
            normalizeRuntimePathForComparison(t.worktreePath) ===
              normalizeRuntimePathForComparison(worktreePath) &&
            t.runtimeEnvironmentId === runtimeEnvironmentId
        )
    )
    const unsubscribe = window.api.fs.onFsChanged((payload) => handleFsChanged(payload, null))
    fsChangedHandlerRef.current = handleFsChanged

    return () => {
      unsubscribe()
      dispose()
      fsChangedHandlerRef.current = null
      // Why: the differential watch effect never unwatches on cleanup, so final unmount is the only place that tears down every subscription.
      for (const target of targetsRef.current) {
        const key = getWatchedTargetKey(target)
        const remoteUnsubscribe = remoteWatchUnsubs.get(key)
        if (remoteUnsubscribe) {
          remoteUnsubscribe()
        } else {
          void window.api.fs.unwatchWorktree({
            worktreePath: target.worktreePath,
            connectionId: target.connectionId
          })
        }
      }
      remoteWatchUnsubs.clear()
      targetsRef.current = []
      // Why: don't clear the module-scoped pendingExternalReloadTimers — StrictMode's first-mount cleanup would drop the second mount's timers; a late dispatch is harmless.
    }
  }, [])
}

/**
 * Builds the fs:changed handler used by `useEditorExternalWatch`. Exported so
 * tests can drive the full event pipeline (including the tombstone coalescer)
 * without mounting the hook.
 */
export function createExternalWatchEventHandler(
  findTarget: (
    worktreePath: string,
    runtimeEnvironmentId: string | null
  ) => WatchedTarget | undefined
): {
  handleFsChanged: (payload: FsChangedPayload, runtimeEnvironmentId?: string | null) => void
  dispose: () => void
} {
  // Why: coalesce 'deleted' tombstones so a same-path create cancels them before the tab flashes (macOS atomic write). See EXTERNAL_MUTATION_DEBOUNCE_MS.
  const pendingDeletes = new Map<string, PendingDeleteTimer>()
  const pendingKey = (
    worktreeId: string,
    runtimeEnvironmentId: string | null,
    absolutePath: string
  ): string => `${worktreeId}::${runtimeEnvironmentId ?? 'client'}::${absolutePath}`

  const handleFsChanged = (
    payload: FsChangedPayload,
    runtimeEnvironmentId: string | null = null
  ): void => {
    const target = findTarget(payload.worktreePath, runtimeEnvironmentId)
    if (!target) {
      return
    }
    // Why: this app-level hook owns watcher subscriptions; other consumers listen here so they don't fight over watch/unwatch ownership.
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent<WorktreeFileChangeEventDetail>(ORCA_WORKTREE_FILE_CHANGE_EVENT, {
          detail: { payload, runtimeEnvironmentId: target.runtimeEnvironmentId }
        })
      )
    }

    // Why: collect create/update paths first to cancel any pending same-path delete — this absorbs the macOS atomic-write delete→create split across two payloads.
    const createOrUpdatePaths = new Set<string>()
    for (const evt of payload.events) {
      if (evt.isDirectory === true) {
        continue
      }
      if (evt.kind === 'create' || evt.kind === 'update') {
        createOrUpdatePaths.add(normalizeRuntimePathForComparison(evt.absolutePath))
      }
    }
    for (const createdPath of createOrUpdatePaths) {
      const key = pendingKey(target.worktreeId, target.runtimeEnvironmentId, createdPath)
      const existing = pendingDeletes.get(key)
      if (existing) {
        clearTimeout(existing.timer)
        pendingDeletes.delete(key)
      }
    }

    // Why: mark editor tabs deleted/renamed instead of closing them so the user keeps in-memory content; a paired create means rename, a lone delete is hard.
    // Why: snapshot openFiles once so the delete/rename helpers share a consistent view without N store reads per payload.
    const openFilesAtStart = useAppStore.getState().openFiles
    const deletedOpenEditorIdsRaw = collectDeletedOpenEditorIds(
      payload,
      target.worktreeId,
      target.runtimeEnvironmentId,
      openFilesAtStart
    )
    // Only pay the per-id lookup to suppress a move's own source-delete while a move is live; else the batch stays O(deletes).
    const deletedOpenEditorIds = hasActiveEditorPathMoves()
      ? deletedOpenEditorIdsRaw.filter((fileId) => {
          const file = openFilesAtStart.find((f) => f.id === fileId)
          return (
            !file ||
            !isActiveMoveSourcePath(target.worktreeId, target.runtimeEnvironmentId, file.filePath)
          )
        })
      : deletedOpenEditorIdsRaw
    // Why: correlate creates to deletes by basename to avoid mislabelling unrelated create+delete pairs as "renamed"; default to 'deleted' when we can't correlate.
    const hasPairedCreate =
      deletedOpenEditorIds.length > 0 &&
      hasRenameCorrelatedCreate(payload, target.worktreeId, deletedOpenEditorIds, openFilesAtStart)
    if (deletedOpenEditorIds.length > 0) {
      if (hasPairedCreate) {
        // Why: single-payload delete+create is already correct in one render tick, so no debounce needed.
        const setExternalMutation = useAppStore.getState().setExternalMutation
        for (const fileId of deletedOpenEditorIds) {
          setExternalMutation(fileId, 'renamed')
        }
      } else {
        // Why: defer the 'deleted' tombstone so a follow-up same-path create in the next payload can cancel it (macOS atomic write).
        const deletePathByFileId = buildDeletePathByFileId(
          payload,
          target.worktreeId,
          target.runtimeEnvironmentId,
          deletedOpenEditorIds,
          openFilesAtStart
        )
        for (const fileId of deletedOpenEditorIds) {
          const absolutePath = deletePathByFileId.get(fileId)
          if (!absolutePath) {
            continue
          }
          const key = pendingKey(target.worktreeId, target.runtimeEnvironmentId, absolutePath)
          const existing = pendingDeletes.get(key)
          if (existing) {
            clearTimeout(existing.timer)
            pendingDeletes.delete(key)
          }
          const timer = setTimeout(() => {
            pendingDeletes.delete(key)
            // Why: the debounce window lets the tab close or leave edit mode, so re-check before writing to avoid tombstoning a dropped or non-edit tab.
            const state = useAppStore.getState()
            const stillEditing = state.openFiles.some((f) => f.id === fileId && f.mode === 'edit')
            if (stillEditing) {
              state.setExternalMutation(fileId, 'deleted')
            }
          }, EXTERNAL_MUTATION_DEBOUNCE_MS)
          pendingDeletes.set(key, { fileId, timer })
        }
      }
    }

    // Why: a reappearing file (e.g. `git checkout`) clears its deleted/renamed tombstone — but not a 'changed' mark, which resolves via reload/save instead.
    if (createOrUpdatePaths.size > 0) {
      const state = useAppStore.getState()
      for (const file of state.openFiles) {
        if (
          file.worktreeId === target.worktreeId &&
          openFileRuntimeOwner(file) === target.runtimeEnvironmentId &&
          (file.mode === 'edit' || file.mode === 'markdown-preview') &&
          (file.externalMutation === 'deleted' || file.externalMutation === 'renamed') &&
          createOrUpdatePaths.has(normalizeRuntimePathForComparison(file.filePath))
        ) {
          state.setExternalMutation(file.id, null)
        }
      }
    }

    const changedFiles = new Set<string>()
    for (const evt of payload.events) {
      if (evt.kind === 'overflow') {
        // Why: overflow omits per-path info, so conservatively clear stale tombstones or a file that reappeared during the overrun stays struck through.
        for (const notification of getOverflowExternalReloadTargets(target)) {
          scheduleDebouncedExternalReload(notification)
        }
        // Why: `break` not `return` — changedFiles is empty so the rest early-returns anyway, and this is more robust to code added after the loop.
        break
      }

      if (evt.kind === 'update' && evt.isDirectory === true) {
        continue
      }

      if (evt.kind === 'delete') {
        // Why: deletes are tombstoned above; feeding them into reload would read the ENOENT path and replace in-memory content with an error, losing the user's view.
        continue
      }

      const relativePath = getExternalFileChangeRelativePath(
        target.worktreePath,
        evt.absolutePath,
        evt.isDirectory
      )
      if (relativePath) {
        changedFiles.add(relativePath)
      }
    }

    if (changedFiles.size === 0) {
      return
    }

    // Why: read openFiles once per payload to avoid N store reads on large batches; consumers skip dirty tabs so external writes don't destroy unsaved work.
    const openFilesSnapshot = useAppStore.getState().openFiles
    // Why: the combined "Changes" tab is per-worktree not per-path, so compute it once instead of rescanning openFiles per changed file in a large batched payload.
    const hasCombinedDiffConsumer = openFilesSnapshot.some(
      (f) =>
        f.worktreeId === target.worktreeId &&
        openFileRuntimeOwner(f) === target.runtimeEnvironmentId &&
        isWorkingTreeCombinedDiffTab(f)
    )
    for (const relativePath of changedFiles) {
      const notification = {
        worktreeId: target.worktreeId,
        worktreePath: target.worktreePath,
        relativePath,
        runtimeEnvironmentId: target.runtimeEnvironmentId
      }
      const absolutePath = joinPath(notification.worktreePath, notification.relativePath)
      const matching = getOpenFilesForExternalFileChange(openFilesSnapshot, notification)
      if (matching.length === 0) {
        // Why: combined-diff tab has no in-memory content to clobber and guards its own reload, so notify it directly without self-write suppression.
        if (hasCombinedDiffConsumer) {
          scheduleDebouncedExternalReload(notification)
        }
        continue
      }
      const dirtyMatches = matching.filter((f) => f.isDirty)
      if (dirtyMatches.length > 0) {
        // canAutoSaveOpenFile is the set of tabs that can hold unsaved edits — the tabs the banner serves.
        const dirtyIds = dirtyMatches.filter((f) => canAutoSaveOpenFile(f)).map((f) => f.id)
        // A tab carrying move-echo provenance for this path may just be seeing the move's own echo; settle by
        // disk identity below. Only a provenance-carrying tab can match, so skip the normalize when none has it.
        let isSelfMoveEcho = false
        if (dirtyMatches.some((f) => f.pendingSelfMoveEcho)) {
          const normalizedAbsolutePath = normalizeRuntimePathForComparison(absolutePath)
          isSelfMoveEcho = dirtyMatches.some(
            (f) =>
              f.pendingSelfMoveEcho &&
              normalizeRuntimePathForComparison(f.pendingSelfMoveEcho.targetPath) ===
                normalizedAbsolutePath
          )
        }
        if (isSelfMoveEcho) {
          // Real destination fs event confirms the echo — consume the provenance so a later genuine write takes the normal path.
          scheduleSelfMoveEchoVerification(target, dirtyIds, true)
        } else {
          // An external write on a dirty tab must not vanish silently (issue #7265); mark it for the reload banner.
          scheduleChangedOnDiskMark(target, notification, dirtyIds)
        }
        if (dirtyMatches.length === matching.length) {
          if (hasCombinedDiffConsumer) {
            scheduleDebouncedExternalReload(notification)
          }
          continue
        }
        // Clean sibling tabs (e.g. an unstaged diff of the same path) still reload below; consumers skip dirty files.
      }
      const recentSelfWrite = getRecentSelfWrite(absolutePath, target.runtimeEnvironmentId)
      if (recentSelfWrite) {
        scheduleSelfWriteAwareExternalReload(target, notification, matching[0], recentSelfWrite)
        continue
      }
      scheduleDebouncedExternalReload(notification)
    }
  }

  const dispose = (): void => {
    // Why: clear in-flight tombstone timers so they don't fire after disposal and touch a stale store.
    for (const pending of pendingDeletes.values()) {
      clearTimeout(pending.timer)
    }
    pendingDeletes.clear()
  }

  return { handleFsChanged, dispose }
}
function scheduleSelfWriteAwareExternalReload(
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
  // Why: a self-write stamp only proves recent change; compare disk content so we suppress only Orca's own echo, not a newer agent write in the same TTL.
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
  // Why: one clean target is enough — consumers skip dirty files per-file, so a dirty sibling doesn't veto the reload.
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
      // Why: overflow gives no per-path resurrection signal, so clear the tombstone and let a still-missing file surface as a read failure.
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

function buildDeletePathByFileId(
  payload: FsChangedPayload,
  worktreeId: string,
  runtimeEnvironmentId: string | null,
  deletedOpenEditorIds: string[],
  openFiles: OpenFile[]
): Map<string, string> {
  const deletePaths = new Set<string>()
  for (const evt of payload.events) {
    if (evt.kind === 'delete') {
      deletePaths.add(normalizeRuntimePathForComparison(evt.absolutePath))
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

function collectDeletedOpenEditorIds(
  payload: FsChangedPayload,
  worktreeId: string,
  runtimeEnvironmentId: string | null,
  openFiles: OpenFile[]
): string[] {
  const deletePaths = new Set<string>()
  for (const evt of payload.events) {
    if (evt.kind === 'delete') {
      deletePaths.add(normalizeRuntimePathForComparison(evt.absolutePath))
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

/**
 * Returns true if the batched payload contains at least one file-create event
 * whose basename matches a deleted open editor file.
 *
 * Why: correlate by basename only, not parent dir — save-as-temp patterns (`rm foo.md && touch foo.md.new`) put unrelated creates in the same dir and would mislabel deletes as renames.
 */
function hasRenameCorrelatedCreate(
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
      (file.mode !== 'edit' && file.mode !== 'markdown-preview')
    ) {
      continue
    }
    if (!deletedIdSet.has(file.id)) {
      continue
    }
    deletedBasenames.add(basename(file.filePath))
  }
  if (deletedBasenames.size === 0) {
    return false
  }
  for (const evt of payload.events) {
    if (evt.kind !== 'create' || evt.isDirectory === true) {
      continue
    }
    if (deletedBasenames.has(basename(evt.absolutePath))) {
      return true
    }
  }
  return false
}
