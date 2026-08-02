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

export const NOTIFICATION_COOLDOWN_MS = 5000
export const MAX_RECENT_NOTIFICATION_KEYS = 50
export const NOTIFICATION_DISPLAY_CONFIRMATION_TIMEOUT_MS = 2500
export const NOTIFICATION_RELEASE_FALLBACK_MS = 5 * 60 * 1000
export const MAX_NOTIFICATION_SOUND_BYTES = 10 * 1024 * 1024
export const MACOS_PACKAGED_BUNDLE_ID = 'com.stablyai.orca'
export const MACOS_NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
export type NotificationSoundId = NotificationSettings['customSoundId']

// Why: keep a strong reference so GC can't collect notifications (and their click handlers) before the user interacts with them.
export const activeNotifications = new Set<Notification>()
export const activeNotificationsById = new Map<
  string,
  { notification: Notification; release: () => void }
>()

export function retainNotificationUntilRelease(
  notification: Notification,
  onRelease?: () => void
): () => void {
  activeNotifications.add(notification)
  let released = false
  let releaseTimer: ReturnType<typeof setTimeout> | null = null

  function release(): void {
    if (released) {
      return
    }
    released = true
    activeNotifications.delete(notification)
    notification.removeListener('close', release)
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
    onRelease?.()
  }

  notification.on('close', release)
  releaseTimer = setTimeout(release, NOTIFICATION_RELEASE_FALLBACK_MS)
  if (typeof releaseTimer.unref === 'function') {
    releaseTimer.unref()
  }

  return release
}

export const NOTIFICATION_PROBE_RESULT_TIMEOUT_MS = 3000
export const NOTIFICATION_PROBE_BANNER_CLOSE_DELAY_MS = 4000

// Why: no API to read macOS auth, so track the last scheduled notification's outcome; session-scoped since permission can change between runs.
export let lastObservedDeliveryOutcome: 'delivered' | 'failed' | null = null
export let deliveryProbeInFlight: Promise<NotificationDeliveryProbeResult> | null = null
// Why: firing one probe instantiates Electron's presenter and pops the macOS permission dialog; once per session is enough.
export let permissionDialogTriggeredThisSession = false

/**
 * Fallback for hosts without the native helper: schedules a silent probe and reports whether macOS accepted it.
 * On a fresh install the probe also instantiates Electron's presenter, which pops the macOS permission dialog.
 *
 * Known ambiguity (verified macOS 26): while undecided, or when notifications are toggled off after being
 * authorized, macOS silently swallows accepted requests, so 'delivered' can over-report; only 'failed' is definitive.
 */
export function probeNotificationDelivery(): Promise<NotificationDeliveryProbeResult> {
  if (deliveryProbeInFlight) {
    return deliveryProbeInFlight
  }
  permissionDialogTriggeredThisSession = true

  const probe = new Notification({
    title: 'Orca notifications are on',
    body: 'Orca will alert you when agents finish or terminals need attention.',
    silent: true
  })
  activeNotifications.add(probe)

  deliveryProbeInFlight = new Promise<NotificationDeliveryProbeResult>((resolve) => {
    let settled = false
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    function releaseProbe(): void {
      activeNotifications.delete(probe)
      probe.removeListener('show', onShow)
      probe.removeListener('failed', onFailed)
      probe.close()
    }

    function settle(state: 'delivered' | 'blocked'): void {
      if (settled) {
        return
      }
      settled = true
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      lastObservedDeliveryOutcome = state === 'delivered' ? 'delivered' : 'failed'
      resolve({ state, authoritative: false })
    }

    function onShow(): void {
      settle('delivered')
      // Why: the probe banner doubles as the user-facing confirmation, so let it linger briefly instead of vanishing instantly.
      const closeTimer = setTimeout(releaseProbe, NOTIFICATION_PROBE_BANNER_CLOSE_DELAY_MS)
      if (typeof closeTimer.unref === 'function') {
        closeTimer.unref()
      }
    }

    function onFailed(_event: unknown, _error?: string): void {
      // Why: a rejected probe is expected (denied permission); don't log — it would spam the console on every poll.
      settle('blocked')
      releaseProbe()
    }

    probe.once('show', onShow)
    probe.once('failed', onFailed)
    // Why: don't record 'failed' on timeout — a missing callback is ambiguous, only the 'failed' event is definitive.
    timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve({ state: 'blocked', authoritative: false })
        releaseProbe()
      }
    }, NOTIFICATION_PROBE_RESULT_TIMEOUT_MS)
    if (typeof timeoutTimer.unref === 'function') {
      timeoutTimer.unref()
    }

    probe.show()
  }).finally(() => {
    deliveryProbeInFlight = null
  })

  return deliveryProbeInFlight
}

export function getMacNotificationSettingsUrl(): string {
  const bundleId = process.env.ORCA_DEV_MACOS_BUNDLE_ID ?? MACOS_PACKAGED_BUNDLE_ID
  return `${MACOS_NOTIFICATION_SETTINGS_URL}?id=${encodeURIComponent(bundleId)}`
}

export function openNotificationSystemSettings(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal(getMacNotificationSettingsUrl())
  } else if (process.platform === 'win32') {
    void shell.openExternal('ms-settings:notifications')
  }
}

export function getEffectiveNotificationSoundId(settings: NotificationSettings): NotificationSoundId {
  return settings.customSoundId ?? (settings.customSoundPath ? 'custom' : 'system')
}

export function getSelectedNotificationSoundPath(settings: NotificationSettings): {
  path: string | null
  reason?: 'missing-path' | 'invalid-path' | 'unsupported-type'
} {
  const customSoundId = getEffectiveNotificationSoundId(settings)
  if (customSoundId === 'system') {
    return { path: null, reason: 'missing-path' }
  }
  if (customSoundId !== 'custom') {
    const builtInPath = BUILT_IN_NOTIFICATION_SOUNDS.get(customSoundId)
    return builtInPath ? { path: builtInPath } : { path: null, reason: 'missing-path' }
  }
  if (!settings.customSoundPath) {
    return { path: null, reason: 'missing-path' }
  }
  const normalizedPath = normalize(settings.customSoundPath)
  if (!isAbsolute(normalizedPath)) {
    return { path: null, reason: 'invalid-path' }
  }
  if (!NOTIFICATION_SOUND_MIME_BY_EXTENSION.has(extname(normalizedPath).toLowerCase())) {
    return { path: null, reason: 'unsupported-type' }
  }
  return { path: normalizedPath }
}

export function waitForNotificationDisplay(notification: Notification): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function cleanup(): void {
      notification.removeListener('show', onShow)
      notification.removeListener('failed', onFailed)
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    function settle(displayed: boolean): void {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(displayed)
    }

    function onShow(): void {
      settle(true)
    }

    function onFailed(): void {
      settle(false)
    }

    notification.once('show', onShow)
    notification.once('failed', onFailed)
    timer = setTimeout(() => settle(false), NOTIFICATION_DISPLAY_CONFIRMATION_TIMEOUT_MS)
  })
}

export function logNativeNotificationFailure(context: string, error?: string): void {
  console.warn(
    `[notifications] ${context} notification failed to show${error ? `: ${error}` : '.'}`
  )
}

export function pruneRecentNotifications(recentNotifications: Map<string, number>, now: number): void {
  if (recentNotifications.size <= MAX_RECENT_NOTIFICATION_KEYS) {
    return
  }

  for (const [key, ts] of recentNotifications) {
    if (now - ts >= NOTIFICATION_COOLDOWN_MS) {
      recentNotifications.delete(key)
    }
  }

  while (recentNotifications.size > MAX_RECENT_NOTIFICATION_KEYS) {
    const oldest = recentNotifications.keys().next()
    if (oldest.done) {
      break
    }
    recentNotifications.delete(oldest.value)
  }
}

export function reserveNotificationCooldown(
  recentNotifications: Map<string, number>,
  dedupeKey: string,
  now: number
): boolean {
  const lastSentAt = recentNotifications.get(dedupeKey) ?? 0
  if (now - lastSentAt < NOTIFICATION_COOLDOWN_MS) {
    return false
  }
  recentNotifications.delete(dedupeKey)
  recentNotifications.set(dedupeKey, now)
  pruneRecentNotifications(recentNotifications, now)
  return true
}

