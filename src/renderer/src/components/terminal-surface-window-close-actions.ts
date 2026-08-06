import { useCallback, useRef, useState } from 'react'
import { getClientRuntime } from '@/runtime/client-runtime'
import { getConnectionId } from '../lib/connection-context'
import { useAppStore } from '../store'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'

export function useTerminalSurfaceWindowCloseActions(): Record<string, unknown> {
  const [windowCloseDialogOpen, setWindowCloseDialogOpen] = useState(false)
  const windowCloseAfterDirtyRef = useRef<{ isQuitting: boolean } | null>(null)
  const confirmNativeWindowClose = useCallback(() => {
    const accepted = window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    if (!accepted) return
    getClientRuntime().app.confirmWindowClose()
  }, [])
  const proceedToNativeWindowClose = useCallback(
    (isQuitting: boolean) => {
      if (!isQuitting) {
        const state = useAppStore.getState()
        const localPtyIds = Object.entries(state.tabsByWorktree).flatMap(
          ([worktreeId, worktreeTabs]) => {
            if (getConnectionId(worktreeId) !== null) return []
            return worktreeTabs
              .flatMap((tab) => state.ptyIdsByTabId[tab.id] ?? [])
              .filter((ptyId) => !isRemoteRuntimePtyId(ptyId))
          }
        )
        if (localPtyIds.length > 0) {
          void Promise.all(
            localPtyIds.map((id) => getClientRuntime().terminal.hasChildProcesses(id))
          ).then((results) => {
            if (results.some(Boolean)) setWindowCloseDialogOpen(true)
            else confirmNativeWindowClose()
          })
          return
        }
      }
      confirmNativeWindowClose()
    },
    [confirmNativeWindowClose]
  )
  return {
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    windowCloseAfterDirtyRef,
    confirmNativeWindowClose,
    proceedToNativeWindowClose
  }
}
