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
  type RawCookieEntry,
  type ValidatedCookie,
  selectBrowserProfile,
  chromiumSameSite
} from './browser-cookie-import-pipeline-select-browser-profile-chromium-same-site'
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
import type { BrowserCookieImportResult, BrowserCookieImportSummary } from '../../shared/types'
import { browserSessionRegistry } from './browser-session-registry'
import { setupClientHintsOverride } from './browser-session-ua'
import {
  createChromiumCookieSnapshot,
  type ChromiumCookieSnapshot
} from './chromium-cookie-snapshot'
import { resolveChromiumCookiesPath } from './chromium-cookie-path'
import { copyFileWithWindowsRetry } from '../codex-accounts/fs-utils'

export async function importCookiesFromBrowser(
  browser: DetectedBrowser,
  targetPartition: string
): Promise<BrowserCookieImportResult> {
  diag(`importCookiesFromBrowser: browser=${browser.family} partition="${targetPartition}"`)
  if (!existsSync(browser.cookiesPath)) {
    diag(`  cookies DB not found: ${browser.cookiesPath}`)
    return { ok: false, reason: `${browser.label} cookies database not found.` }
  }

  if (browser.family === 'firefox') {
    return importCookiesFromFirefox(browser, targetPartition)
  }
  if (browser.family === 'safari') {
    return importCookiesFromSafari(browser, targetPartition)
  }

  // Why: cookies.set() rejects many valid values (bytes > 0x7F); instead write plaintext to the `value` column, which CookieMonster reads raw when `encrypted_value` is empty and re-encrypts on flush in packaged builds.

  // Why: CookieMonster overwrites the live DB on flush, so stage a populated copy and swap it in at next cold start.
  const targetSession = session.fromPartition(targetPartition)
  await targetSession.cookies.flushStore()

  const partitionName = targetPartition.replace('persist:', '')
  const partitionDir = join(app.getPath('userData'), 'Partitions', partitionName)
  let liveCookiesPath = resolveChromiumCookiesPath(partitionDir)

  // Why: Electron creates the Cookies file only after a cookie is stored; a throwaway set/remove forces DB init for unused profiles.
  if (!liveCookiesPath) {
    try {
      await targetSession.cookies.set({ url: 'https://localhost', name: '__init', value: '1' })
      await targetSession.cookies.remove('https://localhost', '__init')
      await targetSession.cookies.flushStore()
    } catch {
      // ignore — the set/remove may fail but flushStore should still create the file
    }
    liveCookiesPath = resolveChromiumCookiesPath(partitionDir)
  }

  if (!liveCookiesPath) {
    return { ok: false, reason: 'Target cookie database not found. Open a browser tab first.' }
  }

  const stagingDir = join(app.getPath('userData'), 'cookie-import-staging')
  const partitionSegment = partitionName.replace(/[^a-zA-Z0-9_-]/g, '_')
  const stagingCookiesPath = join(
    stagingDir,
    `Cookies-${partitionSegment}-${Date.now()}-${randomUUID()}`
  )
  // Why: #9355 — staging only backs the cold-restart replay for cookies the in-memory
  // import rejects, so losing it must degrade that fallback rather than abort the import.
  let stagingAvailable = false
  try {
    mkdirSync(stagingDir, { recursive: true })
    copyFileWithWindowsRetry(liveCookiesPath, stagingCookiesPath)
    stagingAvailable = true
  } catch (err) {
    const fsErr = err as NodeJS.ErrnoException
    diag(
      `  staging copy unavailable: code=${fsErr.code ?? 'unknown'} errno=${fsErr.errno ?? 'unknown'} syscall=${fsErr.syscall ?? 'unknown'} path=${liveCookiesPath} destination=${stagingCookiesPath}`
    )
    // Why: copyFile is non-atomic and can leave a partial DB; delete it so failed imports retain no cookie data.
    try {
      unlinkSync(stagingCookiesPath)
    } catch {
      /* best-effort */
    }
  }

  let sourceSnapshot: ChromiumCookieSnapshot
  try {
    // Why: an open browser may hold cookies in WAL only; snapshot retries avoid pairing the main DB with a racing WAL.
    sourceSnapshot = createChromiumCookieSnapshot(browser.cookiesPath)
  } catch (err) {
    try {
      unlinkSync(stagingCookiesPath)
    } catch {
      /* best-effort */
    }
    diag(`  Chromium snapshot failed: ${String(err)}`)
    return {
      ok: false,
      reason: `Could not copy ${browser.label} cookies database. Try closing ${browser.label} first.`
    }
  }

  let sourceDb: InstanceType<typeof DatabaseSync> | null = null
  let stagingDb: InstanceType<typeof DatabaseSync> | null = null
  const closeStagingDb = (): void => {
    try {
      stagingDb?.close()
    } catch {
      /* best-effort */
    }
    stagingDb = null
  }
  const discardStagingFile = (): void => {
    try {
      unlinkSync(stagingCookiesPath)
    } catch {
      /* best-effort */
    }
  }

  try {
    // Why: Chromium timestamps (µs since 1601) can exceed Number.MAX_SAFE_INTEGER; readBigInts avoids precision loss.
    sourceDb = new DatabaseSync(sourceSnapshot.databasePath, {
      readOnly: true,
      readBigInts: true
    })
    let targetColumnInfo: ChromiumCookieColumnInfo[] | null = null
    let colList: string | null = null
    let placeholders: string | null = null
    if (stagingAvailable) {
      // Why: the staged file is Orca's own partition DB, also named "Cookies", so the same
      // transient AV handle can make opening it throw — degrade instead of killing the import.
      try {
        stagingDb = new DatabaseSync(stagingCookiesPath)
        targetColumnInfo = stagingDb
          .prepare('PRAGMA table_info(cookies)')
          .all() as ChromiumCookieColumnInfo[]
        const targetCols: string[] = targetColumnInfo.map((r) => r.name)
        colList = targetCols.join(', ')
        placeholders = targetCols.map(() => '?').join(', ')
        stagingDb.exec('DELETE FROM cookies')
      } catch (err) {
        diag(`  staging database unusable, restart fallback disabled: ${String(err)}`)
        stagingAvailable = false
        targetColumnInfo = null
        colList = null
        placeholders = null
        closeStagingDb()
        // Why: the copy holds real partition cookies; discard it now rather than at the exit branches.
        discardStagingFile()
      }
    }

    const sourceRows = sourceDb.prepare('SELECT * FROM cookies ORDER BY rowid').all() as Record<
      string,
      unknown
    >[]
    sourceDb.close()
    sourceDb = null

    diag(`  source has ${sourceRows.length} cookies`)

    if (sourceRows.length === 0) {
      closeStagingDb()
      discardStagingFile()
      return { ok: false, reason: `No cookies found in ${browser.label}.` }
    }

    const needsSourceKey = sourceRows.some((sourceRow) => {
      const encRaw = sourceRow.encrypted_value
      return encRaw instanceof Uint8Array && encRaw.length > 0
    })
    const sourceKey = needsSourceKey
      ? getEncryptionKey(browser.keychainService!, browser.keychainAccount!, browser)
      : null
    if (needsSourceKey && !sourceKey) {
      closeStagingDb()
      // Why: key denial happens after staging, so clean up the target DB copy or retries pile up.
      discardStagingFile()
      return {
        ok: false,
        reason: `Could not access ${browser.label} encryption key. The OS may have denied access.`
      }
    }

    // Why: Google integrity cookies are bound to the source browser's TLS/env; importing them triggers CookieMismatch, so skip and let Google reissue.
    const INTEGRITY_COOKIE_NAMES = new Set([
      'SIDCC',
      '__Secure-1PSIDCC',
      '__Secure-3PSIDCC',
      '__Secure-STRP',
      'AEC'
    ])
    function isIntegrityCookie(name: string, domain: string): boolean {
      if (!INTEGRITY_COOKIE_NAMES.has(name)) {
        return false
      }
      const d = domain.startsWith('.') ? domain.slice(1) : domain
      return d === 'google.com' || d.endsWith('.google.com')
    }

    let imported = 0
    let skipped = 0
    let integritySkipped = 0
    let memoryLoaded = 0
    let memoryFailed = 0
    const domainSet = new Set<string>()

    type DecryptedCookie = {
      decryptedValue: Buffer
      value: string
      domain: string
      name: string
      path: string
      secure: boolean
      httpOnly: boolean
      sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
      expirationDate: number | undefined
    }

    const decryptedCookies: DecryptedCookie[] = []

    // Why: staging only backs the cold-restart replay, so any failure writing it disables that
    // fallback instead of aborting an import whose in-memory half still works.
    let insertStmt: ReturnType<InstanceType<typeof DatabaseSync>['prepare']> | null = null
    const disableStaging = (reason: string): void => {
      diag(`  staging disabled, restart fallback unavailable: ${reason}`)
      stagingAvailable = false
      insertStmt = null
      closeStagingDb()
      discardStagingFile()
    }

    if (stagingDb && colList && placeholders) {
      try {
        insertStmt = stagingDb.prepare(
          `INSERT OR REPLACE INTO cookies (${colList}) VALUES (${placeholders})`
        )
        stagingDb.exec('BEGIN TRANSACTION')
      } catch (err) {
        disableStaging(String(err))
      }
    } else if (stagingAvailable) {
      disableStaging('staged database exposed no cookies columns')
    }

    for (const sourceRow of sourceRows) {
      const encRaw = sourceRow.encrypted_value
      // Why: node:sqlite returns BLOBs as Uint8Array; treat any other type as missing, not an empty buffer that would silently blank the cookie value.
      const encBuf = encRaw instanceof Uint8Array ? Buffer.from(encRaw) : null
      const plainRaw = sourceRow.value

      let decryptedValue: Buffer
      if (encBuf && encBuf.length > 0) {
        const raw = sourceKey ? decryptCookieValueRaw(encBuf, sourceKey) : null
        if (!raw) {
          skipped++
          continue
        }
        decryptedValue = raw
      } else if (plainRaw instanceof Uint8Array) {
        decryptedValue = Buffer.from(plainRaw)
      } else if (typeof plainRaw === 'string') {
        decryptedValue = Buffer.from(plainRaw, 'latin1')
      } else {
        decryptedValue = Buffer.alloc(0)
      }

      const domain = sourceRow.host_key as string
      const name = sourceRow.name as string

      if (isIntegrityCookie(name, domain)) {
        integritySkipped++
        continue
      }

      const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain
      domainSet.add(cleanDomain)

      const path = sourceRow.path as string
      const secure = sourceRow.is_secure === 1n
      const httpOnly = sourceRow.is_httponly === 1n
      const sameSite = chromiumSameSite(Number(sourceRow.samesite ?? 0))
      const expiresUtc = chromiumTimestampToUnix(sourceRow.expires_utc as bigint)
      // Why: cookie values are raw bytes, not UTF-8; latin1 preserves 0x00–0xFF without lossy replacement.
      const value = decryptedValue.toString('latin1')

      decryptedCookies.push({
        decryptedValue,
        value,
        domain,
        name,
        path,
        secure,
        httpOnly,
        sameSite,
        expirationDate: expiresUtc > 0 ? expiresUtc : undefined
      })

      if (insertStmt && targetColumnInfo) {
        try {
          const params = buildChromiumCookieInsertParams(
            targetColumnInfo,
            sourceRow,
            decryptedValue
          )
          insertStmt.run(...params)
        } catch (err) {
          disableStaging(String(err))
        }
      }
      // Why: counts importable cookies, not staged rows — the summary must stay truthful when
      // the optional staging DB is unavailable.
      imported++
    }
    diag(`  skipped ${integritySkipped} Google integrity cookies (SIDCC/STRP/AEC)`)

    if (stagingDb) {
      try {
        stagingDb.exec('COMMIT')
        closeStagingDb()
        diag(`  SQLite staging complete: ${imported} cookies, ${domainSet.size} domains`)
      } catch (err) {
        disableStaging(String(err))
      }
    } else {
      diag(`  staging skipped: ${imported} cookies will load in-memory only`)
    }

    // Why: clear stale cookies first; mixing them with the imported set makes sites like Google reject the session.
    await targetSession.clearStorageData({ storages: ['cookies'] })
    diag(
      `  cleared existing session cookies before loading ${decryptedCookies.length} imported cookies`
    )

    // Why: load into memory via cookies.set() so imported cookies work without a restart.
    for (const cookie of decryptedCookies) {
      const url = deriveUrl(cookie.domain, cookie.secure)
      if (!url) {
        memoryFailed++
        continue
      }
      try {
        // Why: Chromium rejects __Host- cookies unless they omit domain and use path=/.
        const isHostPrefixed = cookie.name.startsWith('__Host-')
        await targetSession.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          ...(isHostPrefixed ? {} : { domain: cookie.domain }),
          path: isHostPrefixed ? '/' : cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate
        })
        memoryLoaded++
      } catch {
        memoryFailed++
      }
    }

    diag(`  memory load: ${memoryLoaded} OK, ${memoryFailed} failed`)

    let warning: BrowserCookieImportSummary['warning']
    if (memoryFailed > 0 && stagingAvailable) {
      // Why: keep the staging DB so the failed cookies load from SQLite on next cold start, where CookieMonster skips validation.
      browserSessionRegistry.setPendingCookieImport(targetPartition, stagingCookiesPath)
      diag(`  staged at ${stagingCookiesPath} for ${memoryFailed} cookies that need restart`)
    } else if (memoryFailed > 0) {
      // Why: never register a path that was never written — cold start would replay a missing
      // or partial DB over the live partition.
      browserSessionRegistry.clearPendingCookieImport(targetPartition)
      discardStagingFile()
      diag(`  ${memoryFailed} cookies need a restart but staging is unavailable — skipped`)
      // Why: the jar was already cleared, so silence here would report a lossy import as a clean success.
      warning = {
        code: 'restart-fallback-unavailable',
        loadedCookies: memoryLoaded,
        failedCookies: memoryFailed
      }
    } else {
      // Why: this import already rewrote the live session, so an older staged DB must not replay over it.
      browserSessionRegistry.clearPendingCookieImport(targetPartition)
      discardStagingFile()
      diag(`  all cookies loaded in-memory — no restart needed`)
    }

    const ua = getUserAgentForBrowser(browser.family)
    if (ua) {
      targetSession.setUserAgent(ua)
      setupClientHintsOverride(targetSession, ua)
      browserSessionRegistry.persistUserAgent(targetPartition, ua)
      diag(`  set UA for partition: ${ua.substring(0, 80)}...`)
    }

    const summary: BrowserCookieImportSummary = {
      totalCookies: sourceRows.length,
      importedCookies: imported,
      skippedCookies: skipped,
      domains: [...domainSet].sort(),
      ...(warning ? { warning } : {})
    }

    return { ok: true, profileId: '', summary }
  } catch (err) {
    try {
      sourceDb?.close()
    } catch {
      /* may already be closed */
    }
    try {
      stagingDb?.close()
    } catch {
      /* may already be closed */
    }
    // Why: drop the staging DB so a stale staged import isn't applied on the next cold start.
    try {
      unlinkSync(stagingCookiesPath)
    } catch {
      /* may not exist yet */
    }
    diag(`  SQLite import failed: ${String(err)}`)
    return {
      ok: false,
      reason: reasonWithDiagLog(
        `Could not import cookies from ${browser.label}: ${summarizeCookieImportError(err)}.`
      )
    }
  } finally {
    try {
      sourceSnapshot.cleanup()
    } catch (err) {
      diag(`  Chromium snapshot cleanup failed: ${String(err)}`)
    }
  }
}
