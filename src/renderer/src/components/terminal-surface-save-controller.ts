import { useCallback, useEffect, useRef, useState } from 'react'
import { getClientRuntime } from '@/runtime/client-runtime'
import { toast } from 'sonner'
import { getConnectionId } from '../lib/connection-context'
import { useAppStore } from '../store'
import { appendUniqueOpenFileIds } from './terminal/unsaved-close-queue'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import {
  requestEditorSaveQuiesce,
  type EditorRequestFileCloseDetail
} from './editor/editor-autosave'
import { translate } from '@/i18n/i18n'
import { resolveRepairedActiveTerminalTabId } from './terminal/active-terminal-repair'
const CLOSE_DIALOG_DEBOUNCE_MS = 200
export function useTerminalSurfaceSaveController(
  context: Record<string, any>
): Record<string, any> {
  const {
    openFiles,
    activeWorktreeId,
    activeTabType,
    activeTabId,
    activeTabIdByWorktree,
    renderedActiveWorktreeId,
    tabs,
    tabsByWorktree,
    setActiveTab,
    setActiveTabType,
    setActiveWorktree,
    markFileDirty,
    closeFile,
    activeFileId,
    terminalParkingRevision,
    setTerminalParkingRevision,
    backgroundMountRevision,
    setBackgroundMountRevision,
    consumeSuppressedPtyExit
  } = context
  const pendingEditorCloseQueueRef = useRef<string[]>([])

  // Why: track the file whose save-and-close is in flight so getNextQueuedEditorClose skips it and concurrent close requests can't re-open the dialog over it.
  const inFlightSaveFileIdRef = useRef<string | null>(null)

  // Why: gate the Save/Discard/Cancel handlers so a stray carry-over click doesn't act on the next dialog before the user reads it; released after CLOSE_DIALOG_DEBOUNCE_MS.
  const isClosingRef = useRef(false)
  const closeDialogDebounceTimersRef = useRef<Set<number>>(new Set())
  const releaseCloseDialogGuardAfterDebounce = useCallback(() => {
    const timer = window.setTimeout(() => {
      closeDialogDebounceTimersRef.current.delete(timer)
      isClosingRef.current = false
    }, CLOSE_DIALOG_DEBOUNCE_MS)
    closeDialogDebounceTimersRef.current.add(timer)
  }, [])

  // Window close confirmation, shown for local terminals with running children (SSH terminals detach/persist via the relay).
  const [windowCloseDialogOpen, setWindowCloseDialogOpen] = useState(false)

  // Why: defer confirmWindowClose() while tabs are dirty — the beforeunload guard preventDefault()s, so an immediate confirm leaves the window open with no UI.
  const windowCloseAfterDirtyRef = useRef<{ isQuitting: boolean } | null>(null)

  const confirmNativeWindowClose = useCallback(() => {
    // Why: capture only after every close guard has committed. A canceled child-
    // process prompt must not consume App's synthetic/native unload guard.
    const accepted = window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    if (!accepted) {
      return
    }
    getClientRuntime().app.confirmWindowClose()
  }, [])

  const proceedToNativeWindowClose = useCallback(
    (isQuitting: boolean) => {
      if (!isQuitting) {
        const state = useAppStore.getState()
        const localPtyIds = Object.entries(state.tabsByWorktree).flatMap(
          ([worktreeId, worktreeTabs]) => {
            const connectionId = getConnectionId(worktreeId)
            if (connectionId !== null) {
              return []
            }
            return worktreeTabs
              .flatMap((tab) => state.ptyIdsByTabId[tab.id] ?? [])
              .filter((ptyId) => !isRemoteRuntimePtyId(ptyId))
          }
        )
        if (localPtyIds.length > 0) {
          void Promise.all(
            localPtyIds.map((id) => getClientRuntime().terminal.hasChildProcesses(id))
          ).then((results) => {
            if (results.some(Boolean)) {
              setWindowCloseDialogOpen(true)
            } else {
              confirmNativeWindowClose()
            }
          })
          return
        }
      }
      confirmNativeWindowClose()
    },
    [confirmNativeWindowClose]
  )

  const waitForFileClosed = useCallback((fileId: string, timeoutMs: number): Promise<boolean> => {
    if (!useAppStore.getState().openFiles.some((f) => f.id === fileId)) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      let unsub: (() => void) | null = null
      const timeoutId = window.setTimeout(() => {
        unsub?.()
        resolve(false)
      }, timeoutMs)
      unsub = useAppStore.subscribe((state) => {
        if (!state.openFiles.some((f) => f.id === fileId)) {
          window.clearTimeout(timeoutId)
          unsub?.()
          resolve(true)
        }
      })
      // Why: zustand only fires subscribers on later changes, so re-check in case the file closed between the guard and subscribe.
      if (!useAppStore.getState().openFiles.some((f) => f.id === fileId)) {
        window.clearTimeout(timeoutId)
        unsub?.()
        resolve(true)
      }
    })
  }, [])

  const getNextQueuedEditorClose = useCallback((): string | null => {
    // Why: bulk closes enqueue files that may go clean or vanish before reaching the front; drain them so the dialog only blocks on tabs still needing a decision.
    while (pendingEditorCloseQueueRef.current.length > 0) {
      const fileId = pendingEditorCloseQueueRef.current[0]
      // Why: skip a fileId with an in-flight save; waitForFileClosed re-advances the queue once it closes or times out.
      if (inFlightSaveFileIdRef.current === fileId) {
        return null
      }
      const file = useAppStore.getState().openFiles.find((candidate) => candidate.id === fileId)
      if (!file) {
        pendingEditorCloseQueueRef.current.shift()
        continue
      }
      if (!file.isDirty) {
        closeFile(fileId)
        pendingEditorCloseQueueRef.current.shift()
        continue
      }
      return fileId
    }
    return null
  }, [closeFile])

  const advanceEditorCloseQueue = useCallback(() => {
    const nextFileId = getNextQueuedEditorClose()
    if (nextFileId) {
      // Why: the queue can cross worktrees during window-close; switch to the file's worktree so the UI behind the dialog matches its filename.
      const state = useAppStore.getState()
      const file = state.openFiles.find((f) => f.id === nextFileId)
      if (file && file.worktreeId !== state.activeWorktreeId) {
        setActiveWorktree(file.worktreeId)
      }
      setActiveFile(nextFileId)
      setActiveTabType('editor')
      setSaveDialogFileId(nextFileId)
      return
    }
    setSaveDialogFileId(null)
    const pendingWindowClose = windowCloseAfterDirtyRef.current
    if (pendingWindowClose) {
      windowCloseAfterDirtyRef.current = null
      proceedToNativeWindowClose(pendingWindowClose.isQuitting)
    }
  }, [
    getNextQueuedEditorClose,
    proceedToNativeWindowClose,
    setActiveFile,
    setActiveTabType,
    setActiveWorktree
  ])

  const queueEditorCloseRequests = useCallback(
    (fileIds: string[], pendingWindowClose?: { isQuitting: boolean }) => {
      if (pendingWindowClose) {
        windowCloseAfterDirtyRef.current = pendingWindowClose
      }
      pendingEditorCloseQueueRef.current = appendUniqueOpenFileIds(
        pendingEditorCloseQueueRef.current,
        fileIds,
        new Set(useAppStore.getState().openFiles.map((file) => file.id))
      )
      advanceEditorCloseQueue()
    },
    [advanceEditorCloseQueue]
  )

  const handleCloseFile = useCallback(
    (fileId: string) => {
      const state = useAppStore.getState()
      if (activeWorktreeId && isPinnedActiveEditorTab(state, activeWorktreeId, fileId)) {
        return
      }
      const file = state.openFiles.find((f) => f.id === fileId)
      if (file?.isDirty) {
        queueEditorCloseRequests([fileId])
        return
      }
      closeFile(fileId)
    },
    [activeWorktreeId, closeFile, queueEditorCloseRequests]
  )

  const handleSaveDialogSave = useCallback(async () => {
    if (isClosingRef.current) {
      return
    }
    if (!saveDialogFileId) {
      return
    }
    isClosingRef.current = true
    const fileId = saveDialogFileId
    const file = useAppStore.getState().openFiles.find((f) => f.id === fileId)
    if (!file) {
      pendingEditorCloseQueueRef.current = pendingEditorCloseQueueRef.current.filter(
        (id) => id !== fileId
      )
      advanceEditorCloseQueue()
      releaseCloseDialogGuardAfterDebounce()
      return
    }

    // Why: signal the headless autosave controller via event (not editor refs) so save-and-close flushes even when the editor panel has unmounted.
    setSaveDialogFileId(null)
    window.dispatchEvent(new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId } }))
    inFlightSaveFileIdRef.current = fileId
    let closed = false
    try {
      closed = await waitForFileClosed(fileId, 10_000)
    } finally {
      // Why: clear the in-flight ref on success or timeout so getNextQueuedEditorClose no longer treats the queue head as un-advanceable.
      if (inFlightSaveFileIdRef.current === fileId) {
        inFlightSaveFileIdRef.current = null
      }
    }
    if (!closed) {
      // Why: the save may have resolved just after the timeout fired; re-check so we drain/advance instead of re-opening a stale dialog, toasting only real timeouts.
      if (!useAppStore.getState().openFiles.some((f) => f.id === fileId)) {
        pendingEditorCloseQueueRef.current = pendingEditorCloseQueueRef.current.filter(
          (id) => id !== fileId
        )
        advanceEditorCloseQueue()
        releaseCloseDialogGuardAfterDebounce()
        return
      }
      toast.error(
        translate(
          'auto.components.Terminal.a2a279b32a',
          'Save timed out or failed. Fix errors before closing.'
        )
      )
      setSaveDialogFileId(fileId)
      // Why: on a genuine timeout the user stays on the same dialog, so release the guard now — a new click is a deliberate retry.
      isClosingRef.current = false
      return
    }
    pendingEditorCloseQueueRef.current = pendingEditorCloseQueueRef.current.filter(
      (id) => id !== fileId
    )
    advanceEditorCloseQueue()
    releaseCloseDialogGuardAfterDebounce()
  }, [
    advanceEditorCloseQueue,
    releaseCloseDialogGuardAfterDebounce,
    saveDialogFileId,
    waitForFileClosed
  ])

  const handleSaveDialogDiscard = useCallback(async () => {
    if (isClosingRef.current) {
      return
    }
    if (!saveDialogFileId) {
      return
    }
    isClosingRef.current = true
    const fileId = saveDialogFileId

    // Why: dismiss synchronously before awaiting quiesce so a double-click can't fire twice with the same fileId and double-advance the queue.
    setSaveDialogFileId(null)

    // Why: wait for background autosave to settle before "Don't Save", else a write can land after the user chose to discard.
    try {
      await requestEditorSaveQuiesce({ fileId })
    } catch (error) {
      // Why: don't trap the user in the close-dialog loop on quiesce failure, but still warn so a stuck controller stays visible.
      console.warn('Autosave quiesce failed before discard', error)
    }
    markFileDirty(fileId, false)
    closeFile(fileId)
    pendingEditorCloseQueueRef.current = pendingEditorCloseQueueRef.current.filter(
      (id) => id !== fileId
    )
    advanceEditorCloseQueue()
    releaseCloseDialogGuardAfterDebounce()
  }, [
    advanceEditorCloseQueue,
    closeFile,
    markFileDirty,
    releaseCloseDialogGuardAfterDebounce,
    saveDialogFileId
  ])

  const handleSaveDialogCancel = useCallback(() => {
    if (isClosingRef.current) {
      return
    }
    isClosingRef.current = true
    pendingEditorCloseQueueRef.current = []
    windowCloseAfterDirtyRef.current = null
    setSaveDialogFileId(null)
    releaseCloseDialogGuardAfterDebounce()
  }, [releaseCloseDialogGuardAfterDebounce])

  useEffect(() => {
    const onRequestEditorClose = (event: Event): void => {
      const customEvent = event as CustomEvent<EditorRequestFileCloseDetail>
      const fileId = customEvent.detail?.fileId
      if (!fileId) {
        return
      }
      queueEditorCloseRequests([fileId])
    }
    window.addEventListener(
      ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT,
      onRequestEditorClose as EventListener
    )
    return () =>
      window.removeEventListener(
        ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT,
        onRequestEditorClose as EventListener
      )
  }, [queueEditorCloseRequests])

  useEffect(() => {
    const rememberedTabId = renderedActiveWorktreeId
      ? (activeTabIdByWorktree[renderedActiveWorktreeId] ?? null)
      : null
    // Why: prefer the remembered active tab so a repair on a transient switch render doesn't reset selection to Terminal 1.
    const repairedTabId = resolveRepairedActiveTerminalTabId({
      activeTabType,
      activeTabId,
      rememberedTabId,
      tabs
    })
    if (!repairedTabId) {
      return
    }
    // Why: run in an effect (Zustand mutation during render trips React's cross-component update warning); keep terminal-only so inactive CLI-created tabs can't steal editor/browser focus.
    setActiveTab(repairedTabId)
    // Why: `tabs` is the dependency so the repair reacts to tab-order/content changes, not just scalar IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTabId,
    activeTabType,
    setActiveTab,
    tabs,
    activeTabIdByWorktree,
    renderedActiveWorktreeId
  ])

  return {
    saveDialogFileId,
    saveDialogFile,
    handleSaveDialogCancel,
    handleSaveDialogDiscard,
    handleSaveDialogSave,
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    confirmNativeWindowClose,
    proceedToNativeWindowClose,
    windowCloseAfterDirtyRef,
    queueEditorCloseRequests,
    handleCloseFile
  }
}
