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

import { AgentBrowserBridgeMethods1, type AgentBrowserBridgeMethods1Surface } from './agent-browser-command-bridge-set-active-tab-get-page-info'
import { AgentBrowserBridgeMethods2, type AgentBrowserBridgeMethods2Surface } from './agent-browser-command-bridge-on-tab-changed-get-registered-tabs'
import { AgentBrowserBridgeMethods3, type AgentBrowserBridgeMethods3Surface } from './agent-browser-command-bridge-tab-list-click'
import { AgentBrowserBridgeMethods4, type AgentBrowserBridgeMethods4Surface } from './agent-browser-command-bridge-dblclick-type'
import { AgentBrowserBridgeMethods5, type AgentBrowserBridgeMethods5Surface } from './agent-browser-command-bridge-select-get'
import { AgentBrowserBridgeMethods6, type AgentBrowserBridgeMethods6Surface } from './agent-browser-command-bridge-is-mouse-down'
import { AgentBrowserBridgeMethods7, type AgentBrowserBridgeMethods7Surface } from './agent-browser-command-bridge-mouse-click-find'
import { AgentBrowserBridgeMethods8, type AgentBrowserBridgeMethods8Surface } from './agent-browser-command-bridge-set-device-set-credentials'
import { AgentBrowserBridgeMethods9, type AgentBrowserBridgeMethods9Surface } from './agent-browser-command-bridge-set-media-dialog-accept'
import { AgentBrowserBridgeMethods10, type AgentBrowserBridgeMethods10Surface } from './agent-browser-command-bridge-dialog-dismiss-storage-local-clear'
import { AgentBrowserBridgeMethods11, type AgentBrowserBridgeMethods11Surface } from './agent-browser-command-bridge-storage-session-get-download'
import { AgentBrowserBridgeMethods12, type AgentBrowserBridgeMethods12Surface } from './agent-browser-command-bridge-highlight-reload'
import { AgentBrowserBridgeMethods13, type AgentBrowserBridgeMethods13Surface } from './agent-browser-command-bridge-screenshot-capture-screenshot-command'
import { AgentBrowserBridgeMethods14, type AgentBrowserBridgeMethods14Surface } from './agent-browser-command-bridge-capture-full-page-screenshot-command-hover'
import { AgentBrowserBridgeMethods15, type AgentBrowserBridgeMethods15Surface } from './agent-browser-command-bridge-drag-check'
import { AgentBrowserBridgeMethods16, type AgentBrowserBridgeMethods16Surface } from './agent-browser-command-bridge-focus-keypress'
import { AgentBrowserBridgeMethods17, type AgentBrowserBridgeMethods17Surface } from './agent-browser-command-bridge-pdf-cookie-delete'
import { AgentBrowserBridgeMethods18, type AgentBrowserBridgeMethods18Surface } from './agent-browser-command-bridge-set-viewport-intercept-disable'
import { AgentBrowserBridgeMethods19, type AgentBrowserBridgeMethods19Surface } from './agent-browser-command-bridge-intercept-list-console-log'
import { AgentBrowserBridgeMethods20, type AgentBrowserBridgeMethods20Surface } from './agent-browser-command-bridge-network-log-enqueue-command'
import { AgentBrowserBridgeMethods21, type AgentBrowserBridgeMethods21Surface } from './agent-browser-command-bridge-enqueue-targeted-command-process-queue'
import { AgentBrowserBridgeMethods22, type AgentBrowserBridgeMethods22Surface } from './agent-browser-command-bridge-get-active-page-id-resolve-scoped-active-tab'
import { AgentBrowserBridgeMethods23, type AgentBrowserBridgeMethods23Surface } from './agent-browser-command-bridge-ensure-session-reject-queued-commands-for-closed-session'
import { AgentBrowserBridgeMethods24, type AgentBrowserBridgeMethods24Surface } from './agent-browser-command-bridge-exec-agent-browser-create-page-unavailable-error'
import { AgentBrowserBridgeMethods25, type AgentBrowserBridgeMethods25Surface } from './agent-browser-command-bridge-close-stale-agent-browser-session-run-agent-browser-raw'
import { AgentBrowserBridgeMethods26, type AgentBrowserBridgeMethods26Surface } from './agent-browser-command-bridge-resolve-tab-id-safe-get-web-contents'

export * from './agent-browser-command-bridge-foundation'

export class AgentBrowserBridge {

  // Why: per-worktree active tab so one worktree's tab switch can't affect another's command targeting.
  private readonly activeWebContentsPerWorktree = new Map<string, number>()
  private activeWebContentsId: number | null = null
  private readonly sessions = new Map<string, SessionState>()
  private readonly commandQueues = new Map<string, QueuedCommand[]>()
  private readonly processingQueues = new Set<string>()
  // Why: screenshot prep mutates shared paintability across tabs; serialize globally so concurrent captures don't blank each other.
  private screenshotTurn: Promise<void> = Promise.resolve()
  private readonly agentBrowserBin: string
  // Why: stash intercept patterns from a swap-destroyed session, keyed by name, so the next session restores them.
  private readonly pendingInterceptRestore = new Map<string, string[]>()
  // Why: promise-lock so two concurrent ensureSession calls don't both create the session entry.
  private readonly pendingSessionCreation = new Map<string, Promise<void>>()
  // Why: `agent-browser close` is async, keyed by session name — recreating before it finishes lets the old teardown close the new session.
  private readonly pendingSessionDestruction = new Map<string, Promise<void>>()
  private readonly cancelledProcesses = new WeakSet<ChildProcess>()


  constructor(
    private readonly browserManager: BrowserManager,
    private readonly options: AgentBrowserBridgeOptions = {}
  ) {
    this.agentBrowserBin = resolveAgentBrowserBinary()
  }
}

export interface AgentBrowserBridge extends AgentBrowserBridgeMethods1Surface, AgentBrowserBridgeMethods2Surface, AgentBrowserBridgeMethods3Surface, AgentBrowserBridgeMethods4Surface, AgentBrowserBridgeMethods5Surface, AgentBrowserBridgeMethods6Surface, AgentBrowserBridgeMethods7Surface, AgentBrowserBridgeMethods8Surface, AgentBrowserBridgeMethods9Surface, AgentBrowserBridgeMethods10Surface, AgentBrowserBridgeMethods11Surface, AgentBrowserBridgeMethods12Surface, AgentBrowserBridgeMethods13Surface, AgentBrowserBridgeMethods14Surface, AgentBrowserBridgeMethods15Surface, AgentBrowserBridgeMethods16Surface, AgentBrowserBridgeMethods17Surface, AgentBrowserBridgeMethods18Surface, AgentBrowserBridgeMethods19Surface, AgentBrowserBridgeMethods20Surface, AgentBrowserBridgeMethods21Surface, AgentBrowserBridgeMethods22Surface, AgentBrowserBridgeMethods23Surface, AgentBrowserBridgeMethods24Surface, AgentBrowserBridgeMethods25Surface, AgentBrowserBridgeMethods26Surface {}

Object.assign(AgentBrowserBridge.prototype, AgentBrowserBridgeMethods1, AgentBrowserBridgeMethods2, AgentBrowserBridgeMethods3, AgentBrowserBridgeMethods4, AgentBrowserBridgeMethods5, AgentBrowserBridgeMethods6, AgentBrowserBridgeMethods7, AgentBrowserBridgeMethods8, AgentBrowserBridgeMethods9, AgentBrowserBridgeMethods10, AgentBrowserBridgeMethods11, AgentBrowserBridgeMethods12, AgentBrowserBridgeMethods13, AgentBrowserBridgeMethods14, AgentBrowserBridgeMethods15, AgentBrowserBridgeMethods16, AgentBrowserBridgeMethods17, AgentBrowserBridgeMethods18, AgentBrowserBridgeMethods19, AgentBrowserBridgeMethods20, AgentBrowserBridgeMethods21, AgentBrowserBridgeMethods22, AgentBrowserBridgeMethods23, AgentBrowserBridgeMethods24, AgentBrowserBridgeMethods25, AgentBrowserBridgeMethods26)
