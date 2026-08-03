
import { CHROMIUM_EPOCH_OFFSET } from './browser-cookie-import-pipeline-pbkdf2-iterations-chromium-epoch-offset'

export function chromiumTimestampToUnix(chromiumTs: bigint | number | string): number {
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


export function parseSqliteDefaultValue(raw: unknown, type: string): string | number | Buffer | null {
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
