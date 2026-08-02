import { app, type BrowserWindow, dialog, session } from 'electron'
import { execFileSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: write the diag log to userData, not world-readable /tmp, so only the current user can read it.
import { _diagLog, getDiagLogPath, reasonWithDiagLog, COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS } from './browser-cookie-import-pipeline-diag-log-cookie-import-error-summary-max-chars'
import { type DetectedBrowser, type ChromiumBrowserDef, CHROMIUM_BROWSERS, browserRootPath } from './browser-cookie-import-pipeline-detected-browser-browser-root-path'
import { isSafeBrowserProfileDirectory, discoverProfiles, firefoxProfilesRoot, discoverFirefoxProfiles } from './browser-cookie-import-pipeline-is-safe-browser-profile-directory-discover-firefox-profiles'
import { detectFirefox, MAC_EPOCH_DELTA, detectSafari, detectInstalledBrowsers } from './browser-cookie-import-pipeline-detect-firefox-detect-installed-browsers'
import { type RawCookieEntry, type ValidatedCookie, selectBrowserProfile, chromiumSameSite } from './browser-cookie-import-pipeline-select-browser-profile-chromium-same-site'
import { firefoxSameSite, normalizeSameSite, deriveUrl, validateCookieEntry } from './browser-cookie-import-pipeline-firefox-same-site-validate-cookie-entry'
import { importValidatedCookies, pickCookieFile, importCookiesFromFile, getUserAgentForBrowser } from './browser-cookie-import-pipeline-import-validated-cookies-get-user-agent-for-browser'
import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_SALT, CHROMIUM_EPOCH_OFFSET } from './browser-cookie-import-pipeline-pbkdf2-iterations-chromium-epoch-offset'
import { type EncryptionKeyResult, type ChromiumCookieColumnInfo, chromiumTimestampToUnix, parseSqliteDefaultValue } from './browser-cookie-import-pipeline-chromium-timestamp-to-unix-parse-sqlite-default-value'
import { normalizeSqliteCookieValue, isSqliteNotNull, fallbackChromiumCookieColumnValue, buildChromiumCookieInsertParams } from './browser-cookie-import-pipeline-normalize-sqlite-cookie-value-build-chromium-cookie-insert-params'
import { getEncryptionKey, getMacEncryptionKey, getLinuxEncryptionKey, getWindowsEncryptionKey } from './browser-cookie-import-pipeline-get-encryption-key-get-windows-encryption-key'
import { CHROMIUM_COOKIE_HMAC_LEN, hasHmacPrefix, stripHmac, decryptCookieValueRaw } from './browser-cookie-import-pipeline-chromium-cookie-hmac-len-decrypt-cookie-value-raw'
import { decryptAes256Gcm, decodeSafariBinaryCookies, appendSafariCookies, decodeSafariPage } from './browser-cookie-import-pipeline-decrypt-aes256-gcm-decode-safari-page'
import { decodeSafariCookie, readCString, importCookiesFromFirefox, importCookiesFromSafari } from './browser-cookie-import-pipeline-decode-safari-cookie-import-cookies-from-safari'
import { importCookiesFromBrowser } from './browser-cookie-import-pipeline-import-cookies-from-browser-import-cookies-from-browser'

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
import type {
  BrowserCookieImportResult,
  BrowserCookieImportSummary,
  BrowserSessionProfileSource
} from '../../shared/types'
import { browserSessionRegistry } from './browser-session-registry'
import { setupClientHintsOverride } from './browser-session-ua'
import {
  createChromiumCookieSnapshot,
  type ChromiumCookieSnapshot
} from './chromium-cookie-snapshot'
import { resolveChromiumCookiesPath } from './chromium-cookie-path'
import { copyFileWithWindowsRetry } from '../codex-accounts/fs-utils'

// ---------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------


export type BrowserProfile = {
  name: string
  directory: string
}
