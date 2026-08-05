export type ResolveRenderer = (browserTabId: string) => Electron.WebContents | null

export const CONTROL_MODIFIERS = new Set(['control', 'ctrl'])
