 * run history, and actions must stay co-located behind one relay request handler. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { RelayDispatcher } from './dispatcher'

const execFileAsync = promisify(execFile)
const requireOptional = createRequire(__filename)
const HERMES_HOME = process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
const HERMES_CRON_DIR = join(HERMES_HOME, 'cron')
const HERMES_JOBS_FILE = join(HERMES_CRON_DIR, 'jobs.json')
const HERMES_OUTPUT_DIR = join(HERMES_CRON_DIR, 'output')
const HERMES_STATE_DB = join(HERMES_HOME, 'state.db')
const OPENCLAW_JOBS_FILE = join(homedir(), '.openclaw', 'cron', 'jobs.json')
const EXTERNAL_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const HERMES_OUTPUT_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/
const HERMES_RUN_KEY_PATTERN = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
const MAX_SESSION_OUTPUT_GAP_MS = 24 * 60 * 60 * 1000
const MAX_REFERENCED_LOG_BYTES = 5 * 1024 * 1024
const HERMES_RUN_COUNT_CACHE_MAX_ENTRIES = 200
const FULL_SESSION_LOG_HEADING = '## Full session log'
const REFERENCED_LOG_HEADING = '## Latest log file'
const LATEST_LOG_PATH_PATTERN =
  /\bLatest log path:\s*(?<path>(?:[A-Za-z]:[\\/]|\/)[^\r\n]*?)(?=\s+Run summary:|\r?\n|$)/i
type SqliteStatement = {
  get: (...args: unknown[]) => Record<string, unknown> | undefined
  all: (...args: unknown[]) => Record<string, unknown>[]
}
type SqliteDatabase = {
  prepare: (sql: string) => SqliteStatement
  close: () => void
}
type DatabaseConstructor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }
) => SqliteDatabase
type NodeSqliteDatabaseSync = new (
  path: string,
  options?: { readOnly?: boolean; timeout?: number }
) => SqliteDatabase
let databaseConstructor: DatabaseConstructor | null | undefined

type ExternalProvider = 'hermes' | 'openclaw'
type HermesAction = 'pause' | 'resume' | 'run' | 'delete'
type HermesOutputRunRef = {
  kind: 'output'
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
  output_path: string
}
type HermesSessionRunRef = {
  kind: 'session'
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
}
type HermesMergedRunRef = {
  id: string
  job_id: string
  run_at: string | null
  run_key: string | null
  output: HermesOutputRunRef | null
  session: HermesSessionRunRef | null
}
type HermesRunCountCacheEntry = {
  promise: Promise<number>
  expiresAt: number
}

const HERMES_RUN_COUNT_CACHE_TTL_MS = 2000

export class ExternalAutomationsHandler {
  protected readonly hermesRunCountCache = new Map<string, HermesRunCountCacheEntry>()

  constructor(protected readonly dispatcher: RelayDispatcher) {
    this.dispatcher.onRequest('externalAutomations.list', (params) => this.listJobs(params))
    this.dispatcher.onRequest('externalAutomations.runs', (params) => this.listRuns(params))
    this.dispatcher.onRequest('externalAutomations.create', (params) => this.createJob(params))
    this.dispatcher.onRequest('externalAutomations.update', (params) => this.updateJob(params))
    this.dispatcher.onRequest('externalAutomations.act', (params) => this.runAction(params))
  }

}
