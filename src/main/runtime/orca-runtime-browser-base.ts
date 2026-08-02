import { webContents, type BrowserWindow } from 'electron'
import type { BrowserScreencastResult, BrowserTabListResult } from '../../shared/runtime-types'
import type { AgentBrowserBridge } from '../browser/agent-browser-bridge'
import type { BrowserBackend } from '../browser/browser-backend'
import { browserManager } from '../browser/browser-manager'
import { BrowserError } from '../browser/cdp-bridge'
import type { BrowserScreencastSession } from '../browser/browser-screencast-stream'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import { waitForTabRegistration, waitForWorktreeTabRegistration } from '../ipc/browser'

export type BrowserCommandTargetParams = {
  worktree?: string
  page?: string
}

type ResolvedBrowserCommandTarget = {
  worktreeId?: string
  browserPageId?: string
}

type ResolvedBrowserPageWebContents = {
  browserPageId: string
  webContents: Electron.WebContents
}

export type BrowserScreencastParams = {
  format: 'jpeg' | 'png'
  quality?: number
  maxWidth?: number
  maxHeight?: number
  viewportWidth?: number
  viewportHeight?: number
  deviceScaleFactor?: number
  mobile?: boolean
  everyNthFrame?: number
  minFrameIntervalMs?: number
} & BrowserCommandTargetParams

export type BrowserScreencastStartResult = {
  subscriptionId: string
  ready: Extract<BrowserScreencastResult, { type: 'ready' }>
  session: BrowserScreencastSession
}

type ActiveBrowserScreencastPage = {
  stop: () => void
  done: Promise<void>
}

export function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampOptionalInteger(
  value: number | undefined,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampOptionalNumber(
  value: number | undefined,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(max, Math.max(min, value))
}

export type RuntimeBrowserCommandHost = {
  getAgentBrowserBridge(): AgentBrowserBridge | null
  resolveWorktreeSelector(selector: string): Promise<{ id: string }>
  getAuthoritativeWindow(): BrowserWindow
  getAvailableAuthoritativeWindow(): BrowserWindow | null
  // Why: headless serve backs pages with a main-process offscreen backend; null when the environment can't support offscreen browsing.
  getOffscreenBrowserBackend(): BrowserBackend | null
  // Why: the session-tab snapshot owns focus, so a headless create must mark itself active or paired clients snap back to a terminal.
  markHeadlessBrowserSessionTabActive?(
    worktreeId: string | undefined,
    browserPageId: string,
    targetGroupId?: string
  ): void
}

export class RuntimeBrowserBaseCommands {
  protected readonly activeScreencastPageIds = new Set<string>()
  protected readonly activeScreencastsByPageId = new Map<string, ActiveBrowserScreencastPage>()
  protected readonly stoppingScreencastPageIds = new Map<string, Promise<void>>()

  constructor(private readonly host: RuntimeBrowserCommandHost) {}

  protected requireAgentBrowserBridge(): AgentBrowserBridge {
    const bridge = this.host.getAgentBrowserBridge()
    if (!bridge) {
      throw new BrowserError('browser_no_tab', 'No browser session is active')
    }
    return bridge
  }

  protected hasLiveRegisteredBrowserTab(
    bridge: AgentBrowserBridge,
    worktreeId: string | undefined
  ): boolean {
    for (const [, webContentsId] of bridge.getRegisteredTabs(worktreeId)) {
      const guest = webContents.fromId(webContentsId)
      if (guest && !guest.isDestroyed()) {
        return true
      }
    }
    return false
  }

  protected hasLiveRegisteredBrowserPage(
    bridge: AgentBrowserBridge,
    worktreeId: string | undefined,
    browserPageId: string
  ): boolean {
    const webContentsId = bridge.getRegisteredTabs(worktreeId).get(browserPageId)
    if (webContentsId == null) {
      return false
    }
    const guest = webContents.fromId(webContentsId)
    return Boolean(guest && !guest.isDestroyed())
  }

  // Why: the CLI sends selectors (e.g. "path:/...") but the bridge keys tabs by "repoId::path"; resolve to that store-compatible id.
  protected async resolveBrowserWorktreeId(selector?: string): Promise<string | undefined> {
    if (!selector) {
      // Why: after restart, webviews mount only when the pane is visible; activate the view so persisted tabs become operable via registerGuest.
      const bridge = this.host.getAgentBrowserBridge()
      if (bridge && !this.hasLiveRegisteredBrowserTab(bridge, undefined)) {
        try {
          await this.ensureBrowserWorktreeActive(undefined)
        } catch {
          // Window may not exist yet (e.g. during startup or in tests)
        }
      }
      return undefined
    }

    const worktreeId = (await this.host.resolveWorktreeSelector(selector)).id
    // Why: explicit selectors are user intent, so resolution errors surface (not silently widen scope); only activation stays best-effort.
    const bridge = this.host.getAgentBrowserBridge()
    if (bridge && !this.hasLiveRegisteredBrowserTab(bridge, worktreeId)) {
      try {
        await this.ensureBrowserWorktreeActive(worktreeId)
      } catch {
        // Fall through with the validated worktree id so routing stays scoped to the caller's explicit selector.
      }
    }
    return worktreeId
  }

  protected async resolveBrowserCommandTarget(
    params: BrowserCommandTargetParams
  ): Promise<ResolvedBrowserCommandTarget> {
    const browserPageId =
      typeof params.page === 'string' && params.page.length > 0 ? params.page : undefined
    if (!browserPageId) {
      return {
        worktreeId: await this.resolveBrowserWorktreeId(params.worktree)
      }
    }

    const worktreeId = params.worktree
      ? (await this.host.resolveWorktreeSelector(params.worktree)).id
      : undefined
    const bridge = this.host.getAgentBrowserBridge()
    if (bridge && !this.hasLiveRegisteredBrowserPage(bridge, worktreeId, browserPageId)) {
      try {
        await this.ensureBrowserPageActive(worktreeId, browserPageId)
      } catch {
        // Fall through with the explicit page target; downstream routing surfaces a clear "tab not found" error if wake fails.
      }
    }
    return {
      // Why: an explicit browserPageId is already a stable tab identity, so don't auto-resolve cwd worktree scoping on top of it.
      worktreeId,
      browserPageId
    }
  }

  protected resolveBrowserPageWebContents(
    worktreeId: string | undefined,
    browserPageId: string | undefined
  ): ResolvedBrowserPageWebContents {
    const bridge = this.requireAgentBrowserBridge()
    const resolvedPageId = browserPageId ?? bridge.getActivePageId(worktreeId)
    if (!resolvedPageId) {
      throw new BrowserError('browser_no_tab', 'No browser tab open in this worktree')
    }
    const webContentsId = bridge.getRegisteredTabs(worktreeId).get(resolvedPageId)
    if (webContentsId == null) {
      const scope = worktreeId ? ' in this worktree' : ''
      throw new BrowserError(
        'browser_tab_not_found',
        `Browser page ${resolvedPageId} was not found${scope}`
      )
    }
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      throw new BrowserError(
        'browser_tab_not_found',
        `Browser page ${resolvedPageId} is no longer available`
      )
    }
    return { browserPageId: resolvedPageId, webContents: guest }
  }

  // Why: background-mount the worktree via a hidden visibility lease so the webview guest can register without stealing the user's visible pane.
  protected async ensureBrowserWorktreeActive(worktreeId: string | undefined): Promise<void> {
    const win = this.host.getAuthoritativeWindow()
    win.webContents.send('browser:activateView', worktreeId ? { worktreeId } : {})
    // Why: the pane is operable only after the webview mounts and calls registerGuest; wait on that IPC rather than a flaky fixed sleep.
    await waitForWorktreeTabRegistration(worktreeId)
  }

  protected async ensureBrowserPageActive(
    worktreeId: string | undefined,
    browserPageId: string
  ): Promise<void> {
    const win = this.host.getAuthoritativeWindow()
    win.webContents.send(
      'browser:activateView',
      worktreeId ? { worktreeId, browserPageId } : { browserPageId }
    )
    await waitForTabRegistration(browserPageId)
  }

  // Why: helper-driven clicks can bypass Electron navigation events; push authoritative URL/title updates after automation.
  protected notifyRendererNavigation(browserPageId: string, url: string, title: string): void {
    try {
      const win = this.host.getAuthoritativeWindow()
      win.webContents.send('browser:navigation-update', { browserPageId, url, title })
    } catch {
      // Window may not exist during shutdown
    }
  }

  // Why: carry worktreeId (not a global setActiveWorktree) so one agent's --focus can't steal the screen from another agent's parallel worktree.
  protected notifyRendererBrowserPaneFocus(
    worktreeId: string | undefined,
    browserPageId: string
  ): void {
    try {
      const win = this.host.getAuthoritativeWindow()
      win.webContents.send('browser:pane-focus', {
        worktreeId: worktreeId ?? null,
        browserPageId
      })
    } catch {
      // Window may not exist during shutdown
    }
  }

  protected enrichBrowserTabInfo(
    tab: BrowserTabListResult['tabs'][number]
  ): BrowserTabListResult['tabs'][number] {
    const rawProfileId = browserManager.getSessionProfileIdForTab(tab.browserPageId)
    const profile =
      browserSessionRegistry.getProfile(rawProfileId ?? 'default') ??
      browserSessionRegistry.getDefaultProfile()
    return {
      ...tab,
      worktreeId: browserManager.getWorktreeIdForTab(tab.browserPageId) ?? null,
      profileId: profile.id,
      profileLabel: profile.label
    }
  }

  protected describeBrowserTab(
    browserPageId: string,
    explicitWorktreeId?: string
  ): BrowserTabListResult['tabs'][number] {
    const worktreeId = explicitWorktreeId ?? browserManager.getWorktreeIdForTab(browserPageId)
    const tab = this.requireAgentBrowserBridge()
      .tabList(worktreeId)
      .tabs.find((entry) => entry.browserPageId === browserPageId)
    if (!tab) {
      const scope = worktreeId ? ' in this worktree' : ''
      throw new BrowserError(
        'browser_tab_not_found',
        `Browser page ${browserPageId} was not found${scope}`
      )
    }
    return this.enrichBrowserTabInfo(tab)
  }

}
