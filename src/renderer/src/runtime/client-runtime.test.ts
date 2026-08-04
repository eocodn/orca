import { describe, expect, it, vi } from 'vitest'
import {
  createClientRuntime,
  getClientRuntime,
  type ClientRuntimeFileService,
  type ClientRuntimeTerminalService
} from './client-runtime'

describe('ClientRuntime service boundary', () => {
  it('exposes runtime and remote-host services without changing their contracts', () => {
    const runtime = {
      call: vi.fn(),
      getStatus: vi.fn()
    }
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService

    const clientRuntime = createClientRuntime({
      runtime,
      runtimeEnvironments: remoteHost,
      fs: file,
      pty: terminal
    })

    expect(clientRuntime.runtime).toBe(runtime)
    expect(clientRuntime.remoteHost).toBe(remoteHost)
    expect(clientRuntime.file).toBe(file)
    expect(clientRuntime.terminal).toBe(terminal)
  })

  it('reads the current host adapter when a renderer entry point asks for it', () => {
    const runtime = { call: vi.fn(), getStatus: vi.fn() }
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService
    vi.stubGlobal('window', {
      api: { runtime, runtimeEnvironments: remoteHost, fs: file, pty: terminal }
    })

    expect(getClientRuntime().runtime).toBe(runtime)
    expect(getClientRuntime().remoteHost).toBe(remoteHost)
    expect(getClientRuntime().file).toBe(file)
    expect(getClientRuntime().terminal).toBe(terminal)
  })
})
