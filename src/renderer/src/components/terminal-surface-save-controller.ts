import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import { appendUniqueOpenFileIds } from './terminal/unsaved-close-queue'
import {
  requestEditorSaveQuiesce,
  type EditorRequestFileCloseDetail
} from './editor/editor-autosave'
import { translate } from '@/i18n/i18n'
import { useTerminalSurfaceWindowCloseActions } from './terminal-surface-window-close-actions'
import { waitForTerminalFileClosed } from './terminal-surface-file-close-wait'
import { useTerminalSurfaceActiveTabRepairEffect } from './terminal-surface-active-tab-repair-effect'
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
  const [saveDialogFileId, setSaveDialogFileId] = useState<string | null>(null)
  const saveDialogFile = saveDialogFileId
    ? useAppStore.getState().openFiles.find((file) => file.id === saveDialogFileId) ?? null
    : null
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
  const windowClose = useTerminalSurfaceWindowCloseActions()
  const {
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    windowCloseAfterDirtyRef,
    confirmNativeWindowClose,
    proceedToNativeWindowClose
  } = windowClose

  const waitForFileClosed = waitForTerminalFileClosed

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
  useTerminalSurfaceActiveTabRepairEffect({
    renderedActiveWorktreeId,
    activeTabIdByWorktree,
    activeTabType,
    activeTabId,
    tabs,
    setActiveTab
  })
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
