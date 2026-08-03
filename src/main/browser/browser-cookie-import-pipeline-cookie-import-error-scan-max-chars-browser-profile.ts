import { appendFileSync } from 'node:fs'

// Why: write the diag log to userData, not world-readable /tmp, so only the current user can read it.
import { getDiagLogPath, COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS } from './browser-cookie-import-pipeline-diag-log-cookie-import-error-summary-max-chars'

export const COOKIE_IMPORT_ERROR_SCAN_MAX_CHARS = 512

// Why: error messages can embed large pasted/file payloads; cap the scan since diagnostics only need a short preview.

export function summarizeCookieImportError(err: unknown): string {
  const raw = err instanceof Error && err.message ? err.message : String(err)
  let summary = ''
  let previousWasWhitespace = false
  const scanLimit = Math.min(raw.length, COOKIE_IMPORT_ERROR_SCAN_MAX_CHARS)
  for (let index = 0; index < scanLimit; index += 1) {
    const code = raw.charCodeAt(index)
    if (code === 32 || (code >= 9 && code <= 13)) {
      if (summary.length > 0 && !previousWasWhitespace) {
        summary += ' '
      }
      previousWasWhitespace = true
      continue
    }
    summary += raw.charAt(index)
    if (summary.length >= COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS) {
      return summary.slice(0, COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS)
    }
    previousWasWhitespace = false
  }
  return summary
}

export function diag(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    appendFileSync(getDiagLogPath(), line)
  } catch {
    /* best-effort */
  }
  console.log('[cookie-import]', msg)
}

// ---------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------


export type BrowserProfile = {
  name: string
  directory: string
}
