import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HERMES_HOME = process.env.HERMES_HOME?.trim() || join(homedir(), '.hermes')
const HERMES_CRON_DIR = join(HERMES_HOME, 'cron')
const HERMES_JOBS_FILE = join(HERMES_CRON_DIR, 'jobs.json')
const OPENCLAW_JOBS_FILE = join(homedir(), '.openclaw', 'cron', 'jobs.json')
const HERMES_OUTPUT_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/
const HERMES_RUN_KEY_PATTERN = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
const MAX_SESSION_OUTPUT_GAP_MS = 24 * 60 * 60 * 1000
const MAX_REFERENCED_LOG_BYTES = 5 * 1024 * 1024
const FULL_SESSION_LOG_HEADING = '## Full session log'
const REFERENCED_LOG_HEADING = '## Latest log file'
const LATEST_LOG_PATH_PATTERN =
  /\bLatest log path:\s*(?<path>(?:[A-Za-z]:[\\/]|\/)[^\r\n]*?)(?=\s+Run summary:|\r?\n|$)/i
type ExternalProvider = 'hermes' | 'openclaw'
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
import { ExternalAutomationsHandler } from './external-automations-stage-state'
export class ExternalAutomationsHandlerStage1 extends ExternalAutomationsHandler {
  protected async isCommandAvailable(command: string): Promise<boolean> {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    try {
      await execFileAsync(finder, [command], {
        encoding: 'utf-8',
        timeout: 5000
      })
      return true
    } catch {
      return false
    }
  }

  protected async readJobs(provider: ExternalProvider): Promise<unknown[]> {
    const jobsFile = provider === 'hermes' ? HERMES_JOBS_FILE : OPENCLAW_JOBS_FILE
    if (!existsSync(jobsFile)) {
      return []
    }
    const content = await readFile(jobsFile, 'utf-8')
    const parsed = JSON.parse(content) as unknown
    const jobs = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          Array.isArray((parsed as { jobs?: unknown }).jobs)
        ? (parsed as { jobs: unknown[] }).jobs
        : []
    if (provider !== 'hermes') {
      return jobs
    }
    return Promise.all(
      jobs.map(async (job) => {
        if (!this.isRecord(job) || typeof job.id !== 'string') {
          return job
        }
        const runsPage = await this.listRuns({
          provider: 'hermes',
          jobId: job.id,
          page: 1,
          pageSize: 0
        })
        return {
          ...job,
          run_count: runsPage.total,
          runs: runsPage.runs
        }
      })
    )
  }

  protected isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  protected runAtFromHermesOutputFile(filename: string): string | null {
    const match = HERMES_OUTPUT_FILE_PATTERN.exec(filename)
    if (!match) {
      return null
    }
    const [, year, month, day, hour, minute, second] = match
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`
  }

  protected runKeyFromHermesOutputFile(filename: string): string | null {
    const match = HERMES_OUTPUT_FILE_PATTERN.exec(filename)
    if (!match) {
      return null
    }
    const [, year, month, day, hour, minute, second] = match
    return `${year}${month}${day}_${hour}${minute}${second}`
  }

  protected runAtFromUnixSeconds(value: unknown): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null
    }
    const date = new Date(value * 1000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  protected sortableTimeFromRunKey(runKey: string | null): number {
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

  protected escapeSqlLike(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
  }

  protected cleanRunPreview(value: string): string | null {
    const normalized = value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_`>()]/g, ' ')
      .replaceAll('[', ' ')
      .replaceAll(']', ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!normalized) {
      return null
    }
    return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
  }

  protected parseHermesOutput(content: string): {
    status: 'completed' | 'failed' | 'unknown'
    outputPreview: string | null
    outputContent: string
    error: string | null
  } {
    const failed = /^#\s+Cron Job:.*\(FAILED\)/m.test(content) || /^##\s+Error\b/m.test(content)
    const errorMatch = /##\s+Error\s+```([\s\S]*?)```/m.exec(content)
    const responseMatch = /##\s+Response\s+([\s\S]*)$/m.exec(content)
    const error = errorMatch ? this.cleanRunPreview(errorMatch[1]) : null
    return {
      status: failed ? 'failed' : responseMatch ? 'completed' : 'unknown',
      outputPreview: this.cleanRunPreview(responseMatch?.[1] ?? errorMatch?.[1] ?? content),
      outputContent: content,
      error
    }
  }

  protected extractLatestLogPath(content: string): string | null {
    const rawPath = LATEST_LOG_PATH_PATTERN.exec(content)?.groups?.path?.trim()
    if (!rawPath) {
      return null
    }
    return rawPath.replace(/^`|`$/g, '').trim()
  }

  protected async readReferencedLogFile(content: string): Promise<{
    path: string
    content: string
    truncated: boolean
  } | null> {
    const logPath = this.extractLatestLogPath(content)
    if (!logPath || !isAbsolute(logPath)) {
      return null
    }
    try {
      const homeRealPath = await realpath(HERMES_HOME)
      const logRealPath = await realpath(logPath)
      const relativeToHermesHome = relative(resolve(homeRealPath), resolve(logRealPath))
      // Why: the output body can contain agent-authored text, so only hydrate
      // referenced files that resolve inside Hermes' own data directory.
      if (
        relativeToHermesHome === '..' ||
        relativeToHermesHome.startsWith(`..${sep}`) ||
        isAbsolute(relativeToHermesHome)
      ) {
        return null
      }
      const logStat = await stat(logPath)
      if (!logStat.isFile()) {
        return null
      }
      if (logStat.size <= MAX_REFERENCED_LOG_BYTES) {
        return {
          path: logPath,
          content: await readFile(logPath, 'utf-8'),
          truncated: false
        }
      }
      const file = await open(logPath, 'r')
      try {
        const buffer = Buffer.alloc(MAX_REFERENCED_LOG_BYTES)
        await file.read(
          buffer,
          0,
          MAX_REFERENCED_LOG_BYTES,
          logStat.size - MAX_REFERENCED_LOG_BYTES
        )
        return {
          path: logPath,
          content: buffer.toString('utf-8'),
          truncated: true
        }
      } finally {
        await file.close()
      }
    } catch {
      return null
    }
  }

  protected async appendReferencedLogFile(content: string): Promise<string> {
    if (content.includes(REFERENCED_LOG_HEADING)) {
      return content
    }
    const logFile = await this.readReferencedLogFile(content)
    if (!logFile) {
      return content
    }
    const note = logFile.truncated
      ? `Showing the last ${MAX_REFERENCED_LOG_BYTES} bytes because the log file is larger.`
      : null
    return [
      content,
      '---',
      REFERENCED_LOG_HEADING,
      '',
      `Path: ${logFile.path}`,
      note,
      '```text',
      logFile.content.trimEnd(),
      '```'
    ]
      .filter((part) => part !== null)
      .join('\n\n')
  }

  protected formatSessionMessages(messages: Record<string, unknown>[]): string | null {
    if (messages.length === 0) {
      return null
    }
    return messages
      .map((message) => {
        const role = typeof message.role === 'string' ? message.role : 'message'
        const content = typeof message.content === 'string' ? message.content.trim() : ''
        const toolName = typeof message.tool_name === 'string' ? message.tool_name.trim() : ''
        const reasoning =
          typeof message.reasoning_content === 'string'
            ? message.reasoning_content.trim()
            : typeof message.reasoning === 'string'
              ? message.reasoning.trim()
              : ''
        const parts = [
          `## ${role}${toolName ? ` / ${toolName}` : ''}`,
          reasoning ? `### Reasoning\n\n${reasoning}` : null,
          content || '(empty)'
        ].filter(Boolean)
        return parts.join('\n\n')
      })
      .join('\n\n---\n\n')
  }

  protected getRunKey(run: unknown): string | null {
    return this.isRecord(run) && typeof run.run_key === 'string' && run.run_key.trim()
      ? run.run_key
      : null
  }

  protected getRunOutputContent(run: unknown): string | null {
    return this.isRecord(run) && typeof run.output_content === 'string' && run.output_content.trim()
      ? run.output_content
      : null
  }

  protected getRunOutputPreview(run: unknown): string | null {
    return this.isRecord(run) && typeof run.output_preview === 'string' && run.output_preview.trim()
      ? run.output_preview
      : null
  }

  protected mergeOutputAndSessionContent(
    outputContent: string | null,
    sessionContent: string | null
  ): string | null {
    if (!sessionContent) {
      return outputContent
    }
    if (!outputContent) {
      return `${FULL_SESSION_LOG_HEADING}\n\n${sessionContent}`
    }
    if (outputContent.includes(FULL_SESSION_LOG_HEADING)) {
      return outputContent
    }
    return `${outputContent}\n\n---\n\n${FULL_SESSION_LOG_HEADING}\n\n${sessionContent}`
  }

  protected findMatchingSessionRunIndex(
    outputRun: unknown,
    sessionRuns: unknown[],
    usedSessionRunIndexes: Set<number>
  ): number | null {
    const outputRunKey = this.getRunKey(outputRun)
    const exactMatchIndex = sessionRuns.findIndex(
      (sessionRun, index) =>
        !usedSessionRunIndexes.has(index) && this.getRunKey(sessionRun) === outputRunKey
    )
    if (exactMatchIndex >= 0) {
      return exactMatchIndex
    }

    const outputTime = this.sortableTimeFromRunKey(outputRunKey)
    if (!Number.isFinite(outputTime)) {
      return null
    }

    let bestIndex: number | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (let index = 0; index < sessionRuns.length; index += 1) {
      if (usedSessionRunIndexes.has(index)) {
        continue
      }
      const sessionTime = this.sortableTimeFromRunKey(this.getRunKey(sessionRuns[index]))
      if (!Number.isFinite(sessionTime)) {
        continue
      }
      const gap = outputTime - sessionTime
      if (gap < 0 || gap > MAX_SESSION_OUTPUT_GAP_MS || gap >= bestGap) {
        continue
      }
      bestIndex = index
      bestGap = gap
    }
    return bestIndex
  }

  protected mergeHermesOutputAndSessionRuns(
    outputRuns: unknown[],
    sessionRuns: unknown[]
  ): unknown[] {
    const usedSessionRunIndexes = new Set<number>()
    const mergedOutputRuns = outputRuns.map((outputRun) => {
      if (!this.isRecord(outputRun)) {
        return outputRun
      }
      const sessionRunIndex = this.findMatchingSessionRunIndex(
        outputRun,
        sessionRuns,
        usedSessionRunIndexes
      )
      if (sessionRunIndex === null) {
        return outputRun
      }
      const sessionRun = sessionRuns[sessionRunIndex]
      if (!this.isRecord(sessionRun)) {
        return outputRun
      }
      usedSessionRunIndexes.add(sessionRunIndex)
      // Hermes writes the markdown output at completion, while state.db keeps
      // the actual turn-by-turn transcript under the cron session start time.
      return {
        ...outputRun,
        output_preview: this.getRunOutputPreview(outputRun) ?? this.getRunOutputPreview(sessionRun),
        output_content: this.mergeOutputAndSessionContent(
          this.getRunOutputContent(outputRun),
          this.getRunOutputContent(sessionRun)
        )
      }
    })
    return [
      ...mergedOutputRuns,
      ...sessionRuns.filter((_, index) => !usedSessionRunIndexes.has(index))
    ]
  }

  protected mergeHermesOutputAndSessionRunRefs(
    outputRefs: HermesOutputRunRef[],
    sessionRefs: HermesSessionRunRef[]
  ): HermesMergedRunRef[] {
    const usedSessionRunIndexes = new Set<number>()
    const mergedOutputRefs = outputRefs.map((outputRef) => {
      const sessionRunIndex = this.findMatchingSessionRunIndex(
        outputRef,
        sessionRefs,
        usedSessionRunIndexes
      )
      const sessionRef = sessionRunIndex === null ? null : sessionRefs[sessionRunIndex]
      if (sessionRunIndex !== null) {
        usedSessionRunIndexes.add(sessionRunIndex)
      }
      return {
        id: outputRef.id,
        job_id: outputRef.job_id,
        run_at: outputRef.run_at,
        run_key: outputRef.run_key,
        output: outputRef,
        session: sessionRef
      }
    })
    return [
      ...mergedOutputRefs,
      ...sessionRefs
        .filter((_, index) => !usedSessionRunIndexes.has(index))
        .map((sessionRef) => ({
          id: sessionRef.id,
          job_id: sessionRef.job_id,
          run_at: sessionRef.run_at,
          run_key: sessionRef.run_key,
          output: null,
          session: sessionRef
        }))
    ]
  }

}
