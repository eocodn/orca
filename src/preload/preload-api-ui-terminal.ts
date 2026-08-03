import { ipcRenderer } from './preload-api-runtime-context';import type { PreloadApi, TerminalPaneSplitSource, TerminalTabCreateReply, AgentProviderSessionMetadata, SleepingAgentLaunchConfig, TuiAgent, WorktreeDefaultTabsLaunch, RuntimeMobileSessionTabMove, RuntimeTerminalCreateRequestPayload, RuntimeTerminalPresentation, RuntimeMobileMarkdownRequest, RuntimeMobileMarkdownResponse } from './preload-api-runtime-context';export function createPreloadApiUiTerminal(): { ui: Partial<PreloadApi['ui']> } {
  return {
    ui: {
    onCloseActiveTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:closeActiveTab', listener)
      return () => ipcRenderer.removeListener('ui:closeActiveTab', listener)
    },
    onCloseFloatingItem: (callback: (payload: { sourceId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sourceId: string }) =>
        callback(payload)
      ipcRenderer.on('ui:closeFloatingItem', listener)
      return () => ipcRenderer.removeListener('ui:closeFloatingItem', listener)
    },
    onSelectFloatingIndex: (callback: (payload: { index: number }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { index: number }) =>
        callback(payload)
      ipcRenderer.on('ui:selectFloatingIndex', listener)
      return () => ipcRenderer.removeListener('ui:selectFloatingIndex', listener)
    },
    onSwitchTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTab', listener)
    },
    onSwitchTabAcrossAllTypes: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTabAcrossAllTypes', listener)
      return () => ipcRenderer.removeListener('ui:switchTabAcrossAllTypes', listener)
    },
    onSwitchRecentTab: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:switchRecentTab', listener)
      return () => ipcRenderer.removeListener('ui:switchRecentTab', listener)
    },
    onSwitchTerminalTab: (callback: (direction: 1 | -1) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 1 | -1) => callback(direction)
      ipcRenderer.on('ui:switchTerminalTab', listener)
      return () => ipcRenderer.removeListener('ui:switchTerminalTab', listener)
    },
    onCtrlTabKeyDown: (callback: (data: { shiftKey: boolean }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { shiftKey: boolean }) =>
        callback(data)
      ipcRenderer.on('ui:ctrlTabKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyDown', listener)
    },
    onCtrlTabKeyUp: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:ctrlTabKeyUp', listener)
      return () => ipcRenderer.removeListener('ui:ctrlTabKeyUp', listener)
    },
    onToggleStatusBar: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:toggleStatusBar', listener)
      return () => ipcRenderer.removeListener('ui:toggleStatusBar', listener)
    },
    onExportPdfRequested: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('export:requestPdf', listener)
      return () => ipcRenderer.removeListener('export:requestPdf', listener)
    },
    onAppMenuPaste: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:appMenuPaste', listener)
      return () => ipcRenderer.removeListener('ui:appMenuPaste', listener)
    },
    onEditableContextPaste: (
      callback: (data: { plainTextOnly: boolean }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { plainTextOnly: boolean }
      ): void => callback({ plainTextOnly: data?.plainTextOnly === true })
      ipcRenderer.on('ui:editableContextPaste', listener)
      return () => ipcRenderer.removeListener('ui:editableContextPaste', listener)
    },
    onDictationKeyDown: (callback: () => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on('ui:dictationKeyDown', listener)
      return () => ipcRenderer.removeListener('ui:dictationKeyDown', listener)
    },
    onActivateWorktree: (
      callback: (data: {
        repoId: string
        worktreeId: string
        setup?: { runnerScriptPath: string; envVars: Record<string, string> }
        startup?: { command: string; env?: Record<string, string> }
        defaultTabs?: WorktreeDefaultTabsLaunch
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          repoId: string
          worktreeId: string
          setup?: { runnerScriptPath: string; envVars: Record<string, string> }
          startup?: { command: string; env?: Record<string, string> }
          defaultTabs?: WorktreeDefaultTabsLaunch
        }
      ) => callback(data)
      ipcRenderer.on('ui:activateWorktree', listener)
      return () => ipcRenderer.removeListener('ui:activateWorktree', listener)
    },
    onCreateTerminal: (
      callback: (data: {
        requestId?: string
        worktreeId: string
        command?: string
        cwd?: string
        env?: Record<string, string>
        launchConfig?: SleepingAgentLaunchConfig
        resumeProviderSession?: AgentProviderSessionMetadata
        launchToken?: string
        launchAgent?: TuiAgent
        viewMode?: 'terminal' | 'chat'
        title?: string
        ptyId?: string
        activate?: boolean
        focus?: boolean
        presentation?: RuntimeTerminalPresentation
        surfaceOwner?: false
        tabId?: string
        leafId?: string
        splitFromLeafId?: string
        splitDirection?: 'horizontal' | 'vertical'
        splitTelemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          requestId?: string
          worktreeId: string
          command?: string
          cwd?: string
          env?: Record<string, string>
          launchConfig?: SleepingAgentLaunchConfig
          resumeProviderSession?: AgentProviderSessionMetadata
          launchToken?: string
          launchAgent?: TuiAgent
          viewMode?: 'terminal' | 'chat'
          title?: string
          ptyId?: string
          activate?: boolean
          focus?: boolean
          presentation?: RuntimeTerminalPresentation
          surfaceOwner?: false
          tabId?: string
          leafId?: string
          splitFromLeafId?: string
          splitDirection?: 'horizontal' | 'vertical'
          splitTelemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:createTerminal', listener)
      return () => ipcRenderer.removeListener('ui:createTerminal', listener)
    },
    onRequestTerminalCreate: (
      callback: (data: RuntimeTerminalCreateRequestPayload) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: RuntimeTerminalCreateRequestPayload
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabCreate', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabCreate', listener)
    },
    onRequestTerminalTabMount: (
      callback: (data: { worktreeId: string; tabId?: string; ptyId?: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string; tabId?: string; ptyId?: string }
      ) => callback(data)
      ipcRenderer.on('terminal:requestTabMount', listener)
      return () => ipcRenderer.removeListener('terminal:requestTabMount', listener)
    },
    replyTerminalCreate: (reply: TerminalTabCreateReply): void => {
      ipcRenderer.send('terminal:tabCreateReply', reply)
    },
    onSplitTerminal: (
      callback: (data: {
        tabId: string
        paneRuntimeId: number
        direction: 'horizontal' | 'vertical'
        command?: string
        telemetrySource?: TerminalPaneSplitSource
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          paneRuntimeId: number
          direction: 'horizontal' | 'vertical'
          command?: string
          telemetrySource?: TerminalPaneSplitSource
        }
      ) => callback(data)
      ipcRenderer.on('ui:splitTerminal', listener)
      return () => ipcRenderer.removeListener('ui:splitTerminal', listener)
    },
    onRenameTerminal: (
      callback: (data: { tabId: string; title: string | null }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; title: string | null }
      ) => callback(data)
      ipcRenderer.on('ui:renameTerminal', listener)
      return () => ipcRenderer.removeListener('ui:renameTerminal', listener)
    },
    onFocusTerminal: (
      callback: (data: {
        tabId: string
        worktreeId: string
        leafId?: string | null
        ackPaneKeyOnSuccess?: string
        flashFocusedPane?: boolean
        scrollToBottomIfOutputSinceLastView?: boolean
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          tabId: string
          worktreeId: string
          leafId?: string | null
          ackPaneKeyOnSuccess?: string
          flashFocusedPane?: boolean
          scrollToBottomIfOutputSinceLastView?: boolean
        }
      ) => callback(data)
      ipcRenderer.on('ui:focusTerminal', listener)
      return () => ipcRenderer.removeListener('ui:focusTerminal', listener)
    },
    onFocusEditorTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:focusEditorTab', listener)
      return () => ipcRenderer.removeListener('ui:focusEditorTab', listener)
    },
    onCloseSessionTab: (
      callback: (data: { tabId: string; worktreeId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; worktreeId: string }
      ) => callback(data)
      ipcRenderer.on('ui:closeSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:closeSessionTab', listener)
    },
    onMoveSessionTab: (
      callback: (data: { worktreeId: string } & RuntimeMobileSessionTabMove) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { worktreeId: string } & RuntimeMobileSessionTabMove
      ) => callback(data)
      ipcRenderer.on('ui:moveSessionTab', listener)
      return () => ipcRenderer.removeListener('ui:moveSessionTab', listener)
    },
    onOpenFileFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openFileFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openFileFromMobile', listener)
    },
    onOpenDiffFromMobile: (
      callback: (data: {
        worktreeId: string
        filePath: string
        relativePath: string
        staged: boolean
        runtimeEnvironmentId?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          worktreeId: string
          filePath: string
          relativePath: string
          staged: boolean
          runtimeEnvironmentId?: string
        }
      ) => callback(data)
      ipcRenderer.on('ui:openDiffFromMobile', listener)
      return () => ipcRenderer.removeListener('ui:openDiffFromMobile', listener)
    },
    onMobileMarkdownRequest: (
      callback: (request: RuntimeMobileMarkdownRequest) => void
    ): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: RuntimeMobileMarkdownRequest) =>
        callback(request)
      ipcRenderer.on('ui:mobileMarkdownRequest', listener)
      return () => ipcRenderer.removeListener('ui:mobileMarkdownRequest', listener)
    },
    respondMobileMarkdownRequest: (response: RuntimeMobileMarkdownResponse): void => {
      ipcRenderer.send('ui:mobileMarkdownResponse', response)
    },
    onCloseTerminal: (
      callback: (data: { tabId: string; paneRuntimeId?: number }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { tabId: string; paneRuntimeId?: number }
      ) => callback(data)
      ipcRenderer.on('ui:closeTerminal', listener)
      return () => ipcRenderer.removeListener('ui:closeTerminal', listener)
    },
    onTerminalTabCloseRequest: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: Parameters<typeof callback>[0]
      ) => callback(request)
      ipcRenderer.on('ui:terminalTabCloseRequest', listener)
      return () => ipcRenderer.removeListener('ui:terminalTabCloseRequest', listener)
    },
    respondTerminalTabClose: (response) => {
      ipcRenderer.send('ui:terminalTabCloseResponse', response)
    },
    onSleepWorktree: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:sleepWorktree', listener)
      return () => ipcRenderer.removeListener('ui:sleepWorktree', listener)
    },
    onResumeSleepingAgents: (callback: (data: { worktreeId: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { worktreeId: string }) =>
        callback(data)
      ipcRenderer.on('ui:resumeSleepingAgents', listener)
      return () => ipcRenderer.removeListener('ui:resumeSleepingAgents', listener)
    },
    onTerminalZoom: (callback: (direction: 'in' | 'out' | 'reset') => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, direction: 'in' | 'out' | 'reset') =>
        callback(direction)
      ipcRenderer.on('terminal:zoom', listener)
      return () => ipcRenderer.removeListener('terminal:zoom', listener)
    },
    } satisfies Partial<PreloadApi['ui']>
  }
}

