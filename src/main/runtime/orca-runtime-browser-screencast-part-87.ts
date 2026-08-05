import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { browserCertificateTrustController } from '../browser/browser-manager-lifecycle'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import {
  detectInstalledBrowsers,
  importCookiesFromBrowser,
  selectBrowserProfile
} from '../browser/browser-cookie-import'
import { waitForTabRegistration } from '../ipc/browser'
import { BrowserPageRuntime, type BrowserMouseButton } from '../browser/browser-page-runtime'
import type {
  BrowserBackResult,
  BrowserEvalResult,
  BrowserGotoResult,
  BrowserKeypressResult,
  BrowserProfileClearDefaultCookiesResult,
  BrowserProfileCreateResult,
  BrowserProfileDeleteResult,
  BrowserProfileImportFromBrowserResult,
  BrowserProfileListResult,
  BrowserTabCurrentResult,
  BrowserTabListResult,
  BrowserTabShowResult,
  BrowserTabSwitchResult,
  BrowserViewportResult,
  BrowserScreencastResult,
  BrowserTabSetProfileResult,
  BrowserTabProfileShowResult,
  BrowserTabProfileCloneResult
} from '../../shared/runtime-browser'
import type { BrowserCertificateProceedResult } from '../../shared/types'
import { OrcaRuntimeNotifyLinearLinkedIssueUpdatedPart86 } from './orca-runtime-notify-linear-linked-issue-updated-part-86'

type BrowserTarget = { worktree?: string; page?: string }
type ScreencastParams = BrowserTarget & { format: 'jpeg' | 'png' }

/** BrowserPane transport: direct WebContents operations, with no automation driver. */
export class OrcaRuntimeBrowserScreencastPart87 extends OrcaRuntimeNotifyLinearLinkedIssueUpdatedPart86 {
  protected readonly browserPageRuntime = new BrowserPageRuntime()

  private async worktreeId(selector?: string): Promise<string | undefined> {
    return selector ? (await this.resolveWorktreeSelector(selector)).id : undefined
  }

  private async pageId(target: BrowserTarget): Promise<string> {
    const id = this.browserPageRuntime.getActivePageId(
      await this.worktreeId(target.worktree),
      target.page
    )
    if (!id) throw new Error('No browser tab open in this worktree')
    return id
  }

  browserTabList = async (params: { worktree?: string }): Promise<BrowserTabListResult> =>
    this.browserPageRuntime.tabList(await this.worktreeId(params.worktree))

  browserTabCurrent = async (params: { worktree?: string }): Promise<BrowserTabCurrentResult> =>
    this.browserPageRuntime.tabCurrent(await this.worktreeId(params.worktree))

  browserTabShow = async (params: { page: string }): Promise<BrowserTabShowResult> =>
    this.browserPageRuntime.tabShow(params.page)

  browserTabSwitch = async (params: {
    index?: number
    page?: string
    worktree?: string
  }): Promise<BrowserTabSwitchResult> =>
    this.browserPageRuntime.tabSwitch(
      params.index,
      await this.worktreeId(params.worktree),
      params.page
    )

  browserGoto = async (params: { url: string } & BrowserTarget): Promise<BrowserGotoResult> => {
    const page = await this.pageId(params)
    const result = await this.browserPageRuntime.goto(page, params.url)
    this.notifyRendererNavigation(page, result.url, result.title)
    return result
  }

  browserBack = async (params: BrowserTarget): Promise<BrowserBackResult> => {
    const page = await this.pageId(params)
    const result = await this.browserPageRuntime.back(page)
    this.notifyRendererNavigation(page, result.url, result.title)
    return result
  }

  browserForward = async (params: BrowserTarget): Promise<BrowserBackResult> => {
    const page = await this.pageId(params)
    const result = await this.browserPageRuntime.forward(page)
    this.notifyRendererNavigation(page, result.url, result.title)
    return result
  }

  browserReload = async (params: BrowserTarget): Promise<BrowserBackResult> => {
    const page = await this.pageId(params)
    const result = await this.browserPageRuntime.reload(page)
    this.notifyRendererNavigation(page, result.url, result.title)
    return result
  }

  browserEval = async (
    params: { expression: string } & BrowserTarget
  ): Promise<BrowserEvalResult> =>
    this.browserPageRuntime.eval(await this.pageId(params), params.expression)

  browserKeypress = async (
    params: { key: string } & BrowserTarget
  ): Promise<BrowserKeypressResult> =>
    this.browserPageRuntime.keypress(await this.pageId(params), params.key)

  browserMouseMove = async (params: { x: number; y: number } & BrowserTarget): Promise<void> => {
    this.browserPageRuntime.mouseMove(await this.pageId(params), params.x, params.y)
  }

  browserMouseDown = async (
    params: { x: number; y: number; button?: string } & BrowserTarget
  ): Promise<void> => {
    this.browserPageRuntime.mouseButton(
      await this.pageId(params),
      'mouseDown',
      params.x,
      params.y,
      (params.button as BrowserMouseButton | undefined) ?? 'left'
    )
  }

  browserMouseUp = async (
    params: { x: number; y: number; button?: string } & BrowserTarget
  ): Promise<void> => {
    this.browserPageRuntime.mouseButton(
      await this.pageId(params),
      'mouseUp',
      params.x,
      params.y,
      (params.button as BrowserMouseButton | undefined) ?? 'left'
    )
  }

  browserMouseClick = async (
    params: { x: number; y: number; button?: string } & BrowserTarget
  ): Promise<void> => {
    const page = await this.pageId(params)
    const button = (params.button as BrowserMouseButton | undefined) ?? 'left'
    this.browserPageRuntime.mouseButton(page, 'mouseDown', params.x, params.y, button)
    this.browserPageRuntime.mouseButton(page, 'mouseUp', params.x, params.y, button)
  }

  browserMouseWheel = async (
    params: { x: number; y: number; dx?: number; dy: number } & BrowserTarget
  ): Promise<void> => {
    this.browserPageRuntime.mouseWheel(
      await this.pageId(params),
      params.x,
      params.y,
      params.dx ?? 0,
      params.dy
    )
  }

  browserSetViewport = async (
    params: {
      width: number
      height: number
      deviceScaleFactor?: number
      mobile?: boolean
    } & BrowserTarget
  ): Promise<BrowserViewportResult> =>
    this.browserPageRuntime.setViewport(
      await this.pageId(params),
      params.width,
      params.height,
      params.deviceScaleFactor,
      params.mobile
    )

  browserProceedCertificate = async (params: {
    page?: string
    worktree?: string
    challengeId: string
  }): Promise<BrowserCertificateProceedResult> => {
    const page = await this.pageId(params)
    return browserCertificateTrustController.proceed(page, params.challengeId)
  }

  async browserScreencast(
    params: ScreencastParams,
    options: {
      connectionId?: string
      sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
      signal?: AbortSignal
      emit: (result: BrowserScreencastResult) => void
    }
  ): Promise<void> {
    if (!options.sendBinary)
      throw new Error('Browser screencast requires a binary streaming transport.')
    const page = await this.pageId(params)
    const session = await this.browserPageRuntime.screencast(
      page,
      params.format,
      options.sendBinary,
      options.emit
    )
    const stop = (): void => session.session.stop()
    options.signal?.addEventListener('abort', stop, { once: true })
    try {
      await session.session.done
    } finally {
      options.signal?.removeEventListener('abort', stop)
    }
  }

  async browserTabCreate(params: {
    url?: string
    worktree?: string
    profileId?: string
    waitForRegistration?: boolean
    activate?: boolean
  }): Promise<{ browserPageId: string }> {
    const url = params.url ?? 'about:blank'
    const worktreeId = await this.worktreeId(params.worktree)
    const profile = params.profileId
      ? browserSessionRegistry.getProfile(params.profileId)
      : browserSessionRegistry.getDefaultProfile()
    if (!profile) throw new Error(`Browser profile ${params.profileId} was not found`)
    if (!this.getAvailableAuthoritativeWindow()) {
      if (!this.offscreenBrowserBackend)
        throw new Error('This host does not support browser panes.')
      const created = await this.offscreenBrowserBackend.createTab({
        url,
        worktreeId,
        profileId: profile.id
      })
      return { browserPageId: created.browserPageId }
    }
    const win = this.getAuthoritativeWindow()
    const requestId = randomUUID()
    const browserPageId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('browser:tabCreateReply', handler)
        reject(new Error('Tab creation timed out'))
      }, 10_000)
      const handler = (
        event: Electron.IpcMainEvent,
        reply: { requestId: string; browserPageId?: string; error?: string }
      ): void => {
        if (event.sender !== win.webContents || reply.requestId !== requestId) return
        clearTimeout(timer)
        ipcMain.removeListener('browser:tabCreateReply', handler)
        if (reply.error) reject(new Error(reply.error))
        else if (reply.browserPageId) resolve(reply.browserPageId)
        else reject(new Error('Browser tab creation returned no page ID'))
      }
      ipcMain.on('browser:tabCreateReply', handler)
      win.webContents.send('browser:requestTabCreate', {
        requestId,
        url,
        worktreeId,
        sessionProfileId: profile.id,
        sessionPartition: profile.partition,
        activate: params.activate
      })
    })
    if (params.waitForRegistration !== false)
      await waitForTabRegistration(browserPageId).catch(() => {})
    return { browserPageId }
  }

  async browserTabClose(params: {
    index?: number
    page?: string
    worktree?: string
  }): Promise<{ closed: boolean }> {
    const worktree = await this.worktreeId(params.worktree)
    const tabs = this.browserPageRuntime.tabList(worktree).tabs
    const page =
      params.page ??
      (params.index == null
        ? tabs.find((tab) => tab.active)?.browserPageId
        : tabs[params.index]?.browserPageId)
    if (!page) return { closed: false }
    if (!this.getAvailableAuthoritativeWindow() && this.offscreenBrowserBackend) {
      await this.offscreenBrowserBackend.closeTab(page)
      return { closed: true }
    }
    const win = this.getAuthoritativeWindow()
    const requestId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ipcMain.removeListener('browser:tabCloseReply', handler)
        reject(new Error('Tab close timed out'))
      }, 10_000)
      const handler = (
        _event: Electron.IpcMainEvent,
        reply: { requestId: string; error?: string }
      ): void => {
        if (reply.requestId !== requestId) return
        clearTimeout(timer)
        ipcMain.removeListener('browser:tabCloseReply', handler)
        reply.error ? reject(new Error(reply.error)) : resolve()
      }
      ipcMain.on('browser:tabCloseReply', handler)
      win.webContents.send('browser:requestTabClose', {
        requestId,
        tabId: page,
        worktreeId: worktree
      })
    })
    return { closed: true }
  }

  browserTabSetProfile = async (params: {
    page?: string
    worktree?: string
    profileId: string
  }): Promise<BrowserTabSetProfileResult> => {
    const page = await this.pageId(params)
    const profile = browserSessionRegistry.getProfile(params.profileId)
    if (!profile) throw new Error(`Browser profile ${params.profileId} was not found`)
    return { browserPageId: page, profileId: profile.id, profileLabel: profile.label }
  }

  browserTabProfileShow = async (params: {
    page: string
  }): Promise<BrowserTabProfileShowResult> => {
    const tab = this.browserPageRuntime.tabShow(params.page).tab
    return {
      browserPageId: tab.browserPageId,
      worktreeId: tab.worktreeId ?? null,
      profileId: tab.profileId ?? null,
      profileLabel: tab.profileLabel ?? null
    }
  }

  browserTabProfileClone = async (params: {
    profileId: string
    page?: string
    worktree?: string
  }): Promise<BrowserTabProfileCloneResult> => {
    const source = await this.pageId(params)
    const created = await this.browserTabCreate({
      worktree: params.worktree,
      profileId: params.profileId,
      url: this.browserPageRuntime.tabShow(source).tab.url
    })
    const profile = browserSessionRegistry.getProfile(params.profileId)
    return {
      browserPageId: created.browserPageId,
      sourceBrowserPageId: source,
      profileId: profile?.id ?? null,
      profileLabel: profile?.label ?? null
    }
  }

  browserProfileList = async (): Promise<BrowserProfileListResult> => ({
    profiles: browserSessionRegistry.listProfiles()
  })
  browserProfileCreate = async (params: {
    label: string
    scope: 'isolated' | 'imported'
  }): Promise<BrowserProfileCreateResult> => ({
    profile: browserSessionRegistry.createProfile(params.scope, params.label)
  })
  browserProfileDelete = async (params: {
    profileId: string
  }): Promise<BrowserProfileDeleteResult> => ({
    deleted: await browserSessionRegistry.deleteProfile(params.profileId),
    profileId: params.profileId
  })
  browserProfileDetectBrowsers = async () => ({
    browsers: detectInstalledBrowsers().map((browser) => ({
      family: browser.family,
      label: browser.label,
      profiles: browser.profiles,
      selectedProfile: browser.selectedProfile
    }))
  })
  async browserProfileImportFromBrowser(params: {
    profileId: string
    browserFamily: string
    browserProfile?: string
  }): Promise<BrowserProfileImportFromBrowserResult> {
    const profile = browserSessionRegistry.getProfile(params.profileId)
    if (!profile) return { ok: false, reason: 'Session profile not found.' }
    if (
      params.browserProfile &&
      (/[/\\]/.test(params.browserProfile) || params.browserProfile.includes('..'))
    ) {
      return { ok: false, reason: 'Invalid browser profile name.' }
    }
    const browser = detectInstalledBrowsers().find((entry) => entry.family === params.browserFamily)
    if (!browser) return { ok: false, reason: 'Browser not found on this system.' }
    const selected =
      params.browserProfile && params.browserProfile !== browser.selectedProfile
        ? selectBrowserProfile(browser, params.browserProfile)
        : browser
    if (!selected) return { ok: false, reason: 'No cookies database found for profile.' }
    const result = await importCookiesFromBrowser(selected, profile.partition)
    return result.ok ? { ...result, profileId: params.profileId } : result
  }
  browserProfileClearDefaultCookies =
    async (): Promise<BrowserProfileClearDefaultCookiesResult> => ({
      cleared: await browserSessionRegistry.clearDefaultSessionCookies()
    })
}
