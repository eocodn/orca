import type {
  BrowserCaptureStartResult, BrowserCaptureStopResult, BrowserCheckResult, BrowserClearResult,
  BrowserConsoleResult, BrowserCookieDeleteResult, BrowserCookieGetResult, BrowserCookieSetResult,
  BrowserFocusResult, BrowserGeolocationResult, BrowserInterceptDisableResult, BrowserInterceptEnableResult,
  BrowserKeypressResult, BrowserNetworkLogResult, BrowserPdfResult, BrowserScreenshotResult,
  BrowserSelectAllResult, BrowserViewportResult
} from "../../shared/runtime-types"
import { RuntimeBrowserCoreCommands, clampOptionalNumber } from "./orca-runtime-browser-core"
import type { BrowserCommandTargetParams } from "./orca-runtime-browser-base"

export class RuntimeBrowserExtraCommands extends RuntimeBrowserCoreCommands {
  async browserCheck(
    params: { element: string; checked: boolean } & BrowserCommandTargetParams
  ): Promise<BrowserCheckResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().check(
      params.element,
      params.checked,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserFocus(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<BrowserFocusResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().focus(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserClear(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<BrowserClearResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().clear(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSelectAll(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<BrowserSelectAllResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().selectAll(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserKeypress(
    params: { key: string } & BrowserCommandTargetParams
  ): Promise<BrowserKeypressResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().keypress(
      params.key,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserPdf(params: BrowserCommandTargetParams): Promise<BrowserPdfResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().pdf(target.worktreeId, target.browserPageId)
  }

  async browserFullScreenshot(
    params: {
      format?: 'png' | 'jpeg'
    } & BrowserCommandTargetParams
  ): Promise<BrowserScreenshotResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().fullPageScreenshot(
      params.format,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Cookie management ──

  async browserCookieGet(
    params: { url?: string } & BrowserCommandTargetParams
  ): Promise<BrowserCookieGetResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().cookieGet(
      params.url,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserCookieSet(
    params: {
      name: string
      value: string
      domain?: string
      path?: string
      secure?: boolean
      httpOnly?: boolean
      sameSite?: string
      expires?: number
    } & BrowserCommandTargetParams
  ): Promise<BrowserCookieSetResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().cookieSet(
      params,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserCookieDelete(
    params: {
      name: string
      domain?: string
      url?: string
    } & BrowserCommandTargetParams
  ): Promise<BrowserCookieDeleteResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().cookieDelete(
      params.name,
      params.domain,
      params.url,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Viewport ──

  async browserSetViewport(
    params: {
      width: number
      height: number
      deviceScaleFactor?: number
      mobile?: boolean
    } & BrowserCommandTargetParams
  ): Promise<BrowserViewportResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setViewport(
      params.width,
      params.height,
      params.deviceScaleFactor,
      params.mobile,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Geolocation ──

  async browserSetGeolocation(
    params: {
      latitude: number
      longitude: number
      accuracy?: number
    } & BrowserCommandTargetParams
  ): Promise<BrowserGeolocationResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setGeolocation(
      params.latitude,
      params.longitude,
      params.accuracy,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Request interception ──

  async browserInterceptEnable(
    params: {
      patterns?: string[]
    } & BrowserCommandTargetParams
  ): Promise<BrowserInterceptEnableResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().interceptEnable(
      params.patterns,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserInterceptDisable(
    params: BrowserCommandTargetParams
  ): Promise<BrowserInterceptDisableResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().interceptDisable(
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserInterceptList(params: BrowserCommandTargetParams): Promise<{ requests: unknown[] }> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().interceptList(target.worktreeId, target.browserPageId)
  }

  // ── Console/network capture ──

  async browserCaptureStart(
    params: BrowserCommandTargetParams
  ): Promise<BrowserCaptureStartResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().captureStart(target.worktreeId, target.browserPageId)
  }

  async browserCaptureStop(params: BrowserCommandTargetParams): Promise<BrowserCaptureStopResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().captureStop(target.worktreeId, target.browserPageId)
  }

  async browserConsoleLog(
    params: { limit?: number } & BrowserCommandTargetParams
  ): Promise<BrowserConsoleResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().consoleLog(
      params.limit,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserNetworkLog(
    params: { limit?: number } & BrowserCommandTargetParams
  ): Promise<BrowserNetworkLogResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().networkLog(
      params.limit,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Additional core commands ──

  async browserDblclick(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().dblclick(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserForward(params: BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().forward(target.worktreeId, target.browserPageId)
  }

  async browserScrollIntoView(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().scrollIntoView(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserGet(
    params: {
      what: string
      selector?: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().get(
      params.what,
      params.selector,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserIs(
    params: { what: string; selector: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().is(
      params.what,
      params.selector,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Keyboard insert text ──

  async browserKeyboardInsertText(
    params: { text: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().keyboardInsertText(
      params.text,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Mouse commands ──

  async browserMouseMove(
    params: { x: number; y: number } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().mouseMove(
      params.x,
      params.y,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserMouseDown(
    params: { button?: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().mouseDown(
      params.button,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserMouseClick(
    params: {
      x: number
      y: number
      button?: string
      radius?: number
      modifiers?: ('cmd' | 'ctrl' | 'alt' | 'shift')[]
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().mouseClick(
      params.x,
      params.y,
      params.button,
      target.worktreeId,
      target.browserPageId,
      clampOptionalNumber(params.radius, 0, 64),
      params.modifiers
    )
  }

  async browserMouseUp(params: { button?: string } & BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().mouseUp(
      params.button,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserMouseWheel(
    params: {
      dy: number
      dx?: number
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().mouseWheel(
      params.dy,
      params.dx,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Find (semantic locators) ──

  async browserFind(
    params: {
      locator: string
      value: string
      action: string
      text?: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().find(
      params.locator,
      params.value,
      params.action,
      params.text,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Set commands ──

  async browserSetDevice(params: { name: string } & BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setDevice(
      params.name,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSetOffline(
    params: { state?: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setOffline(
      params.state,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSetHeaders(
    params: { headers: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setHeaders(
      params.headers,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSetCredentials(
    params: {
      user: string
      pass: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setCredentials(
      params.user,
      params.pass,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSetMedia(
    params: {
      colorScheme?: string
      reducedMotion?: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().setMedia(
      params.colorScheme,
      params.reducedMotion,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Clipboard commands ──

  async browserClipboardRead(params: BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().clipboardRead(target.worktreeId, target.browserPageId)
  }

  async browserClipboardWrite(
    params: { text: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().clipboardWrite(
      params.text,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Dialog commands ──

  async browserDialogAccept(
    params: { text?: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().dialogAccept(
      params.text,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserDialogDismiss(params: BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().dialogDismiss(target.worktreeId, target.browserPageId)
  }

  // ── Storage commands ──

  async browserStorageLocalGet(
    params: { key: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageLocalGet(
      params.key,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserStorageLocalSet(
    params: {
      key: string
      value: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageLocalSet(
      params.key,
      params.value,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserStorageLocalClear(params: BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageLocalClear(
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserStorageSessionGet(
    params: { key: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageSessionGet(
      params.key,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserStorageSessionSet(
    params: {
      key: string
      value: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageSessionSet(
      params.key,
      params.value,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserStorageSessionClear(params: BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().storageSessionClear(
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Download command ──

  async browserDownload(
    params: {
      selector: string
      path: string
    } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().download(
      params.selector,
      params.path,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── Highlight command ──

  async browserHighlight(
    params: { selector: string } & BrowserCommandTargetParams
  ): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().highlight(
      params.selector,
      target.worktreeId,
      target.browserPageId
    )
  }

  // ── New: exec passthrough + tab lifecycle ──

  async browserExec(params: { command: string } & BrowserCommandTargetParams): Promise<unknown> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().exec(
      params.command,
      target.worktreeId,
      target.browserPageId
    )
  }


}
