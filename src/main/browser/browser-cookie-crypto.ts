import { execFileSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  browserRootPath,
  CHROMIUM_BROWSERS,
  type DetectedBrowser
} from './browser-profile-discovery'
import { deriveUrl, type ValidatedCookie } from './browser-cookie-value-validation'
import { diag } from './browser-cookie-import-pipeline-cookie-import-error-scan-max-chars-browser-profile'
import { MAC_EPOCH_DELTA } from './browser-cookie-import-pipeline-detect-firefox-detect-installed-browsers'
const PBKDF2_ITERATIONS = 1003
const PBKDF2_KEY_LENGTH = 16
const PBKDF2_SALT = 'saltysalt'

const CHROMIUM_EPOCH_OFFSET = 11644473600n

function chromiumTimestampToUnix(chromiumTs: bigint | number | string): number {
  if (!chromiumTs || chromiumTs === 0n || chromiumTs === 0 || chromiumTs === '0') {
    return 0
  }
  try {
    const ts =
      typeof chromiumTs === 'bigint'
        ? chromiumTs
        : BigInt(typeof chromiumTs === 'number' ? Math.round(chromiumTs) : chromiumTs)
    if (ts === 0n) {
      return 0
    }
    return Math.max(Number(ts / 1000000n - CHROMIUM_EPOCH_OFFSET), 0)
  } catch {
    return 0
  }
}

// Why: each platform protects the Chromium key differently: macOS/Linux PBKDF2→AES-128-CBC, Windows DPAPI→AES-256-GCM.

export type EncryptionKeyResult = {
  key: Buffer
  mode: 'aes-128-cbc' | 'aes-256-gcm'
  // Why: Linux v10 cookies use "peanuts" and v11 the keyring password; both keys are needed to decrypt the full set.
  fallbackKey?: Buffer
}

export type ChromiumCookieColumnInfo = {
  name: string
  type?: string
  notnull?: number | bigint
  dflt_value?: unknown
}

function parseSqliteDefaultValue(raw: unknown, type: string): string | number | Buffer | null {
  if (raw === null || raw === undefined) {
    return null
  }
  if (typeof raw !== 'string') {
    return typeof raw === 'number' || typeof raw === 'bigint' ? Number(raw) : String(raw)
  }

  const trimmed = raw.trim()
  if (!trimmed || trimmed.toUpperCase() === 'NULL') {
    return null
  }
  if (/^X''$/i.test(trimmed) || type.includes('BLOB')) {
    return Buffer.alloc(0)
  }
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  if (type.includes('INT')) {
    const numeric = Number(trimmed)
    return Number.isFinite(numeric) ? numeric : 0
  }
  return trimmed
}

function normalizeSqliteCookieValue(value: unknown): string | number | bigint | Buffer | null {
  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return value
  }
  return String(value)
}

function isSqliteNotNull(column: ChromiumCookieColumnInfo): boolean {
  return Number(column.notnull ?? 0) !== 0
}

function fallbackChromiumCookieColumnValue(
  column: ChromiumCookieColumnInfo,
  sourceRow: Record<string, unknown>
): string | number | bigint | Buffer | null {
  const type = (column.type ?? '').toUpperCase()
  const defaultValue = parseSqliteDefaultValue(column.dflt_value, type)
  if (defaultValue !== null) {
    return defaultValue
  }
  if (!isSqliteNotNull(column)) {
    return null
  }

  switch (column.name) {
    case 'value':
    case 'encrypted_value':
      return Buffer.alloc(0)
    case 'top_frame_site_key':
      return ''
    case 'source_port':
      return -1
    case 'last_update_utc':
      return normalizeSqliteCookieValue(sourceRow.creation_utc) ?? 0
    default:
      if (type.includes('BLOB')) {
        return Buffer.alloc(0)
      }
      if (type.includes('INT')) {
        return 0
      }
      return ''
  }
}

export function buildChromiumCookieInsertParams(
  targetColumns: ChromiumCookieColumnInfo[],
  sourceRow: Record<string, unknown>,
  decryptedValue: Buffer
): (string | number | bigint | Buffer | null)[] {
  return targetColumns.map((column) => {
    if (column.name === 'encrypted_value') {
      return Buffer.alloc(0)
    }
    if (column.name === 'value') {
      return decryptedValue
    }

    const sourceHasColumn = Object.prototype.hasOwnProperty.call(sourceRow, column.name)
    const sourceValue = sourceHasColumn ? normalizeSqliteCookieValue(sourceRow[column.name]) : null
    if (sourceValue !== null) {
      return sourceValue
    }
    if (sourceHasColumn && !isSqliteNotNull(column)) {
      return null
    }

    // Why: cookie columns drift across Chrome/Electron versions; missing NOT NULL columns need Chromium defaults, not NULL.
    return fallbackChromiumCookieColumnValue(column, sourceRow)
  })
}

export function getEncryptionKey(
  keychainService: string,
  keychainAccount: string,
  browser?: DetectedBrowser
): EncryptionKeyResult | null {
  if (process.platform === 'darwin') {
    return getMacEncryptionKey(keychainService, keychainAccount)
  }
  if (process.platform === 'linux') {
    return getLinuxEncryptionKey(keychainService, keychainAccount)
  }
  if (process.platform === 'win32' && browser) {
    return getWindowsEncryptionKey(browser)
  }
  return null
}

function getMacEncryptionKey(
  keychainService: string,
  keychainAccount: string
): EncryptionKeyResult | null {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', keychainService, '-a', keychainAccount, '-w'],
      { encoding: 'utf-8', timeout: 30_000 }
    ).trim()
    return {
      key: pbkdf2Sync(raw, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha1'),
      mode: 'aes-128-cbc'
    }
  } catch {
    return null
  }
}

function getLinuxEncryptionKey(
  keychainService: string,
  keychainAccount: string
): EncryptionKeyResult | null {
  // Why: v10 cookies use hardcoded "peanuts", v11 the keyring password; derive both so decrypt can pick by version prefix.
  const v10Key = pbkdf2Sync('peanuts', PBKDF2_SALT, 1, PBKDF2_KEY_LENGTH, 'sha1')

  let keyringPassword = ''
  try {
    // Why: GNOME keyring stores the Chrome Safe Storage password via secret-tool.
    keyringPassword = execFileSync(
      'secret-tool',
      ['lookup', 'service', keychainService, 'account', keychainAccount],
      { encoding: 'utf-8', timeout: 5_000 }
    ).trim()
  } catch {
    // Why: fall back to application-based lookup used by newer Chromium versions.
    try {
      const app = keychainAccount.toLowerCase().replaceAll(' ', '')
      keyringPassword = execFileSync('secret-tool', ['lookup', 'application', app], {
        encoding: 'utf-8',
        timeout: 5_000
      }).trim()
    } catch {
      diag('  Linux keyring unavailable — v11 cookies may fail to decrypt')
    }
  }

  const v11Key = pbkdf2Sync(keyringPassword, PBKDF2_SALT, 1, PBKDF2_KEY_LENGTH, 'sha1')
  return { key: v11Key, mode: 'aes-128-cbc', fallbackKey: v10Key }
}

function getWindowsEncryptionKey(browser: DetectedBrowser): EncryptionKeyResult | null {
  const browserDef = CHROMIUM_BROWSERS.find((b) => b.family === browser.family)
  if (!browserDef) {
    return null
  }
  const root = browserRootPath(browserDef)
  if (!root) {
    return null
  }

  const localStatePath = join(root, 'Local State')
  if (!existsSync(localStatePath)) {
    return null
  }

  try {
    const raw = readFileSync(localStatePath, 'utf-8')
    const localState = JSON.parse(raw)
    const encryptedKeyB64 = localState?.os_crypt?.encrypted_key
    if (typeof encryptedKeyB64 !== 'string') {
      return null
    }

    const encryptedKey = Buffer.from(encryptedKeyB64, 'base64')
    const dpapiPrefix = Buffer.from('DPAPI', 'utf-8')
    if (!encryptedKey.subarray(0, dpapiPrefix.length).equals(dpapiPrefix)) {
      return null
    }

    // Why: PowerShell DPAPI decrypt is the only native-addon-free path to the master key; pass via stdin to avoid injection.
    const dpapiData = encryptedKey.subarray(dpapiPrefix.length).toString('base64')
    const script = [
      'try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop }',
      'catch { try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch {} };',
      '$in=[Convert]::FromBase64String([Console]::In.ReadLine());',
      '$out=[System.Security.Cryptography.ProtectedData]::Unprotect($in,$null,',
      '[System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
      '[Convert]::ToBase64String($out)'
    ].join('')

    const result = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf-8', timeout: 10_000, input: dpapiData }
    ).trim()

    return { key: Buffer.from(result, 'base64'), mode: 'aes-256-gcm' }
  } catch (err) {
    diag(`  Windows DPAPI key extraction failed: ${String(err)}`)
    return null
  }
}

// Why: Chromium 127+ prepends a 32-byte HMAC before the value; a hash is ~half non-printable, so ≥8 non-printable of the first 32 bytes flags the prefix.
const CHROMIUM_COOKIE_HMAC_LEN = 32

function hasHmacPrefix(buf: Buffer): boolean {
  if (buf.length <= CHROMIUM_COOKIE_HMAC_LEN) {
    return false
  }
  let nonPrintable = 0
  for (let i = 0; i < CHROMIUM_COOKIE_HMAC_LEN; i++) {
    if (buf[i] < 0x20 || buf[i] > 0x7e) {
      nonPrintable++
    }
  }
  return nonPrintable >= 8
}

function stripHmac(buf: Buffer): Buffer {
  return hasHmacPrefix(buf) ? buf.subarray(CHROMIUM_COOKIE_HMAC_LEN) : buf
}

export function decryptCookieValueRaw(
  encryptedBuffer: Buffer,
  keyResult: EncryptionKeyResult
): Buffer | null {
  if (!encryptedBuffer || encryptedBuffer.length === 0) {
    return null
  }
  const version = encryptedBuffer.subarray(0, 3).toString('utf-8')
  if (!/^v\d\d$/.test(version)) {
    return null
  }

  if (keyResult.mode === 'aes-256-gcm') {
    return decryptAes256Gcm(encryptedBuffer.subarray(3), keyResult.key)
  }

  // AES-128-CBC (macOS and Linux)
  const ciphertext = encryptedBuffer.subarray(3)
  if (!ciphertext.length) {
    return Buffer.alloc(0)
  }

  // Why: Linux v10 uses the "peanuts" key, v11 the keyring key; try primary then fallback (macOS uses one key).
  const keysToTry =
    version === 'v10' && keyResult.fallbackKey
      ? [keyResult.fallbackKey, keyResult.key]
      : [keyResult.key, ...(keyResult.fallbackKey ? [keyResult.fallbackKey] : [])]

  for (const key of keysToTry) {
    try {
      const iv = Buffer.alloc(16, ' ')
      const decipher = createDecipheriv('aes-128-cbc', key, iv)
      decipher.setAutoPadding(true)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return stripHmac(decrypted)
    } catch {
      continue
    }
  }
  return null
}

function decryptAes256Gcm(payload: Buffer, key: Buffer): Buffer | null {
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

function appendSafariCookies(target: ValidatedCookie[], cookies: readonly ValidatedCookie[]): void {
  // Why: pages can hold large cookie lists; push per-item to avoid exceeding the spread argument limit.
  for (const cookie of cookies) {
    target.push(cookie)
  }
}

function decodeSafariPage(page: Buffer): ValidatedCookie[] {
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

function decodeSafariCookie(buf: Buffer): ValidatedCookie | null {
  if (buf.length < 48) {
    return null
  }
  // Why: size comes from the file and could be attacker-controlled; clamp so readCString can't escape the subarray.
  const size = Math.min(buf.readUInt32LE(0), buf.length)
  if (size < 48) {
    return null
  }

  const flags = buf.readUInt32LE(8)
  const secure = (flags & 1) !== 0
  const httpOnly = (flags & 4) !== 0

  const urlOffset = buf.readUInt32LE(16)
  const nameOffset = buf.readUInt32LE(20)
  const pathOffset = buf.readUInt32LE(24)
  const valueOffset = buf.readUInt32LE(28)

  // Why: Safari stores dates as Mac absolute time (seconds since 2001-01-01).
  const expiration = buf.length >= 48 ? buf.readDoubleLE(40) : 0

  const name = readCString(buf, nameOffset, size)
  if (!name) {
    return null
  }
  const value = readCString(buf, valueOffset, size) ?? ''
  const path = readCString(buf, pathOffset, size) ?? '/'
  const rawUrl = readCString(buf, urlOffset, size) ?? ''

  // Why: Safari stores the domain in the URL field, not as a separate domain column.
  const domain = rawUrl.startsWith('.') ? rawUrl : rawUrl || null
  if (!domain) {
    return null
  }

  const url = deriveUrl(domain, secure)
  if (!url) {
    return null
  }

  const expirationDate = expiration > 0 ? Math.round(expiration + MAC_EPOCH_DELTA) : undefined

  return {
    url,
    name,
    value,
    domain,
    path,
    secure,
    httpOnly,
    sameSite: 'unspecified',
    expirationDate
  }
}

function readCString(buf: Buffer, offset: number, end: number): string | null {
  if (offset < 0 || offset >= end) {
    return null
  }
  let cursor = offset
  while (cursor < end && buf[cursor] !== 0) {
    cursor++
  }
  if (cursor >= end) {
    return null
  }
  return buf.toString('utf8', offset, cursor)
}
