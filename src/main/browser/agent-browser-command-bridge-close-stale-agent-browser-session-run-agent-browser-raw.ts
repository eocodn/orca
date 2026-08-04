import { execFile, type ChildProcess } from 'node:child_process'
import { BrowserError } from './cdp-bridge'

// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.
import * as foundation from './agent-browser-command-bridge-foundation'
const {
  CONSECUTIVE_TIMEOUT_LIMIT,
  EXEC_TIMEOUT_MS,
  STALE_SESSION_CLOSE_TIMEOUT_MS,
  classifyErrorCode,
  isTabClosedTransportError
} = foundation
type AgentBrowserExecOptions = foundation.AgentBrowserExecOptions

export const AgentBrowserBridgeMethods25 = {
  closeStaleAgentBrowserSession(this: any, sessionName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ReturnType<typeof execFile> | null = null
      let settled = false

      const finish = (error?: Error): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      // Why: proceeding after an unverified close can reuse a daemon that owns an unrelated browser.
      const timeout = setTimeout(() => {
        child?.kill()
        finish(
          new BrowserError(
            'browser_owner_unavailable',
            `Could not reset stale helper session ${sessionName}; retry after agent-browser exits`
          )
        )
      }, STALE_SESSION_CLOSE_TIMEOUT_MS)

      try {
        child = execFile(
          this.agentBrowserBin,
          ['--session', sessionName, 'close'],
          { timeout: STALE_SESSION_CLOSE_TIMEOUT_MS },
          (error) =>
            finish(
              error
                ? new BrowserError(
                    'browser_owner_unavailable',
                    `Could not reset stale helper session ${sessionName}: ${error.message}`
                  )
                : undefined
            )
        )
      } catch (error) {
        finish(
          new BrowserError(
            'browser_owner_unavailable',
            `Could not reset stale helper session ${sessionName}: ${error instanceof Error ? error.message : String(error)}`
          )
        )
      }
    })
  },
  createCommandError(
    this: any,
    sessionName: string,
    message: string,
    fallbackCode: string,
    webContentsId?: number
  ): BrowserError {
    // Why: CDP "connection refused" can also mean a real proxy failure — only map to closed-page when the target is confirmed gone.
    if (
      fallbackCode === 'browser_error' &&
      isTabClosedTransportError(message) &&
      this.isSessionTargetClosed(sessionName, webContentsId)
    ) {
      return this.createPageUnavailableError(sessionName)
    }
    return new BrowserError(fallbackCode, message)
  },
  isSessionTargetClosed(this: any, sessionName: string, webContentsId?: number): boolean {
    const session = this.sessions.get(sessionName)
    if (!session) {
      return true
    }
    const targetWebContentsId = webContentsId ?? session.webContentsId
    return !this.getWebContents(targetWebContentsId)
  },
  runAgentBrowserRaw(
    this: any,
    sessionName: string,
    args: string[],
    execOptions?: AgentBrowserExecOptions
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const session = this.sessions.get(sessionName)
      let child: ChildProcess | null = null
      child = execFile(
        this.agentBrowserBin,
        args,
        // Why: screenshots return large base64 that exceeds Node's default 1MB maxBuffer (ENOBUFS).
        {
          timeout: execOptions?.timeoutMs ?? EXEC_TIMEOUT_MS,
          maxBuffer: 50 * 1024 * 1024,
          env: execOptions?.envOverrides
            ? { ...process.env, ...execOptions.envOverrides }
            : process.env
        },
        (error, stdout, stderr) => {
          if (session && session.activeProcess === child) {
            session.activeProcess = null
          }
          if (child && this.cancelledProcesses.has(child)) {
            this.cancelledProcesses.delete(child)
            reject(
              new BrowserError('browser_tab_closed', 'Tab was closed while command was running')
            )
            return
          }

          const liveSession = this.sessions.get(sessionName)

          if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
            if (execOptions?.timeoutError) {
              reject(execOptions.timeoutError)
              return
            }
            if (liveSession) {
              liveSession.consecutiveTimeouts++
              if (liveSession.consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_LIMIT) {
                // Why: 3 consecutive timeouts means the daemon is likely stuck — destroy and recreate
                this.destroySession(sessionName)
              }
            }
            reject(new BrowserError('browser_error', 'Browser command timed out'))
            return
          }

          if (liveSession) {
            liveSession.consecutiveTimeouts = 0
          }

          if (error) {
            // Why: agent-browser exits non-zero on failure but still writes structured JSON to stdout — parse it for the real error.
            if (stdout) {
              try {
                const parsed = JSON.parse(stdout)
                if (parsed.error) {
                  const code = classifyErrorCode(parsed.error)
                  reject(
                    this.createCommandError(sessionName, parsed.error, code, session?.webContentsId)
                  )
                  return
                }
              } catch {
                // stdout not valid JSON — fall through to stderr/error.message
              }
            }
            const message = stderr || error.message
            const code = classifyErrorCode(message)
            reject(this.createCommandError(sessionName, message, code, session?.webContentsId))
            return
          }

          resolve(stdout)
        }
      )
      if (session) {
        session.activeProcess = child
      }
      if (execOptions?.stdinText !== undefined && child?.stdin) {
        // Why: eval --stdin keeps paste-sized scripts out of argv on every platform.
        child.stdin.on('error', () => {})
        child.stdin.end(execOptions.stdinText)
      }
    })
  }
}
export type AgentBrowserBridgeMethods25Surface = typeof AgentBrowserBridgeMethods25
