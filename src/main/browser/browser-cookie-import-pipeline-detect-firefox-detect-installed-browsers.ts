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

export function detectFirefox(): DetectedBrowser | null {
  const profilesRoot = firefoxProfilesRoot()
  if (!profilesRoot) {
    return null
  }
  const profiles = discoverFirefoxProfiles()
  for (const profile of profiles) {
    const cookiesPath = join(profilesRoot, profile.directory, 'cookies.sqlite')
    if (existsSync(cookiesPath)) {
      return {
        family: 'firefox',
        label: 'Firefox',
        cookiesPath,
        profiles,
        selectedProfile: profile.directory
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Safari detection
// ---------------------------------------------------------------------------


export const MAC_EPOCH_DELTA = 978_307_200


export function detectSafari(): DetectedBrowser | null {
  if (process.platform !== 'darwin') {
    return null
  }
  const home = process.env.HOME ?? ''
  const candidates = [
    join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
    join(
      home,
      'Library',
      'Containers',
      'com.apple.Safari',
      'Data',
      'Library',
      'Cookies',
      'Cookies.binarycookies'
    )
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return {
        family: 'safari',
        label: 'Safari',
        cookiesPath: candidate,
        profiles: [{ name: 'Default', directory: 'Default' }],
        selectedProfile: 'Default'
      }
    }
  }
  return null
}


export function detectInstalledBrowsers(): DetectedBrowser[] {
  const detected: DetectedBrowser[] = []
  for (const browser of CHROMIUM_BROWSERS) {
    const root = browserRootPath(browser)
    if (!root) {
      continue
    }
    const profiles = discoverProfiles(root)
    // Why: a browser counts as detected once a profile has a cookies DB; use the first such profile as default.
    for (const profile of profiles) {
      const profileDir = join(root, profile.directory)
      const cookiesPath = resolveChromiumCookiesPath(profileDir)
      if (cookiesPath) {
        detected.push({
          family: browser.family,
          label: browser.label,
          keychainService: browser.keychainService,
          keychainAccount: browser.keychainAccount,
          cookiesPath,
          profiles,
          selectedProfile: profile.directory
        })
        break
      }
    }
  }

  const firefox = detectFirefox()
  if (firefox) {
    detected.push(firefox)
  }

  const safari = detectSafari()
  if (safari) {
    detected.push(safari)
  }

  return detected
}
