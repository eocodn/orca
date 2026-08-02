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
import { firefoxSameSite, normalizeSameSite, deriveUrl, validateCookieEntry } from './browser-cookie-import-pipeline-firefox-same-site-validate-cookie-entry'
import { importValidatedCookies, pickCookieFile, importCookiesFromFile, getUserAgentForBrowser } from './browser-cookie-import-pipeline-import-validated-cookies-get-user-agent-for-browser'
import { PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_SALT, CHROMIUM_EPOCH_OFFSET } from './browser-cookie-import-pipeline-pbkdf2-iterations-chromium-epoch-offset'
import { type EncryptionKeyResult, type ChromiumCookieColumnInfo, chromiumTimestampToUnix, parseSqliteDefaultValue } from './browser-cookie-import-pipeline-chromium-timestamp-to-unix-parse-sqlite-default-value'
import { normalizeSqliteCookieValue, isSqliteNotNull, fallbackChromiumCookieColumnValue, buildChromiumCookieInsertParams } from './browser-cookie-import-pipeline-normalize-sqlite-cookie-value-build-chromium-cookie-insert-params'
import { getEncryptionKey, getMacEncryptionKey, getLinuxEncryptionKey, getWindowsEncryptionKey } from './browser-cookie-import-pipeline-get-encryption-key-get-windows-encryption-key'
import { CHROMIUM_COOKIE_HMAC_LEN, hasHmacPrefix, stripHmac, decryptCookieValueRaw } from './browser-cookie-import-pipeline-chromium-cookie-hmac-len-decrypt-cookie-value-raw'
import { decodeSafariCookie, readCString, importCookiesFromFirefox, importCookiesFromSafari } from './browser-cookie-import-pipeline-decode-safari-cookie-import-cookies-from-safari'
import { importCookiesFromBrowser } from './browser-cookie-import-pipeline-import-cookies-from-browser-import-cookies-from-browser'

export function decryptAes256Gcm(payload: Buffer, key: Buffer): Buffer | null {
  // Why: Windows AES-256-GCM layout is: [12-byte nonce][ciphertext][16-byte auth tag]
  if (payload.length < 12 + 16) {
    return null
  }
  const nonce = payload.subarray(0, 12)
  const authTag = payload.subarray(-16)
  const ciphertext = payload.subarray(12, -16)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return stripHmac(decrypted)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Safari binary cookie parser
// ---------------------------------------------------------------------------


export function decodeSafariBinaryCookies(buffer: Buffer): ValidatedCookie[] {
  if (buffer.length < 8) {
    return []
  }
  if (buffer.subarray(0, 4).toString('utf8') !== 'cook') {
    return []
  }

  const pageCount = buffer.readUInt32BE(4)
  let cursor = 8
  if (cursor + pageCount * 4 > buffer.length) {
    return []
  }
  const pageSizes: number[] = []
  for (let i = 0; i < pageCount; i++) {
    pageSizes.push(buffer.readUInt32BE(cursor))
    cursor += 4
  }

  const cookies: ValidatedCookie[] = []
  for (const pageSize of pageSizes) {
    const page = buffer.subarray(cursor, cursor + pageSize)
    cursor += pageSize
    appendSafariCookies(cookies, decodeSafariPage(page))
  }
  return cookies
}


export function appendSafariCookies(target: ValidatedCookie[], cookies: readonly ValidatedCookie[]): void {
  // Why: pages can hold large cookie lists; push per-item to avoid exceeding the spread argument limit.
  for (const cookie of cookies) {
    target.push(cookie)
  }
}


export function decodeSafariPage(page: Buffer): ValidatedCookie[] {
  if (page.length < 16) {
    return []
  }
  if (page.readUInt32BE(0) !== 0x00000100) {
    return []
  }

  const cookieCount = page.readUInt32LE(4)
  if (8 + cookieCount * 4 > page.length) {
    return []
  }
  const offsets: number[] = []
  let cursor = 8
  for (let i = 0; i < cookieCount; i++) {
    offsets.push(page.readUInt32LE(cursor))
    cursor += 4
  }

  const cookies: ValidatedCookie[] = []
  for (const offset of offsets) {
    const cookie = decodeSafariCookie(page.subarray(offset))
    if (cookie) {
      cookies.push(cookie)
    }
  }
  return cookies
}
