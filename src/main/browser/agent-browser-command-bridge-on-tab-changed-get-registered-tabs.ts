// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.

export const AgentBrowserBridgeMethods2 = {
  onTabChanged(this: any, webContentsId: number, worktreeId?: string): void {
    this.activeWebContentsId = webContentsId
    if (worktreeId) {
      this.activeWebContentsPerWorktree.set(worktreeId, webContentsId)
    }
    this.options.onTabsChanged?.(worktreeId)
  },
  async onTabClosed(this: any, webContentsId: number): Promise<void> {
    const browserPageId = this.resolveTabIdSafe(webContentsId)
    const owningWorktreeId = browserPageId
      ? this.browserManager.getWorktreeIdForTab(browserPageId)
      : undefined
    let nextWorktreeActiveWebContentsId: number | null = null
    if (
      owningWorktreeId &&
      this.activeWebContentsPerWorktree.get(owningWorktreeId) === webContentsId
    ) {
      nextWorktreeActiveWebContentsId = this.selectFallbackActiveWebContents(
        owningWorktreeId,
        webContentsId
      )
    }
    if (this.activeWebContentsId === webContentsId) {
      this.activeWebContentsId = nextWorktreeActiveWebContentsId
    }
    if (browserPageId) {
      const sessionName = `orca-tab-${browserPageId}`
      await this.destroySession(sessionName)
      this.pendingInterceptRestore.delete(sessionName)
    }
    this.options.onTabsChanged?.(owningWorktreeId)
  },
  async onProcessSwap(
    this: any,
    browserPageId: string,
    newWebContentsId: number,
    previousWebContentsId?: number
  ): Promise<void> {
    // Why: an Electron process swap keeps browserPageId but gives a new webContentsId — destroy the session so the next command recreates it.
    const sessionName = `orca-tab-${browserPageId}`
    const session = this.sessions.get(sessionName)
    const oldWebContentsId = previousWebContentsId ?? session?.webContentsId
    const owningWorktreeId = this.browserManager.getWorktreeIdForTab(browserPageId)
    // Why: save intercept patterns before destroy so the new session can restore them after init.
    if (session && session.activeInterceptPatterns.length > 0) {
      this.pendingInterceptRestore.set(sessionName, [...session.activeInterceptPatterns])
    }
    await this.destroySession(sessionName)
    if (oldWebContentsId != null && this.activeWebContentsId === oldWebContentsId) {
      this.activeWebContentsId = newWebContentsId
    }
    if (
      owningWorktreeId &&
      oldWebContentsId != null &&
      this.activeWebContentsPerWorktree.get(owningWorktreeId) === oldWebContentsId
    ) {
      this.activeWebContentsPerWorktree.set(owningWorktreeId, newWebContentsId)
    }
    this.options.onTabsChanged?.(owningWorktreeId ?? undefined)
  },
  getRegisteredTabs(this: any, worktreeId?: string): Map<string, number> {
    const all = this.browserManager.getWebContentsIdByTabId()
    if (!worktreeId) {
      return all
    }

    const filtered = new Map<string, number>()
    for (const [tabId, wcId] of all) {
      if (this.browserManager.getWorktreeIdForTab(tabId) === worktreeId) {
        filtered.set(tabId, wcId)
      }
    }
    return filtered
  }
}
export type AgentBrowserBridgeMethods2Surface = typeof AgentBrowserBridgeMethods2
