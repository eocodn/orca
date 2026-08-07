import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingSpawnByPaneKey } from './pty-connection-runtime-state'
import { createPtyConnectionPendingSpawnController } from './pty-connection-pending-spawn-controller'

afterEach(() => {
  pendingSpawnByPaneKey.clear()
})

const createController = (
  overrides: Partial<Parameters<typeof createPtyConnectionPendingSpawnController>[0]> = {}
) => {
  const adoptPendingSpawn = vi.fn(() => true)
  const onMissingSpawn = vi.fn()
  const reportError = vi.fn()
  const armDirectSshPaneRetryTimeout = vi.fn()
  let ptyId: string | null = null
  const controller = createPtyConnectionPendingSpawnController({
    pendingSpawnKey: 'pane-1',
    tabId: 'tab-1',
    paneId: 1,
    transport: { getPtyId: () => ptyId },
    directSshRetryAttempt: undefined,
    armDirectSshPaneRetryTimeout,
    isDisposed: () => false,
    canAdoptCapturedDirectSshRetryPty: () => true,
    adoptPendingSpawn,
    onMissingSpawn,
    reportError,
    recordDiagnostic: vi.fn(),
    ...overrides
  })
  return {
    controller,
    adoptPendingSpawn,
    onMissingSpawn,
    reportError,
    armDirectSshPaneRetryTimeout,
    setPtyId: (nextPtyId: string | null) => {
      ptyId = nextPtyId
    }
  }
}

describe('createPtyConnectionPendingSpawnController', () => {
  it('returns false when no earlier mount has a pending spawn', () => {
    const { controller } = createController()

    expect(controller.join()).toBe(false)
  })

  it('joins and adopts a PTY produced by an earlier mount', async () => {
    pendingSpawnByPaneKey.set('pane-1', Promise.resolve('pty-1'))
    const { controller, adoptPendingSpawn, armDirectSshPaneRetryTimeout } = createController()

    expect(controller.join()).toBe(true)
    await Promise.resolve()

    expect(armDirectSshPaneRetryTimeout).toHaveBeenCalledOnce()
    expect(adoptPendingSpawn).toHaveBeenCalledWith('pty-1')
  })

  it('restarts when the earlier pending spawn resolves without an id', async () => {
    pendingSpawnByPaneKey.set('pane-1', Promise.resolve(null))
    const { controller, onMissingSpawn, adoptPendingSpawn } = createController()

    controller.join()
    await Promise.resolve()

    expect(onMissingSpawn).toHaveBeenCalledOnce()
    expect(adoptPendingSpawn).not.toHaveBeenCalled()
  })

  it('does not adopt after this pane is disposed or already bound', async () => {
    pendingSpawnByPaneKey.set('pane-1', Promise.resolve('pty-1'))
    const disposed = createController({ isDisposed: () => true })
    disposed.controller.join()
    await Promise.resolve()
    expect(disposed.adoptPendingSpawn).not.toHaveBeenCalled()

    pendingSpawnByPaneKey.set('pane-1', Promise.resolve('pty-2'))
    const bound = createController()
    bound.setPtyId('current-pty')
    bound.controller.join()
    await Promise.resolve()
    expect(bound.adoptPendingSpawn).not.toHaveBeenCalled()
  })

  it('rejects a PTY that no longer belongs to the captured SSH retry authority', async () => {
    pendingSpawnByPaneKey.set('pane-1', Promise.resolve('pty-stale'))
    const { controller, adoptPendingSpawn } = createController({
      canAdoptCapturedDirectSshRetryPty: () => false
    })

    controller.join()
    await Promise.resolve()

    expect(adoptPendingSpawn).not.toHaveBeenCalled()
  })

  it('reports a rejected pending spawn promise', async () => {
    pendingSpawnByPaneKey.set('pane-1', Promise.reject(new Error('spawn failed')))
    const { controller, reportError } = createController()

    controller.join()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(reportError).toHaveBeenCalledWith('spawn failed')
  })
})
