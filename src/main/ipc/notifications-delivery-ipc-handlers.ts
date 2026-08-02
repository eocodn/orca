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

export function registerNotificationDeliveryHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  ipcMain.removeHandler('notifications:openSystemSettings')

  ipcMain.removeHandler('notifications:getPermissionStatus')

  ipcMain.removeHandler('notifications:probeDelivery')

  ipcMain.handle('notifications:openSystemSettings', (): void => {
      openNotificationSystemSettings()
    })
  
    // Why: Electron's main process can't read macOS auth status; expose only what we can observe (platform support + whether we've prompted).

  const getPermissionStatus = (): NotificationPermissionStatusResult => ({
      supported: Notification.isSupported(),
      platform: process.platform,
      requested: store.getUI().notificationPermissionRequested === true
    })

  ipcMain.handle('notifications:getPermissionStatus', getPermissionStatus)

  ipcMain.handle(
      'notifications:probeDelivery',
      async (_event, args?: { force?: boolean }): Promise<NotificationDeliveryProbeResult> => {
        // Why: macOS-only — Windows/Linux have no first-use permission dialog, so the onboarding card never renders there.
        if (process.platform !== 'darwin' || !Notification.isSupported()) {
          return { state: 'unsupported', authoritative: false }
        }
        // Why: probes surface the macOS permission dialog, so mark startup registration done to avoid a second prompt later.
        if (store.getUI().notificationPermissionRequested !== true) {
          store.updateUI({ notificationPermissionRequested: true })
        }
        // Preferred source: the bundled helper reads real auth silently, so polling tracks System Settings changes without banners.
        const authorization = await readNotificationAuthorizationStatus()
        if (authorization === 'authorized') {
          lastObservedDeliveryOutcome = 'delivered'
          return { state: 'delivered', authoritative: true }
        }
        if (authorization === 'denied') {
          lastObservedDeliveryOutcome = 'failed'
          return { state: 'blocked', authoritative: true }
        }
        if (authorization === 'not-determined') {
          // Why: the dialog only appears once something asks; fire one probe per session to trigger it, then report pending.
          if (!permissionDialogTriggeredThisSession) {
            void probeNotificationDelivery()
          }
          return { state: 'awaiting-decision', authoritative: true }
        }
        // Helper unavailable or 'unknown': fall back to scheduling-based probes with session caching to avoid repeated banners.
        if (!args?.force && lastObservedDeliveryOutcome !== null) {
          return {
            state: lastObservedDeliveryOutcome === 'delivered' ? 'delivered' : 'blocked',
            authoritative: false
          }
        }
        return probeNotificationDelivery()
      }
    )
}
