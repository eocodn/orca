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

import { ExternalAutomationsHandlerStage1 } from './external-automations-stage-1'
export class ExternalAutomationsHandlerStage2 extends ExternalAutomationsHandlerStage1 {
  protected getDatabaseConstructor(): DatabaseConstructor | null {
    if (databaseConstructor !== undefined) {
      return databaseConstructor
    }
    try {
      // Why: the remote relay still targets Node 18. Hosts without node:sqlite
      // should keep listing file-backed runs and simply omit DB transcripts.
      const loaded = requireOptional('node:sqlite') as {
        DatabaseSync?: NodeSqliteDatabaseSync
      }
      const DatabaseSync = loaded.DatabaseSync
      if (typeof DatabaseSync !== 'function') {
        databaseConstructor = null
        return databaseConstructor
      }
      const SqliteDatabaseSync = DatabaseSync
      databaseConstructor = class RelaySqliteDatabase {
        protected readonly db: SqliteDatabase

        constructor(
          path: string,
          options: { readonly?: boolean; fileMustExist?: boolean; timeout?: number } = {}
        ) {
          if (options.fileMustExist && !existsSync(path)) {
            throw new Error(`SQLite database does not exist: ${path}`)
          }
          this.db = new SqliteDatabaseSync(path, {
            readOnly: options.readonly,
            timeout: options.timeout
          })
        }

        prepare(sql: string): SqliteStatement {
          return this.db.prepare(sql)
        }

        close(): void {
          this.db.close()
        }
      }
    } catch {
      databaseConstructor = null
    }
    return databaseConstructor
  }

  protected async readHermesRunRefs(jobId: string): Promise<HermesMergedRunRef[]> {
    const outputRuns = await this.readHermesOutputFileRunRefs(jobId)
    return this.mergeHermesOutputAndSessionRunRefs(
      outputRuns,
      this.readHermesSessionDbRunRefs(jobId)
    ).sort((a, b) => {
      const aTime = this.getRawRunTime(a)
      const bTime = this.getRawRunTime(b)
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return bTime - aTime
      }
      return this.getRawRunId(b).localeCompare(this.getRawRunId(a))
    })
  }

  protected async hydrateHermesRunRef(jobId: string, ref: HermesMergedRunRef): Promise<unknown> {
    const outputRun = ref.output ? await this.readHermesOutputFileRun(ref.output) : null
    const sessionRun = ref.session ? this.readHermesSessionDbRunById(jobId, ref.session.id) : null
    return (
      this.mergeHermesOutputAndSessionRuns(
        outputRun ? [outputRun] : [],
        sessionRun ? [sessionRun] : []
      )[0] ??
      outputRun ??
      sessionRun ??
      ref
    )
  }

  protected async readHermesRunCount(jobId: string): Promise<number> {
    if (!EXTERNAL_JOB_ID_PATTERN.test(jobId)) {
      return 0
    }
    const now = Date.now()
    const cached = this.hermesRunCountCache.get(jobId)
    if (cached && cached.expiresAt > now) {
      return cached.promise
    }
    if (cached) {
      this.hermesRunCountCache.delete(jobId)
    }
    // Why: remote Hermes jobs can churn independently of Orca; relay
    // processes are long-lived, so stale job ids need both TTL and a hard cap.
    this.pruneHermesRunCountCache(now)
    const entry: HermesRunCountCacheEntry = {
      promise: this.readHermesRunRefs(jobId).then((refs) => refs.length),
      expiresAt: Number.POSITIVE_INFINITY
    }
    this.hermesRunCountCache.set(jobId, entry)
    try {
      const count = await entry.promise
      entry.expiresAt = Date.now() + HERMES_RUN_COUNT_CACHE_TTL_MS
      return count
    } catch (error) {
      if (this.hermesRunCountCache.get(jobId) === entry) {
        this.hermesRunCountCache.delete(jobId)
      }
      throw error
    }
  }

  protected pruneHermesRunCountCache(now: number): void {
    for (const [jobId, entry] of this.hermesRunCountCache) {
      if (entry.expiresAt <= now) {
        this.hermesRunCountCache.delete(jobId)
      }
    }
    while (this.hermesRunCountCache.size >= HERMES_RUN_COUNT_CACHE_MAX_ENTRIES) {
      const oldestJobId = this.hermesRunCountCache.keys().next().value
      if (oldestJobId === undefined) {
        return
      }
      this.hermesRunCountCache.delete(oldestJobId)
    }
  }

  protected clearHermesRunCountCache(jobId?: string): void {
    if (jobId) {
      this.hermesRunCountCache.delete(jobId)
      return
    }
    this.hermesRunCountCache.clear()
  }

  protected async listRuns(params: Record<string, unknown> = {}): Promise<{
    total: number
    runs: unknown[]
  }> {
    const provider = params.provider === 'openclaw' ? 'openclaw' : 'hermes'
    const jobId = params.jobId
    const page =
      typeof params.page === 'number' && Number.isFinite(params.page)
        ? Math.max(1, Math.floor(params.page))
        : 1
    const pageSize =
      typeof params.pageSize === 'number' && Number.isFinite(params.pageSize)
        ? Math.min(100, Math.max(0, Math.floor(params.pageSize)))
        : 25
    if (provider !== 'hermes') {
      return { total: 0, runs: [] }
    }
    if (typeof jobId !== 'string' || !EXTERNAL_JOB_ID_PATTERN.test(jobId)) {
      throw new Error('Invalid external automation job ID.')
    }
    if (pageSize === 0) {
      // Why: manager listing only needs a badge count; hydrating markdown logs
      // and full session transcripts can make opening Automations very slow.
      return { total: await this.readHermesRunCount(jobId), runs: [] }
    }
    const runRefs = await this.readHermesRunRefs(jobId)
    const start = (page - 1) * pageSize
    return {
      total: runRefs.length,
      runs: await Promise.all(
        runRefs.slice(start, start + pageSize).map((ref) => this.hydrateHermesRunRef(jobId, ref))
      )
    }
  }

  protected getRawRunId(run: unknown): string {
    if (this.isRecord(run) && 'id' in run) {
      return String(run.id)
    }
    return ''
  }

  protected getRawRunTime(run: unknown): number {
    if (!this.isRecord(run) || !('run_at' in run)) {
      return Number.NaN
    }
    return typeof run.run_at === 'string' ? Date.parse(run.run_at) : Number.NaN
  }

  protected async readHermesOutputFileRunRefs(jobId: string): Promise<HermesOutputRunRef[]> {
    const outputDir = join(HERMES_OUTPUT_DIR, jobId)
    if (!existsSync(outputDir)) {
      return []
    }
    const entries = await readdir(outputDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && HERMES_OUTPUT_FILE_PATTERN.test(entry.name))
      .map((entry) => ({
        kind: 'output' as const,
        id: `${jobId}:${entry.name}`,
        job_id: jobId,
        run_at: this.runAtFromHermesOutputFile(entry.name),
        run_key: this.runKeyFromHermesOutputFile(entry.name),
        output_path: join(outputDir, entry.name)
      }))
  }

  protected async readHermesOutputFileRun(ref: HermesOutputRunRef): Promise<unknown> {
    try {
      const content = await readFile(ref.output_path, 'utf-8')
      const parsed = this.parseHermesOutput(content)
      const outputContent = await this.appendReferencedLogFile(parsed.outputContent)
      return {
        id: ref.id,
        job_id: ref.job_id,
        run_at: ref.run_at,
        run_key: ref.run_key,
        status: parsed.status,
        output_preview: parsed.outputPreview,
        output_content: outputContent,
        error: parsed.error,
        output_path: ref.output_path
      }
    } catch (error) {
      return {
        id: ref.id,
        job_id: ref.job_id,
        run_at: ref.run_at,
        run_key: ref.run_key,
        status: 'unknown',
        output_preview: null,
        output_content: null,
        error: error instanceof Error ? error.message : String(error),
        output_path: ref.output_path
      }
    }
  }

  protected readHermesSessionDbRunRefs(jobId: string): HermesSessionRunRef[] {
    if (!existsSync(HERMES_STATE_DB)) {
      return []
    }
    const Database = this.getDatabaseConstructor()
    if (!Database) {
      return []
    }
    try {
      const db = new Database(HERMES_STATE_DB, { readonly: true, fileMustExist: true })
      try {
        const pattern = `cron\\_${this.escapeSqlLike(jobId)}\\_%`
        const rows = db
          .prepare(
            `SELECT id, started_at
               FROM sessions
              WHERE id LIKE ? ESCAPE '\\'
              ORDER BY started_at DESC`
          )
          .all(pattern) as Record<string, unknown>[]
        return rows.map((row) => {
          const runId = typeof row.id === 'string' ? row.id : `${jobId}:${String(row.started_at)}`
          return {
            kind: 'session',
            id: runId,
            job_id: jobId,
            run_at: this.runAtFromUnixSeconds(row.started_at),
            run_key: runId.split(`${jobId}_`).at(-1) ?? null
          }
        })
      } finally {
        db.close()
      }
    } catch {
      return []
    }
  }

  protected readHermesSessionDbRunById(jobId: string, runId: string): unknown | null {
    if (!existsSync(HERMES_STATE_DB)) {
      return null
    }
    const Database = this.getDatabaseConstructor()
    if (!Database) {
      return null
    }
    try {
      const db = new Database(HERMES_STATE_DB, { readonly: true, fileMustExist: true })
      try {
        const row = db
          .prepare(
            `SELECT id, title, started_at, ended_at, end_reason, model, message_count,
                    input_tokens, output_tokens, estimated_cost_usd
               FROM sessions
              WHERE id = ?`
          )
          .get(runId) as Record<string, unknown> | undefined
        if (!row) {
          return null
        }
        const messages = db
          .prepare(
            `SELECT role, content, tool_name, reasoning, reasoning_content
                 FROM messages
                WHERE session_id = ?
                ORDER BY timestamp, id`
          )
          .all(runId) as Record<string, unknown>[]
        const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null
        const model = typeof row.model === 'string' && row.model.trim() ? row.model.trim() : null
        const messageCount = typeof row.message_count === 'number' ? row.message_count : null
        const tokenCount =
          (typeof row.input_tokens === 'number' ? row.input_tokens : 0) +
          (typeof row.output_tokens === 'number' ? row.output_tokens : 0)
        const summaryParts = [
          title,
          model ? `Model: ${model}` : null,
          messageCount !== null ? `${messageCount} messages` : null,
          tokenCount > 0 ? `${tokenCount} tokens` : null
        ].filter(Boolean)
        return {
          id: runId,
          job_id: jobId,
          run_at: this.runAtFromUnixSeconds(row.started_at),
          run_key: runId.split(`${jobId}_`).at(-1) ?? null,
          status: typeof row.ended_at === 'number' ? 'completed' : 'unknown',
          output_preview: summaryParts.join(' · ') || null,
          output_content: this.formatSessionMessages(messages),
          error: null,
          output_path: HERMES_STATE_DB
        }
      } finally {
        db.close()
      }
    } catch {
      return null
    }
  }

  protected async listJobs(params?: Record<string, unknown>): Promise<{
    jobs: unknown[]
    hermesAvailable: boolean
    openclawAvailable: boolean
    error: string | null
  }> {
    const provider = params?.provider === 'openclaw' ? 'openclaw' : 'hermes'
    const [commandAvailable, jobsResult] = await Promise.allSettled([
      this.isCommandAvailable(provider),
      this.readJobs(provider)
    ])
    const jobs = jobsResult.status === 'fulfilled' ? jobsResult.value : []
    const available = commandAvailable.status === 'fulfilled' && commandAvailable.value
    return {
      jobs,
      hermesAvailable: provider === 'hermes' && available,
      openclawAvailable: provider === 'openclaw' && available,
      error: jobsResult.status === 'rejected' ? String(jobsResult.reason) : null
    }
  }

  protected hermesCommand(action: HermesAction): string {
    switch (action) {
      case 'pause':
        return 'pause'
      case 'resume':
        return 'resume'
      case 'run':
        return 'run'
      case 'delete':
        return 'remove'
    }
  }

  protected openClawCommand(action: HermesAction): string {
    switch (action) {
      case 'pause':
        return 'disable'
      case 'resume':
        return 'enable'
      case 'run':
        return 'run'
      case 'delete':
        return 'rm'
    }
  }

  protected normalizeHermesJobMutation(params: Record<string, unknown>): {
    name: string
    prompt: string
    schedule: string
    workdir: string
  } {
    const provider = params.provider === 'openclaw' ? 'openclaw' : 'hermes'
    if (provider !== 'hermes') {
      throw new Error('Only Hermes cron creation and editing are supported.')
    }
    const name = typeof params.name === 'string' ? params.name.trim() : ''
    const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : ''
    const schedule = typeof params.schedule === 'string' ? params.schedule.trim() : ''
    const workdir = typeof params.workdir === 'string' ? params.workdir.trim() : ''
    if (!prompt) {
      throw new Error('Hermes cron requires a prompt.')
    }
    if (!schedule) {
      throw new Error('Hermes cron requires a schedule.')
    }
    return {
      name: name || prompt.slice(0, 50).trim(),
      prompt,
      schedule,
      workdir
    }
  }

  protected async runHermesCronCommand(args: string[]): Promise<void> {
    await execFileAsync('hermes', args, {
      encoding: 'utf-8',
      timeout: 30_000
    })
  }

}
