import { spawn } from 'node:child_process'
import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import {
  classifyCodexRateLimitWindows,
  CODEX_SESSION_WINDOW_MINUTES,
  CODEX_WEEKLY_WINDOW_MINUTES,
  type CodexRateLimitWindowsSnapshot,
  type CodexRateWindowSnapshot
} from './codex-rate-limit-window-classification'
import type { FetchCodexRateLimitsOptions } from './codex-fetcher'
import { resolveCodexCommand } from '../codex-cli/command'
import { getCmdExePath, getSpawnArgsForWindows } from '../win32-utils'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  buildWslLoginShellCommand,
  escapeWslShCommandForWindows
} from '../../shared/wsl-login-shell-command'
import {
  getHiddenRateLimitWslCwdSetupCommands,
  resolveHiddenRateLimitPtyCwd
} from './hidden-rate-limit-pty-cwd'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'

const RPC_TIMEOUT_MS = 10_000
const WSL_RPC_TIMEOUT_MS = 25_000
const MAX_DIAGNOSTIC_OUTPUT_LENGTH = 100_000

type RpcResponse = {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

type RateLimitResetCredits = {
  availableCount: number
  totalEarnedCount?: number
  nextExpiresAt?: number | null
  credits?: { status: string; expiresAt: number | null; grantedAt: number | null }[]
}

type RpcRateLimitsResponse = {
  rateLimits?: CodexRateLimitWindowsSnapshot | null
  rateLimitResetCredits?: {
    availableCount?: number
    totalEarnedCount?: number
    nextExpiresAt?: number | null
    credits?: {
      status?: string
      expiresAt?: number | string | null
      grantedAt?: number | string | null
    }[]
  } | null
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function buildWslCodexCommand(
  codexHomePath: string,
  options?: { isolateRpcStdio?: boolean }
): { command: string; args: string[] } | null {
  const wslInfo = parseWslUncPath(codexHomePath)
  if (process.platform !== 'win32' || !wslInfo) {
    return null
  }
  const setupCommands = [
    ...getHiddenRateLimitWslCwdSetupCommands(),
    `export CODEX_HOME=${shellQuote(wslInfo.linuxPath)}`
  ].join(' && ')
  const execSuffix = `codex -s read-only -a untrusted app-server${
    options?.isolateRpcStdio ? ' <&3 >&4 3<&- 4>&-' : ''
  }`
  const loginShellCommand = buildWslLoginShellCommand(
    [setupCommands, `exec ${execSuffix}`].join(' && ')
  )
  const command = options?.isolateRpcStdio
    ? ['exec 3<&0', 'exec 4>&1', 'exec </dev/null', 'exec >/dev/null', loginShellCommand].join('\n')
    : loginShellCommand
  return {
    command: 'wsl.exe',
    args: ['-d', wslInfo.distro, '--', 'sh', '-c', escapeWslShCommandForWindows(command)]
  }
}

function cloneProcessEnvWithoutCodexHome(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CODEX_HOME
  return env
}

function buildRpcMessage(id: number, method: string, params?: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`
}

function abortedCodexRateLimitResult(): ProviderRateLimits {
  return {
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Rate-limit fetch aborted',
    status: 'error'
  }
}

function parseCreditTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }
  const numeric = Number(value.trim())
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeCreditStatus(status: string | undefined): string {
  return status?.toLowerCase() ?? 'unknown'
}

function getNextAvailableCreditExpiry(
  credits: RateLimitResetCredits['credits'] | undefined
): number | null {
  return (
    credits
      ?.filter((credit) => credit.status === 'available')
      .map((credit) => credit.expiresAt)
      .filter((expiresAt): expiresAt is number => typeof expiresAt === 'number')
      .sort((a, b) => a - b)[0] ?? null
  )
}

function mapRpcRateLimitResetCredits(
  raw: RpcRateLimitsResponse['rateLimitResetCredits']
): RateLimitResetCredits | null | undefined {
  if (!raw) {
    return raw
  }
  if (typeof raw.availableCount !== 'number' || !Number.isFinite(raw.availableCount)) {
    return null
  }
  const credits = raw.credits?.map((credit) => ({
    status: normalizeCreditStatus(credit.status),
    expiresAt: parseCreditTimestamp(credit.expiresAt),
    grantedAt: parseCreditTimestamp(credit.grantedAt)
  }))
  return {
    availableCount: Math.max(0, Math.floor(raw.availableCount)),
    ...(typeof raw.totalEarnedCount === 'number' && Number.isFinite(raw.totalEarnedCount)
      ? { totalEarnedCount: Math.max(0, Math.floor(raw.totalEarnedCount)) }
      : {}),
    nextExpiresAt: parseCreditTimestamp(raw.nextExpiresAt) ?? getNextAvailableCreditExpiry(credits),
    ...(credits ? { credits } : {})
  }
}

function mapRpcWindow(
  raw: CodexRateWindowSnapshot | null | undefined,
  expectedWindowMinutes: number
): RateLimitWindow | null {
  if (!raw || typeof raw.usedPercent !== 'number' || !Number.isFinite(raw.usedPercent)) {
    return null
  }
  let resetDescription: string | null = null
  let resetsAt: number | null = null
  if (typeof raw.resetsAt === 'number' && Number.isFinite(raw.resetsAt) && raw.resetsAt > 0) {
    const date = new Date(raw.resetsAt * 1000)
    if (!Number.isNaN(date.getTime())) {
      resetsAt = date.getTime()
      const now = new Date()
      resetDescription =
        date.toDateString() === now.toDateString()
          ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : date.toLocaleDateString(undefined, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit'
            })
    }
  }
  return {
    usedPercent: Math.min(100, Math.max(0, raw.usedPercent)),
    windowMinutes: expectedWindowMinutes,
    resetsAt,
    resetDescription
  }
}

export async function fetchCodexRateLimitsViaRpc(
  options?: FetchCodexRateLimitsOptions
): Promise<ProviderRateLimits> {
  if (options?.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  return new Promise<ProviderRateLimits>((resolve) => {
    let buffer = ''
    let stderr = ''
    let resolved = false
    let rpcId = 0
    const codexArgs = ['-s', 'read-only', '-a', 'untrusted', 'app-server']
    const wslCodex = options?.codexHomePath
      ? buildWslCodexCommand(options.codexHomePath, { isolateRpcStdio: true })
      : null
    const rpcTimeoutMs = wslCodex ? WSL_RPC_TIMEOUT_MS : RPC_TIMEOUT_MS
    const codexCommand = wslCodex ? 'codex' : resolveCodexCommand()
    const { spawnCmd, spawnArgs } = wslCodex
      ? { spawnCmd: wslCodex.command, spawnArgs: wslCodex.args }
      : getSpawnArgsForWindows(codexCommand, codexArgs)
    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: resolveHiddenRateLimitPtyCwd(),
      windowsHide: true,
      env: {
        ...(wslCodex ? cloneProcessEnvWithoutCodexHome() : process.env),
        ...(options?.codexHomePath && !wslCodex ? { CODEX_HOME: options.codexHomePath } : {})
      }
    })
    let timeout: ReturnType<typeof setTimeout> | null = null
    function onAbort(): void {
      settle(abortedCodexRateLimitResult(), { kill: true })
    }
    function cleanupListeners(): void {
      if (timeout) clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', onAbort)
      child.stdout.off('data', onStdoutData)
      child.stderr.off('data', onStderrData)
      child.off('error', onError)
      child.off('close', onClose)
    }
    function settle(result: ProviderRateLimits, settleOptions?: { kill?: boolean }): void {
      if (resolved) return
      resolved = true
      cleanupListeners()
      if (settleOptions?.kill) child.kill()
      resolve(result)
    }
    function sendRpc(method: string, params?: unknown): number {
      const id = ++rpcId
      child.stdin.write(buildRpcMessage(id, method, params))
      return id
    }
    if (options?.signal) {
      if (options.signal.aborted) return onAbort()
      options.signal.addEventListener('abort', onAbort, { once: true })
    }
    timeout = setTimeout(() => {
      settle(
        {
          provider: 'codex',
          session: null,
          weekly: null,
          updatedAt: Date.now(),
          error: 'RPC timeout',
          status: 'error'
        },
        { kill: true }
      )
    }, rpcTimeoutMs)

    let rateLimitsId: number | null = null
    const initId = sendRpc('initialize', { clientInfo: { name: 'orca', version: '1.0.0' } })
    function sendNotification(method: string): void {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`)
    }
    function onStdoutData(chunk: Buffer): void {
      buffer += chunk.toString()
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as RpcResponse
          if (msg.id == null) continue
          if (msg.id === initId) {
            sendNotification('initialized')
            rateLimitsId = sendRpc('account/rateLimits/read')
            continue
          }
          if (rateLimitsId !== null && msg.id === rateLimitsId) {
            if (msg.error) {
              settle({
                provider: 'codex',
                session: null,
                weekly: null,
                updatedAt: Date.now(),
                error: withMacTailscaleDnsHint(msg.error.message, stderr),
                status: 'error'
              }, { kill: true })
              return
            }
            const wrapper = msg.result as RpcRateLimitsResponse | undefined
            const classified = classifyCodexRateLimitWindows(wrapper?.rateLimits)
            settle({
              provider: 'codex',
              session: mapRpcWindow(classified.session, CODEX_SESSION_WINDOW_MINUTES),
              weekly: mapRpcWindow(classified.weekly, CODEX_WEEKLY_WINDOW_MINUTES),
              ...(wrapper?.rateLimitResetCredits !== undefined
                ? { rateLimitResetCredits: mapRpcRateLimitResetCredits(wrapper.rateLimitResetCredits) }
                : {}),
              updatedAt: Date.now(),
              error: null,
              status: 'ok'
            }, { kill: true })
          }
        } catch {
          // Non-JSON output is startup noise from some Codex builds.
        }
      }
    }
    function onStderrData(chunk: Buffer): void {
      stderr += chunk.toString()
      if (stderr.length > MAX_DIAGNOSTIC_OUTPUT_LENGTH) {
        stderr = stderr.slice(-MAX_DIAGNOSTIC_OUTPUT_LENGTH)
      }
    }
    function onError(err: Error): void {
      const isEnoent = (err as NodeJS.ErrnoException).code === 'ENOENT'
      settle({
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: Date.now(),
        error: isEnoent
          ? codexCommand === 'codex'
            ? 'Codex CLI not found'
            : 'Codex CLI found but could not run — Node.js may not be in your PATH'
          : withMacTailscaleDnsHint(err.message, stderr),
        status: isEnoent && codexCommand === 'codex' ? 'unavailable' : 'error'
      })
    }
    function onClose(): void {
      settle({
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: Date.now(),
        error: withMacTailscaleDnsHint('RPC process exited unexpectedly', stderr),
        status: 'error'
      })
    }
    child.stdout.on('data', onStdoutData)
    child.stderr.on('data', onStderrData)
    child.on('error', onError)
    child.on('close', onClose)
  })
}
