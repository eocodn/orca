export const BrowserManagerMethods6 = {
  getGuestWebContentsId(this: any, browserTabId: string): number | null {
    return this.webContentsIdByTabId.get(browserTabId) ?? null
  },
  getWebContentsIdByTabId(this: any): Map<string, number> {
    return this.webContentsIdByTabId
  },
  getWorktreeIdForTab(this: any, browserTabId: string): string | undefined {
    return this.worktreeIdByTabId.get(browserTabId)
  },
  getSessionProfileIdForTab(this: any, browserTabId: string): string | null {
    return this.sessionProfileIdByPageId.get(browserTabId) ?? null
  }
}
export type BrowserManagerMethods6Surface = typeof BrowserManagerMethods6
