import * as pty from 'node-pty'
import type { SubprocessHandle } from './session'
import type { PtySubprocessOptions } from './daemon-pty-spawn-support'
import {
  FOREGROUND_AGENT_CACHE_TTL_MS,
  PENDING_PRE_LISTENER_DATA_MAX_CHARS,
  SHELL_FOREGROUND_OUTPUT_HOT_WINDOW_MS,
  SHELL_FOREGROUND_REFRESH_RETRY_MS,
  STARTUP_AGENT_FOREGROUND_BOOTSTRAP_MS,
  WINDOWS_IDLE_SHELL_FOREGROUND_REFRESH_RETRY_MS,
  resolveFallbackForegroundProcess,
  shouldInspectOuterWrapperFallback
} from './daemon-pty-spawn-support'
import { isValidPtySize } from './daemon-pty-size'
import { resolveAgentForegroundProcessWithAvailability } from '../providers/agent-foreground-process'
import { readWindowsConptyProcessIds } from '../providers/windows-conpty-process-membership'
import {
  isAgentForegroundWrapperProcess,
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine,
  shouldInspectOuterWrapperForegroundProcess
} from '../../shared/agent-process-recognition'
import { isShellProcess } from '../../shared/shell-process-detection'
import { parsePtySessionId } from './pty-session-id'
import { getAgentForegroundContextPaths } from '../providers/agent-foreground-context-paths'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'

export function createDaemonPtySubprocessHandle(args: {
  proc: pty.IPty
  shellPath: string
  startupCommandDeliveredInShellArgs: boolean
  opts: PtySubprocessOptions
  startupAgentRecognition: ReturnType<typeof recognizeAgentProcessFromCommandLine>
}): SubprocessHandle {
  const { proc, opts, shellPath, startupCommandDeliveredInShellArgs, startupAgentRecognition } = args
  let onDataCb: ((data: string) => void) | null = null
  let onExitCb: ((code: number) => void) | null = null
  let pendingPreListenerData: string[] = []
  let pendingPreListenerDataChars = 0
  let pendingPreListenerExitCode: number | null = null

  const bufferPreListenerData = (data: string): void => {
    // Why: Windows shell-arg startup commands can print before Session wires this subprocess in; preserve that spawn-time race window.
    pendingPreListenerData.push(data)
    pendingPreListenerDataChars += data.length
    while (pendingPreListenerDataChars > PENDING_PRE_LISTENER_DATA_MAX_CHARS) {
      const removed = pendingPreListenerData.shift()
      if (removed === undefined) {
        pendingPreListenerDataChars = 0
        return
      }
      pendingPreListenerDataChars -= removed.length
    }
  }

  const flushPreListenerData = (): void => {
    if (!onDataCb || pendingPreListenerData.length === 0) {
      return
    }
    const pending = pendingPreListenerData
    pendingPreListenerData = []
    pendingPreListenerDataChars = 0
    for (const data of pending) {
      onDataCb(data)
    }
  }

  let lastOutputAt = 0
  proc.onData((data) => {
    if (data.length > 0) {
      lastOutputAt = Date.now()
    }
    if (onDataCb) {
      onDataCb(data)
    } else {
      bufferPreListenerData(data)
    }
  })
  proc.onExit(({ exitCode }) => {
    if (onExitCb) {
      flushPreListenerData()
      onExitCb(exitCode)
    } else {
      pendingPreListenerExitCode = exitCode
    }
  })

  // Why: node-pty throws Napi::Error if write/resize/kill hit a closed fd (child-exit vs onExit race); uncaught it std::terminates the daemon.
  let dead = false
  let disposed = false
  let nodePtyKillIssued = false
  let cachedAgentForeground: { processName: string; refreshedAt: number } | null = null
  const agentForegroundContextPaths = getAgentForegroundContextPaths({
    cwd: opts.cwd,
    worktreeId: parsePtySessionId(opts.sessionId).worktreeId
  })
  let startupAgentForeground: { processName: string; expiresAt: number } | null =
    startupAgentRecognition
      ? {
          processName: startupAgentRecognition.processName,
          expiresAt: Date.now() + STARTUP_AGENT_FOREGROUND_BOOTSTRAP_MS
        }
      : null
  let foregroundRefreshInFlight = false
  let lastForegroundRefreshStartedAt = 0
  const getFallbackForegroundProcess = (): string | null =>
    resolveFallbackForegroundProcess(proc.process, shellPath)
  const getActiveStartupAgentForeground = (
    now = Date.now()
  ): { processName: string; expiresAt: number } | null => {
    if (!startupAgentForeground) {
      return null
    }
    if (now > startupAgentForeground.expiresAt) {
      startupAgentForeground = null
      return null
    }
    return startupAgentForeground
  }
  const shouldInspectFallbackForegroundProcess = (fallbackProcess: string | null): boolean =>
    fallbackProcess !== null &&
    (isShellProcess(fallbackProcess) ||
      isAgentForegroundWrapperProcess(fallbackProcess) ||
      shouldInspectOuterWrapperFallback(fallbackProcess) ||
      // Why: agent-spawned helpers can become the PTY foreground child, but the Unix process tree still identifies the parent agent.
      process.platform !== 'win32')
  const scheduleAgentForegroundRefresh = (fallbackProcess: string | null): void => {
    if (dead || !proc.pid) {
      return
    }
    const fallbackIsShell = fallbackProcess !== null && isShellProcess(fallbackProcess)
    const fallbackRecognition = recognizeAgentProcess(fallbackProcess)
    if (
      !fallbackProcess ||
      (fallbackRecognition !== null &&
        !shouldInspectOuterWrapperForegroundProcess(fallbackRecognition)) ||
      !shouldInspectFallbackForegroundProcess(fallbackProcess)
    ) {
      return
    }
    const now = Date.now()
    const idleNoEvidenceShell =
      fallbackIsShell && !getActiveStartupAgentForeground(now) && !cachedAgentForeground
    // Why: on Windows each refresh is a whole-table CIM scan, so only shells with no agent evidence and no recent output relax the retry.
    const retryMs = !idleNoEvidenceShell
      ? FOREGROUND_AGENT_CACHE_TTL_MS
      : process.platform === 'win32' && now - lastOutputAt > SHELL_FOREGROUND_OUTPUT_HOT_WINDOW_MS
        ? WINDOWS_IDLE_SHELL_FOREGROUND_REFRESH_RETRY_MS
        : SHELL_FOREGROUND_REFRESH_RETRY_MS
    if (foregroundRefreshInFlight || now - lastForegroundRefreshStartedAt < retryMs) {
      return
    }
    foregroundRefreshInFlight = true
    lastForegroundRefreshStartedAt = now
    // Why: daemon foreground reads are sync on the IPC hot path; refresh derived identities in the background and serve from a short cache.
    // Why: Windows may need an async membership check before this shell/wrapper retirement policy is safe.
    const retireStaleForegroundIdentity = (): void => {
      const currentFallbackProcess = getFallbackForegroundProcess()
      if (
        fallbackIsShell &&
        !getActiveStartupAgentForeground() &&
        currentFallbackProcess !== null &&
        isShellProcess(currentFallbackProcess)
      ) {
        cachedAgentForeground = null
        startupAgentForeground = null
      } else if (
        cachedAgentForeground !== null &&
        Date.now() - cachedAgentForeground.refreshedAt > FOREGROUND_AGENT_CACHE_TTL_MS &&
        currentFallbackProcess !== null &&
        isAgentForegroundWrapperProcess(currentFallbackProcess)
      ) {
        // Why: an expired wrapper identity must not transfer to an unrelated wrapper (e.g. npm after an agent exit); fresh ones survive scan hiccups.
        cachedAgentForeground = null
      }
    }
    void resolveAgentForegroundProcessWithAvailability(proc.pid, fallbackProcess, {
      contextPaths: agentForegroundContextPaths
    })
      .then<string | void>(({ processName, available }) => {
        if (dead) {
          return
        }
        // Why: a degraded scan isn't exit evidence — retiring would fire false completion while the agent works under CIM load.
        if (!available) {
          return
        }
        if (!processName || !recognizeAgentProcess(processName)) {
          // Why: a Windows snapshot can omit a live agent; only verified shell-only membership may retire cached identity.
          if (process.platform === 'win32' && fallbackIsShell && cachedAgentForeground !== null) {
            return readWindowsConptyProcessIds(proc.pid).then((consoleProcessIds) => {
              if (dead || consoleProcessIds === null || consoleProcessIds.size > 1) {
                return
              }
              retireStaleForegroundIdentity()
            })
          }
          retireStaleForegroundIdentity()
          return
        }
        cachedAgentForeground = { processName, refreshedAt: Date.now() }
        startupAgentForeground = null
        return processName
      })
      .catch(() => {
        // Best-effort only: foreground enrichment must never affect PTY health.
      })
      .finally(() => {
        foregroundRefreshInFlight = false
      })
  }
  proc.onExit(() => {
    dead = true
    cachedAgentForeground = null
    startupAgentForeground = null
    // Why: neutralize proc.kill synchronously in onExit so UnixTerminal's async socket-close SIGHUP can't land on a recycled pid.
    // Windows excluded: WindowsTerminal.destroy needs kill() to close the ConPTY agent.
    if (process.platform !== 'win32') {
      ;(proc as unknown as { kill: (sig?: string) => void }).kill = () => {}
    }
  })

  return {
    pid: proc.pid,
    shellPath,
    ...(startupCommandDeliveredInShellArgs ? { startupCommandDeliveredInShellArgs: true } : {}),
    getForegroundProcess: () => {
      // Why: node-pty's `.process` reports the live foreground name but reads a recycled pid on a reaped pty, so bail when dead.
      if (dead) {
        return null
      }
      try {
        const fallbackProcess = getFallbackForegroundProcess()
        const fallbackRecognition = recognizeAgentProcess(fallbackProcess)
        const inspectOuterWrapper =
          fallbackRecognition !== null &&
          shouldInspectOuterWrapperForegroundProcess(fallbackRecognition)
        if (fallbackProcess && fallbackRecognition && !inspectOuterWrapper) {
          cachedAgentForeground = { processName: fallbackProcess, refreshedAt: Date.now() }
          startupAgentForeground = null
          return fallbackProcess
        }
        scheduleAgentForegroundRefresh(fallbackProcess)
        const now = Date.now()
        if (
          cachedAgentForeground &&
          now - cachedAgentForeground.refreshedAt <= FOREGROUND_AGENT_CACHE_TTL_MS
        ) {
          return cachedAgentForeground.processName
        }
        // Why: a wrapper (node/python) can't self-identify and readers poll slower than the cache TTL, so serve the last resolved agent.
        // On Windows a shell fallback is an unreliable exit signal under ConPTY lag; trust the cache until a console-presence read confirms exit.
        if (
          cachedAgentForeground &&
          fallbackProcess !== null &&
          (isAgentForegroundWrapperProcess(fallbackProcess) ||
            inspectOuterWrapper ||
            (process.platform === 'win32' && isShellProcess(fallbackProcess)))
        ) {
          return cachedAgentForeground.processName
        }
        const activeStartupAgentForeground = getActiveStartupAgentForeground(now)
        if (fallbackProcess && isShellProcess(fallbackProcess) && activeStartupAgentForeground) {
          return activeStartupAgentForeground.processName
        }
        return fallbackProcess
      } catch {
        return null
      }
    },
    confirmForegroundProcess: async () => {
      if (dead || !proc.pid) {
        return null
      }
      try {
        const fallbackProcess = getFallbackForegroundProcess()
        const fallbackRecognition = recognizeAgentProcess(fallbackProcess)
        if (
          !fallbackProcess ||
          (fallbackRecognition !== null &&
            process.platform !== 'win32' &&
            !shouldInspectOuterWrapperForegroundProcess(fallbackRecognition)) ||
          (process.platform !== 'win32' && !shouldInspectFallbackForegroundProcess(fallbackProcess))
        ) {
          return fallbackProcess
        }
        // Why: cached/in-flight scans may predate the OSC command boundary; confirmation needs a snapshot started afterward.
        const resolution = await resolveAgentForegroundProcessWithAvailability(
          proc.pid,
          fallbackProcess,
          {
            contextPaths: agentForegroundContextPaths,
            fresh: true,
            ...(process.platform === 'win32'
              ? {
                  forceProcessScan: true,
                  readWindowsConptyProcessIds: () => readWindowsConptyProcessIds(proc.pid)
                }
              : {})
          }
        )
        if (dead || !resolution.available) {
          return null
        }
        const recognized = recognizeAgentProcess(resolution.processName)
        if (recognized) {
          cachedAgentForeground = {
            processName: recognized.processName,
            refreshedAt: Date.now()
          }
          startupAgentForeground = null
          return recognized.processName
        }
        // Why: a post-boundary scan resolving no agent is the authority that retires stale cached/startup identity.
        cachedAgentForeground = null
        startupAgentForeground = null
        return resolution.processName
      } catch {
        return null
      }
    },
    write: (data) => {
      if (dead) {
        return
      }
      try {
        proc.write(data)
      } catch {
        dead = true
      }
    },
    resize: (cols, rows) => {
      if (dead) {
        return
      }
      if (!isValidPtySize(cols, rows)) {
        return
      }
      try {
        proc.resize(cols, rows)
      } catch {
        dead = true
      }
    },
    // Why pause/resume work on Windows too: WindowsTerminal wires _socket to the ConPTY conout pipe, so pausing backpressures the child.
    pause: () => {
      if (dead) {
        return
      }
      try {
        proc.pause()
      } catch {
        /* native handle already torn down — flow control is best-effort */
      }
    },
    resume: () => {
      if (dead) {
        return
      }
      try {
        proc.resume()
      } catch {
        /* native handle already torn down — flow control is best-effort */
      }
    },
    clear: () => {
      if (dead) {
        return
      }
      try {
        proc.clear()
      } catch {
        // Best-effort: a clear on a just-exited PTY must not kill the handle.
      }
    },
    kill: () => {
      if (dead) {
        return
      }
      nodePtyKillIssued = true
      try {
        proc.kill()
      } catch (error) {
        // Why: a rejected native kill isn't proof of exit — keep the wrapper live so Session can retry the owner.
        nodePtyKillIssued = false
        throw error
      }
    },
    forceKill: () => {
      // Why: after reap/dispose proc.pid is a recycled pid, so SIGKILL would hit an unrelated process (forceKill only signals a live child).
      // Why: Windows node-pty kill already closed ConPTY; forcing again can double-close the native handle.
      if (dead || (process.platform === 'win32' && nodePtyKillIssued)) {
        return
      }
      try {
        forceKillPosixPtyProcessGroups(proc.pid, () => {
          process.kill(proc.pid, 'SIGKILL')
        })
      } catch (signalError) {
        try {
          proc.kill()
          nodePtyKillIssued = true
        } catch {
          nodePtyKillIssued = false
          // Keep the original OS failure so callers can retry the same owner.
          throw signalError
        }
      }
    },
    signal: (sig) => {
      // Why: same recycled-pid hazard as forceKill — once dead, dropping avoids signalling an unrelated process.
      if (dead) {
        return
      }
      try {
        process.kill(proc.pid, sig)
      } catch {
        // Process may already be dead
      }
    },
    onData: (cb) => {
      onDataCb = cb
      flushPreListenerData()
    },
    onExit: (cb) => {
      onExitCb = cb
      if (pendingPreListenerExitCode !== null) {
        const code = pendingPreListenerExitCode
        pendingPreListenerExitCode = null
        flushPreListenerData()
        cb(code)
      }
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      dead = true
      onDataCb = null
      onExitCb = null
      pendingPreListenerData = []
      pendingPreListenerDataChars = 0
      pendingPreListenerExitCode = null
      // Why: UnixTerminal.destroy()'s async socket-close SIGHUP can land on a recycled pid, hitting an unrelated user process; neutralize kill on POSIX.
      // Windows destroy() uses kill() to close the ConPTY agent, so the guard is POSIX-only.
      if (process.platform !== 'win32') {
        ;(proc as unknown as { kill: (sig?: string) => void }).kill = () => {}
      } else if (nodePtyKillIssued) {
        // Why: WindowsTerminal.destroy() calls kill(); destroying after node-pty's kill() double-closes the ConPTY handle (heap corruption).
        return
      }
      try {
        ;(proc as unknown as { destroy?: () => void }).destroy?.()
      } catch {
        /* swallow — already torn down, or native-side error we can't recover from */
      }
    }
  }
}
