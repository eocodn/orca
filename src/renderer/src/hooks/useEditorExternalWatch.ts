import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import type { FsChangedPayload } from '../../../shared/types'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-client'
import {
  getEditorExternalWatchTargets,
  getWatchedTargetKey,
  warnExternalWatchFailure,
  type WatchedTarget
} from './editor-external-watch-targets'
import { createExternalWatchEventHandler } from './editor-external-watch-events'

export { getEditorExternalWatchTargets, getWatchedTargetKey }
export type { EditorExternalWatchTargetState, WatchedTarget } from './editor-external-watch-targets'
export { createExternalWatchEventHandler } from './editor-external-watch-events'
export { verifyLatchedMoveDestinations } from './editor-external-watch-echo'

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
