import { ipcRenderer, subscribeRuntimeEnvironmentFromPreload } from './preload-api-runtime-context'
import type {
  VerifyAndAddRuntimeEnvironmentResult,
  MemorySnapshot,
  RuntimeBrowserDriverState,
  RuntimeStatus,
  RuntimeSyncWindowGraphResult,
  RuntimeSyncWindowGraph,
  RuntimeTerminalDriverState,
  RuntimeRpcResponse,
  PublicKnownRuntimeEnvironment,
  RuntimeEnvironmentSubscriptionHandle
} from './preload-api-runtime-context'
export function createPreloadApiStats(): Record<string, unknown> {
  return {
    stats: {
      getSummary: (): Promise<{
        totalAgentsSpawned: number
        totalPRsCreated: number
        totalAgentTimeMs: number
        firstEventAt: number | null
      }> => ipcRenderer.invoke('stats:summary')
    },
    memory: {
      getSnapshot: (): Promise<MemorySnapshot> => ipcRenderer.invoke('memory:getSnapshot')
    },
    runtime: {
      syncWindowGraph: (graph: RuntimeSyncWindowGraph): Promise<RuntimeSyncWindowGraphResult> =>
        ipcRenderer.invoke('runtime:syncWindowGraph', graph),
      getStatus: (): Promise<RuntimeStatus> => ipcRenderer.invoke('runtime:getStatus'),
      call: (args: { method: string; params?: unknown }): Promise<RuntimeRpcResponse<unknown>> =>
        ipcRenderer.invoke('runtime:call', args),
      getTerminalFitOverrides: (): Promise<
        { ptyId: string; mode: 'mobile-fit' | 'remote-desktop-fit'; cols: number; rows: number }[]
      > => ipcRenderer.invoke('runtime:getTerminalFitOverrides'),
      getTerminalDrivers: (): Promise<
        {
          ptyId: string
          driver: RuntimeTerminalDriverState
        }[]
      > => ipcRenderer.invoke('runtime:getTerminalDrivers'),
      getBrowserDrivers: (): Promise<
        {
          browserPageId: string
          driver: RuntimeBrowserDriverState
        }[]
      > => ipcRenderer.invoke('runtime:getBrowserDrivers'),
      restoreTerminalFit: (ptyId: string): Promise<{ restored: boolean }> =>
        ipcRenderer.invoke('runtime:restoreTerminalFit', { ptyId }),
      reclaimBrowserForDesktop: (browserPageId: string): Promise<{ reclaimed: boolean }> =>
        ipcRenderer.invoke('runtime:reclaimBrowserForDesktop', { browserPageId }),
      onTerminalFitOverrideChanged: (
        callback: (event: {
          ptyId: string
          mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
          cols: number
          rows: number
        }) => void
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          data: {
            ptyId: string
            mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
            cols: number
            rows: number
          }
        ) => callback(data)
        ipcRenderer.on('runtime:terminalFitOverrideChanged', listener)
        return () => ipcRenderer.removeListener('runtime:terminalFitOverrideChanged', listener)
      },
      onTerminalDriverChanged: (
        callback: (event: { ptyId: string; driver: RuntimeTerminalDriverState }) => void
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          data: {
            ptyId: string
            driver: RuntimeTerminalDriverState
          }
        ) => callback(data)
        ipcRenderer.on('runtime:terminalDriverChanged', listener)
        return () => ipcRenderer.removeListener('runtime:terminalDriverChanged', listener)
      },
      onBrowserDriverChanged: (
        callback: (event: { browserPageId: string; driver: RuntimeBrowserDriverState }) => void
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          data: {
            browserPageId: string
            driver: RuntimeBrowserDriverState
          }
        ) => callback(data)
        ipcRenderer.on('runtime:browserDriverChanged', listener)
        return () => ipcRenderer.removeListener('runtime:browserDriverChanged', listener)
      }
    },
    runtimeEnvironments: {
      list: (): Promise<PublicKnownRuntimeEnvironment[]> =>
        ipcRenderer.invoke('runtimeEnvironments:list'),
      addFromPairingCode: (args: {
        name: string
        pairingCode: string
      }): Promise<{ environment: PublicKnownRuntimeEnvironment }> =>
        ipcRenderer.invoke('runtimeEnvironments:addFromPairingCode', args),
      verifyAndAddFromPairingCode: (args: {
        name: string
        pairingCode: string
        allowLoopback?: boolean
      }): Promise<VerifyAndAddRuntimeEnvironmentResult> =>
        ipcRenderer.invoke('runtimeEnvironments:verifyAndAddFromPairingCode', args),
      resolve: (args: { selector: string }): Promise<PublicKnownRuntimeEnvironment> =>
        ipcRenderer.invoke('runtimeEnvironments:resolve', args),
      remove: (args: { selector: string }): Promise<{ removed: PublicKnownRuntimeEnvironment }> =>
        ipcRenderer.invoke('runtimeEnvironments:remove', args),
      disconnect: (args: {
        selector: string
      }): Promise<{ disconnected: PublicKnownRuntimeEnvironment }> =>
        ipcRenderer.invoke('runtimeEnvironments:disconnect', args),
      connect: (args: {
        selector: string
        timeoutMs?: number
      }): Promise<RuntimeRpcResponse<RuntimeStatus>> =>
        ipcRenderer.invoke('runtimeEnvironments:connect', args),
      getStatus: (args: {
        selector: string
        timeoutMs?: number
      }): Promise<RuntimeRpcResponse<RuntimeStatus>> =>
        ipcRenderer.invoke('runtimeEnvironments:getStatus', args),
      retryConnectionsNow: (): Promise<void> =>
        ipcRenderer.invoke('runtimeEnvironments:retryConnectionsNow'),
      call: (args: {
        selector: string
        method: string
        params?: unknown
        timeoutMs?: number
        expectedEnvironmentPairingRevision?: number
      }): Promise<RuntimeRpcResponse<unknown>> =>
        ipcRenderer.invoke('runtimeEnvironments:call', args),
      subscribe: async (
        args: {
          selector: string
          method: string
          params?: unknown
          timeoutMs?: number
          expectedEnvironmentPairingRevision?: number
        },
        callbacks: {
          onResponse: (response: RuntimeRpcResponse<unknown>) => void
          onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
          onError?: (error: { code: string; message: string }) => void
          onClose?: () => void
        }
      ): Promise<RuntimeEnvironmentSubscriptionHandle> =>
        subscribeRuntimeEnvironmentFromPreload(ipcRenderer, args, callbacks)
    },
    minimaxCredentials: {
      getStatus: (): Promise<{ configured: boolean }> =>
        ipcRenderer.invoke('minimaxCredentials:getStatus'),
      saveCookie: (cookie: string): Promise<{ configured: boolean }> =>
        ipcRenderer.invoke('minimaxCredentials:saveCookie', cookie),
      clearCookie: (): Promise<{ configured: boolean }> =>
        ipcRenderer.invoke('minimaxCredentials:clearCookie')
    }
  }
}
