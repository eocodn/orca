// Notification permission, delivery, and sound IPC handlers.
import { Notification, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult
} from '../../shared/types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import {
  lastObservedDeliveryOutcome,
  openNotificationSystemSettings,
  permissionDialogTriggeredThisSession,
  probeNotificationDelivery,
  setLastObservedDeliveryOutcome
} from './notifications-ipc-foundation'

export function registerNotificationDeliveryHandlers(
  store: Store,
  _runtime?: OrcaRuntimeService
): void {
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
          setLastObservedDeliveryOutcome('delivered')
          return { state: 'delivered', authoritative: true }
        }
        if (authorization === 'denied') {
          setLastObservedDeliveryOutcome('failed')
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
