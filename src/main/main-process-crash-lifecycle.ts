import * as startupDeps from './main-process-startup-dependencies'
import { startupState, getExpectedTeardownScope } from './main-process-startup-state'

export async function presentRendererRecoveryPrompt(recentRecoveryCount: number): Promise<void> {
  if (startupState.isQuitting) {
    return
  }
  const window = startupState.mainWindow && !startupState.mainWindow.isDestroyed() ? startupState.mainWindow : undefined
  const options = {
    type: 'error' as const,
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'Orca keeps failing to load',
    message: 'The app window crashed repeatedly and stopped reloading automatically.',
    detail: `Orca tried to recover ${recentRecoveryCount} times in a row without success. This is often a graphics-driver or installation problem. Reload to try again, or quit and relaunch Orca.`
  }
  const { response } = window
    ? await startupDeps.dialog.showMessageBox(window, options)
    : await startupDeps.dialog.showMessageBox(options)
  if (response === 0 && startupState.mainWindow && !startupState.mainWindow.isDestroyed()) {
    startupDeps.recordDurableCrashBreadcrumb('renderer_recovery_manual_retry')
    startupDeps.loadMainWindow(startupState.mainWindow)
  } else if (response === 1) {
    startupState.isQuitting = true
    startupDeps.app.quit()
  }
}

export function getGpuFallbackEnvironment(): startupDeps.GpuFallbackEnvironment {
  return {
    appVersion: startupDeps.app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    platform: process.platform
  }
}

function getWindowsGpuFallbackEnvironment(): startupDeps.WindowsGpuFallbackEnvironment | null {
  const environment = getGpuFallbackEnvironment()
  if (environment.platform !== 'win32') {
    return null
  }
  return { ...environment, platform: 'win32' }
}

// Why: read the GPU-fallback marker before app.whenReady() so app.disableHardwareAcceleration() takes effect. Windows desktop only.
export function maybeApplyGpuFallbackForThisLaunch(): void {
  if (startupState.isServeMode || process.platform !== 'win32') {
    return
  }
  const marker = startupDeps.readActiveGpuFallbackMarker(startupDeps.app.getPath('userData'), getGpuFallbackEnvironment())
  if (!marker) {
    return
  }
  startupDeps.app.disableHardwareAcceleration()
  const appliedSwitches = startupDeps.applyGpuFallbackCommandLineSwitches(startupDeps.app.commandLine, process.platform)
  startupState.gpuFallbackActiveThisLaunch = true
  // Why: with no GPU child left, child-process-gone can't report a GPU fault, so
  // name the applied switches in the trail any later crash report carries.
  startupDeps.recordCrashBreadcrumb('gpu_fallback_applied', {
    crashesInWindow: marker.crashesInWindow,
    switches: appliedSwitches.join(',')
  })
}

// Why: a burst of GPU child crashes means HW acceleration is unusable — persist a build-scoped marker and offer software rendering.
export async function handleGpuChildCrash(reason: string, exitCode: number | null): Promise<void> {
  // Software rendering already active or shutting down: nothing more to do.
  if (startupState.gpuFallbackActiveThisLaunch || startupState.isQuitting || startupState.isServeMode) {
    return
  }
  const result = startupState.gpuCrashFallbackTracker.recordGpuCrash(performance.now())
  if (!result.shouldEngageFallback) {
    return
  }
  startupDeps.recordCrashBreadcrumb('gpu_fallback_engaged', {
    reason,
    exitCode,
    crashesInWindow: result.crashesInWindow
  })
  const engagedAt = Date.now()
  const window = startupState.mainWindow && !startupState.mainWindow.isDestroyed() ? startupState.mainWindow : undefined
  let restartDecision: startupDeps.GpuFallbackRestartDecision
  try {
    restartDecision = await startupDeps.promptForGpuFallbackRestart(window)
  } catch (error) {
    console.warn('[gpu-fallback] failed to show restart prompt:', error)
    return
  }
  const fallbackData = {
    processReason: reason,
    exitCode,
    crashesInWindow: result.crashesInWindow
  }
  if (startupState.isQuitting) {
    return
  }
  if (restartDecision !== 'restart') {
    startupDeps.recordDurableCrashBreadcrumb('gpu_fallback_restart_deferred', fallbackData)
    return
  }
  const environment = getWindowsGpuFallbackEnvironment()
  if (!environment) {
    return
  }
  try {
    startupDeps.writeGpuFallbackMarker(
      startupDeps.app.getPath('userData'),
      {
        engagedAt,
        crashesInWindow: result.crashesInWindow
      },
      environment
    )
  } catch (error) {
    console.warn('[gpu-fallback] failed to persist marker:', error)
    return
  }
  startupState.isQuitting = true
  startupDeps.relaunchApp('gpu-fallback', fallbackData)
  // Why: app.exit(0) skips before-quit, so destroy the Windows tray manually to avoid a stale icon.
  startupDeps.destroySystemTray()
  startupDeps.app.exit(0)
}

export function recordProcessGoneCrash(
  source: 'renderer' | 'child',
  processType: string,
  reason: string,
  exitCode: number | null,
  details: Record<string, unknown>,
  webContentsId?: number
): void {
  startupDeps.recordProcessGoneCrashEvent(startupState.crashReports, {
    source,
    processType,
    reason,
    exitCode,
    expectedTeardown: getExpectedTeardownScope(webContentsId),
    details
  })
}

export function shutdownWatchersOnce(): Promise<void> {
  if (startupState.watcherShutdownDone) {
    return Promise.resolve()
  }
  if (!startupState.watcherShutdownPromise) {
    // Why: @parcel/watcher tears down native async work on unsubscribe; Electron must await it before Node's environment exits.
    startupState.watcherShutdownPromise = Promise.allSettled([
      startupDeps.closeAllWatchers(),
      startupDeps.disposeWorktreeBaseDirectoryWatchers()
    ])
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error('[filesystem-watcher] shutdown failed:', result.reason)
          }
        }
      })
      .then(() => {
        startupState.watcherShutdownDone = true
      })
  }
  return startupState.watcherShutdownPromise
}
