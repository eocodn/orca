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

export const AgentBrowserBridgeMethods21 = {
  async enqueueTargetedCommand<T>(this: any,
    worktreeId: string | undefined,
    browserPageId: string | undefined,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions = {}
  ): Promise<T> {
    const target = this.resolveCommandTarget(worktreeId, browserPageId, options.requireScopedTarget)
    const sessionName = `orca-tab-${target.browserPageId}`

    if (options.ensureSession !== false) {
      await this.ensureSession(sessionName, target.browserPageId, target.webContentsId)
    }

    return new Promise<T>((resolve, reject) => {
      let queue = this.commandQueues.get(sessionName)
      if (!queue) {
        queue = []
        this.commandQueues.set(sessionName, queue)
      }
      queue.push({
        execute: (() =>
          this.executeWithVisibleTarget(
            sessionName,
            worktreeId,
            target,
            execute,
            options
          )) as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.processQueue(sessionName)
    })
  }
  async executeWithVisibleTarget<T>(this: any,
    sessionName: string,
    worktreeId: string | undefined,
    target: ResolvedBrowserCommandTarget,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions
  ): Promise<T> {
    if (options.ensureVisible === false) {
      return execute(sessionName, target)
    }

    // Why: inactive panes are display:none; the automation lease makes only this target paintable without selecting it.
    const restore = await this.browserManager.acquireAutomationVisibility(target.webContentsId)
    try {
      const visibleTarget = await this.refreshTargetAfterAutomationVisibility(
        sessionName,
        worktreeId,
        target,
        options
      )
      return await execute(sessionName, visibleTarget)
    } finally {
      restore()
    }
  }
  async refreshTargetAfterAutomationVisibility(this: any,
    sessionName: string,
    worktreeId: string | undefined,
    target: ResolvedBrowserCommandTarget,
    options: EnqueueTargetedCommandOptions
  ): Promise<ResolvedBrowserCommandTarget> {
    const visibleTarget = this.resolveCommandTarget(worktreeId, target.browserPageId)
    if (visibleTarget.webContentsId === target.webContentsId) {
      return visibleTarget
    }

    if (this.activeWebContentsId === target.webContentsId) {
      this.activeWebContentsId = visibleTarget.webContentsId
    }
    if (worktreeId && this.activeWebContentsPerWorktree.get(worktreeId) === target.webContentsId) {
      this.activeWebContentsPerWorktree.set(worktreeId, visibleTarget.webContentsId)
    }

    // Why: making a parked webview paintable can re-register the page with a new guest webContents; tear down the stale session.
    await this.restartSessionForTarget(
      sessionName,
      visibleTarget.browserPageId,
      visibleTarget.webContentsId,
      { recreate: options.ensureSession !== false }
    )

    return visibleTarget
  }
  async processQueue(this: any, sessionName: string): Promise<void> {
    if (this.processingQueues.has(sessionName)) {
      return
    }
    this.processingQueues.add(sessionName)

    const queue = this.commandQueues.get(sessionName)
    while (queue && queue.length > 0) {
      const cmd = queue.shift()!
      try {
        const result = await cmd.execute()
        cmd.resolve(result)
      } catch (error) {
        cmd.reject(error)
      }
    }

    if (queue && queue.length === 0 && this.commandQueues.get(sessionName) === queue) {
      this.commandQueues.delete(sessionName)
    }
    this.processingQueues.delete(sessionName)
  }
}
export type AgentBrowserBridgeMethods21Surface = typeof AgentBrowserBridgeMethods21
