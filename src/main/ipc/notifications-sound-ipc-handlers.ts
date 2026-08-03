// Notification permission, delivery, and sound IPC handlers.
import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname, normalize } from 'node:path'
import type { Store } from '../persistence'
import type { NotificationSoundDataResult } from '../../shared/types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  getSelectedNotificationSoundPath,
  MAX_NOTIFICATION_SOUND_BYTES
} from './notifications-ipc-foundation'
import { NOTIFICATION_SOUND_MIME_BY_EXTENSION } from './notification-sound-assets'

export function registerNotificationSoundHandlers(
  store: Store,
  _runtime?: OrcaRuntimeService
): void {
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
