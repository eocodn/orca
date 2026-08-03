import { ORCA_BROWSER_BLANK_URL } from '../../shared/constants'
import { normalizeBrowserNavigationUrl } from '../../shared/browser-url'

export const BrowserManagerMethods18 = {
  openLinkInOrcaTab(this: any, browserTabId: string, rawUrl: string): boolean {
    const renderer = this.resolveRendererForBrowserTab(browserTabId)
    if (!renderer) {
      return false
    }
    const normalizedUrl = normalizeBrowserNavigationUrl(rawUrl)
    if (!normalizedUrl || normalizedUrl === ORCA_BROWSER_BLANK_URL) {
      return false
    }
    // Why: only the renderer owns Orca's worktree/tab model; main forwards a validated URL, never letting guest content mutate it.
    renderer.send('browser:open-link-in-orca-tab', {
      browserPageId: browserTabId,
      url: normalizedUrl
    })
    return true
  }
}
export type BrowserManagerMethods18Surface = typeof BrowserManagerMethods18
