import { ipcRenderer, webFrame, richMarkdownContextMenuCommandChannel, subscribeNativeFileDrop } from './preload-api-runtime-context';import type { NativeFileDropPayload, PreloadApi, ReadClipboardTextOptions, RichMarkdownContextMenuCommandPayload } from './preload-api-runtime-context';export function createPreloadApiUiWindow(): { ui: Partial<PreloadApi['ui']> } {
  return {
    ui: {
    readClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readText', options),
    readSelectionClipboardText: (options?: ReadClipboardTextOptions): Promise<string> =>
      ipcRenderer.invoke('clipboard:readSelectionText', options),
    saveClipboardImageAsTempFile: (args?: {
      connectionId?: string | null
      runtimeEnvironmentId?: string | null
    }): Promise<string | null> => ipcRenderer.invoke('clipboard:saveImageAsTempFile', args),
    writeClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeText', text),
    writeTerminalClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeTerminalText', text),
    writeSelectionClipboardText: (text: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeSelectionText', text),
    writeClipboardImage: (dataUrl: string): Promise<void> =>
      ipcRenderer.invoke('clipboard:writeImage', dataUrl),
    performNativePaste: (options?: { mode?: 'paste' | 'paste-and-match-style' }): void => {
      ipcRenderer.send('ui:performNativePaste', {
        mode: options?.mode === 'paste-and-match-style' ? 'paste-and-match-style' : 'paste'
      })
    },
    writeClipboardFile: (
      args:
        | {
            filePath: string
            connectionId?: string | null
          }
        | string
    ): Promise<{ ok: boolean; reason?: string }> => ipcRenderer.invoke('clipboard:writeFile', args),
    onFileDrop: (callback: (data: NativeFileDropPayload) => void): (() => void) =>
      subscribeNativeFileDrop(callback),
    getZoomLevel: (): number => webFrame.getZoomLevel(),
    setZoomLevel: (level: number): void => webFrame.setZoomLevel(level),
    syncTrafficLights: (zoomFactor: number): void =>
      ipcRenderer.send('ui:sync-traffic-lights', zoomFactor),
    // Why: one-way send so main's before-input-event can synchronously skip Cmd+B while the markdown editor is focused (TipTap bold).
    setMarkdownEditorFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setMarkdownEditorFocused', focused)
    },
    setTerminalInputFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setTerminalInputFocused', focused)
    },
    // Why: one atomic payload so main's synchronous before-input-event never sees a torn terminal=true/panel=false state.
    setFloatingFocus: (state: { panelFocused: boolean; terminalFocused: boolean }): void => {
      ipcRenderer.send('ui:setFloatingFocus', state)
    },
    setShortcutRecorderFocused: (focused: boolean): void => {
      ipcRenderer.send('ui:setShortcutRecorderFocused', focused)
    },
    onRichMarkdownContextCommand: (
      callback: (payload: RichMarkdownContextMenuCommandPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: RichMarkdownContextMenuCommandPayload
      ) => callback(payload)
      ipcRenderer.on(richMarkdownContextMenuCommandChannel, listener)
      return () => ipcRenderer.removeListener(richMarkdownContextMenuCommandChannel, listener)
    },
    onFullscreenChanged: (callback: (isFullScreen: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) =>
        callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-changed', listener)
      return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
    },
    /** Fired when the OS resumes from sleep — a focus-preserving wake fires no renderer focus/visibility events. */
    onSystemResumed: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('system:resumed', listener)
      return () => ipcRenderer.removeListener('system:resumed', listener)
    },
    /** Desktop custom titlebar only: minimize via renderer-drawn window controls. */
    minimize: (): void => {
      ipcRenderer.send('window:minimize')
    },
    /** Desktop custom titlebar only: toggle maximize/restore via renderer-drawn controls. */
    maximize: (): void => {
      ipcRenderer.send('window:maximize')
    },
    /** Desktop custom titlebar only: read initial maximize state on mount — maximize-changed only fires on transitions. */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** Desktop custom titlebar only: subscribe to maximize-state changes so the maximize button shows the right icon. */
    onMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) =>
        callback(isMaximized)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.removeListener('window:maximize-changed', listener)
    },
    /** Desktop custom titlebar only: request close via main so the BrowserWindow 'close' event
     *  (and its terminal-running guard) still fires — window.close() is unreliable in sandboxed renderers. */
    requestClose: (): void => {
      ipcRenderer.send('window:request-close')
    },
    /** Desktop custom titlebar only: pop up the app menu at the cursor — Alt-reveal replacement for the ··· button. */
    popupMenu: (): void => {
      ipcRenderer.send('menu:popup')
    },
    /** Fired by main when the user tries to close the window; renderer confirms running
     *  terminals then calls confirmWindowClose(). isQuitting (Cmd+Q / app.quit) skips that dialog. */
    onWindowCloseRequested: (callback: (data: { isQuitting: boolean }) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { isQuitting: boolean; requestId?: number }
      ): void => {
        // Why: main cannot reach will-quit while a frozen renderer owns the window close handshake.
        ipcRenderer.send('window:close-request-received', data?.requestId)
        callback({ isQuitting: data?.isQuitting ?? false })
      }
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
    /** Tell the main process to proceed with the window close. */
    confirmWindowClose: (): void => {
      ipcRenderer.send('window:confirm-close')
    },
    /** Report a genuine hidden→visible reveal so main can recover a stale (throttled) layout/compositor surface. */
    notifyWindowRevealed: (): void => {
      ipcRenderer.send('ui:window-revealed')
    }
    } satisfies Partial<PreloadApi['ui']>
  }
}
