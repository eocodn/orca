import { randomUUID } from 'node:crypto'
import { BrowserError } from "../browser/cdp-bridge"
import { browserManager } from '../browser/browser-manager'
import { browserCertificateTrustController } from '../browser/browser-manager-lifecycle'
import { startBrowserScreencast, type BrowserScreencastSession } from "../browser/browser-screencast-stream"
import type {
  BrowserBackResult, BrowserClickResult, BrowserEvalResult, BrowserFillResult, BrowserGotoResult,
  BrowserReloadResult, BrowserScreenshotResult, BrowserScrollResult, BrowserSelectResult,
  BrowserScreencastResult, BrowserSnapshotResult, BrowserTabCurrentResult, BrowserTabListResult,
  BrowserTabShowResult, BrowserTabSwitchResult, BrowserTypeResult, BrowserUploadResult, BrowserWaitResult,
  BrowserHoverResult, BrowserDragResult
} from "../../shared/runtime-types"
import type { BrowserCertificateProceedResult } from "../../shared/types"
import {
  RuntimeBrowserBaseCommands, clampInteger, clampOptionalInteger, clampOptionalNumber,
  type BrowserCommandTargetParams, type BrowserScreencastParams, type BrowserScreencastStartResult
  , type ActiveBrowserScreencastPage
} from "./orca-runtime-browser-base"

export class RuntimeBrowserCoreCommands extends RuntimeBrowserBaseCommands {
  async browserSnapshot(params: BrowserCommandTargetParams): Promise<BrowserSnapshotResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().snapshot(target.worktreeId, target.browserPageId)
  }

  async browserClick(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<BrowserClickResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const bridge = this.requireAgentBrowserBridge()
    const result = await bridge.click(params.element, target.worktreeId, target.browserPageId)
    // Why: clicks can trigger navigation, so push the tab's live URL/title to the renderer even when automation targeted a non-active page.
    const page = bridge.getPageInfo(target.worktreeId, target.browserPageId)
    if (page) {
      this.notifyRendererNavigation(page.browserPageId, page.url, page.title)
    }
    return result
  }

  async browserGoto(
    params: { url: string } & BrowserCommandTargetParams
  ): Promise<BrowserGotoResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const bridge = this.requireAgentBrowserBridge()
    const result = await bridge.goto(params.url, target.worktreeId, target.browserPageId)
    const pageId = bridge.getActivePageId(target.worktreeId, target.browserPageId)
    if (pageId) {
      this.notifyRendererNavigation(pageId, result.url, result.title)
    }
    return result
  }

  async browserFill(
    params: {
      element: string
      value: string
    } & BrowserCommandTargetParams
  ): Promise<BrowserFillResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().fill(
      params.element,
      params.value,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserType(
    params: { input: string } & BrowserCommandTargetParams
  ): Promise<BrowserTypeResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().type(
      params.input,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserSelect(
    params: {
      element: string
      value: string
    } & BrowserCommandTargetParams
  ): Promise<BrowserSelectResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().select(
      params.element,
      params.value,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserScroll(
    params: { direction: 'up' | 'down'; amount?: number } & BrowserCommandTargetParams
  ): Promise<BrowserScrollResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().scroll(
      params.direction,
      params.amount,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserBack(params: BrowserCommandTargetParams): Promise<BrowserBackResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const bridge = this.requireAgentBrowserBridge()
    const result = await bridge.back(target.worktreeId, target.browserPageId)
    const pageId = bridge.getActivePageId(target.worktreeId, target.browserPageId)
    if (pageId) {
      this.notifyRendererNavigation(pageId, result.url, result.title)
    }
    return result
  }

  async browserReload(params: BrowserCommandTargetParams): Promise<BrowserReloadResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const bridge = this.requireAgentBrowserBridge()
    const result = await bridge.reload(target.worktreeId, target.browserPageId)
    const pageId = bridge.getActivePageId(target.worktreeId, target.browserPageId)
    if (pageId) {
      this.notifyRendererNavigation(pageId, result.url, result.title)
    }
    return result
  }

  async browserScreenshot(
    params: {
      format?: 'png' | 'jpeg'
    } & BrowserCommandTargetParams
  ): Promise<BrowserScreenshotResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().screenshot(
      params.format,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserScreencast(
    params: BrowserScreencastParams,
    stream: {
      sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
      emit?: (event: BrowserScreencastResult) => void
    }
  ): Promise<BrowserScreencastStartResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { browserPageId, webContents: guest } = this.resolveBrowserPageWebContents(
      target.worktreeId,
      target.browserPageId
    )
    let stopping = this.stoppingScreencastPageIds.get(browserPageId)
    if (stopping) {
      await stopping
    }
    let active = this.activeScreencastsByPageId.get(browserPageId)
    while (active) {
      // Why: CDP allows one Page.startScreencast per page, so a new subscriber takes over a stale/hidden client instead of erroring.
      active.stop()
      await active.done
      stopping = this.stoppingScreencastPageIds.get(browserPageId)
      if (stopping) {
        await stopping
      }
      active = this.activeScreencastsByPageId.get(browserPageId)
    }
    this.activeScreencastPageIds.add(browserPageId)
    const format = params.format
    const subscriptionId = `browser-screencast:${browserPageId}:${randomUUID()}`
    let session: BrowserScreencastSession | null = null
    let resolveActiveDone!: () => void
    const activeDone = new Promise<void>((resolve) => {
      resolveActiveDone = resolve
    })
    let cancelledBeforeStart = false
    const activeRecord: ActiveBrowserScreencastPage = {
      stop: () => {
        if (session) {
          session.stop()
          return
        }
        cancelledBeforeStart = true
      },
      done: activeDone
    }
    this.activeScreencastsByPageId.set(browserPageId, activeRecord)
    try {
      session = await startBrowserScreencast(guest, {
        format,
        quality: clampInteger(params.quality, 10, 100, 70),
        maxWidth: clampInteger(params.maxWidth, 320, 3840, 1440),
        maxHeight: clampInteger(params.maxHeight, 240, 2160, 1200),
        viewportWidth: clampOptionalInteger(params.viewportWidth, 320, 3840),
        viewportHeight: clampOptionalInteger(params.viewportHeight, 240, 2160),
        deviceScaleFactor: clampOptionalNumber(params.deviceScaleFactor, 1, 4),
        mobile: params.mobile === true,
        everyNthFrame: clampInteger(params.everyNthFrame, 1, 10, 2),
        minFrameIntervalMs: clampInteger(params.minFrameIntervalMs, 0, 1000, 0),
        onFrame: stream.sendBinary,
        onEvent: stream.emit,
        onError: (message) => stream.emit?.({ type: 'error', message })
      })
      if (cancelledBeforeStart) {
        session.stop()
        await session.done
        throw new BrowserError('browser_error', 'Browser screencast was cancelled.')
      }
    } catch (error) {
      this.activeScreencastPageIds.delete(browserPageId)
      if (this.activeScreencastsByPageId.get(browserPageId) === activeRecord) {
        this.activeScreencastsByPageId.delete(browserPageId)
      }
      resolveActiveDone()
      throw error
    }
    let stoppingPromise: Promise<void> | null = null
    const clearPageGate = (): void => {
      this.activeScreencastPageIds.delete(browserPageId)
      if (this.activeScreencastsByPageId.get(browserPageId) === activeRecord) {
        this.activeScreencastsByPageId.delete(browserPageId)
      }
      if (
        stoppingPromise &&
        this.stoppingScreencastPageIds.get(browserPageId) === stoppingPromise
      ) {
        this.stoppingScreencastPageIds.delete(browserPageId)
      }
      resolveActiveDone()
    }
    const markStopping = (): void => {
      if (stoppingPromise || !session) {
        return
      }
      // Why: mobile can unsubscribe and instantly resubscribe on rotation; new streams wait for CDP teardown instead of failing already-active.
      stoppingPromise = session.done.finally(clearPageGate)
      this.stoppingScreencastPageIds.set(browserPageId, stoppingPromise)
    }
    void session.done.finally(() => {
      clearPageGate()
    })

    try {
      return {
        subscriptionId,
        session: {
          done: session.done,
          stop: () => {
            markStopping()
            session?.stop()
          }
        },
        ready: {
          type: 'ready',
          subscriptionId,
          browserPageId,
          format,
          tab: this.describeBrowserTab(browserPageId, target.worktreeId)
        }
      }
    } catch (error) {
      markStopping()
      session.stop()
      throw error
    }
  }

  async browserEval(
    params: { expression: string } & BrowserCommandTargetParams
  ): Promise<BrowserEvalResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().evaluate(
      params.expression,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserTabList(params: { worktree?: string }): Promise<BrowserTabListResult> {
    const worktreeId = await this.resolveBrowserWorktreeId(params.worktree)
    const result = this.requireAgentBrowserBridge().tabList(worktreeId)
    return {
      tabs: result.tabs.map((tab) => this.enrichBrowserTabInfo(tab))
    }
  }

  async browserProceedCertificate(
    params: { challengeId: string } & BrowserCommandTargetParams
  ): Promise<BrowserCertificateProceedResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    if (!target.browserPageId) {
      return { ok: false, reason: 'missing' }
    }
    return browserCertificateTrustController.proceed(target.browserPageId, params.challengeId)
  }

  async browserTabShow(params: { page: string; worktree?: string }): Promise<BrowserTabShowResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return { tab: this.describeBrowserTab(params.page, target.worktreeId) }
  }

  async browserTabCurrent(params: { worktree?: string }): Promise<BrowserTabCurrentResult> {
    const worktreeId = await this.resolveBrowserWorktreeId(params.worktree)
    const browserPageId = this.requireAgentBrowserBridge().getActivePageId(worktreeId)
    if (!browserPageId) {
      throw new BrowserError('browser_no_tab', 'No browser tab open in this worktree')
    }
    return { tab: this.describeBrowserTab(browserPageId, worktreeId) }
  }

  async browserTabSwitch(
    params: {
      index?: number
      focus?: boolean
    } & BrowserCommandTargetParams
  ): Promise<BrowserTabSwitchResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const bridge = this.requireAgentBrowserBridge()
    const result = await bridge.tabSwitch(params.index, target.worktreeId, target.browserPageId)
    if (params.focus) {
      // Why: scope focus to the tab's owning worktree; the renderer never yanks the user across worktrees on this signal (see focusBrowserTabInWorktree).
      const worktreeId =
        target.worktreeId ?? browserManager.getWorktreeIdForTab(result.browserPageId) ?? undefined
      this.notifyRendererBrowserPaneFocus(worktreeId, result.browserPageId)
    }
    return result
  }

  async browserHover(
    params: { element: string } & BrowserCommandTargetParams
  ): Promise<BrowserHoverResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().hover(
      params.element,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserDrag(
    params: {
      from: string
      to: string
    } & BrowserCommandTargetParams
  ): Promise<BrowserDragResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().drag(
      params.from,
      params.to,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserUpload(
    params: { element: string; files: string[] } & BrowserCommandTargetParams
  ): Promise<BrowserUploadResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    return this.requireAgentBrowserBridge().upload(
      params.element,
      params.files,
      target.worktreeId,
      target.browserPageId
    )
  }

  async browserWait(
    params: {
      selector?: string
      timeout?: number
      text?: string
      url?: string
      load?: string
      fn?: string
      state?: string
    } & BrowserCommandTargetParams
  ): Promise<BrowserWaitResult> {
    const target = await this.resolveBrowserCommandTarget(params)
    const { worktree: _, page: __, ...options } = params
    return this.requireAgentBrowserBridge().wait(options, target.worktreeId, target.browserPageId)
  }


}
