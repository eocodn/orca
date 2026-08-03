import { ipcRenderer } from './preload-api-runtime-context';import type { PreloadApi, PersistedUIState, KeybindingActionId } from './preload-api-runtime-context';export function createPreloadApiUiState(): { ui: Partial<PreloadApi['ui']> } {
  return {
    ui: {
    get: () => ipcRenderer.invoke('ui:get'),
    set: (args) => ipcRenderer.invoke('ui:set', args),
    recordFeatureInteraction: (id) => ipcRenderer.invoke('ui:recordFeatureInteraction', id),
    onStateChanged: (callback: (ui: PersistedUIState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, ui: PersistedUIState): void =>
        callback(ui)
      ipcRenderer.on('ui:stateChanged', listener)
      return () => ipcRenderer.removeListener('ui:stateChanged', listener)
    },
    onOpenSettings: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSettings', listener)
      return () => ipcRenderer.removeListener('ui:openSettings', listener)
    },
    consumePendingOpenSettings: (): Promise<boolean> =>
      ipcRenderer.invoke('ui:consumePendingOpenSettings'),
    onOpenSetupGuide: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openSetupGuide', listener)
      return () => ipcRenderer.removeListener('ui:openSetupGuide', listener)
    },
    onOpenFeatureTour: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openFeatureTour', listener)
      return () => ipcRenderer.removeListener('ui:openFeatureTour', listener)
    },
    onOpenCrashReport: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openCrashReport', listener)
      return () => ipcRenderer.removeListener('ui:openCrashReport', listener)
    },
    onToggleLeftSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleLeftSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleLeftSidebar', listener)
    },
    onToggleRightSidebar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleRightSidebar', listener)
      return () => ipcRenderer.removeListener('ui:toggleRightSidebar', listener)
    },
    onToggleWorktreePalette: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleWorktreePalette', listener)
      return () => ipcRenderer.removeListener('ui:toggleWorktreePalette', listener)
    },
    onToggleFloatingTerminal: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleFloatingTerminal', listener)
      return () => ipcRenderer.removeListener('ui:toggleFloatingTerminal', listener)
    },
    onTerminalShortcutCaptured: (
      callback: (data: { actionId: KeybindingActionId }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { actionId: KeybindingActionId }
      ) => callback(data)
      ipcRenderer.on('ui:terminalShortcutCaptured', listener)
      return () => ipcRenderer.removeListener('ui:terminalShortcutCaptured', listener)
    },
    onOpenQuickOpen: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openQuickOpen', listener)
      return () => ipcRenderer.removeListener('ui:openQuickOpen', listener)
    },
    onToggleQuickCommandsMenu: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleQuickCommandsMenu', listener)
      return () => ipcRenderer.removeListener('ui:toggleQuickCommandsMenu', listener)
    },
    onOpenNewWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openNewWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:openNewWorkspace', listener)
    },
    onDeleteCurrentWorkspace: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:deleteCurrentWorkspace', listener)
      return () => ipcRenderer.removeListener('ui:deleteCurrentWorkspace', listener)
    },
    onOpenWorkspaceBoard: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openWorkspaceBoard', listener)
      return () => ipcRenderer.removeListener('ui:openWorkspaceBoard', listener)
    },
    onOpenTasks: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:openTasks', listener)
      return () => ipcRenderer.removeListener('ui:openTasks', listener)
    },
    onJumpToWorktreeIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToWorktreeIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToWorktreeIndex', listener)
    },
    onJumpToTabIndex: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number) => callback(index)
      ipcRenderer.on('ui:jumpToTabIndex', listener)
      return () => ipcRenderer.removeListener('ui:jumpToTabIndex', listener)
    },
    onWorktreeHistoryNavigate: (
      callback: (direction: 'back' | 'forward') => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'back' | 'forward') =>
        callback(direction)
      ipcRenderer.on('ui:worktreeHistoryNavigate', listener)
      return () => ipcRenderer.removeListener('ui:worktreeHistoryNavigate', listener)
    },
    onNewBrowserTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newBrowserTab', listener)
      return () => ipcRenderer.removeListener('ui:newBrowserTab', listener)
    },
    onNewMarkdownTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newMarkdownTab', listener)
      return () => ipcRenderer.removeListener('ui:newMarkdownTab', listener)
    },
    onNewSimulatorTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:newSimulatorTab', listener)
      return () => ipcRenderer.removeListener('ui:newSimulatorTab', listener)
    },
    } satisfies Partial<PreloadApi['ui']>
  }
}

