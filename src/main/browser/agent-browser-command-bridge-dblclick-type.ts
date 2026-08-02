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

export const AgentBrowserBridgeMethods4 = {
  async dblclick(this: any,
    element: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserClickResult> {
    return this.enqueueTargetedCommand(worktreeId, browserPageId, async (sessionName) => {
      return (await this.execAgentBrowser(sessionName, ['dblclick', element])) as BrowserClickResult
    })
  }
  async goto(this: any, url: string, worktreeId?: string, browserPageId?: string): Promise<BrowserGotoResult> {
    return this.enqueueTargetedCommand(
      worktreeId,
      browserPageId,
      async (_sessionName, target) => {
        const wc = this.requireTargetWebContents(target)
        const navigationUrl = normalizeBrowserNavigationUrl(url)
        if (!navigationUrl) {
          throw new BrowserError('invalid_argument', `Unsupported browser URL: ${url}`)
        }
        const navigationState: { preventUnloadEvent: Electron.Event | null } = {
          preventUnloadEvent: null
        }
        const onWillPreventUnload = (event: Electron.Event): void => {
          navigationState.preventUnloadEvent = event
        }
        wc.on('will-prevent-unload', onWillPreventUnload)
        let navigationAborted = false
        const navigationDeadline = Date.now() + EMBEDDED_NAVIGATION_TIMEOUT_MS
        let navigationTimeout: ReturnType<typeof setTimeout> | null = null
        try {
          await Promise.race([
            wc.loadURL(navigationUrl),
            new Promise<never>((_resolve, reject) => {
              navigationTimeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Browser navigation timed out after ${EMBEDDED_NAVIGATION_TIMEOUT_MS}ms`
                    )
                  ),
                EMBEDDED_NAVIGATION_TIMEOUT_MS
              )
              navigationTimeout.unref?.()
            })
          ])
        } catch (error) {
          if (navigationTimeout) {
            clearTimeout(navigationTimeout)
            navigationTimeout = null
          }
          if (!this.getWebContents(target.webContentsId)) {
            throw this.createPageUnavailableError(`orca-tab-${target.browserPageId}`)
          }
          // Why: ERR_ABORTED also covers a page vetoing unload; that navigation did not succeed.
          if (
            !isAbortedNavigationError(error) ||
            (navigationState.preventUnloadEvent !== null &&
              !navigationState.preventUnloadEvent.defaultPrevented)
          ) {
            throw new BrowserError(
              'browser_error',
              `Failed to navigate browser page ${target.browserPageId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
          navigationAborted = true
          // Why: a superseding navigation rejects the first load before its replacement has landed.
          await waitForAbortedNavigationReplacement(
            wc,
            target.browserPageId,
            Math.max(0, navigationDeadline - Date.now())
          )
        } finally {
          wc.removeListener('will-prevent-unload', onWillPreventUnload)
          if (navigationTimeout) {
            clearTimeout(navigationTimeout)
          }
        }

        // Why: cross-process navigation can replace the guest while retaining the same authoritative page id.
        const navigatedTarget = this.resolveCommandTarget(worktreeId, target.browserPageId)
        const navigatedWebContents = this.requireTargetWebContents(navigatedTarget)
        const loadError = navigationAborted
          ? this.browserManager.getBrowserPageLoadError(target.browserPageId)
          : null
        if (loadError) {
          throw new BrowserError(
            'browser_error',
            `Failed to navigate browser page ${target.browserPageId}: ${loadError.description} (${loadError.code})`
          )
        }
        return { url: navigatedWebContents.getURL(), title: navigatedWebContents.getTitle() }
      },
      { ensureSession: false }
    )
  }
  async fill(this: any,
    element: string,
    value: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserFillResult> {
    await assertClipboardTextWriteWithinLimitWithYield(value)
    // Why: agent-browser's CDP text insertion loses focus in Electron guests; edit through the browser's input pipeline instead.
    return this.enqueueTargetedCommand(
      worktreeId,
      browserPageId,
      async (sessionName) => {
        if (!(await this.isExplicitContentEditableTarget(sessionName, element))) {
          await this.execAgentBrowser(sessionName, ['focus', element])
          await this.execAgentBrowser(sessionName, [
            'eval',
            focusedValueSetExpression(JSON.stringify(''))
          ])
          for (const chunk of iterateBrowserTextInsertionChunks(
            value,
            AGENT_BROWSER_TEXT_ARGUMENT_MAX_BYTES
          )) {
            await this.execAgentBrowser(sessionName, [
              'eval',
              focusedValueSetExpression(JSON.stringify(chunk), { append: true })
            ])
          }
          await this.execAgentBrowser(sessionName, [
            'eval',
            focusedValueSetExpression(JSON.stringify(''), { append: true, dispatchEvents: true })
          ])
          return { filled: element } as BrowserFillResult
        }

        await this.fillExplicitContentEditable(sessionName, element, value)
        return { filled: element } as BrowserFillResult
      },
      { requireScopedTarget: true }
    )
  }
  async type(this: any,
    input: string,
    worktreeId?: string,
    browserPageId?: string
  ): Promise<BrowserTypeResult> {
    await assertClipboardTextWriteWithinLimitWithYield(input)
    return this.enqueueTargetedCommand(
      worktreeId,
      browserPageId,
      async (sessionName) => {
        for (const chunk of iterateBrowserTextInsertionChunks(
          input,
          AGENT_BROWSER_TEXT_ARGUMENT_MAX_BYTES
        )) {
          await this.execAgentBrowser(sessionName, ['keyboard', 'type', chunk])
        }
        return { typed: true } as BrowserTypeResult
      },
      { requireScopedTarget: true }
    )
  }
}
export type AgentBrowserBridgeMethods4Surface = typeof AgentBrowserBridgeMethods4
