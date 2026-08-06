import type { MutableRefObject } from 'react'
import type { AppState } from '../store'

export type TerminalSurfaceSaveContext = Pick<
  AppState,
  | 'openFiles'
  | 'activeWorktreeId'
  | 'activeTabType'
  | 'activeTabId'
  | 'activeTabIdByWorktree'
  | 'setActiveTab'
  | 'setActiveFile'
  | 'setActiveTabType'
  | 'setActiveWorktree'
  | 'markFileDirty'
  | 'closeFile'
  | 'activeFileId'
  | 'tabsByWorktree'
  | 'consumeSuppressedPtyExit'
> & {
  renderedActiveWorktreeId: string | null
  tabs: NonNullable<AppState['tabsByWorktree'][string]>
}

export type TerminalSurfaceSaveResult = {
  saveDialogFileId: string | null
  saveDialogFile: AppState['openFiles'][number] | null
  handleSaveDialogCancel: () => void
  handleSaveDialogDiscard: () => Promise<void>
  handleSaveDialogSave: () => Promise<void>
  windowCloseDialogOpen: boolean
  setWindowCloseDialogOpen: (open: boolean) => void
  confirmNativeWindowClose: (isQuitting: boolean) => void
  proceedToNativeWindowClose: (isQuitting: boolean) => void
  windowCloseAfterDirtyRef: MutableRefObject<{ isQuitting: boolean } | null>
  queueEditorCloseRequests: (
    fileIds: string[],
    pendingWindowClose?: { isQuitting: boolean }
  ) => void
  handleCloseFile: (fileId: string) => void
}
