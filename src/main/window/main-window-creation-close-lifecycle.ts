import type { BrowserWindow} from 'electron';
import { app, ipcMain, Menu, Notification, powerMonitor } from 'electron'
import { browserManager } from '../browser/browser-manager'
import { translateMain } from '../i18n/main-i18n'
import { clearTrustedUIRendererWebContentsId } from '../ipc/ui'
import { closeDashboardPopout } from './dashboard-popout-window'
import { resolveWindowCloseAction } from './window-close-decision'
import {
  WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS,
  syncTrafficLightPosition
} from './main-window-creation'

type CloseLifecycleOptions = {
  mainWindow: BrowserWindow
  store: any
  opts?: {
    getIsQuitting?: () => boolean
    onQuitAborted?: () => void
  }
  rendererWebContentsId: number
  getRendererProcessGone: () => boolean
  setWindowClosing: (value: boolean) => void
  clearBoundsTimer: () => void
  freezeBoundsOnQuit: () => void
  resetFocusState: () => void
  clearInitialRevealFallbackTimer: () => void
  clearRendererRecoveryTimer: () => void
  onSystemResume: () => void
  removeShortcutListeners: () => void
}

export function registerMainWindowCloseLifecycle(options: CloseLifecycleOptions): void {
  const {
    mainWindow,
    store,
    opts,
    rendererWebContentsId,
    getRendererProcessGone,
    setWindowClosing,
    clearBoundsTimer,
    freezeBoundsOnQuit,
    resetFocusState,
    clearInitialRevealFallbackTimer,
    clearRendererRecoveryTimer,
    onSystemResume,
    removeShortcutListeners
  } = options
  let windowCloseConfirmed = false
  const confirmCloseChannel = 'window:confirm-close'
  const closeRequestReceivedChannel = 'window:close-request-received'
  let closeRequestSequence = 0
  let quitRendererAckRequestId: number | null = null
  let quitRendererAckTimer: ReturnType<typeof setTimeout> | null = null
  const clearQuitRendererAckTimer = (): void => {
    quitRendererAckRequestId = null
    if (quitRendererAckTimer) {
      clearTimeout(quitRendererAckTimer)
      quitRendererAckTimer = null
    }
  }
  const armQuitRendererAckTimer = (requestId: number): void => {
    quitRendererAckRequestId = requestId
    if (quitRendererAckTimer) {
      return
    }
    quitRendererAckTimer = setTimeout(() => {
      quitRendererAckTimer = null
      quitRendererAckRequestId = null
      if (mainWindow.isDestroyed()) {
        return
      }
      console.warn('[window] Renderer did not acknowledge quit; destroying unresponsive window')
      freezeBoundsOnQuit()
      mainWindow.destroy()
    }, WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS)
    quitRendererAckTimer.unref?.()
  }
  const onCloseRequestReceived = (event: Electron.IpcMainEvent, requestId: number): void => {
    if (event.sender.id === rendererWebContentsId && requestId === quitRendererAckRequestId) {
      clearQuitRendererAckTimer()
    }
  }
  const hideToTrayIfEnabled = (): boolean => {
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    if (
      process.platform !== 'win32' ||
      getRendererProcessGone() ||
      isRendererCrashed ||
      opts?.getIsQuitting?.() === true ||
      store?.getSettings().minimizeToTrayOnClose !== true
    ) {
      return false
    }
    mainWindow.hide()
    if (store.getUI().trayMinimizeNoticeShown !== true) {
      try {
        new Notification({ title: 'Orca', body: translateMain('tray.minimizeNotice.body', 'Orca is still running in the system tray') }).show()
      } catch {
        // Notification is best-effort; hiding the window is the required action.
      }
      store.updateUI({ trayMinimizeNoticeShown: true })
    }
    return true
  }
  const onClose = (event: Electron.Event): void => {
    if (!windowCloseConfirmed && hideToTrayIfEnabled()) {
      event.preventDefault()
      return
    }
    const closeAction = resolveWindowCloseAction({
      windowCloseConfirmed,
      rendererProcessGone: getRendererProcessGone(),
      isRendererCrashed: mainWindow.webContents.isCrashed?.() ?? false
    })
    if (closeAction !== 'request-confirmation') {
      if (closeAction === 'allow-confirmed') {
        windowCloseConfirmed = false
      }
      setWindowClosing(true)
      clearBoundsTimer()
      return
    }
    event.preventDefault()
    const isQuitting = opts?.getIsQuitting?.() ?? false
    const requestId = ++closeRequestSequence
    if (isQuitting) {
      armQuitRendererAckTimer(requestId)
    }
    mainWindow.webContents.send('window:close-requested', { isQuitting, requestId })
  }
  const onPreventUnload = (): void => {
    setWindowClosing(false)
    clearQuitRendererAckTimer()
    opts?.onQuitAborted?.()
    mainWindow.webContents.send('window:unload-prevented')
  }
  const onConfirmClose = (): void => {
    clearQuitRendererAckTimer()
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  }
  const trafficLightChannel = 'ui:sync-traffic-lights'
  const onSyncTrafficLights = (_event: Electron.IpcMainEvent, zoomFactor: number): void => syncTrafficLightPosition(mainWindow, zoomFactor)
  const minimizeChannel = 'window:minimize'
  const onMinimize = (): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.minimize()
    }
  }
  const maximizeChannel = 'window:maximize'
  const onMaximize = (): void => {
    if (mainWindow.isDestroyed()) {
      return
    }
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  }
  const requestCloseChannel = 'window:request-close'
  const onRequestClose = (): void => {
    if (mainWindow.isDestroyed()) {
      return
    }
    if (hideToTrayIfEnabled()) {
      return
    }
    mainWindow.webContents.send('window:close-requested', { isQuitting: false })
  }
  const popupMenuChannel = 'menu:popup'
  const onPopupMenu = (): void => Menu.getApplicationMenu()?.popup({ window: mainWindow })
  const isMaximizedChannel = 'window:isMaximized'
  const onIsMaximized = (): boolean => !mainWindow.isDestroyed() && mainWindow.isMaximized()

  ipcMain.on(trafficLightChannel, onSyncTrafficLights)
  ipcMain.on(minimizeChannel, onMinimize)
  ipcMain.on(maximizeChannel, onMaximize)
  ipcMain.on(requestCloseChannel, onRequestClose)
  ipcMain.on(popupMenuChannel, onPopupMenu)
  ipcMain.handle(isMaximizedChannel, onIsMaximized)
  ipcMain.on(confirmCloseChannel, onConfirmClose)
  ipcMain.on(closeRequestReceivedChannel, onCloseRequestReceived)
  mainWindow.on('close', onClose)
  mainWindow.webContents.on('will-prevent-unload', onPreventUnload)
  mainWindow.on('closed', () => {
    closeDashboardPopout()
    clearInitialRevealFallbackTimer()
    clearQuitRendererAckTimer()
    resetFocusState()
    clearRendererRecoveryTimer()
    removeShortcutListeners()
    ipcMain.removeListener(trafficLightChannel, onSyncTrafficLights)
    ipcMain.removeListener(minimizeChannel, onMinimize)
    ipcMain.removeListener(maximizeChannel, onMaximize)
    ipcMain.removeListener(requestCloseChannel, onRequestClose)
    ipcMain.removeListener(popupMenuChannel, onPopupMenu)
    ipcMain.removeHandler(isMaximizedChannel)
    ipcMain.removeListener(confirmCloseChannel, onConfirmClose)
    ipcMain.removeListener(closeRequestReceivedChannel, onCloseRequestReceived)
    clearTrustedUIRendererWebContentsId(rendererWebContentsId)
    // powerMonitor is app-global; remove the resume listener with the window.
    powerMonitor.removeListener('resume', onSystemResume)
    app.removeListener('before-quit', freezeBoundsOnQuit)
  })
}
