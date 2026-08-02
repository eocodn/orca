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

export const AgentBrowserBridgeMethods24 = {
  async execAgentBrowser(this: any,
    sessionName: string,
    commandArgs: string[],
    execOptions?: AgentBrowserExecOptions
  ): Promise<unknown> {
    const session = this.sessions.get(sessionName)
    if (!session) {
      // Why: a queued command can run after a concurrent close deleted the session — surface a tab-lifecycle error, not an opaque failure.
      throw this.createPageUnavailableError(sessionName)
    }

    // Why: the webContents can be destroyed during queue delay — check here to avoid cryptic Electron debugger errors.
    if (!this.getWebContents(session.webContentsId)) {
      await this.destroySession(sessionName)
      throw this.createPageUnavailableError(sessionName)
    }

    const args = ['--session', sessionName]
    const managesInterceptRoutes =
      commandArgs[0] === 'network' && (commandArgs[1] === 'route' || commandArgs[1] === 'unroute')

    const needsInit = !session.initialized
    // Why: a restarted named daemon auto-launches Chrome unless every invocation reasserts Orca's CDP owner.
    args.push('--cdp', String(session.proxy.getPort()))

    // Why: exec passthrough can produce a large argv; spreading into push risks V8 argument limits.
    for (const commandArg of commandArgs) {
      args.push(commandArg)
    }
    args.push('--json')

    const stdout = await this.runAgentBrowserRaw(sessionName, args, execOptions)
    const translated = translateResult(stdout)

    if (!translated.ok) {
      throw this.createCommandError(
        sessionName,
        translated.error.message,
        translated.error.code,
        session.webContentsId
      )
    }

    // Why: mark initialized only after success, so a failed first --cdp connection retries with --cdp.
    if (needsInit) {
      session.initialized = true

      // Why: a process swap loses intercept patterns — restore them now unless the caller's first command reconfigured routing.
      const pendingPatterns = managesInterceptRoutes
        ? undefined
        : this.pendingInterceptRestore.get(sessionName)
      if (pendingPatterns && pendingPatterns.length > 0) {
        this.pendingInterceptRestore.delete(sessionName)
        try {
          const urlPattern = pendingPatterns[0] ?? '**/*'
          await this.runAgentBrowserRaw(sessionName, [
            '--session',
            sessionName,
            '--cdp',
            String(session.proxy.getPort()),
            'network',
            'route',
            urlPattern,
            '--json'
          ])
          session.activeInterceptPatterns = pendingPatterns
        } catch {
          // Why: intercept restore is best-effort — don't fail the user's command if the new page can't support it.
        }
      }
    }

    return translated.result
  }
  async isExplicitContentEditableTarget(this: any,
    sessionName: string,
    element: string
  ): Promise<boolean> {
    const result = await this.execAgentBrowser(sessionName, [
      'get',
      'attr',
      element,
      'contenteditable'
    ])
    return isExplicitContentEditableResult(result)
  }
  async fillExplicitContentEditable(this: any,
    sessionName: string,
    element: string,
    value: string
  ): Promise<void> {
    await this.execAgentBrowser(sessionName, ['focus', element])
    // Why: stdin avoids argv limits and keeps replacement atomic; chunked edits can move focus and split a fill across controls.
    await this.execAgentBrowser(sessionName, ['eval', '--stdin'], {
      stdinText: focusedRichTextEditExpression(JSON.stringify(value), { selectAll: true })
    })
  }
  createPageUnavailableError(this: any, sessionName: string): BrowserError {
    return new BrowserError('browser_tab_not_found', pageUnavailableMessageForSession(sessionName))
  }
}
export type AgentBrowserBridgeMethods24Surface = typeof AgentBrowserBridgeMethods24
