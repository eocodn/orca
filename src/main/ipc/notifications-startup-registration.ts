// Notification permission, delivery, and sound IPC handlers.
import { app, BrowserWindow, Notification, ipcMain, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, normalize } from 'node:path'
import type { Store } from '../persistence'
import type {
  NotificationDeliveryProbeResult,
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationDismissResult,
  NotificationPermissionStatusResult,
  NotificationSettings,
  NotificationSoundDataResult
} from '../../shared/types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from './notification-options'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { setTrayAttention } from '../tray/system-tray'
import { isMainWindowVisible } from '../window/main-window-visibility'
import {
  BUILT_IN_NOTIFICATION_SOUNDS,
  NOTIFICATION_SOUND_MIME_BY_EXTENSION
} from './notification-sound-assets'

import { NOTIFICATION_COOLDOWN_MS, MAX_RECENT_NOTIFICATION_KEYS, NOTIFICATION_DISPLAY_CONFIRMATION_TIMEOUT_MS, NOTIFICATION_RELEASE_FALLBACK_MS, MAX_NOTIFICATION_SOUND_BYTES, MACOS_PACKAGED_BUNDLE_ID, MACOS_NOTIFICATION_SETTINGS_URL, NotificationSoundId, activeNotifications, activeNotificationsById, retainNotificationUntilRelease, NOTIFICATION_PROBE_RESULT_TIMEOUT_MS, NOTIFICATION_PROBE_BANNER_CLOSE_DELAY_MS, lastObservedDeliveryOutcome, deliveryProbeInFlight, permissionDialogTriggeredThisSession, probeNotificationDelivery, getMacNotificationSettingsUrl, openNotificationSystemSettings, getEffectiveNotificationSoundId, getSelectedNotificationSoundPath, waitForNotificationDisplay, logNativeNotificationFailure, pruneRecentNotifications, reserveNotificationCooldown } from './notifications-ipc-foundation'

export function triggerStartupNotificationRegistration(store: Store): void {
  if (process.platform !== 'darwin' || !Notification.isSupported()) {
    return
  }
  // Why: fire once per install, not on every launch where status stays not-determined (e.g. user dismisses the dialog).
  const ui = store.getUI()
  if (ui.notificationPermissionRequested) {
    return
  }
  store.updateUI({ notificationPermissionRequested: true })

  const notification = new Notification({
    title: 'Orca is ready to notify you',
    body: 'Allow notifications so Orca can alert you when agents finish or terminals need attention.'
  })

  // Why: prevent GC from collecting the notification and its click handler while it's still visible.
  activeNotifications.add(notification)

  let handled = false
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  function clearStartupTimers(): void {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
  }

  function cleanup(): void {
    if (handled) {
      return
    }
    handled = true
    clearStartupTimers()
    activeNotifications.delete(notification)
    notification.removeListener('click', onClick)
    notification.removeListener('show', onShow)
    notification.removeListener('failed', onFailed)
    notification.close()
  }

  // Why: the body reads like an actionable "Allow notifications…" prompt, so clicking opens macOS Notification Settings.
  function onClick(): void {
    cleanup()
    openNotificationSystemSettings()
  }

  function onShow(): void {
    // Why: close after a delay so the banner doesn't linger; the macOS permission sheet is separate and unaffected.
    closeTimer = setTimeout(cleanup, 8000)
    if (typeof closeTimer.unref === 'function') {
      closeTimer.unref()
    }
  }

  function onFailed(_event: unknown, error?: string): void {
    // Why: Electron 42 requires code-signed macOS apps for UNNotification delivery; unsigned builds fail here.
    logNativeNotificationFailure('startup registration', error)
    lastObservedDeliveryOutcome = 'failed'
    cleanup()
  }

  notification.on('click', onClick)
  notification.on('show', onShow)
  notification.on('failed', onFailed)

  // Fallback in case macOS doesn't fire the 'show' event (e.g. user denies).
  fallbackTimer = setTimeout(cleanup, 10_000)
  if (typeof fallbackTimer.unref === 'function') {
    fallbackTimer.unref()
  }

  notification.show()
}
