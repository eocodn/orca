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

export const AgentBrowserBridgeMethods19 = {
  async interceptList(this: any,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<{ requests: unknown[] }> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return (await this.execAgentBrowser(sessionName, ['network', 'requests'])) as {
        requests: unknown[]
      }
    })
  }
  async captureStart(this: any,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserCaptureStartResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      const result = (await this.execAgentBrowser(sessionName, [
        'network',
        'har',
        'start'
      ])) as BrowserCaptureStartResult
      const session = this.sessions.get(sessionName)
      if (session) {
        session.activeCapture = true
      }
      return result
    })
  }
  async captureStop(this: any,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserCaptureStopResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      const result = (await this.execAgentBrowser(sessionName, [
        'network',
        'har',
        'stop'
      ])) as BrowserCaptureStopResult
      const session = this.sessions.get(sessionName)
      if (session) {
        session.activeCapture = false
      }
      return result
    })
  }
  async consoleLog(this: any,
    _limit?: number,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserConsoleResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return (await this.execAgentBrowser(sessionName, ['console'])) as BrowserConsoleResult
    })
  }
}
export type AgentBrowserBridgeMethods19Surface = typeof AgentBrowserBridgeMethods19
