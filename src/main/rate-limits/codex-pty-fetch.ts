import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import type { FetchCodexRateLimitsOptions } from './codex-fetcher'
import { extractClaudePtyResetMetadata } from './claude-pty-reset-parser'
import { resolveCodexCommand } from '../codex-cli/command'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'
import { getCmdExePath } from '../win32-utils'
import { extractCodexAuthError } from '../../shared/codex-auth-errors'
import { cleanupHiddenRateLimitPty, registerHiddenRateLimitPty } from './hidden-pty-cleanup'
import { resolveHiddenRateLimitPtyCwd } from './hidden-rate-limit-pty-cwd'

const PTY_TIMEOUT_MS = 15_000
const PTY_STATUS_NUDGE_MS = 2_500
const PTY_STATUS_ENTER_DELAY_MS = 350
const PTY_STATUS_ENTER_RETRY_MS = 3_000
const MAX_DIAGNOSTIC_OUTPUT_LENGTH = 100_000

function abortedCodexRateLimitResult(): ProviderRateLimits {
  return { provider: 'codex', session: null, weekly: null, updatedAt: Date.now(), error: 'Rate-limit fetch aborted', status: 'error' }
}

const FIVE_HOUR_RE = /(?<![\w-][^\S\r\n]{0,4})5h\s+limit[^\d%\r\n]*(\d+)%(?:\s*(used|left))?/i
const WEEKLY_RE = /(?<![\w-][^\S\r\n]{0,4})weekly\s+limit[^\d%\r\n]*(\d+)%(?:\s*(used|left))?/i
// Why: model-scoped limit rows must still stop a per-window reset-text scan.
const ANY_LIMIT_LABEL_RE = /(?:5h|weekly)\s+limit/i

// eslint-disable-next-line no-control-regex
const PTY_CONTROL_SEQUENCE_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

function stripPtyControlSequences(output: string): string {
  return output.replace(PTY_CONTROL_SEQUENCE_RE, '')
}

function isPtyLimitLabel(line: string): boolean {
  return ANY_LIMIT_LABEL_RE.test(line)
}

function ptyUsedPercent(match: RegExpExecArray): number {
  const pct = Number.parseInt(match[1], 10)
  const oriented = match[2]?.toLowerCase() === 'left' ? 100 - pct : pct
  return Math.min(100, Math.max(0, oriented))
}

function parsePtyStatus(output: string): {
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
} {
  const fiveMatch = FIVE_HOUR_RE.exec(output)
  const weeklyMatch = WEEKLY_RE.exec(output)
  const lines = output.split(/\r\n|\n|\r/)
  // Why: each limit line owns the reset text that follows it (weekly-only plans
  // have no 5h line), and parsing it into resetsAt is what the UI renders.
  const sessionReset = extractClaudePtyResetMetadata(
    lines,
    (line) => FIVE_HOUR_RE.test(line),
    isPtyLimitLabel
  )
  const weeklyReset = extractClaudePtyResetMetadata(
    lines,
    (line) => WEEKLY_RE.test(line),
    isPtyLimitLabel
  )

  const session: RateLimitWindow | null = fiveMatch
    ? {
        usedPercent: ptyUsedPercent(fiveMatch),
        windowMinutes: 300,
        resetsAt: sessionReset.resetsAt,
        resetDescription: sessionReset.resetDescription
      }
    : null

  const weekly: RateLimitWindow | null = weeklyMatch
    ? {
        usedPercent: ptyUsedPercent(weeklyMatch),
        windowMinutes: 10080,
        resetsAt: weeklyReset.resetsAt,
        resetDescription: weeklyReset.resetDescription
      }
    : null

  return { session, weekly }
}

export async function fetchCodexRateLimitsViaPty(
  options: FetchCodexRateLimitsOptions | undefined,
  deps: {
    buildWslCodexCommand: (codexHomePath: string, args: string[]) => { command: string; args: string[] } | null
    cloneProcessEnvWithoutCodexHome: () => NodeJS.ProcessEnv
  }
): Promise<ProviderRateLimits> {
  if (options?.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  const pty = await import('node-pty')
  if (options?.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  const wslCodex = options?.codexHomePath ? deps.buildWslCodexCommand(options.codexHomePath, []) : null
  const codexCommand = wslCodex ? 'codex' : resolveCodexCommand()

  // Why: on win32 route through cmd.exe (even bare 'codex') so PATHEXT resolves codex.cmd under a minimal Electron PATH.
  const isWin32 = process.platform === 'win32'
  const spawnFile = wslCodex ? wslCodex.command : isWin32 ? getCmdExePath() : codexCommand
  const spawnArgs = wslCodex ? wslCodex.args : isWin32 ? ['/d', '/c', codexCommand] : []

  return new Promise<ProviderRateLimits>((resolve) => {
    let output = ''
    let resolved = false
    let sentStatus = false
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null

    const term = pty.spawn(spawnFile, spawnArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: resolveHiddenRateLimitPtyCwd(),
      env: {
        ...(wslCodex ? deps.cloneProcessEnvWithoutCodexHome() : process.env),
        TERM: 'xterm-256color',
        ...(options?.codexHomePath && !wslCodex ? { CODEX_HOME: options.codexHomePath } : {})
      }
    })
    const termDisposables: { dispose: () => void }[] = [registerHiddenRateLimitPty(term)]

    let statusEnter: ReturnType<typeof setTimeout> | null = null
    function sendStatusCommand(): void {
      sentStatus = true
      if (statusNudge) {
        clearTimeout(statusNudge)
        statusNudge = null
      }
      term.write('/status')
      statusEnter = setTimeout(() => {
        statusEnter = null
        term.write('\r')
        statusEnter = setTimeout(() => {
          statusEnter = null
          if (!resolved && !settleTimer) {
            term.write('\r')
          }
        }, PTY_STATUS_ENTER_RETRY_MS)
      }, PTY_STATUS_ENTER_DELAY_MS)
    }

    let statusNudge: ReturnType<typeof setTimeout> | null = null
    // Why: count the nudge grace from first TUI output, not spawn, so slow
    // WSL/SSH boots get the full window before /status is typed.
    function armStatusNudge(): void {
      if (statusNudge || sentStatus || resolved) {
        return
      }
      statusNudge = setTimeout(() => {
        statusNudge = null
        if (!resolved && !sentStatus) {
          sendStatusCommand()
        }
      }, PTY_STATUS_NUDGE_MS)
    }
    termDisposables.push({
      dispose: () => {
        if (statusNudge) {
          clearTimeout(statusNudge)
          statusNudge = null
        }
        if (statusEnter) {
          clearTimeout(statusEnter)
          statusEnter = null
        }
      }
    })

    function settleAborted(): void {
      if (resolved) {
        return
      }
      resolved = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      cleanupHiddenRateLimitPty(term, termDisposables, { kill: true })
      resolve(abortedCodexRateLimitResult())
    }

    if (options?.signal) {
      if (options.signal.aborted) {
        settleAborted()
        return
      }
      options.signal.addEventListener('abort', settleAborted, { once: true })
      termDisposables.push({
        dispose: () => options.signal?.removeEventListener('abort', settleAborted)
      })
    }

    timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        if (settleTimer) {
          clearTimeout(settleTimer)
          settleTimer = null
        }
        cleanupHiddenRateLimitPty(term, termDisposables, { kill: true })
        resolve({
          provider: 'codex',
          session: null,
          weekly: null,
          updatedAt: Date.now(),
          error: extractCodexAuthError(output) ?? withMacTailscaleDnsHint('PTY timeout', output),
          status: 'error'
        })
      }
    }, PTY_TIMEOUT_MS)

    const onDataDisposable = term.onData((data) => {
      output += data
      // Why: only recent status output is needed; cap noisy TUI output like the Claude fallback.
      if (output.length > MAX_DIAGNOSTIC_OUTPUT_LENGTH) {
        output = output.slice(-MAX_DIAGNOSTIC_OUTPUT_LENGTH)
      }

      armStatusNudge()

      // Wait for prompt, then send /status
      if (!sentStatus && /[>›]\s*$/.test(data)) {
        sendStatusCommand()
        return
      }

      // Check if we have parseable output
      // Why: colored meter bars embed digits inside CSI sequences, so probe cleaned text.
      const probe = sentStatus && !settleTimer ? stripPtyControlSequences(output) : null
      if (probe !== null && (FIVE_HOUR_RE.test(probe) || WEEKLY_RE.test(probe))) {
        // Why: the TUI keeps streaming after status is parseable; one settle timer lets the panel finish flushing.
        settleTimer = setTimeout(() => {
          settleTimer = null
          if (resolved) {
            return
          }
          resolved = true
          if (timeout) {
            clearTimeout(timeout)
            timeout = null
          }
          cleanupHiddenRateLimitPty(term, termDisposables, { kill: true })

          const clean = stripPtyControlSequences(output)
          const { session, weekly } = parsePtyStatus(clean)

          resolve({
            provider: 'codex',
            session,
            weekly,
            updatedAt: Date.now(),
            error:
              session || weekly
                ? null
                : withMacTailscaleDnsHint('Failed to parse CLI output', clean),
            status: session || weekly ? 'ok' : 'error'
          })
        }, 500)
      }
    })
    if (onDataDisposable) {
      termDisposables.push(onDataDisposable)
    }

    const onExitDisposable = term.onExit(() => {
      cleanupHiddenRateLimitPty(term, termDisposables, { kill: false })
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      if (!resolved) {
        resolved = true
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        const clean = stripPtyControlSequences(output)
        const { session, weekly } = parsePtyStatus(clean)
        resolve({
          provider: 'codex',
          session,
          weekly,
          updatedAt: Date.now(),
          error:
            session || weekly
              ? null
              : (extractCodexAuthError(clean) ??
                withMacTailscaleDnsHint('CLI exited before status was available', clean)),
          status: session || weekly ? 'ok' : 'error'
        })
      }
    })
    if (onExitDisposable) {
      termDisposables.push(onExitDisposable)
    }
  })
}

// ---------------------------------------------------------------------------

