import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, accessSync, chmodSync, readFileSync, constants } from 'node:fs'
import { join } from 'node:path'
import { platform, arch } from 'node:os'
import { app, type WebContents } from 'electron'
import { CdpWsProxy } from './cdp-ws-proxy'
import { captureFullPageScreenshot } from './cdp-screenshot'
import { acquireElectronDebugger } from './electron-debugger-lease'
import type { BrowserManager } from './browser-manager'
import { BrowserError } from './cdp-bridge'
import type {
  BrowserTabInfo,
  BrowserTabListResult,
  BrowserTabSwitchResult,
  BrowserSnapshotResult,
  BrowserClickResult,
  BrowserGotoResult,
  BrowserFillResult,
  BrowserTypeResult,
  BrowserSelectResult,
  BrowserScrollResult,
  BrowserBackResult,
  BrowserReloadResult,
  BrowserScreenshotResult,
  BrowserEvalResult,
  BrowserHoverResult,
  BrowserDragResult,
  BrowserUploadResult,
  BrowserWaitResult,
  BrowserCheckResult,
  BrowserFocusResult,
  BrowserClearResult,
  BrowserSelectAllResult,
  BrowserKeypressResult,
  BrowserPdfResult,
  BrowserCookieGetResult,
  BrowserCookieSetResult,
  BrowserCookieDeleteResult,
  BrowserViewportResult,
  BrowserGeolocationResult,
  BrowserInterceptEnableResult,
  BrowserInterceptDisableResult,
  BrowserConsoleResult,
  BrowserNetworkLogResult,
  BrowserCaptureStartResult,
  BrowserCaptureStopResult,
  BrowserCookie
} from '../../shared/runtime-types'
import { assertClipboardTextWriteWithinLimitWithYield } from '../../shared/clipboard-text'
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'
import { iterateBrowserTextInsertionChunks } from './browser-text-insertion'

// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.
import * as foundation from './agent-browser-command-bridge-foundation'
const { AGENT_BROWSER_CLIPBOARD_WRITE_MAX_BYTES, AGENT_BROWSER_TEXT_ARGUMENT_MAX_BYTES, CONSECUTIVE_TIMEOUT_LIMIT, EMBEDDED_NAVIGATION_TIMEOUT_MS, EXEC_TIMEOUT_MS, STALE_SESSION_CLOSE_TIMEOUT_MS, WAIT_PROCESS_TIMEOUT_GRACE_MS, agentBrowserNativeName, cdpMouseButtonMask, cdpMouseModifierMask, classifyErrorCode, focusedRichTextEditExpression, focusedValueSetExpression, isAbortedNavigationError, isExplicitContentEditableResult, isTabClosedTransportError, isWebContentsLoading, mobileTouchClickExpression, normalizeCdpMouseButton, pageUnavailableMessageForSession, parseShellArgs, readClickPoint, resolveAgentBrowserBinary, resolveMobileTouchClickPoint, stripAgentBrowserTargetArgs, translateResult, waitForAbortedNavigationReplacement } = foundation
type AgentBrowserBridgeOptions = foundation.AgentBrowserBridgeOptions
type AgentBrowserExecOptions = foundation.AgentBrowserExecOptions
type BrowserClickPoint = foundation.BrowserClickPoint
type BrowserMouseModifier = foundation.BrowserMouseModifier
type CdpMouseButton = foundation.CdpMouseButton
type EnqueueTargetedCommandOptions = foundation.EnqueueTargetedCommandOptions
type QueuedCommand = foundation.QueuedCommand
type ResolvedBrowserCommandTarget = foundation.ResolvedBrowserCommandTarget
type SessionState = foundation.SessionState

export const AgentBrowserBridgeMethods23 = {
  async ensureSession(this: any,
    sessionName: string,
    browserPageId: string,
    webContentsId: number
  ): Promise<void> {
    const pendingDestruction = this.pendingSessionDestruction.get(sessionName)
    if (pendingDestruction) {
      await pendingDestruction
    }

    if (this.sessions.has(sessionName)) {
      return
    }

    // Why: without this lock, two concurrent calls both create proxies and the second leaks the first's server/debugger.
    const pending = this.pendingSessionCreation.get(sessionName)
    if (pending) {
      await pending
      return
    }

    const createSession = async (): Promise<void> => {
      const wc = this.getWebContents(webContentsId)
      if (!wc) {
        // Why: the webview can be destroyed between target resolution and session creation — keep the same closed-tab error shape.
        throw new BrowserError(
          'browser_tab_not_found',
          `Browser page ${browserPageId} is no longer available`
        )
      }

      // Why: the daemon persists sessions (incl. CDP port) across restarts; close the stale one first or it ignores --cdp and hits the dead port.
      await this.closeStaleAgentBrowserSession(sessionName)

      const proxy = new CdpWsProxy(wc)
      const cdpEndpoint = await proxy.start()

      this.sessions.set(sessionName, {
        proxy,
        cdpEndpoint,
        initialized: false,
        consecutiveTimeouts: 0,
        activeInterceptPatterns: [],
        activeCapture: false,
        webContentsId,
        activeProcess: null
      })
    }

    const promise = createSession()
    this.pendingSessionCreation.set(sessionName, promise)
    try {
      await promise
    } finally {
      this.pendingSessionCreation.delete(sessionName)
    }
  }
  async restartSessionForTarget(this: any,
    sessionName: string,
    browserPageId: string,
    webContentsId: number,
    options: { recreate: boolean } = { recreate: true }
  ): Promise<void> {
    const pendingCreation = this.pendingSessionCreation.get(sessionName)
    if (pendingCreation) {
      await pendingCreation.catch(() => {})
    }

    const session = this.sessions.get(sessionName)
    if (session) {
      if (session.activeInterceptPatterns.length > 0) {
        this.pendingInterceptRestore.set(sessionName, [...session.activeInterceptPatterns])
      }
      this.sessions.delete(sessionName)
      this.pendingSessionCreation.delete(sessionName)
      if (session.activeProcess) {
        this.cancelledProcesses.add(session.activeProcess)
        try {
          session.activeProcess.kill()
        } catch {
          // Process may already be exiting.
        }
        session.activeProcess = null
      }

      const destroy = (async (): Promise<void> => {
        try {
          await this.runAgentBrowserRaw(sessionName, ['--session', sessionName, 'close'])
        } catch {
          // Session may already be dead.
        }
        await session.proxy.stop()
      })()
      this.pendingSessionDestruction.set(sessionName, destroy)
      try {
        await destroy
      } finally {
        this.pendingSessionDestruction.delete(sessionName)
      }
    }

    if (options.recreate) {
      await this.ensureSession(sessionName, browserPageId, webContentsId)
    }
  }
  async destroySession(this: any, sessionName: string): Promise<void> {
    const pendingDestruction = this.pendingSessionDestruction.get(sessionName)
    if (pendingDestruction) {
      await pendingDestruction
      return
    }

    const pendingCreation = this.pendingSessionCreation.get(sessionName)
    if (pendingCreation) {
      // Why: tab close can race session creation before sessions.set(); await it so no late proxy survives the close.
      try {
        await pendingCreation
      } catch {
        // Creation failures are handled by the original caller; teardown still rejects queued work below.
      }
    }

    const session = this.sessions.get(sessionName)
    if (!session) {
      this.rejectQueuedCommandsForClosedSession(sessionName)
      return
    }

    this.sessions.delete(sessionName)
    this.pendingSessionCreation.delete(sessionName)

    // Why: queued commands would hang forever if we just delete the queue — drain and reject them.
    this.rejectQueuedCommandsForClosedSession(sessionName)

    if (session.activeProcess) {
      // Why: rejecting the queue isn't enough for an in-flight command — kill the process so callers don't wait out the exec timeout.
      this.cancelledProcesses.add(session.activeProcess)
      try {
        session.activeProcess.kill()
      } catch {
        // Process may already be exiting.
      }
      session.activeProcess = null
    }

    const destroy = (async (): Promise<void> => {
      try {
        // Why: each tab has its own named session — close without --session leaves this tab's daemon running.
        await this.runAgentBrowserRaw(sessionName, ['--session', sessionName, 'close'])
      } catch {
        // Session may already be dead
      }

      await session.proxy.stop()
    })()
    this.pendingSessionDestruction.set(sessionName, destroy)
    try {
      await destroy
    } finally {
      this.pendingSessionDestruction.delete(sessionName)
    }
  }
  rejectQueuedCommandsForClosedSession(this: any, sessionName: string): void {
    const queue = this.commandQueues.get(sessionName)
    this.commandQueues.delete(sessionName)
    this.processingQueues.delete(sessionName)
    if (queue) {
      const err = new BrowserError(
        'browser_tab_closed',
        'Tab was closed while commands were queued'
      )
      for (const cmd of queue) {
        cmd.reject(err)
      }
      queue.length = 0
    }
  }
}
export type AgentBrowserBridgeMethods23Surface = typeof AgentBrowserBridgeMethods23
