import { randomUUID } from 'node:crypto'
import { webContents, type WebContents } from 'electron'
import { browserManager } from './browser-manager'
import { browserSessionRegistry } from './browser-session-registry'
import type {
  BrowserBackResult,
  BrowserEvalResult,
  BrowserGotoResult,
  BrowserKeypressResult,
  BrowserReloadResult,
  BrowserScreencastResult,
  BrowserTabCurrentResult,
  BrowserTabInfo,
  BrowserTabListResult,
  BrowserTabShowResult,
  BrowserTabSwitchResult,
  BrowserViewportResult
} from '../../shared/runtime-browser'

export type BrowserMouseButton = 'left' | 'middle' | 'right'

export type BrowserPageTarget = { page?: string; worktree?: string }

export type BrowserPageScreencastSession = {
  subscriptionId: string
  ready: Extract<BrowserScreencastResult, { type: 'ready' }>
  session: { stop: () => void; done: Promise<void> }
}

function requireGuest(pageId: string): WebContents {
  const id = browserManager.getGuestWebContentsId(pageId)
  const guest = id == null ? null : webContents.fromId(id)
  if (!guest || guest.isDestroyed()) {
    throw new Error(`Browser page ${pageId} was not found`)
  }
  return guest
}

function tabInfo(pageId: string, active = false): BrowserTabInfo {
  const guest = requireGuest(pageId)
  const profileId = browserManager.getSessionProfileIdForTab(pageId)
  const profile = profileId ? browserSessionRegistry.getProfile(profileId) : null
  return {
    browserPageId: pageId,
    index: 0,
    url: guest.getURL(),
    title: guest.getTitle(),
    active,
    worktreeId: browserManager.getWorktreeIdForTab(pageId) ?? null,
    profileId,
    profileLabel: profile?.label ?? null
  }
}

export class BrowserPageRuntime {
  private activePageByWorktree = new Map<string, string>()

  getRegisteredTabs(worktree?: string): Map<string, number> {
    const all = browserManager.getWebContentsIdByTabId()
    if (!worktree) return new Map(all)
    return new Map(
      [...all].filter(([pageId]) => browserManager.getWorktreeIdForTab(pageId) === worktree)
    )
  }

  getActivePageId(worktree?: string, page?: string): string | null {
    if (page && this.getRegisteredTabs(worktree).has(page)) return page
    const remembered = worktree ? this.activePageByWorktree.get(worktree) : undefined
    if (remembered && this.getRegisteredTabs(worktree).has(remembered)) return remembered
    return this.getRegisteredTabs(worktree).keys().next().value ?? null
  }

  setActiveTab(webContentsId: number, worktree?: string): void {
    const page = [...this.getRegisteredTabs(worktree)].find(([, id]) => id === webContentsId)?.[0]
    if (page && worktree) this.activePageByWorktree.set(worktree, page)
  }

  getPageInfo(worktree?: string, page?: string): BrowserTabInfo | null {
    const id = this.getActivePageId(worktree, page)
    return id ? tabInfo(id, id === this.getActivePageId(worktree)) : null
  }

  tabList(worktree?: string): BrowserTabListResult {
    const active = this.getActivePageId(worktree)
    return {
      tabs: [...this.getRegisteredTabs(worktree).keys()].flatMap((id) => {
        try {
          return [tabInfo(id, id === active)]
        } catch {
          return []
        }
      })
    }
  }

  tabCurrent(worktree?: string): BrowserTabCurrentResult {
    const page = this.getActivePageId(worktree)
    if (!page) throw new Error('No browser tab open in this worktree')
    return { tab: tabInfo(page, true) }
  }

  tabShow(page: string, worktree?: string): BrowserTabShowResult {
    if (!this.getRegisteredTabs(worktree).has(page)) {
      throw new Error(`Browser page ${page} was not found in this worktree`)
    }
    return { tab: tabInfo(page, true) }
  }

  tabSwitch(index?: number, worktree?: string, page?: string): BrowserTabSwitchResult {
    const tabs = [...this.getRegisteredTabs(worktree).keys()]
    const selected = page ?? (index == null ? tabs[0] : tabs[index])
    if (!selected) throw new Error('No browser tab open in this worktree')
    if (!tabs.includes(selected)) {
      throw new Error(`Browser page ${selected} was not found in this worktree`)
    }
    const owner = browserManager.getWorktreeIdForTab(selected)
    if (owner) this.activePageByWorktree.set(owner, selected)
    return { switched: Math.max(0, tabs.indexOf(selected)), browserPageId: selected }
  }

  async goto(page: string, url: string): Promise<BrowserGotoResult> {
    const guest = requireGuest(page)
    await guest.loadURL(url)
    return { url: guest.getURL(), title: guest.getTitle() }
  }

  async back(page: string): Promise<BrowserBackResult> {
    const guest = requireGuest(page)
    if (guest.canGoBack()) guest.goBack()
    return { url: guest.getURL(), title: guest.getTitle() }
  }

  async forward(page: string): Promise<BrowserBackResult> {
    const guest = requireGuest(page)
    if (guest.canGoForward()) guest.goForward()
    return { url: guest.getURL(), title: guest.getTitle() }
  }

  async reload(page: string): Promise<BrowserReloadResult> {
    const guest = requireGuest(page)
    await guest.reload()
    return { url: guest.getURL(), title: guest.getTitle() }
  }

  async eval(page: string, expression: string): Promise<BrowserEvalResult> {
    const guest = requireGuest(page)
    const value = await guest.executeJavaScript(expression, true)
    return {
      result: typeof value === 'string' ? value : JSON.stringify(value),
      origin: guest.getURL()
    }
  }

  keypress(page: string, key: string): BrowserKeypressResult {
    requireGuest(page).sendInputEvent({ type: 'keyDown', keyCode: key })
    requireGuest(page).sendInputEvent({ type: 'keyUp', keyCode: key })
    return { pressed: key }
  }

  mouseMove(page: string, x: number, y: number): void {
    requireGuest(page).sendInputEvent({ type: 'mouseMove', x, y })
  }

  mouseButton(
    page: string,
    type: 'mouseDown' | 'mouseUp',
    x: number,
    y: number,
    button: BrowserMouseButton = 'left'
  ): void {
    requireGuest(page).sendInputEvent({ type, x, y, button })
  }

  mouseWheel(page: string, x: number, y: number, deltaX: number, deltaY: number): void {
    requireGuest(page).sendInputEvent({ type: 'mouseWheel', x, y, deltaX, deltaY })
  }

  async setViewport(
    page: string,
    width: number,
    height: number,
    deviceScaleFactor = 1,
    mobile = false
  ): Promise<BrowserViewportResult> {
    const ok = await browserManager.setViewportOverride(page, {
      width,
      height,
      deviceScaleFactor,
      mobile
    })
    if (!ok) throw new Error(`Browser page ${page} is unavailable`)
    return { width, height, deviceScaleFactor, mobile }
  }

  async screencast(
    page: string,
    format: 'jpeg' | 'png',
    sendBinary: (bytes: Uint8Array) => boolean | void,
    emit: (event: BrowserScreencastResult) => void
  ): Promise<BrowserPageScreencastSession> {
    const guest = requireGuest(page)
    const subscriptionId = `browser-screencast:${page}:${randomUUID()}`
    if (!guest.debugger.isAttached()) guest.debugger.attach('1.3')
    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    let stopped = false
    const onMessage = (
      _event: unknown,
      method: string,
      params: { data?: string; sessionId?: number }
    ): void => {
      if (method !== 'Page.screencastFrame' || stopped || !params.data) return
      sendBinary(Buffer.from(params.data, 'base64'))
      if (params.sessionId !== undefined) {
        void guest.debugger
          .sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
          .catch(() => {})
      }
    }
    guest.debugger.on('message', onMessage)
    await guest.debugger.sendCommand('Page.startScreencast', { format, everyNthFrame: 1 })
    const ready = {
      type: 'ready' as const,
      subscriptionId,
      browserPageId: page,
      format,
      tab: tabInfo(page, true)
    }
    emit(ready)
    return {
      subscriptionId,
      ready,
      session: {
        stop: () => {
          if (stopped) return
          stopped = true
          guest.debugger.off('message', onMessage)
          void guest.debugger.sendCommand('Page.stopScreencast').catch(() => {})
          resolveDone()
          emit({ type: 'end', subscriptionId })
        },
        done
      }
    }
  }
}
