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

export function registerNotificationSoundHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  ipcMain.removeHandler('notifications:resolveSoundPath')

  ipcMain.handle(
      'notifications:resolveSoundPath',
      ():
        | { ok: true; path: string }
        | { ok: false; reason: 'missing-path' | 'invalid-path' | 'unsupported-type' } => {
        const selectedSound = getSelectedNotificationSoundPath(store.getSettings().notifications)
        if (!selectedSound.path) {
          return { ok: false, reason: selectedSound.reason ?? 'missing-path' }
        }
        const normalizedPath = normalize(selectedSound.path)
        if (!NOTIFICATION_SOUND_MIME_BY_EXTENSION.has(extname(normalizedPath).toLowerCase())) {
          return { ok: false, reason: 'unsupported-type' }
        }
        return { ok: true, path: normalizedPath }
      }
    )

  ipcMain.removeHandler('notifications:loadSound')

  ipcMain.handle('notifications:loadSound', async (): Promise<NotificationSoundDataResult> => {
      const selectedSound = getSelectedNotificationSoundPath(store.getSettings().notifications)
      if (!selectedSound.path) {
        return { ok: false, reason: selectedSound.reason ?? 'missing-path' }
      }
  
      const normalizedPath = normalize(selectedSound.path)
  
      const mimeType = NOTIFICATION_SOUND_MIME_BY_EXTENSION.get(extname(normalizedPath).toLowerCase())
      if (!mimeType) {
        return { ok: false, reason: 'unsupported-type' }
      }
  
      try {
        const fileStat = await stat(normalizedPath)
        if (!fileStat.isFile()) {
          return { ok: false, reason: 'invalid-path' }
        }
        if (fileStat.size > MAX_NOTIFICATION_SOUND_BYTES) {
          return { ok: false, reason: 'too-large' }
        }
  
        const data = await readFile(normalizedPath)
        return { ok: true, data: new Uint8Array(data), mimeType, path: normalizedPath }
      } catch {
        return { ok: false, reason: 'read-failed' }
      }
    })
}
