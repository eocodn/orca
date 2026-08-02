import { webContents } from 'electron'
import type {
  BrowserCaptureStartResult,
  BrowserCaptureStopResult,
  BrowserCheckResult,
  BrowserClearResult,
  BrowserClickResult,
  BrowserConsoleEntry,
  BrowserConsoleResult,
  BrowserCookie,
  BrowserCookieDeleteResult,
  BrowserCookieGetResult,
  BrowserCookieSetResult,
  BrowserDragResult,
  BrowserEvalResult,
  BrowserFillResult,
  BrowserFocusResult,
  BrowserGeolocationResult,
  BrowserGotoResult,
  BrowserHoverResult,
  BrowserInterceptDisableResult,
  BrowserInterceptEnableResult,
  BrowserInterceptedRequest,
  BrowserKeypressResult,
  BrowserNetworkEntry,
  BrowserNetworkLogResult,
  BrowserPdfResult,
  BrowserScreenshotResult,
  BrowserScrollResult,
  BrowserSelectAllResult,
  BrowserSelectResult,
  BrowserSnapshotResult,
  BrowserTabInfo,
  BrowserTabListResult,
  BrowserTabSwitchResult,
  BrowserTypeResult,
  BrowserUploadResult,
  BrowserViewportResult,
  BrowserWaitResult
} from '../../shared/runtime-types'
import {
  buildSnapshot,
  type CdpCommandSender,
  type RefEntry,
  type SnapshotResult
} from './snapshot-engine'
import { insertTextThroughCdp } from './browser-text-insertion'
import type { BrowserManager } from './browser-manager'
import { ANTI_DETECTION_SCRIPT } from './anti-detection'

import * as foundation from './cdp-command-bridge-foundation'
const { BrowserError, CAPTURE_LOG_LIMIT } = foundation
type QueuedCommand = foundation.QueuedCommand
type TabState = foundation.TabState

export const CdpBridgeMethods13 = {
  async ensureDebuggerAttached(this: any, guest: Electron.WebContents): Promise<void> {
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)
    if (state.debuggerAttached && guest.debugger.isAttached()) {
      return
    }

    try {
      // Why: BrowserManager already attached the debugger; reuse it to avoid "another debugger is already attached."
      if (!guest.debugger.isAttached()) {
        guest.debugger.attach('1.3')
      }
    } catch {
      throw new BrowserError(
        'browser_cdp_error',
        'Could not attach debugger. DevTools may already be open for this tab.'
      )
    }

    const sender = this.makeCdpSender(guest)
    await sender('Page.enable')
    await sender('DOM.enable')
    await sender('Network.enable')

    // Why: OOPIF iframes are invisible to the parent CDP session; flatten:true gives each a targetable sessionId.
    await sender('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    })

    // Why: CDP attach exposes automation signals (navigator.webdriver) that Cloudflare checks; override per new document.
    await sender('Page.addScriptToEvaluateOnNewDocument', {
      source: ANTI_DETECTION_SCRIPT
    })

    // Why: only remove this bridge's listeners; screencast/proxy sessions share the debugger and own their teardown.
    this.removeDebuggerListeners(guest, state)

    const detachListener = (): void => {
      state.debuggerAttached = false
      state.snapshotResult = null
      state.iframeSessions.clear()
      this.removeDebuggerListeners(guest, state)
    }

    const messageListener = (_event: unknown, method: string, params: unknown): void => {
      if (method === 'Page.frameNavigated') {
        state.snapshotResult = null
        state.navigationId = null
      }
      // Why: an unhandled JS dialog blocks all subsequent CDP commands; auto-dismiss to avoid hanging.
      if (method === 'Page.javascriptDialogOpening') {
        const dialog = params as { type: string; message: string } | undefined
        guest.debugger
          .sendCommand('Page.handleJavaScriptDialog', {
            accept: dialog?.type !== 'beforeunload'
          })
          .catch(() => {})
      }
      // Why: track iframe sessions so CDP commands and AX queries route to the correct session.
      if (method === 'Target.attachedToTarget') {
        const p = params as
          | {
              sessionId?: string
              targetInfo?: { type?: string; targetId?: string }
            }
          | undefined
        if (p?.sessionId && p.targetInfo?.type === 'iframe' && p.targetInfo.targetId) {
          state.iframeSessions.set(p.targetInfo.targetId, p.sessionId)
          guest.debugger.sendCommand('DOM.enable', {}, p.sessionId).catch(() => {})
          guest.debugger.sendCommand('Accessibility.enable', {}, p.sessionId).catch(() => {})
          guest.debugger.sendCommand('Runtime.enable', {}, p.sessionId).catch(() => {})
        }
      }
      if (method === 'Target.detachedFromTarget') {
        const p = params as { sessionId?: string } | undefined
        if (p?.sessionId) {
          for (const [frameId, sid] of state.iframeSessions) {
            if (sid === p.sessionId) {
              state.iframeSessions.delete(frameId)
              break
            }
          }
        }
      }
      // Why: buffer console/network events per-tab so the agent can retrieve them on demand.
      if (state.capturing) {
        if (method === 'Runtime.consoleAPICalled') {
          const p = params as
            | {
                type?: string
                args?: { value?: string; description?: string }[]
                timestamp?: number
                stackTrace?: { callFrames?: { url?: string; lineNumber?: number }[] }
              }
            | undefined
          if (p) {
            const text = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
            state.consoleLog.push({
              level: p.type ?? 'log',
              text,
              timestamp: p.timestamp ?? Date.now(),
              url: p.stackTrace?.callFrames?.[0]?.url,
              line: p.stackTrace?.callFrames?.[0]?.lineNumber
            })
            if (state.consoleLog.length > CAPTURE_LOG_LIMIT) {
              state.consoleLog.shift()
            }
          }
        }
        if (method === 'Network.responseReceived') {
          const p = params as
            | {
                requestId?: string
                response?: {
                  url?: string
                  status?: number
                  mimeType?: string
                  headers?: Record<string, string>
                }
                type?: string
                timestamp?: number
              }
            | undefined
          if (p?.response) {
            const entry: BrowserNetworkEntry = {
              url: p.response.url ?? '',
              method: '',
              status: p.response.status ?? 0,
              mimeType: p.response.mimeType ?? '',
              size: 0,
              timestamp: p.timestamp ?? Date.now()
            }
            state.networkLog.push(entry)
            // Why: map requestId→entry so loadingFinished attributes size to the right response, not the latest one.
            if (p.requestId) {
              state.networkRequestMap.set(p.requestId, entry)
            }
            if (state.networkLog.length > CAPTURE_LOG_LIMIT) {
              const evicted = state.networkLog.shift()
              if (evicted) {
                for (const [requestId, requestEntry] of state.networkRequestMap) {
                  if (requestEntry === evicted) {
                    state.networkRequestMap.delete(requestId)
                    break
                  }
                }
              }
            }
          }
        }
        if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
          const p = params as { requestId?: string; encodedDataLength?: number } | undefined
          if (p?.requestId) {
            const entry = state.networkRequestMap.get(p.requestId)
            if (entry && method === 'Network.loadingFinished' && p.encodedDataLength) {
              entry.size = p.encodedDataLength
            }
            state.networkRequestMap.delete(p.requestId)
          }
        }
      }
      // Why: buffer paused requests so the agent can later inspect and continue or block them.
      if (state.intercepting && method === 'Fetch.requestPaused') {
        const p = params as
          | {
              requestId?: string
              request?: { url?: string; method?: string; headers?: Record<string, string> }
              resourceType?: string
            }
          | undefined
        if (p?.requestId && p.request) {
          state.pausedRequests.set(p.requestId, {
            id: p.requestId,
            url: p.request.url ?? '',
            method: p.request.method ?? 'GET',
            headers: (p.request.headers ?? {}) as Record<string, string>,
            resourceType: p.resourceType ?? 'Other'
          })
        }
      }
    }

    state.debuggerDetachListener = detachListener
    state.debuggerMessageListener = messageListener
    guest.debugger.on('detach', detachListener)
    guest.debugger.on('message', messageListener)

    state.debuggerAttached = true
  }
  makeCdpSender(this: any, guest: Electron.WebContents, sessionId?: string): CdpCommandSender {
    return (method: string, params?: Record<string, unknown>) => {
      const command = guest.debugger.sendCommand(method, params, sessionId) as Promise<unknown>
      // Why: Electron's CDP sendCommand can hang on a stale debugger session, so a 10s timeout bounds the RPC.
      let timer: ReturnType<typeof setTimeout>
      return Promise.race([
        command.finally(() => clearTimeout(timer)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new BrowserError('browser_cdp_error', `CDP command "${method}" timed out`)),
            10_000
          )
        })
      ])
    }
  }
  senderForRef(this: any, guest: Electron.WebContents, ref: RefEntry): CdpCommandSender {
    return ref.sessionId ? this.makeCdpSender(guest, ref.sessionId) : this.makeCdpSender(guest)
  }
  async resolveRef(this: any,
    guest: Electron.WebContents,
    sender: CdpCommandSender,
    ref: string
  ): Promise<RefEntry> {
    const tabId = this.resolveTabId(guest.id)
    const state = this.getOrCreateTabState(tabId)

    if (!state.snapshotResult) {
      throw new BrowserError(
        'browser_stale_ref',
        "No snapshot exists for this tab. Run 'orca snapshot' first."
      )
    }

    const entry = state.snapshotResult.refMap.get(ref)
    if (!entry) {
      throw new BrowserError(
        'browser_ref_not_found',
        `Element ref ${ref} was not found. Run 'orca snapshot' to see available refs.`
      )
    }

    // Why: iframe refs use a child session with independent nav history, so a parent-navId check would falsely reject them.
    if (!entry.sessionId) {
      const currentNavId = await this.getNavigationId(sender)
      if (state.navigationId && currentNavId !== state.navigationId) {
        state.snapshotResult = null
        state.navigationId = null
        throw new BrowserError(
          'browser_stale_ref',
          "The page has navigated since the last snapshot. Run 'orca snapshot' to get fresh refs."
        )
      }
    }

    const refSender = entry.sessionId ? this.makeCdpSender(guest, entry.sessionId) : sender
    try {
      await refSender('DOM.describeNode', { backendNodeId: entry.backendDOMNodeId })
      return entry
    } catch {
      // Why: dynamic pages re-render nodes, detaching snapshot refs; re-query the AX tree by role+name for the fresh node.
      const recovered = await this.tryRecoverRef(refSender, entry)
      if (recovered) {
        entry.backendDOMNodeId = recovered
        return entry
      }
      state.snapshotResult = null
      throw new BrowserError(
        'browser_stale_ref',
        `Element ${ref} no longer exists in the DOM. Run 'orca snapshot' to get fresh refs.`
      )
    }
  }
}
export type CdpBridgeMethods13Surface = typeof CdpBridgeMethods13
