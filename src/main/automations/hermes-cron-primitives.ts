import { homedir } from "node:os"
import { join } from "node:path"


export const HERMES_HOME = process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
export const HERMES_OUTPUT_DIR = join(HERMES_HOME, 'cron', 'output')
export const HERMES_STATE_DB = join(HERMES_HOME, 'state.db')
export const EXTERNAL_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
export const HERMES_OUTPUT_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/
export const HERMES_RUN_KEY_PATTERN = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
export const MAX_SESSION_OUTPUT_GAP_MS = 24 * 60 * 60 * 1000
export const MAX_REFERENCED_LOG_BYTES = 5 * 1024 * 1024
export const FULL_SESSION_LOG_HEADING = '## Full session log'
export const REFERENCED_LOG_HEADING = '## Latest log file'
export const RUN_PREVIEW_LIMIT = 180
export const LATEST_LOG_PATH_PATTERN =
  /\bLatest log path:\s*(?<path>(?:[A-Za-z]:[\\/]|\/)[^\r\n]*?)(?=\s+Run summary:|\r?\n|$)/i

export type HermesCronOutputRunsPage = {
  total: number
  runs: unknown[]
}

export type HermesOutputRunRef = {
  kind: 'output'
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
  output_path: string
}

export type HermesSessionRunRef = {
  kind: 'session'
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
}

export type HermesMergedRunRef = {
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
  output: HermesOutputRunRef | null
  session: HermesSessionRunRef | null
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function runAtFromHermesOutputFile(filename: string): string | null {
  const match = HERMES_OUTPUT_FILE_PATTERN.exec(filename)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

export function runKeyFromHermesOutputFile(filename: string): string | null {
  const match = HERMES_OUTPUT_FILE_PATTERN.exec(filename)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second] = match
  return `${year}${month}${day}_${hour}${minute}${second}`
}

export function runAtFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function sortableTimeFromRunKey(runKey: string | null): number {
  if (!runKey) {
    return Number.NaN
  }
  const match = HERMES_RUN_KEY_PATTERN.exec(runKey)
  if (!match) {
    return Number.NaN
  }
  const [, year, month, day, hour, minute, second] = match
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
}

export function escapeSqlLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
