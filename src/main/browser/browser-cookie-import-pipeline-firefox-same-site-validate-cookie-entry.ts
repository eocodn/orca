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
import { type BrowserProfile, COOKIE_IMPORT_ERROR_SCAN_MAX_CHARS, summarizeCookieImportError, diag } from './browser-cookie-import-pipeline-cookie-import-error-scan-max-chars-browser-profile'
import { type DetectedBrowser, type ChromiumBrowserDef, CHROMIUM_BROWSERS, browserRootPath } from './browser-cookie-import-pipeline-detected-browser-browser-root-path'
import { isSafeBrowserProfileDirectory, discoverProfiles, firefoxProfilesRoot, discoverFirefoxProfiles } from './browser-cookie-import-pipeline-is-safe-browser-profile-directory-discover-firefox-profiles'
import { detectFirefox, MAC_EPOCH_DELTA, detectSafari, detectInstalledBrowsers } from './browser-cookie-import-pipeline-detect-firefox-detect-installed-browsers'
import { type RawCookieEntry, type ValidatedCookie, selectBrowserProfile, chromiumSameSite } from './browser-cookie-import-pipeline-select-browser-profile-chromium-same-site'
import { importValidatedCookies, pickCookieFile, importCookiesFromFile, getUserAgentForBrowser } from './browser-cookie-import-pipeline-import-validated-cookies-get-user-agent-for-browser'
import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_SALT, CHROMIUM_EPOCH_OFFSET } from './browser-cookie-import-pipeline-pbkdf2-iterations-chromium-epoch-offset'
import { type EncryptionKeyResult, type ChromiumCookieColumnInfo, chromiumTimestampToUnix, parseSqliteDefaultValue } from './browser-cookie-import-pipeline-chromium-timestamp-to-unix-parse-sqlite-default-value'
import { normalizeSqliteCookieValue, isSqliteNotNull, fallbackChromiumCookieColumnValue, buildChromiumCookieInsertParams } from './browser-cookie-import-pipeline-normalize-sqlite-cookie-value-build-chromium-cookie-insert-params'
import { getEncryptionKey, getMacEncryptionKey, getLinuxEncryptionKey, getWindowsEncryptionKey } from './browser-cookie-import-pipeline-get-encryption-key-get-windows-encryption-key'
import { CHROMIUM_COOKIE_HMAC_LEN, hasHmacPrefix, stripHmac, decryptCookieValueRaw } from './browser-cookie-import-pipeline-chromium-cookie-hmac-len-decrypt-cookie-value-raw'
import { decryptAes256Gcm, decodeSafariBinaryCookies, appendSafariCookies, decodeSafariPage } from './browser-cookie-import-pipeline-decrypt-aes256-gcm-decode-safari-page'
import { decodeSafariCookie, readCString, importCookiesFromFirefox, importCookiesFromSafari } from './browser-cookie-import-pipeline-decode-safari-cookie-import-cookies-from-safari'
import { importCookiesFromBrowser } from './browser-cookie-import-pipeline-import-cookies-from-browser-import-cookies-from-browser'

export function firefoxSameSite(raw: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (raw) {
    case 0:
      return 'no_restriction'
    case 1:
      return 'lax'
    case 2:
      return 'strict'
    default:
      return 'unspecified'
  }
}


export function normalizeSameSite(raw: unknown): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  if (typeof raw === 'number') {
    return chromiumSameSite(raw)
  }
  if (typeof raw !== 'string') {
    return 'unspecified'
  }
  const lower = raw.toLowerCase()
  if (lower === 'lax') {
    return 'lax'
  }
  if (lower === 'strict') {
    return 'strict'
  }
  if (lower === 'none' || lower === 'no_restriction') {
    return 'no_restriction'
  }
  return 'unspecified'
}

// Why: cookies.set() needs a url to scope the cookie; derive it from domain + secure flag.

export function deriveUrl(domain: string, secure: boolean): string | null {
  const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain
  if (!cleanDomain || cleanDomain.includes(' ')) {
    return null
  }
  const protocol = secure ? 'https' : 'http'
  try {
    const url = new URL(`${protocol}://${cleanDomain}/`)
    return url.toString()
  } catch {
    return null
  }
}


export function validateCookieEntry(raw: RawCookieEntry): ValidatedCookie | null {
  if (typeof raw.domain !== 'string' || raw.domain.trim().length === 0) {
    return null
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return null
  }
  if (typeof raw.value !== 'string') {
    return null
  }

  const domain = raw.domain.trim()
  const secure = raw.secure === true || raw.secure === 1
  const url = deriveUrl(domain, secure)
  if (!url) {
    return null
  }

  const expirationDate =
    typeof raw.expirationDate === 'number' && raw.expirationDate > 0
      ? raw.expirationDate
      : undefined

  return {
    url,
    name: raw.name.trim(),
    value: raw.value,
    domain,
    path: typeof raw.path === 'string' ? raw.path : '/',
    secure,
    httpOnly: raw.httpOnly === true || raw.httpOnly === 1,
    sameSite: normalizeSameSite(raw.sameSite),
    expirationDate
  }
}
