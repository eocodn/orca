import { ipcRenderer, browserFindSubscriptions } from './preload-api-runtime-context'
import type { PreloadApi } from './preload-api-runtime-context'

export function createPreloadApiUiBrowser(): { ui: Partial<PreloadApi['ui']> } {
  return {
    ui: {
    onRequestTabCreate: (
      callback: (data: {
        requestId: string
        url: string
        worktreeId?: string
        sessionProfileId?: string | null
        sessionPartition?: string
        activate?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          url: string
          worktreeId?: string
          sessionProfileId?: string | null
          sessionPartition?: string
          activate?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('browser:requestTabCreate', listener)
    },
    replyTabCreate: (reply: {
      requestId: string
      browserPageId?: string
      error?: string
    }): void => {
      ipcRenderer.send('browser:tabCreateReply', reply)
    },
    onRequestTabSetProfile: (
      callback: (data: {
        requestId: string
        browserPageId: string
        profileId: string
        sessionPartition?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId: string
          browserPageId: string
          profileId: string
          sessionPartition?: string
        }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabSetProfile', listener)
      return () => ipcRenderer.removeListener('browser:requestTabSetProfile', listener)
    },
    replyTabSetProfile: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabSetProfileReply', reply)
    },
    onRequestTabClose: (
      callback: (data: { requestId: string; tabId: string | null; worktreeId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { requestId: string; tabId: string | null; worktreeId?: string }
      ) => callback(data)
      ipcRenderer.on('browser:requestTabClose', listener)
      return () => ipcRenderer.removeListener('browser:requestTabClose', listener)
    },
    replyTabClose: (reply: { requestId: string; error?: string }): void => {
      ipcRenderer.send('browser:tabCloseReply', reply)
    },
    onNewTerminalTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:newTerminalTab', listener)
    },
    onFocusBrowserAddressBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:focusBrowserAddressBar', listener)
      return () => ipcRenderer.removeListener('ui:focusBrowserAddressBar', listener)
    },
    onFindInBrowserPage: browserFindSubscriptions.subscribe,
    onReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:reloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:reloadBrowserPage', listener)
    },
    onBrowserHistoryNavigate: (callback: (direction: 'back' | 'forward') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward'): void =>
        callback(direction)
      ipcRenderer.on('ui:browserHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:browserHistoryNavigate', listener)
    },
    onZoomBrowserPage: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('ui:zoomBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:zoomBrowserPage', listener)
    },
    onHardReloadBrowserPage: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:hardReloadBrowserPage', listener)
      return () => ipcRenderer.removeListener('ui:hardReloadBrowserPage', listener)
    },
    } satisfies Partial<PreloadApi['ui']>
  }
}

