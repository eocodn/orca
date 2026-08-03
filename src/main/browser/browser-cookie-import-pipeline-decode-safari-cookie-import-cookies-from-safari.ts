import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: write the diag log to userData, not world-readable /tmp, so only the current user can read it.
import { diag } from './browser-cookie-import-pipeline-cookie-import-error-scan-max-chars-browser-profile'
import { type DetectedBrowser } from './browser-cookie-import-pipeline-detected-browser-browser-root-path'
import { MAC_EPOCH_DELTA } from './browser-cookie-import-pipeline-detect-firefox-detect-installed-browsers'
import { type ValidatedCookie } from './browser-cookie-import-pipeline-select-browser-profile-chromium-same-site'
import { firefoxSameSite, deriveUrl } from './browser-cookie-import-pipeline-firefox-same-site-validate-cookie-entry'
import { importValidatedCookies } from './browser-cookie-import-pipeline-import-validated-cookies-get-user-agent-for-browser'
import { decodeSafariBinaryCookies } from './browser-cookie-import-pipeline-decrypt-aes256-gcm-decode-safari-page'
import type { BrowserCookieImportResult } from '../../shared/types'

export function decodeSafariCookie(buf: Buffer): ValidatedCookie | null {
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

export function readCString(buf: Buffer, offset: number, end: number): string | null {
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

// ---------------------------------------------------------------------------
// Firefox import
// ---------------------------------------------------------------------------

export async function importCookiesFromFirefox(
  browser: DetectedBrowser,
  targetPartition: string
): Promise<BrowserCookieImportResult> {
  diag(`importCookiesFromFirefox: partition="${targetPartition}"`)

  const tmpDir = mkdtempSync(join(tmpdir(), 'orca-cookie-import-'))
  const tmpCookiesPath = join(tmpDir, 'cookies.sqlite')

  try {
    copyFileSync(browser.cookiesPath, tmpCookiesPath)
    for (const suffix of ['-wal', '-shm'] as const) {
      const sidecar = browser.cookiesPath + suffix
      if (existsSync(sidecar)) {
        try {
          copyFileSync(sidecar, tmpCookiesPath + suffix)
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    rmSync(tmpDir, { recursive: true, force: true })
    return {
      ok: false,
      reason: 'Could not copy Firefox cookies database. Try closing Firefox first.'
    }
  }

  try {
    const db = new DatabaseSync(tmpCookiesPath, { readOnly: true })
    type FirefoxRow = {
      name: string
      value: string
      host: string
      path: string
      expiry: number
      isSecure: number
      isHttpOnly: number
      sameSite: number
    }
    const rows = db
      .prepare(
        'SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies'
      )
      .all() as FirefoxRow[]
    db.close()

    diag(`  Firefox source has ${rows.length} cookies`)
    if (rows.length === 0) {
      rmSync(tmpDir, { recursive: true, force: true })
      return { ok: false, reason: 'No cookies found in Firefox.' }
    }

    const now = Math.floor(Date.now() / 1000)
    const validated: ValidatedCookie[] = []
    for (const row of rows) {
      if (!row.name || !row.host) {
        continue
      }
      if (row.expiry > 0 && row.expiry < now) {
        continue
      }

      const domain = row.host
      const secure = row.isSecure === 1
      const url = deriveUrl(domain, secure)
      if (!url) {
        continue
      }

      validated.push({
        url,
        name: row.name,
        value: row.value ?? '',
        domain,
        path: row.path || '/',
        secure,
        httpOnly: row.isHttpOnly === 1,
        sameSite: firefoxSameSite(row.sameSite),
        expirationDate: row.expiry > 0 ? row.expiry : undefined
      })
    }

    rmSync(tmpDir, { recursive: true, force: true })

    if (validated.length === 0) {
      return { ok: false, reason: 'No valid cookies found in Firefox.' }
    }

    return importValidatedCookies(validated, rows.length, targetPartition)
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true })
    diag(`  Firefox import failed: ${String(err)}`)
    return {
      ok: false,
      reason: 'Could not import cookies from Firefox. Try closing Firefox first.'
    }
  }
}

// ---------------------------------------------------------------------------
// Safari import
// ---------------------------------------------------------------------------

export async function importCookiesFromSafari(
  browser: DetectedBrowser,
  targetPartition: string
): Promise<BrowserCookieImportResult> {
  diag(`importCookiesFromSafari: partition="${targetPartition}"`)

  let data: Buffer
  try {
    data = readFileSync(browser.cookiesPath)
  } catch (err) {
    diag(`  Safari read failed: ${String(err)}`)
    // Why: Safari's Cookies.binarycookies is in a sandbox container; reading it needs Full Disk Access.
    const isPermError =
      err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM'
    if (isPermError) {
      return {
        ok: false,
        reason:
          'macOS denied access to Safari cookies. Grant Full Disk Access to Orca in System Settings → Privacy & Security → Full Disk Access.'
      }
    }
    return { ok: false, reason: 'Could not read Safari cookies.' }
  }

  try {
    const cookies = decodeSafariBinaryCookies(data)
    diag(`  Safari source has ${cookies.length} cookies`)

    if (cookies.length === 0) {
      return { ok: false, reason: 'No cookies found in Safari.' }
    }

    const now = Math.floor(Date.now() / 1000)
    const valid = cookies.filter((c) => !c.expirationDate || c.expirationDate > now)

    if (valid.length === 0) {
      return { ok: false, reason: 'All Safari cookies are expired.' }
    }

    return importValidatedCookies(valid, cookies.length, targetPartition)
  } catch (err) {
    diag(`  Safari import failed: ${String(err)}`)
    return { ok: false, reason: 'Could not import cookies from Safari.' }
  }
}

// ---------------------------------------------------------------------------
// Import dispatcher
// ---------------------------------------------------------------------------
