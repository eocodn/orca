import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import {
  getProcessOutputFields,
  iterateProcessOutputLines
} from '../../shared/process-output-field-scanner'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'
import { encodeNdjson } from './ndjson'
import {
  PROTOCOL_VERSION,
  type HelloMessage,
  type HelloResponse,
  type SystemResolverHealth,
  type SystemResolverHealthResult
} from './types'

helpers with kill escalation so the SIGKILL safety checks stay co-located. */
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { promisify } from 'node:util'
import {
  getProcessOutputFields,
  iterateProcessOutputLines
} from '../../shared/process-output-field-scanner'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'
import { encodeNdjson } from './ndjson'
import { getDaemonPidPath } from './daemon-spawner'
import {
  PROTOCOL_VERSION,
  type HelloMessage,
  type HelloResponse,
  type SystemResolverHealth,
  type SystemResolverHealthResult
} from './types'

const HEALTH_CHECK_TIMEOUT_MS = 3_000
const RESOLVER_HEALTH_CHECK_TIMEOUT_MS = 3_000
const KILL_WAIT_MS = 3_000
const KILL_POLL_MS = 100
const START_TIME_TOLERANCE_MS = 1_500
// Why: e2e forces the failed-health preserve path without SIGSTOP races â
// a stopped daemon also blocks listSessions, so the unhealthy guard cannot
// verify live sessions until SIGCONT, which is flaky under CI load.
export const E2E_FORCE_DAEMON_HEALTH_UNREACHABLE_ENV = 'ORCA_E2E_FORCE_DAEMON_HEALTH_UNREACHABLE'
// Why: on Windows the pid file's startedAtMs is the daemon's self-reported
// Node start time, while verification reads the OS process creation time â
// the gap between them is the exe bootstrap, which AV/disk pressure can
// stretch to seconds. Pid recycling differs by minutes-to-days, so a wide
// tolerance keeps the guard effective without false mismatches.
const WIN32_START_TIME_TOLERANCE_MS = 10_000

// 'rejected' means the daemon answered and refused the handshake (bad token,
// foreign protocol) â it can never be adopted, unlike 'unreachable', which
// also covers a live-but-wedged daemon that simply missed the RPC budget.
export type DaemonHealth = 'healthy' | 'unreachable' | 'rejected' | 'pty-spawn-unhealthy'

export type ParsedDaemonPid = {
  pid: number
  startedAtMs: number | null
  entryPath: string | null
  appVersion: string | null
  launchNonce: string | null
  linuxStartTicks: string | null
  bootId: string | null
}

export function canConnectSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && !existsSync(socketPath)) {
      resolve(false)
      return
    }
    const sock = connect({ path: socketPath })
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      sock.off('connect', onConnect)
      sock.off('error', onError)
    }
    const settle = (result: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }
    const onConnect = (): void => {
      settle(true)
      sock.destroy()
    }
    const onError = (): void => {
      settle(false)
    }
    const timer = setTimeout(() => {
      settle(false)
      sock.destroy()
    }, 500)
    sock.on('connect', onConnect)
    sock.on('error', onError)
  })
}

export function checkDaemonHealth(socketPath: string, tokenPath: string): Promise<DaemonHealth> {
  return new Promise((resolve) => {
    if (process.env[E2E_FORCE_DAEMON_HEALTH_UNREACHABLE_ENV] === '1') {
      resolve('unreachable')
      return
    }

    if (process.platform !== 'win32' && !existsSync(socketPath)) {
      resolve('unreachable')
      return
    }

    let token: string
    try {
      token = readFileSync(tokenPath, 'utf8').trim()
    } catch {
      resolve('unreachable')
      return
    }

    let settled = false
    let sock: Socket | null = null
    const settle = (result: DaemonHealth): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      removeSocketListeners()
      sock?.destroy()
      resolve(result)
    }
    const removeSocketListeners = (): void => {
      sock?.off('error', onError)
      sock?.off('connect', onConnect)
      sock?.off('data', onData)
    }
    const onError = (): void => settle('unreachable')
    const onConnect = (): void => {
      const hello: HelloMessage = {
        type: 'hello',
        version: PROTOCOL_VERSION,
        token,
        clientId: 'health-check',
        role: 'control'
      }
      sock?.write(encodeNdjson(hello))
    }
    const onData = (chunk: Buffer): void => {
      if (settled) {
        return
      }
      buffer += chunk.toString()
      for (;;) {
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx === -1) {
          break
        }
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) {
          continue
        }

        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          settle('rejected')
          return
        }

        if (message.type === 'hello') {
          if (!(message as HelloResponse).ok) {
            settle('rejected')
            return
          }
          // Why: a protocol-live daemon with a stale cwd or node-pty helper
          // will answer ping but cannot create terminals, so reuse must check
          // the PTY spawn prerequisites too.
          sock?.write(encodeNdjson({ id: 'health-1', type: 'ptySpawnHealth' }))
          continue
        }

        if (message.id === 'health-1') {
          settle(message.ok === true ? 'healthy' : 'pty-spawn-unhealthy')
          return
        }
      }
    }
    const timer = setTimeout(() => settle('unreachable'), HEALTH_CHECK_TIMEOUT_MS)

    sock = connect({ path: socketPath })
    sock.on('error', onError)
    sock.on('connect', onConnect)

    let buffer = ''
    sock.on('data', onData)
  })
}

export async function healthCheckDaemon(socketPath: string, tokenPath: string): Promise<boolean> {
  return (await checkDaemonHealth(socketPath, tokenPath)) === 'healthy'
}

function isSystemResolverHealth(value: unknown): value is SystemResolverHealth {
  return value === 'healthy' || value === 'unhealthy' || value === 'unknown'
}

export function getMacDaemonSystemResolverHealth(
  socketPath: string,
  tokenPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<SystemResolverHealth> {
  if (process.platform !== 'darwin') {
    return Promise.resolve('unknown')
  }

  return new Promise((resolve) => {
    if (!existsSync(socketPath)) {
      resolve('unknown')
      return
    }

    let token: string
    try {
      token = readFileSync(tokenPath, 'utf8').trim()
    } catch {
      resolve('unknown')
      return
    }

    let settled = false
    let sock: Socket | null = null
    const settle = (result: SystemResolverHealth): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      removeSocketListeners()
      sock?.destroy()
      resolve(result)
    }
    const removeSocketListeners = (): void => {
      sock?.off('error', onError)
      sock?.off('connect', onConnect)
      sock?.off('data', onData)
    }
    const onError = (): void => settle('unknown')
    const onConnect = (): void => {
      const hello: HelloMessage = {
        type: 'hello',
        version: protocolVersion,
        token,
        clientId: 'resolver-health-check',
        role: 'control'
      }
      sock?.write(encodeNdjson(hello))
    }
    const onData = (chunk: Buffer): void => {
      if (settled) {
        return
      }
      buffer += chunk.toString()
      for (;;) {
        const newlineIdx = buffer.indexOf('\n')
        if (newlineIdx === -1) {
          break
        }
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        if (!line) {
          continue
        }

        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          settle('unknown')
          return
        }

        if (message.type === 'hello') {
          if (!(message as HelloResponse).ok) {
            settle('unknown')
            return
          }
          // Why: the daemon must report health from inside its own process;
          // external launchctl bsexec probes can misclassify healthy PTYs.
          sock?.write(encodeNdjson({ id: 'resolver-health-1', type: 'systemResolverHealth' }))
          continue
        }

        if (message.id === 'resolver-health-1') {
          if (!message.ok || typeof message.payload !== 'object' || message.payload === null) {
            settle('unknown')
            return
          }
          const payload = message.payload as Partial<SystemResolverHealthResult>
          settle(isSystemResolverHealth(payload.health) ? payload.health : 'unknown')
          return
        }
      }
    }
    const timer = setTimeout(() => settle('unknown'), RESOLVER_HEALTH_CHECK_TIMEOUT_MS)

    sock = connect({ path: socketPath })
    sock.on('error', onError)
    sock.on('connect', onConnect)

    let buffer = ''
    sock.on('data', onData)
  })
}

export function commandLineMatchesDaemon(
  commandLine: string,
  socketPath: string,
  tokenPath: string
): boolean {
  return (
    commandLine.includes('daemon-entry') &&
    commandLine.includes(socketPath) &&
    commandLine.includes(tokenPath)
  )
}

export function parseDaemonPidFile(contents: string): ParsedDaemonPid | null {
  const trimmed = contents.trim()
  try {
    const parsed = JSON.parse(trimmed) as {
      pid?: unknown
      startedAtMs?: unknown
      entryPath?: unknown
      appVersion?: unknown
      launchNonce?: unknown
      linuxStartTicks?: unknown
      bootId?: unknown
    }
    if (typeof parsed.pid === 'number' && Number.isFinite(parsed.pid)) {
      return {
        pid: parsed.pid,
        startedAtMs:
          typeof parsed.startedAtMs === 'number' && Number.isFinite(parsed.startedAtMs)
            ? parsed.startedAtMs
            : null,
        entryPath: typeof parsed.entryPath === 'string' ? parsed.entryPath : null,
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : null,
        launchNonce: typeof parsed.launchNonce === 'string' ? parsed.launchNonce : null,
        linuxStartTicks: typeof parsed.linuxStartTicks === 'string' ? parsed.linuxStartTicks : null,
        bootId: typeof parsed.bootId === 'string' ? parsed.bootId : null
      }
    }
  } catch {
    // Legacy daemons wrote the pid file as a bare integer.
  }

  const pid = Number(trimmed)
  return Number.isFinite(pid)
    ? {
        pid,
        startedAtMs: null,
        entryPath: null,
        appVersion: null,
        launchNonce: null,
        linuxStartTicks: null,
        bootId: null
      }
    : null
}

function getLinuxProcessStartedAtMs(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const startTicks = parseLinuxProcStartTicks(stat)
    const bootTimeSeconds = parseLinuxBootTimeSeconds(readFileSync('/proc/stat', 'utf8'))
    const ticksPerSecond = Number(
      execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1_000 }).trim()
    )
    if (
      !Number.isFinite(startTicks) ||
      !Number.isFinite(bootTimeSeconds) ||
      !Number.isFinite(ticksPerSecond) ||
      ticksPerSecond <= 0
    ) {
      return null
    }
    return bootTimeSeconds * 1000 + (startTicks / ticksPerSecond) * 1000
  } catch {
    return null
  }
}

export function parseLinuxProcStartTicks(stat: string): number {
  const commandEndIndex = stat.lastIndexOf(')')
  if (commandEndIndex === -1) {
    return Number.NaN
  }

  const fields = getProcessOutputFields(stat.slice(commandEndIndex + 1), 20)
  return Number(fields[19])
}

export function parseLinuxBootTimeSeconds(procStat: string): number {
  for (const line of iterateProcessOutputLines(procStat)) {
    if (!line.startsWith('btime ')) {
      continue
    }
    return Number(getProcessOutputFields(line, 2)[1])
  }
  return Number.NaN
}

export function getProcessStartedAtMs(pid: number): number | null {
  if (process.platform === 'linux') {
    return getLinuxProcessStartedAtMs(pid)
  }

  if (process.platform === 'win32') {
    // Why: the only OS source is a CIM query costing a powershell spawn â
    // too slow for this sync path. Windows pid files instead carry the
    // daemon's self-reported start time from its ready message, and
    // isDaemonProcess verifies it against CIM CreationDate asynchronously.
    return null
  }

  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 2_000
    }).trim()
    const startedAtMs = Date.parse(output)
    return Number.isFinite(startedAtMs) ? startedAtMs : null
  } catch {
    return null
  }
}

export function startTimeMatches(pid: number, expectedStartedAtMs: number | null): boolean {
  return startTimesWithinTolerance(
    getProcessStartedAtMs(pid),
    expectedStartedAtMs,
    START_TIME_TOLERANCE_MS
  )
}

// Why: fail open on null â a pid file or OS query without a start time must
// not veto an otherwise-matching daemon (adoption safety beats recycle safety).
export function startTimesWithinTolerance(
  actualStartedAtMs: number | null,
  expectedStartedAtMs: number | null,
  toleranceMs: number
): boolean {
  if (expectedStartedAtMs === null || actualStartedAtMs === null) {
    return true
  }
  return Math.abs(actualStartedAtMs - expectedStartedAtMs) <= toleranceMs
}
