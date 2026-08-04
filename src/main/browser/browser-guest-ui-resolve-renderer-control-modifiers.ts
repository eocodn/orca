export type ResolveRenderer = (browserTabId: string) => Electron.WebContents | null

export type ShouldForwardDictationShortcut = () => boolean

export const CONTROL_MODIFIERS = new Set(['control', 'ctrl'])
