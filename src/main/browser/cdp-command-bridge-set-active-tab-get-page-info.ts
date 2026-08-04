import { webContents } from 'electron'

export const CdpBridgeMethods1 = {
  setActiveTab(this: any, webContentsId: number): void {
    this.activeWebContentsId = webContentsId
  },
  getActiveWebContentsId(this: any): number | null {
    return this.activeWebContentsId
  },
  getActivePageId(this: any, _worktreeId?: string): string | null {
    if (!this.activeWebContentsId) {
      return null
    }
    for (const [tabId, wcId] of this.getRegisteredTabs()) {
      if (wcId === this.activeWebContentsId) {
        return tabId
      }
    }
    return null
  },
  getPageInfo(
    this: any,
    _worktreeId?: string,
    browserPageId?: string
  ): { browserPageId: string; url: string; title: string } | null {
    // Why: expose the same metadata lookup as other bridges, though the CDP bridge routes only one active tab.
    const resolvedPageId = browserPageId ?? this.getActivePageId()
    if (!resolvedPageId) {
      return null
    }
    const webContentsId = this.getRegisteredTabs().get(resolvedPageId)
    if (webContentsId == null) {
      return null
    }
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      return null
    }
    return {
      browserPageId: resolvedPageId,
      url: guest.getURL(),
      title: guest.getTitle()
    }
  }
}
export type CdpBridgeMethods1Surface = typeof CdpBridgeMethods1
