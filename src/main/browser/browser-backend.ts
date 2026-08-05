// Browser pages can be backed by a renderer webview or a headless offscreen
// WebContents. Both register with BrowserManager so navigation and input share
// one lifecycle regardless of where the page was created.

export type BrowserBackendCreateTab = {
  url: string
  worktreeId?: string
  profileId?: string
}

export type BrowserBackend = {
  /** Create a browser page and register its WebContents. Returns the page id. */
  createTab(params: BrowserBackendCreateTab): Promise<{ browserPageId: string }>
  /** Tear down a browser page created by this backend. */
  closeTab(browserPageId: string): Promise<void>
  /** Tear down every page this backend owns (process shutdown). Optional —
   *  renderer-hosted backends are torn down with their window. */
  destroyAll?(): void
}
