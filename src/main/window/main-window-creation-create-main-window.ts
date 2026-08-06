import { app, BrowserWindow, ipcMain, Menu, nativeTheme, powerMonitor, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Store } from '../persistence'
import { getAppIconPath } from '../app-icon'
import { browserManager } from '../browser/browser-manager'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { ORCA_BROWSER_GUEST_WEB_PREFERENCES } from '../../shared/browser-guest-web-preferences'
import { isCrashReportReason } from '../../shared/crash-reporting'
import {
  DEFAULT_RENDERER_RECOVERY_MAX_RECOVERIES,
  DEFAULT_RENDERER_RECOVERY_WINDOW_MS,
  RendererRecoveryCircuitBreaker
} from '../crash-reporting/renderer-recovery-circuit-breaker'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { getMainE2EConfig } from '../e2e-config'
import { buildEditableContextMenuTemplate } from './editable-context-menu'
import { setTrustedUIRendererWebContentsId } from '../ipc/ui'
import { rectHasVisibleAreaOnAnyDisplay } from './window-bounds-validation'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { registerPluginPanelNavigationGuard } from '../plugins/plugin-panel-navigation-guard'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  TITLEBAR_CSS_CENTER,
  TRAFFIC_LIGHT_RADIUS,
  TRAFFIC_LIGHT_X,
  forceRepaint,
  installMacosVisibilityRepaint,
  syncTrafficLightPosition
} from './main-window-creation'
import { registerMainWindowShortcutLifecycle } from './main-window-creation-shortcuts'
import { registerMainWindowCloseLifecycle } from './main-window-creation-close-lifecycle'

export type CreateMainWindowOptions = {
  /** Returns true when a manual app.quit() (Cmd+Q) is in progress, so the renderer skips the running-process confirm dialog. */
  getIsQuitting?: () => boolean
  /** Notifies the caller when the renderer vetoes unload, so the quit latch clears — a prevented beforeunload cancels the in-flight app.quit(). */
  onQuitAborted?: () => void
  onRendererProcessGone?: (
    details: Electron.RenderProcessGoneDetails,
    webContentsId: number
  ) => void
  /** Returns true when Orca should reload after renderer loss; update-relaunch/quit tear down children intentionally, so don't fight shutdown. */
  shouldRecoverRenderer?: (
    details: Electron.RenderProcessGoneDetails,
    webContentsId: number
  ) => boolean
  /** Called when consecutive auto-recoveries hit the circuit-breaker limit so the host can prompt instead of crash-looping. */
  onRendererRecoveryExhausted?: (info: {
    details: Electron.RenderProcessGoneDetails
    webContentsId: number
    recentRecoveryCount: number
  }) => void
  /** Defer renderer load until IPC handlers are registered, or eager renderer calls race into missing channels. */
  deferLoad?: boolean
  title?: string
  getKeybindings?: () => KeybindingOverrides | undefined
  onBeforeReload?: (options: { ignoreCache: boolean; webContentsId: number }) => void
  /** Marks the in-place recovery reload so did-finish-load's PTY orphan sweep spares live sessions until restore re-attaches (#5787). */
  onBeforeRecoveryReload?: (webContentsId: number) => void
}

export function loadMainWindow(mainWindow: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function createMainWindow(
  store: Store | null,
  opts?: CreateMainWindowOptions
): BrowserWindow {
  const rawSavedBounds = store?.getUI().windowBounds
  // Why: reject min-size or substantially off-screen bounds so the titlebar stays reachable after display changes.
  const savedBounds =
    rawSavedBounds &&
    rawSavedBounds.width > MIN_WIDTH &&
    rawSavedBounds.height > MIN_HEIGHT &&
    rectHasVisibleAreaOnAnyDisplay(rawSavedBounds, MIN_WIDTH / 2, MIN_HEIGHT / 2)
      ? rawSavedBounds
      : undefined
  if (rawSavedBounds && !savedBounds) {
    console.warn(
      '[window] Discarding persisted windowBounds and falling back to defaultBounds:',
      rawSavedBounds
    )
  }
  const savedMaximized = store?.getUI().windowMaximized ?? false
  // Why: on first launch fill the primary display work area so the window feels spacious without maximize(); saved bounds win later.
  const defaultBounds = (() => {
    try {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize
      return { width, height }
    } catch {
      return { width: 1200, height: 800 }
    }
  })()

  const blur = settings?.windowBackgroundBlur ?? false
  // Why: only Windows acrylic is ever visible; macOS vibrancy+transparent sat behind our opaque background yet
  // forced per-frame WindowServer alpha compositing (#8482). Applies at creation only, so it needs a restart.
  const platformBlurOptions =
    blur && process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}

  const mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? defaultBounds.width,
    height: savedBounds?.height ?? defaultBounds.height,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: opts?.title ?? 'Orca',
    show: false,
    // Why: macOS swallows the app-activating click by default, so clicking back into Orca needed a second click (Windows/Linux already deliver it).
    acceptFirstMouse: true,
    // Why: auto-hide the Windows/Linux menu bar to save a row (Alt reveals it); macOS uses the system menu bar anyway.
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    // Why: macOS 'hiddenInset' keeps native traffic lights in our custom titlebar; Windows 'hidden' removes the OS title bar so it doesn't double up.
    titleBarStyle:
      process.platform === 'darwin'
        ? 'hiddenInset'
        : process.platform === 'win32'
          ? 'hidden'
          : undefined,
    // Why: Linux ignores titleBarStyle 'hidden'; frame:false drops the native frame so we don't get a double title bar (renderer draws its own).
    ...(process.platform === 'linux' ? { frame: false } : {}),
    // Why: initial position for 1x zoom; syncTrafficLightPosition() adjusts on zoom change.
    ...(process.platform === 'darwin'
      ? {
          trafficLightPosition: {
            x: TRAFFIC_LIGHT_X,
            y: TITLEBAR_CSS_CENTER - TRAFFIC_LIGHT_RADIUS
          }
        }
      : {}),
    icon: getAppIconPath(settings?.appIcon),
    ...platformBlurOptions,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: true
    }
  })
  const rendererWebContentsId = mainWindow.webContents.id
  // Why: native paste fallback is privileged IPC; only the top-level renderer may request it.
  setTrustedUIRendererWebContentsId(rendererWebContentsId)

  if (process.platform === 'darwin') {
    // Why: preserve hidden-window power savings; stable native sizing and frame-only invalidation
    // make wake recovery independent of the throttled viewport.
    mainWindow.webContents.setBackgroundThrottling(true)
    installMacosVisibilityRepaint(mainWindow)
  }

  // Why: a focus-preserving wake fires no focus/visibility events; relay resume so terminal wake recovery runs and force a repaint so stale compositor surfaces recover.
  const onSystemResume = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed?.() === true) {
      return
    }
    forceRepaint(mainWindow)
    mainWindow.webContents.send('system:resumed')
  }
  powerMonitor.on('resume', onSystemResume)

  mainWindow.webContents.on('dom-ready', () => {
    const level = store?.getUI().uiZoomLevel ?? 0
    mainWindow.webContents.setZoomLevel(level)
    // Why: native traffic lights don't scale with CSS zoom; reposition on startup to stay aligned with the zoomed titlebar.
    if (process.platform === 'darwin') {
      syncTrafficLightPosition(mainWindow, Math.pow(1.2, level))
    }
  })

  // Why: macOS+Electron 41 re-emits ready-to-show on webview-guest creation; a one-shot guard stops re-running maximize() after resize (#591).
  let handledInitialReadyToShow = false
  let initialRevealFallbackTimer: ReturnType<typeof setTimeout> | null =
    process.platform === 'win32' || process.platform === 'linux'
      ? setTimeout(() => {
          // Why: GPU/driver failures on Windows/Linux can prevent ready-to-show forever, hiding the only app window (#8421).
          initialRevealFallbackTimer = null
          revealInitialWindow()
        }, 10_000)
      : null
  initialRevealFallbackTimer?.unref?.()

  const clearInitialRevealFallbackTimer = (): void => {
    if (initialRevealFallbackTimer) {
      clearTimeout(initialRevealFallbackTimer)
      initialRevealFallbackTimer = null
    }
  }

  const revealInitialWindow = (): void => {
    if (mainWindow.isDestroyed()) {
      clearInitialRevealFallbackTimer()
      return
    }
    if (handledInitialReadyToShow) {
      return
    }
    handledInitialReadyToShow = true
    clearInitialRevealFallbackTimer()

    // Why: headless integration runs keep the window hidden so tests don't steal focus.
    const e2eConfig = getMainE2EConfig()
    if (e2eConfig.headless) {
      return
    }
    if (savedMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
  }
  mainWindow.on('ready-to-show', revealInitialWindow)

  // Why: persist window bounds to restore last position/size; debounce to avoid hammering persistence during resize drags.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  // Why: teardown still emits resize/move/unmaximize at near-min bounds; freeze persistence once closing so they can't clobber the saved size.
  let windowClosing = false
  const saveBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
    }
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (windowClosing || mainWindow.isDestroyed() || mainWindow.isFullScreen()) {
        return
      }
      // Why: persist windowMaximized and windowBounds atomically; the near-min guard must not leave them a mismatched pair.
      const isMaximized = mainWindow.isMaximized()
      if (isMaximized) {
        store?.updateUI({ windowMaximized: true })
        return
      }
      const bounds = mainWindow.getBounds()
      // Why: never persist shrink-to-min bounds (teardown race past the freeze, PR #1269); fall back to defaultBounds next launch.
      if (bounds.width <= MIN_WIDTH || bounds.height <= MIN_HEIGHT) {
        console.warn('[window] Skipping persist of near-minimum windowBounds:', bounds)
        store?.updateUI({ windowMaximized: false })
        return
      }
      store?.updateUI({ windowMaximized: false, windowBounds: bounds })
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  // Why: the auto-updater calls removeAllListeners('close') before quitting, so latch on app 'before-quit' too to freeze bounds during teardown.
  const freezeBoundsOnQuit = (): void => {
    windowClosing = true
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
  }
  app.on('before-quit', freezeBoundsOnQuit)

  mainWindow.on('maximize', () => {
    if (windowClosing) {
      return
    }
    store?.updateUI({ windowMaximized: true })
    mainWindow.webContents.send('window:maximize-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    if (windowClosing) {
      return
    }
    mainWindow.webContents.send('window:maximize-changed', false)
    const bounds = mainWindow.getBounds()
    // Why: mirror the saveBounds guard — unmaximize during teardown can land at min size; don't persist that as remembered size.
    if (bounds.width <= MIN_WIDTH || bounds.height <= MIN_HEIGHT) {
      console.warn('[window] Skipping unmaximize-time persist of near-min bounds:', bounds)
      store?.updateUI({ windowMaximized: false })
      return
    }
    store?.updateUI({ windowMaximized: false, windowBounds: bounds })
  })

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', true)
  })

  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window:fullscreen-changed', false)
  })

  installPrivilegedWindowNavigationPolicy(mainWindow.webContents)
  // Why: containment must be listening before any plugin panel frame is created,
  // so register it with the window's other navigation policy.
  registerPluginPanelNavigationGuard(mainWindow.webContents)

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = typeof params.src === 'string' ? params.src : ''
    const normalizedSrc = normalizeBrowserNavigationUrl(src)
    const partition = typeof webPreferences.partition === 'string' ? webPreferences.partition : ''

    // Why: fail closed — deny any src or partition not in the registry allowlist so a renderer bug can't smuggle preload/Node into an unprivileged guest.
    if (!normalizedSrc || !browserSessionRegistry.isAllowedPartition(partition)) {
      event.preventDefault()
      return
    }

    delete webPreferences.preload
    // Why: older Electron builds expose preloadURL alongside preload; delete both so the guest can't inherit the main preload bridge.
    delete (webPreferences as Record<string, unknown>).preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.enableBlinkFeatures = ''
    webPreferences.disableBlinkFeatures = ''
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Why: force the browser guest policy even if host markup omits or misspells a preference.
    Object.assign(webPreferences, ORCA_BROWSER_GUEST_WEB_PREFERENCES)
    // Why: keep the registry-validated partition so isolated session profiles use their own storage while other hardening stays intact.
    webPreferences.partition = partition
  })

  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    // Why: attach guest popup/nav policy at creation; waiting for renderer registration races target=_blank/early redirects past it.
    browserManager.attachGuestPolicies(guest)
  })

  // Why: mirror markdown-editor focus so before-input-event skips Cmd/Ctrl+B while TipTap owns focus (docs/markdown-cmd-b-bold-design.md).
  let markdownEditorFocused = false
  let terminalInputFocused = false
  // floatingTerminalInputFocused: textarea-only (terminal keybinding context). floatingPanelFocused: superset for routing ownership.
  let floatingTerminalInputFocused = false
  let floatingPanelFocused = false
  let shortcutRecorderFocused = false

  const markdownFocusChannel = 'ui:setMarkdownEditorFocused'
  // Why: strict-bool + sender check so a guest/webview or malformed IPC payload can't disable the Cmd+B sidebar carve-out.
  const onMarkdownEditorFocused = (event: Electron.IpcMainEvent, focused: unknown): void => {
    if (event.sender !== mainWindow.webContents) {
      return
    }
    markdownEditorFocused = focused === true
  }
  ipcMain.on(markdownFocusChannel, onMarkdownEditorFocused)
  const terminalInputFocusChannel = 'ui:setTerminalInputFocused'
  // Why: before-input-event resolves shortcuts before renderer keydown; mirror xterm focus so Terminal-first lets shells own app chords.
  const onTerminalInputFocused = (event: Electron.IpcMainEvent, focused: unknown): void => {
    if (event.sender !== mainWindow.webContents) {
      return
    }
    terminalInputFocused = focused === true
  }
  ipcMain.on(terminalInputFocusChannel, onTerminalInputFocused)
  const floatingFocusChannel = 'ui:setFloatingFocus'
  // Why: one atomic payload for both bits so before-input-event never reads a torn terminal=true/panel=false state.
  // terminalFocused drives the Ctrl+B/L terminal-context carve-out; panelFocused is the routing-ownership superset (panel ⊇ terminal).
  const onFloatingFocus = (event: Electron.IpcMainEvent, state: unknown): void => {
    if (event.sender !== mainWindow.webContents) {
      return
    }
    const payload = (state ?? {}) as { panelFocused?: unknown; terminalFocused?: unknown }
    const terminal = payload.terminalFocused === true
    floatingTerminalInputFocused = terminal
    // Re-assert the invariant defensively in case a sender ever emits panel=false with terminal=true.
    floatingPanelFocused = payload.panelFocused === true || terminal
  }
  ipcMain.on(floatingFocusChannel, onFloatingFocus)
  const shortcutRecorderFocusChannel = 'ui:setShortcutRecorderFocused'
  // Why: the Settings recorder must receive app shortcuts to rebind them; before-input-event would otherwise consume the key first.
  const onShortcutRecorderFocused = (event: Electron.IpcMainEvent, focused: unknown): void => {
    if (event.sender !== mainWindow.webContents) {
      return
    }
    shortcutRecorderFocused = focused === true
  }
  ipcMain.on(shortcutRecorderFocusChannel, onShortcutRecorderFocused)

  const onMainContextMenu = (_event: Electron.Event, params: Electron.ContextMenuParams): void => {
    const template = buildEditableContextMenuTemplate(params, mainWindow.webContents)
    if (template.length === 0) {
      return
    }
    // Why: the context-menu event can precede our focus-mirror update; trust Electron's editable params, not markdownEditorFocused.
    Menu.buildFromTemplate(template).popup({ window: mainWindow, x: params.x, y: params.y })
  }
  mainWindow.webContents.on('context-menu', onMainContextMenu)

  // Why: a dead renderer can't clear its focus mirror; default-deny carve-outs so it can't disable app shortcuts in a later lifecycle.
  const resetMarkdownEditorFocus = (): void => {
    markdownEditorFocused = false
  }
  const resetTerminalInputFocus = (): void => {
    terminalInputFocused = false
  }
  const resetFloatingTerminalInputFocus = (): void => {
    floatingTerminalInputFocused = false
    floatingPanelFocused = false
  }
  const resetShortcutRecorderFocus = (): void => {
    shortcutRecorderFocused = false
  }
  let rendererProcessGone = false
  let rendererRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  // Why: stop a deterministic per-load renderer fault from auto-reloading forever; breaker opens after too many recoveries in a rolling window.
  const rendererRecoveryCircuitBreaker = new RendererRecoveryCircuitBreaker({
    windowMs: DEFAULT_RENDERER_RECOVERY_WINDOW_MS,
    maxRecoveries: DEFAULT_RENDERER_RECOVERY_MAX_RECOVERIES
  })
  const clearRendererRecoveryTimer = (): void => {
    if (rendererRecoveryTimer) {
      clearTimeout(rendererRecoveryTimer)
      rendererRecoveryTimer = null
    }
  }
  const scheduleRendererRecovery = (details: Electron.RenderProcessGoneDetails): void => {
    if (
      rendererRecoveryTimer ||
      !details ||
      !isCrashReportReason(details.reason) ||
      windowClosing ||
      opts?.getIsQuitting?.() ||
      opts?.shouldRecoverRenderer?.(details, rendererWebContentsId) === false ||
      mainWindow.isDestroyed()
    ) {
      return
    }
    rendererRecoveryTimer = setTimeout(() => {
      rendererRecoveryTimer = null
      if (
        windowClosing ||
        opts?.getIsQuitting?.() ||
        opts?.shouldRecoverRenderer?.(details, rendererWebContentsId) === false ||
        mainWindow.isDestroyed()
      ) {
        return
      }
      const recovery = rendererRecoveryCircuitBreaker.registerRecoveryAttempt(Date.now())
      if (!recovery.allowed) {
        // Why: too many reloads means it will just crash again; stop and let the host surface a recovery prompt.
        opts?.onRendererRecoveryExhausted?.({
          details,
          webContentsId: rendererWebContentsId,
          recentRecoveryCount: recovery.recentRecoveryCount
        })
        return
      }
      // Why: a transient renderer/Network Service loss can blank Chromium; reload the app document once to recover.
      // Why: mark this in-place reload so the did-finish-load orphan sweep spares live PTYs until session restore (#5787).
      opts?.onBeforeRecoveryReload?.(mainWindow.webContents.id)
      loadMainWindow(mainWindow)
    }, 250)
  }
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererProcessGone = true
    resetMarkdownEditorFocus()
    resetTerminalInputFocus()
    resetFloatingTerminalInputFocus()
    resetShortcutRecorderFocus()
    // Why: macOS reports BrowserWindow teardown as renderer killed/SIGKILL after close — window noise, not a crash.
    if (!windowClosing) {
      // Why: the recorder owns crash classification; filtering here made expected-teardown evidence unreachable.
      opts?.onRendererProcessGone?.(details, rendererWebContentsId)
    }
    if (!windowClosing) {
      console.error('[window] Renderer process gone; close confirmation will be bypassed', details)
    }
    scheduleRendererRecovery(details)
  })
  mainWindow.webContents.on('destroyed', () => {
    resetMarkdownEditorFocus()
    resetTerminalInputFocus()
    resetFloatingTerminalInputFocus()
    resetShortcutRecorderFocus()
  })
  mainWindow.webContents.on('did-start-navigation', (_e, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      resetMarkdownEditorFocus()
      resetTerminalInputFocus()
      resetFloatingTerminalInputFocus()
      resetShortcutRecorderFocus()
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    rendererProcessGone = false
    clearRendererRecoveryTimer()
  })

  const removeMainWindowShortcutListeners = registerMainWindowShortcutLifecycle({
    mainWindow,
    store,
    getKeybindings: opts?.getKeybindings,
    getIsQuitting: opts?.getIsQuitting,
    onBeforeReload: opts?.onBeforeReload,
    getFocusState: () => ({
      markdownEditorFocused,
      terminalInputFocused,
      floatingTerminalInputFocused,
      floatingPanelFocused,
      shortcutRecorderFocused
    })
  })

  const removeShortcutListeners = (): void => {
    removeMainWindowShortcutListeners()
    ipcMain.removeListener(markdownFocusChannel, onMarkdownEditorFocused)
    ipcMain.removeListener(terminalInputFocusChannel, onTerminalInputFocused)
    ipcMain.removeListener(floatingFocusChannel, onFloatingFocus)
    ipcMain.removeListener(shortcutRecorderFocusChannel, onShortcutRecorderFocused)
  }

  registerMainWindowCloseLifecycle({
    mainWindow,
    store,
    opts,
    rendererWebContentsId,
    getRendererProcessGone: () => rendererProcessGone,
    setWindowClosing: (value) => {
      windowClosing = value
    },
    clearBoundsTimer: () => {
      if (boundsTimer) {
        clearTimeout(boundsTimer)
        boundsTimer = null
      }
    },
    freezeBoundsOnQuit,
    resetFocusState: () => {
      markdownEditorFocused = false
      terminalInputFocused = false
      floatingTerminalInputFocused = false
      floatingPanelFocused = false
      shortcutRecorderFocused = false
    },
    clearInitialRevealFallbackTimer,
    clearRendererRecoveryTimer,
    onSystemResume,
    removeShortcutListeners
  })

  if (!opts?.deferLoad) {
    loadMainWindow(mainWindow)
  }

  return mainWindow
}
