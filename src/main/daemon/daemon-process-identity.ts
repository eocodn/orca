import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { promisify } from 'node:util'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from '../startup/startup-diagnostics'
import { getDaemonPidPath } from './daemon-spawner'
import { PROTOCOL_VERSION } from './types'
import {
  canConnectSocket,
  commandLineMatchesDaemon,
  parseDaemonPidFile,
  type ParsedDaemonPid,
  startTimeMatches,
  startTimesWithinTolerance
} from './daemon-health-core'

const WIN32_START_TIME_TOLERANCE_MS = 10_000
const KILL_WAIT_MS = 3_000
const KILL_POLL_MS = 100

const execFileAsync = promisify(execFile)

export type WindowsProcessIdentity = {
  commandLine: string
  startedAtMs: number | null
}

export function parseWindowsProcessIdentityJson(stdout: string): WindowsProcessIdentity | null {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed) as { cmd?: unknown; start?: unknown }
    if (typeof parsed.cmd !== 'string' || !parsed.cmd) {
      return null
    }
    return {
      commandLine: parsed.cmd,
      startedAtMs:
        typeof parsed.start === 'number' && Number.isFinite(parsed.start) ? parsed.start : null
    }
  } catch {
    return null
  }
}

// Why: the only reliable command-line source on Windows is a CIM query, which
// costs a full powershell.exe spawn (300-800ms cold, worse under Defender).
// Async because the sync version measurably froze the Electron main thread at
// startup for the whole spawn (benchmark: ~0.5s warm, 3s timeout cap cold).
// CreationDate rides along in the same spawn so start-time verification adds
// zero extra process launches. Timed under ORCA_STARTUP_DIAGNOSTICS so the
// cold-start benchmark can attribute startup cost to these checks.
async function queryWindowsProcessIdentity(pid: number): Promise<WindowsProcessIdentity | null> {
  const startedAt = performance.now()
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; ` +
          `if ($p) { $start = $null; ` +
          `if ($p.CreationDate) { $start = [long]([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }; ` +
          `@{ cmd = $p.CommandLine; start = $start } | ConvertTo-Json -Compress }`
      ],
      {
        encoding: 'utf8',
        timeout: 3_000
      }
    )
    return parseWindowsProcessIdentityJson(stdout)
  } catch {
    return null
  } finally {
    if (isStartupDiagnosticsEnabled()) {
      logStartupDiagnostic('daemon-pid-check', {
        t: Math.round(performance.now()),
        pid,
        ms: Math.round(performance.now() - startedAt)
      })
    }
  }
}

async function isDaemonProcess(
  pid: number,
  socketPath: string,
  tokenPath: string,
  startedAtMs: number | null
): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }

  if (process.platform === 'win32') {
    const identity = await queryWindowsProcessIdentity(pid)
    if (identity === null) {
      return false
    }
    // Why: image names are too broad after PID reuse. Match the daemon entry
    // plus the exact socket/token args so we only kill the daemon for this
    // userData protocol endpoint.
    return (
      commandLineMatchesDaemon(identity.commandLine, socketPath, tokenPath) &&
      startTimesWithinTolerance(identity.startedAtMs, startedAtMs, WIN32_START_TIME_TOLERANCE_MS)
    )
  }

  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return (
      commandLineMatchesDaemon(cmdline, socketPath, tokenPath) && startTimeMatches(pid, startedAtMs)
    )
  } catch {
    try {
      const output = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 2_000
      })
      return (
        commandLineMatchesDaemon(output, socketPath, tokenPath) &&
        startTimeMatches(pid, startedAtMs)
      )
    } catch {
      return false
    }
  }
}

async function getDaemonCommandLine(pid: number): Promise<string | null> {
  if (process.platform === 'win32') {
    return (await queryWindowsProcessIdentity(pid))?.commandLine ?? null
  }

  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
  } catch {
    try {
      return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 2_000
      })
    } catch {
      return null
    }
  }
}

export type DaemonLaunchIdentity = 'match' | 'mismatch' | 'unknown'

export async function getDaemonLaunchIdentity(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  expectedEntryPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<DaemonLaunchIdentity> {
  const parsedPid = await readVerifiedDaemonPid(runtimeDir, socketPath, tokenPath, protocolVersion)
  if (!parsedPid) {
    return 'unknown'
  }

  if (parsedPid.entryPath) {
    return parsedPid.entryPath === expectedEntryPath ? 'match' : 'mismatch'
  }

  // Why: older pid files did not persist entryPath. The command line still
  // carries daemon-entry.js, so use it to stop dev worktrees from reusing a
  // daemon forked from a deleted sibling checkout. If command-line probing is
  // unavailable, fail open so we don't kill live sessions unnecessarily.
  const commandLine = await getDaemonCommandLine(parsedPid.pid)
  if (!commandLine) {
    return 'unknown'
  }
  return commandLine.includes(expectedEntryPath) ? 'match' : 'mismatch'
}

async function readVerifiedDaemonPid(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<ParsedDaemonPid | null> {
  let parsedPid: ParsedDaemonPid | null
  try {
    parsedPid = parseDaemonPidFile(
      readFileSync(getDaemonPidPath(runtimeDir, protocolVersion), 'utf8')
    )
  } catch {
    return null
  }

  if (
    !parsedPid ||
    !(await isDaemonProcess(parsedPid.pid, socketPath, tokenPath, parsedPid.startedAtMs))
  ) {
    return null
  }

  return parsedPid
}

export async function isDaemonStaleForCurrentBundle(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  currentAppVersion: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<boolean> {
  const parsedPid = await readVerifiedDaemonPid(runtimeDir, socketPath, tokenPath, protocolVersion)
  if (!parsedPid) {
    return false
  }

  if (parsedPid.appVersion !== null) {
    return parsedPid.appVersion !== currentAppVersion
  }

  // Why: older packaged daemons do not carry a reliable build-generation
  // marker. Replacing them once prevents archive-preserved mtimes from
  // reusing stale native modules across the first metadata-aware upgrade.
  return true
}

export async function killStaleDaemon(
  runtimeDir: string,
  socketPath: string,
  tokenPath: string,
  protocolVersion = PROTOCOL_VERSION
): Promise<boolean> {
  const pidPath = getDaemonPidPath(runtimeDir, protocolVersion)
  let killedDaemon = false
  try {
    const parsedPid = parseDaemonPidFile(readFileSync(pidPath, 'utf8'))
    if (
      parsedPid &&
      (await isDaemonProcess(parsedPid.pid, socketPath, tokenPath, parsedPid.startedAtMs))
    ) {
      const { pid, startedAtMs } = parsedPid
      process.kill(pid, 'SIGTERM')
      const deadline = Date.now() + KILL_WAIT_MS
      let exited = false
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0)
        } catch {
          exited = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, KILL_POLL_MS))
      }
      if (!exited) {
        // Why: re-check process identity before SIGKILL. The SIGTERM-then-wait
        // window is long enough for the pid to be recycled if the original
        // daemon died during the wait. Without this, we'd SIGKILL an unrelated
        // process that happens to now own the same pid.
        if (!(await isDaemonProcess(pid, socketPath, tokenPath, startedAtMs))) {
          console.warn('[daemon] Skipping SIGKILL for stale daemon: reason=pid_recycled')
          exited = true
          killedDaemon = true
        } else {
          try {
            process.kill(pid, 'SIGKILL')
            exited = true
          } catch {
            // Already dead
          }
        }
      }
      killedDaemon = killedDaemon || exited
    }
  } catch {
    // PID file missing or process already dead
  }

  try {
    unlinkSync(pidPath)
  } catch {
    // Best-effort
  }

  const socketIsLive = await canConnectSocket(socketPath)
  if (process.platform !== 'win32' && existsSync(socketPath) && (killedDaemon || !socketIsLive)) {
    try {
      unlinkSync(socketPath)
    } catch {
      // Best-effort
    }
  }
  return killedDaemon
}
