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
import {
  _diagLog,
  getDiagLogPath,
  reasonWithDiagLog,
  COOKIE_IMPORT_ERROR_SUMMARY_MAX_CHARS
} from './browser-cookie-import-pipeline-diag-log-cookie-import-error-summary-max-chars'
import {
  type BrowserProfile,
  COOKIE_IMPORT_ERROR_SCAN_MAX_CHARS,
  summarizeCookieImportError,
  diag
} from './browser-cookie-import-pipeline-cookie-import-error-scan-max-chars-browser-profile'
import { resolveChromiumCookiesPath } from './chromium-cookie-path'
import {
  type DetectedBrowser,
  type ChromiumBrowserDef,
  CHROMIUM_BROWSERS,
  browserRootPath
} from './browser-cookie-import-pipeline-detected-browser-browser-root-path'
import {
  isSafeBrowserProfileDirectory,
  discoverProfiles,
  firefoxProfilesRoot,
  discoverFirefoxProfiles
} from './browser-cookie-import-pipeline-is-safe-browser-profile-directory-discover-firefox-profiles'
import {
  detectFirefox,
  MAC_EPOCH_DELTA,
  detectSafari,
  detectInstalledBrowsers
} from './browser-cookie-import-pipeline-detect-firefox-detect-installed-browsers'
import {
  firefoxSameSite,
  normalizeSameSite,
  deriveUrl,
  validateCookieEntry
} from './browser-cookie-import-pipeline-firefox-same-site-validate-cookie-entry'
import {
  importValidatedCookies,
  pickCookieFile,
  importCookiesFromFile,
  getUserAgentForBrowser
} from './browser-cookie-import-pipeline-import-validated-cookies-get-user-agent-for-browser'
import {
  PBKDF2_ITERATIONS,
  PBKDF2_KEY_LENGTH,
  PBKDF2_SALT,
  CHROMIUM_EPOCH_OFFSET
} from './browser-cookie-import-pipeline-pbkdf2-iterations-chromium-epoch-offset'
import {
  type EncryptionKeyResult,
  type ChromiumCookieColumnInfo,
  chromiumTimestampToUnix,
  parseSqliteDefaultValue
} from './browser-cookie-import-pipeline-chromium-timestamp-to-unix-parse-sqlite-default-value'
import {
  normalizeSqliteCookieValue,
  isSqliteNotNull,
  fallbackChromiumCookieColumnValue,
  buildChromiumCookieInsertParams
} from './browser-cookie-import-pipeline-normalize-sqlite-cookie-value-build-chromium-cookie-insert-params'
import {
  getEncryptionKey,
  getMacEncryptionKey,
  getLinuxEncryptionKey,
  getWindowsEncryptionKey
} from './browser-cookie-import-pipeline-get-encryption-key-get-windows-encryption-key'
import {
  CHROMIUM_COOKIE_HMAC_LEN,
  hasHmacPrefix,
  stripHmac,
  decryptCookieValueRaw
} from './browser-cookie-import-pipeline-chromium-cookie-hmac-len-decrypt-cookie-value-raw'
import {
  decryptAes256Gcm,
  decodeSafariBinaryCookies,
  appendSafariCookies,
  decodeSafariPage
} from './browser-cookie-import-pipeline-decrypt-aes256-gcm-decode-safari-page'
import {
  decodeSafariCookie,
  readCString,
  importCookiesFromFirefox,
  importCookiesFromSafari
} from './browser-cookie-import-pipeline-decode-safari-cookie-import-cookies-from-safari'
import { importCookiesFromBrowser } from './browser-cookie-import-pipeline-import-cookies-from-browser-import-cookies-from-browser'

export function selectBrowserProfile(
  browser: DetectedBrowser,
  profileDirectory: string
): DetectedBrowser | null {
  if (!isSafeBrowserProfileDirectory(profileDirectory)) {
    return null
  }
  if (browser.family === 'firefox') {
    const profilesRoot = firefoxProfilesRoot()
    if (!profilesRoot) {
      return null
    }
    const cookiesPath = join(profilesRoot, profileDirectory, 'cookies.sqlite')
    if (!existsSync(cookiesPath)) {
      return null
    }
    return { ...browser, cookiesPath, selectedProfile: profileDirectory }
  }

  const browserDef = CHROMIUM_BROWSERS.find((b) => b.family === browser.family)
  if (!browserDef) {
    return null
  }
  const root = browserRootPath(browserDef)
  if (!root) {
    return null
  }
  const profileDir = join(root, profileDirectory)
  const cookiesPath = resolveChromiumCookiesPath(profileDir)
  if (!cookiesPath) {
    return null
  }
  return {
    ...browser,
    cookiesPath,
    selectedProfile: profileDirectory
  }
}

// ---------------------------------------------------------------------------
// Cookie validation (shared between file import and direct import)
// ---------------------------------------------------------------------------

export type RawCookieEntry = {
  domain?: unknown
  name?: unknown
  value?: unknown
  path?: unknown
  secure?: unknown
  httpOnly?: unknown
  sameSite?: unknown
  expirationDate?: unknown
}

export type ValidatedCookie = {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate: number | undefined
}

// Why: Chromium's CookieSameSiteForStorage enum (0=Unspecified,1=None,2=Lax,3=Strict) differs from Firefox's numbering.

export function chromiumSameSite(raw: number): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (raw) {
    case 1:
      return 'no_restriction'
    case 2:
      return 'lax'
    case 3:
      return 'strict'
    default:
      return 'unspecified'
  }
}
