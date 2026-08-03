// Notification permission, delivery, and sound IPC handlers.
import { app, BrowserWindow, Notification, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  NotificationDispatchRequest,
  NotificationDispatchResult,
  NotificationDismissResult
} from '../../shared/types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { buildNotificationOptions } from './notification-options'
import { readNotificationAuthorizationStatus } from './notification-authorization-status'
import { parsePaneKey } from '../../shared/stable-pane-id'
import { setTrayAttention } from '../tray/system-tray'
import { isMainWindowVisible } from '../window/main-window-visibility'
import {
  activeNotificationsById,
  getEffectiveNotificationSoundId,
  logNativeNotificationFailure,
  resetNotificationDeliveryState,
  reserveNotificationCooldown,
  retainNotificationUntilRelease,
  setLastObservedDeliveryOutcome,
  waitForNotificationDisplay
} from './notifications-ipc-foundation'

export function registerNotificationDispatchHandlers(store: Store, runtime?: OrcaRuntimeService): void {
  const recentDesktopNotifications = new Map<string, number>()

  const recentMobileNotifications = new Map<string, number>()
  // Why: handler registration marks a fresh session; permission evidence from a previous one must not leak in.
  resetNotificationDeliveryState()

  ipcMain.removeHandler('notifications:dismiss')

  ipcMain.handle('notifications:dismiss', (_event, ids: string[]): NotificationDismissResult => {
      const uniqueIds = Array.from(
        new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))
      )
      let dismissed = 0
      for (const id of uniqueIds) {
        const entry = activeNotificationsById.get(id)
        if (entry) {
          entry.notification.close()
          entry.release()
          dismissed += 1
        }
        runtime?.dismissMobileNotification(id)
      }
      return { dismissed }
    })

  ipcMain.removeHandler('notifications:dispatch')

  ipcMain.handle(
      'notifications:dispatch',
      (
        _event,
        args: NotificationDispatchRequest
      ): NotificationDispatchResult | Promise<NotificationDispatchResult> => {
        // Why: light the tray attention dot before the cooldown/focus/enabled gates so they can't hold it back (clears on window show/restore; see index.ts).
        if (args.source === 'agent-task-complete' || args.source === 'terminal-bell') {
          const activeWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
          if (!isMainWindowVisible(activeWindow)) {
            setTrayAttention(true)
          }
        }
  
        const settings = store.getSettings().notifications
        if (!settings.enabled) {
          return { delivered: false, reason: 'disabled' }
        }
  
        if (
          (args.source === 'agent-task-complete' && !settings.agentTaskComplete) ||
          (args.source === 'terminal-bell' && !settings.terminalBell)
        ) {
          return { delivered: false, reason: 'source-disabled' }
        }
  
        const notificationOptions = buildNotificationOptions(args)
  
        // Why: desktop focus only means this computer sees the worktree; the paired phone may still need the alert.
        if (runtime && args.source !== 'test') {
          const dedupeKey = args.worktreeId ?? args.worktreeLabel ?? 'global'
          if (reserveNotificationCooldown(recentMobileNotifications, dedupeKey, Date.now())) {
            runtime.dispatchMobileNotification({
              type: 'notification',
              source: args.source,
              title: notificationOptions.title,
              body: notificationOptions.body,
              worktreeId: args.worktreeId,
              ...(args.notificationId ? { notificationId: args.notificationId } : {})
            })
          }
        }
  
        const browserWindow =
          BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
        if (
          settings.suppressWhenFocused &&
          args.isActiveWorktree &&
          browserWindow &&
          browserWindow.isFocused()
        ) {
          return { delivered: false, reason: 'suppressed-focus' }
        }
  
        // Why: the Settings test button is an explicit, often-repeated user action, so it bypasses burst dedupe.
        if (args.source !== 'test') {
          // Dedupe by worktree, not source — agent-finish and terminal-bell often fire in one chunk; surface only the first.
          const dedupeKey = args.worktreeId ?? args.worktreeLabel ?? 'global'
          if (!reserveNotificationCooldown(recentDesktopNotifications, dedupeKey, Date.now())) {
            return { delivered: false, reason: 'cooldown' }
          }
        }
  
        if (!Notification.isSupported()) {
          return { delivered: false, reason: 'not-supported' }
        }
  
        function deliverNativeNotification():
          | NotificationDispatchResult
          | Promise<NotificationDispatchResult> {
          if (getEffectiveNotificationSoundId(settings) !== 'system') {
            notificationOptions.silent = true
          } else if (process.platform === 'darwin') {
            // Why: macOS treats an unset sound as silent, so request Electron's default when using the OS sound.
            notificationOptions.sound = 'default'
          }
          const notification = new Notification(notificationOptions)
          if (args.notificationId) {
            const previous = activeNotificationsById.get(args.notificationId)
            if (previous) {
              previous.notification.close()
              previous.release()
            }
          }
  
          // Why: prevent GC from collecting the notification and its click handler while it's still visible.
          let clickHandler: (() => void) | null = null
          let failedHandler: ((_event: unknown, error?: string) => void) | null = null
          const entryForId: { notification: Notification; release: () => void } | null =
            args.notificationId ? { notification, release: () => {} } : null
          const release = retainNotificationUntilRelease(notification, () => {
            if (clickHandler) {
              notification.removeListener('click', clickHandler)
              clickHandler = null
            }
            if (failedHandler) {
              notification.removeListener('failed', failedHandler)
              failedHandler = null
            }
            if (
              args.notificationId &&
              activeNotificationsById.get(args.notificationId) === entryForId
            ) {
              activeNotificationsById.delete(args.notificationId)
            }
          })
          if (entryForId && args.notificationId) {
            entryForId.release = release
            activeNotificationsById.set(args.notificationId, entryForId)
          }
  
          failedHandler = (_event, error) => {
            // Why: Electron 42's macOS backend reports unsigned/delivery failures here; release now, not after the fallback timer.
            logNativeNotificationFailure(args.source, error)
            // Why: feeds the permission card's evidence.
            setLastObservedDeliveryOutcome('failed')
            release()
          }
          notification.on('failed', failedHandler)
  
          // Why: worktreeId is formatted "repoId::worktreePath"; without the separator we can't extract a repoId, so skip the click-to-navigate binding.
          if (args.worktreeId && args.worktreeId.includes('::')) {
            const repoId = getRepoIdFromWorktreeId(args.worktreeId)
            clickHandler = () => {
              release()
              const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
              if (!win) {
                return
              }
              if (process.platform === 'darwin') {
                app.focus({ steal: true })
              }
              if (win.isMinimized()) {
                win.restore()
              }
              win.focus()
              win.webContents.send('ui:activateWorktree', {
                repoId,
                worktreeId: args.worktreeId
              })
              // Why: focusTerminal targets the pane by stable leafId so split-pane notifications land on the exact pane.
              const paneTarget = args.paneKey ? parsePaneKey(args.paneKey) : null
              if (paneTarget) {
                win.webContents.send('ui:focusTerminal', {
                  tabId: paneTarget.tabId,
                  worktreeId: args.worktreeId,
                  leafId: paneTarget.leafId,
                  ackPaneKeyOnSuccess: args.paneKey,
                  flashFocusedPane: true,
                  scrollToBottomIfOutputSinceLastView: true
                })
              }
            }
            notification.on('click', clickHandler)
          }
  
          const displayConfirmation = args.requireDisplayConfirmation
            ? waitForNotificationDisplay(notification)
            : null
          notification.show()
  
          if (displayConfirmation) {
            return displayConfirmation.then((displayed) => {
              if (!displayed) {
                release()
                return { delivered: false, reason: 'not-displayed' }
              }
              setLastObservedDeliveryOutcome('delivered')
              return { delivered: true }
            })
          }
  
          return { delivered: true }
        }
  
        if (process.platform !== 'darwin') {
          return deliverNativeNotification()
        }
        // Why: macOS silently swallows notifications while permission is denied/undecided (verified macOS 26); skip so the renderer can show a fallback.
        return readNotificationAuthorizationStatus().then((authorization) => {
          if (authorization === 'denied' || authorization === 'not-determined') {
            setLastObservedDeliveryOutcome('failed')
            return { delivered: false, reason: 'blocked-by-system' }
          }
          return deliverNativeNotification()
        })
      }
    )
  
    // Why: return the path so the preload's path-keyed cache skips the 10MB IPC round-trip on repeat dispatches.
}
