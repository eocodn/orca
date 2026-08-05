export type BrowserCommandTargetParams = { worktree?: string; page?: string }

/** Shared target shape retained for browser-pane integrations. */
export type RuntimeBrowserCommandHost = Record<string, never>
