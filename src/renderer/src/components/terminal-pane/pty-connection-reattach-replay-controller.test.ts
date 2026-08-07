import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionReattachReplayController } from './pty-connection-reattach-replay-controller'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function createHarness() {
  let ptyId: string | null = 'pty-1'
  let streamGeneration = 1
  let disposed = false
  const writes: string[] = []
  const rememberPayloadAgentSignal = vi.fn()
  const scanReplayKeyboardModes = vi.fn()
  const sendFocusedReattachFocusInAfterReplay = vi.fn()
  const rebuildPaneWebgl = vi.fn()
  const beginLiveDataDeferral = vi.fn()
  const finishLiveDataDeferral = vi.fn()
  const controller = createPtyConnectionReattachReplayController({
    getPtyId: () => ptyId,
    getStreamGeneration: () => streamGeneration,
    isDisposed: () => disposed,
    writeReplayDataAsync: async (data) => {
      writes.push(data)
    },
    rememberPayloadAgentSignal,
    scanReplayKeyboardModes,
    buildReplayResetSequence: (data) => `reset:${data}`,
    sendFocusedReattachFocusInAfterReplay,
    rebuildPaneWebgl,
    beginLiveDataDeferral,
    finishLiveDataDeferral,
    runStructuralReplay: async (operation) => operation()
  })

  return {
    controller,
    writes,
    rememberPayloadAgentSignal,
    scanReplayKeyboardModes,
    sendFocusedReattachFocusInAfterReplay,
    rebuildPaneWebgl,
    beginLiveDataDeferral,
    finishLiveDataDeferral,
    setPtyId(value: string | null) {
      ptyId = value
    },
    setStreamGeneration(value: number) {
      streamGeneration = value
    },
    setDisposed(value: boolean) {
      disposed = value
    }
  }
}

describe('createPtyConnectionReattachReplayController', () => {
  it('applies only the latest payload queued before the drain starts', async () => {
    const state = createHarness()

    state.controller.enqueue('older')
    state.controller.enqueue('latest', { pendingEscapeTailAnsi: '\x1b[' })
    await state.controller.whenIdle()

    expect(state.writes).toEqual(['\x1b[2J\x1b[3J\x1b[H', 'latest', 'reset:latest', '\x1b['])
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledTimes(1)
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledWith('latest', {
      fullScreenReplay: true
    })
    expect(state.scanReplayKeyboardModes).toHaveBeenCalledTimes(1)
    expect(state.scanReplayKeyboardModes).toHaveBeenCalledWith('latest')
    expect(state.sendFocusedReattachFocusInAfterReplay).toHaveBeenCalledWith('pty-1', 1)
    expect(state.rebuildPaneWebgl).toHaveBeenCalledTimes(1)
    expect(state.beginLiveDataDeferral).toHaveBeenCalledWith(1)
    expect(state.finishLiveDataDeferral).toHaveBeenCalledWith(true, 1)
  })

  it('supersedes an in-flight payload before its application steps continue', async () => {
    const firstWrite = createDeferred()
    let writeCount = 0
    const state = createHarness()
    const controller = createPtyConnectionReattachReplayController({
      getPtyId: () => 'pty-1',
      getStreamGeneration: () => 1,
      isDisposed: () => false,
      writeReplayDataAsync: async (data) => {
        state.writes.push(data)
        writeCount += 1
        if (writeCount === 1) {
          await firstWrite.promise
        }
      },
      rememberPayloadAgentSignal: state.rememberPayloadAgentSignal,
      scanReplayKeyboardModes: state.scanReplayKeyboardModes,
      buildReplayResetSequence: (data) => `reset:${data}`,
      sendFocusedReattachFocusInAfterReplay: state.sendFocusedReattachFocusInAfterReplay,
      rebuildPaneWebgl: state.rebuildPaneWebgl,
      beginLiveDataDeferral: state.beginLiveDataDeferral,
      finishLiveDataDeferral: state.finishLiveDataDeferral,
      runStructuralReplay: async (operation) => operation()
    })

    controller.enqueue('older')
    await Promise.resolve()
    await Promise.resolve()
    controller.enqueue('latest')
    firstWrite.resolve()
    await controller.whenIdle()

    expect(state.writes).toEqual([
      '\x1b[2J\x1b[3J\x1b[H',
      '\x1b[2J\x1b[3J\x1b[H',
      'latest',
      'reset:latest'
    ])
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledTimes(1)
    expect(state.rememberPayloadAgentSignal).toHaveBeenCalledWith('latest', {
      fullScreenReplay: true
    })
    expect(state.rebuildPaneWebgl).toHaveBeenCalledTimes(1)
  })

  it('cancels a stale payload when PTY and stream ownership change', async () => {
    const state = createHarness()

    state.controller.enqueue('stale')
    state.setPtyId('pty-2')
    state.setStreamGeneration(2)
    await state.controller.whenIdle()

    expect(state.writes).toEqual([])
    expect(state.rebuildPaneWebgl).not.toHaveBeenCalled()
    expect(state.finishLiveDataDeferral).toHaveBeenCalledWith(false, 1)
  })

  it('keeps whenIdle pending until the serialized structural replay settles', async () => {
    const gate = createDeferred()
    const state = createHarness()
    const controller = createPtyConnectionReattachReplayController({
      getPtyId: () => 'pty-1',
      getStreamGeneration: () => 1,
      isDisposed: () => false,
      writeReplayDataAsync: async (data) => {
        state.writes.push(data)
      },
      rememberPayloadAgentSignal: state.rememberPayloadAgentSignal,
      scanReplayKeyboardModes: state.scanReplayKeyboardModes,
      buildReplayResetSequence: (data) => `reset:${data}`,
      sendFocusedReattachFocusInAfterReplay: state.sendFocusedReattachFocusInAfterReplay,
      rebuildPaneWebgl: state.rebuildPaneWebgl,
      beginLiveDataDeferral: state.beginLiveDataDeferral,
      finishLiveDataDeferral: state.finishLiveDataDeferral,
      runStructuralReplay: async (operation) => {
        await gate.promise
        await operation()
      }
    })
    let settled = false

    controller.enqueue('payload')
    void controller.whenIdle().then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    gate.resolve()
    await controller.whenIdle()
    expect(settled).toBe(true)
  })
})
