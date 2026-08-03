import { app } from 'electron'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export let _diagLog: string | null = null

export function getDiagLogPath(): string {
  if (!_diagLog) {
    try {
      _diagLog = join(app.getPath('userData'), 'cookie-import-diag.log')
    } catch {
      _diagLog = join(tmpdir(), 'orca-cookie-import-diag.log')
    }
  }
  return _diagLog
}

export function reasonWithDiagLog(reason: string): string {
  return `${reason} Details were written to ${getDiagLogPath()}.`
}

export const COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS = 180
