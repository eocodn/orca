
import { type ChromiumCookieColumnInfo, parseSqliteDefaultValue } from './browser-cookie-import-pipeline-chromium-timestamp-to-unix-parse-sqlite-default-value'

export function normalizeSqliteCookieValue(value: unknown): string | number | bigint | Buffer | null {
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


export function isSqliteNotNull(column: ChromiumCookieColumnInfo): boolean {
  return Number(column.notnull ?? 0) !== 0
}


export function fallbackChromiumCookieColumnValue(
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
