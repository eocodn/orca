import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

const {
  createFoundationMock,
  installSupportMock,
  initializeRendererDeliveryMock,
  installRendererDeliveryQueueMock,
  installRendererExitHandlingMock,
  installProviderListenersMock,
  installRuntimeApisMock,
  installInputDeliveryHandlersMock,
  createControllerMock,
  installSpawnHandlerMock,
  installControlHandlersMock,
  installQueryHandlersMock,
  setPtyControllerMock,
  handleMock,
  rendererDeliveryState
} = vi.hoisted(() => ({
  createFoundationMock: vi.fn(),
  installSupportMock: vi.fn(),
  initializeRendererDeliveryMock: vi.fn(),
  installRendererDeliveryQueueMock: vi.fn(),
  installRendererExitHandlingMock: vi.fn(),
  installProviderListenersMock: vi.fn(),
  installRuntimeApisMock: vi.fn(),
  installInputDeliveryHandlersMock: vi.fn(),
  createControllerMock: vi.fn(() => ({})),
  installSpawnHandlerMock: vi.fn(),
  installControlHandlersMock: vi.fn(),
  installQueryHandlersMock: vi.fn(),
  setPtyControllerMock: vi.fn(),
  handleMock: vi.fn(),
  rendererDeliveryState: {}
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock }
}))

vi.mock('./pty-ipc-runtime-registration-foundation', () => ({
  createPtyRegistrationFoundation: createFoundationMock
}))
vi.mock('./pty-ipc-runtime-registration-support', () => ({
  installPtyRegistrationSupport: installSupportMock
}))
vi.mock('./pty-ipc-runtime-renderer-delivery-core', () => ({
  initializePtyRendererDelivery:
    initializeRendererDeliveryMock.mockReturnValue(rendererDeliveryState)
}))
vi.mock('./pty-ipc-runtime-renderer-delivery-queue', () => ({
  installPtyRendererDeliveryQueue: installRendererDeliveryQueueMock
}))
vi.mock('./pty-ipc-runtime-renderer-exit-handling', () => ({
  installPtyRendererExitHandling: installRendererExitHandlingMock
}))
vi.mock('./pty-ipc-runtime-provider-listeners', () => ({
  installPtyProviderListeners: installProviderListenersMock
}))
vi.mock('./pty-ipc-runtime-registration-api', () => ({
  installPtyRuntimeRegistrationApis: installRuntimeApisMock
}))
vi.mock('./pty-ipc-runtime-input-delivery-handlers', () => ({
  installPtyInputDeliveryHandlers: installInputDeliveryHandlersMock
}))
vi.mock('./pty-ipc-runtime-provider-routing', () => ({
  tryGetProviderForPty: vi.fn()
}))
vi.mock('./pty-ipc-runtime-renderer-lifecycle-state', () => ({
  getPtyRendererDeliveryDebugSnapshot: vi.fn(),
  resetPtyRendererDeliveryDebug: vi.fn(),
  installPowerSignalBreadcrumbs: vi.fn()
}))
vi.mock('./pty-ipc-runtime-controller', () => ({
  createPtyController: createControllerMock
}))
vi.mock('./pty-ipc-runtime-ipc-spawn-registration', () => ({
  installPtyIpcSpawnHandler: installSpawnHandlerMock
}))
vi.mock('./pty-ipc-runtime-ipc-control', () => ({
  installPtyIpcControlHandlers: installControlHandlersMock
}))
vi.mock('./pty-ipc-runtime-ipc-query', () => ({
  installPtyIpcQueryHandlers: installQueryHandlersMock
}))
vi.mock('./providers/local-pty-provider', () => ({
  LocalPtyProvider: class {}
}))
vi.mock('./pty-ipc-runtime-provider-lifecycle-state', () => ({
  getLocalPtyProvider: vi.fn()
}))

import { registerPtyHandlers } from './pty-ipc-runtime-registration-implementation'

describe('PTY runtime registration implementation', () => {
  it('imports and registers snapshot handlers in the direct registration path', () => {
    const runtime = { setPtyController: setPtyControllerMock } as unknown as OrcaRuntimeService

    registerPtyHandlers({} as BrowserWindow, runtime)

    expect(initializeRendererDeliveryMock).toHaveBeenCalledOnce()
    expect(handleMock).toHaveBeenCalledWith('pty:getMainBufferSnapshot', expect.any(Function))
    expect(handleMock).toHaveBeenCalledWith('pty:sideEffectSnapshot', expect.any(Function))
    expect(handleMock).toHaveBeenCalledWith(
      'pty:getRendererDeliveryDebugSnapshot',
      expect.any(Function)
    )
    expect(handleMock).toHaveBeenCalledWith(
      'pty:resetRendererDeliveryDebug',
      expect.any(Function)
    )
    expect(setPtyControllerMock).toHaveBeenCalledOnce()
  })
})
