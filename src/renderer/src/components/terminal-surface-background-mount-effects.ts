import { useEffect, type MutableRefObject } from 'react'
import { useAppStore } from '../store'
import {
  applyBackgroundMountTabRestriction,
  revealActivationDeferredTabs,
  takeAllPendingBackgroundTerminalWorktreeMounts,
  takePendingBackgroundTerminalWorktreeMount
} from './terminal/background-terminal-worktree-mount'
import { scheduleBackgroundTerminalWorktreeMeasure } from './terminal/background-terminal-worktree-visibility'

type TerminalSurfaceBackgroundMountContext = {
  measurableBackgroundWorktreeTimersRef: MutableRefObject<Map<string, number>>
  mountedWorktreeIdsRef: MutableRefObject<Set<string>>
  backgroundMountTabIdsByWorktreeRef: MutableRefObject<Map<string, ReadonlySet<string>>>
  activationDeferredMountTabIdsByWorktreeRef: MutableRefObject<Map<string, ReadonlySet<string>>>
  measurableBackgroundWorktreeIdsRef: MutableRefObject<Set<string>>
  setBackgroundMountRevision: (updater: (revision: number) => number) => void
}

export function useTerminalSurfaceBackgroundMountEffects(
  context: TerminalSurfaceBackgroundMountContext
): void {
  const {
    measurableBackgroundWorktreeTimersRef,
    mountedWorktreeIdsRef,
    backgroundMountTabIdsByWorktreeRef,
    activationDeferredMountTabIdsByWorktreeRef,
    measurableBackgroundWorktreeIdsRef,
    setBackgroundMountRevision
  } = context
  useEffect(() => {
    const timers = measurableBackgroundWorktreeTimersRef.current
    const applyBackgroundMount = (detail: BackgroundMountTerminalWorktreeDetail): void => {
      const worktreeId = detail.worktreeId
      applyBackgroundMountTabRestriction(
        backgroundMountTabIdsByWorktreeRef.current,
        mountedWorktreeIdsRef.current,
        worktreeId,
        detail.tabIds
      )
      const worktreeTabIds = (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).map(
        (tab) => tab.id
      )
      revealActivationDeferredTabs({
        restrictions: backgroundMountTabIdsByWorktreeRef.current,
        deferredMountTabIdsByWorktree: activationDeferredMountTabIdsByWorktreeRef.current,
        worktreeId,
        allTabIds: worktreeTabIds,
        immediateTabIds: new Set(detail.tabIds ?? worktreeTabIds)
      })
      scheduleBackgroundTerminalWorktreeMeasure({
        mountedWorktreeIds: mountedWorktreeIdsRef.current,
        measurableBackgroundWorktreeIds: measurableBackgroundWorktreeIdsRef.current,
        timers,
        worktreeId,
        onRevision: () => setBackgroundMountRevision((revision) => revision + 1),
        setTimeoutFn: window.setTimeout,
        clearTimeoutFn: window.clearTimeout
      })
    }
    const onBackgroundMountTerminalWorktree = (event: Event): void => {
      const customEvent = event as CustomEvent<BackgroundMountTerminalWorktreeDetail>
      const worktreeId = customEvent.detail?.worktreeId
      const pending = takePendingBackgroundTerminalWorktreeMount(worktreeId)
      const detail = pending ?? customEvent.detail
      if (detail?.worktreeId) {
        applyBackgroundMount(detail)
      }
    }
    window.addEventListener(
      BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
      onBackgroundMountTerminalWorktree as EventListener
    )
    for (const pending of takeAllPendingBackgroundTerminalWorktreeMounts()) {
      applyBackgroundMount(pending)
    }
    return () => {
      window.removeEventListener(
        BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
        onBackgroundMountTerminalWorktree as EventListener
      )
      for (const timer of timers.values()) {
        window.clearTimeout(timer)
      }
      timers.clear()
    }
  }, [
    activationDeferredMountTabIdsByWorktreeRef,
    backgroundMountTabIdsByWorktreeRef,
    measurableBackgroundWorktreeIdsRef,
    measurableBackgroundWorktreeTimersRef,
    mountedWorktreeIdsRef,
    setBackgroundMountRevision
  ])
}
