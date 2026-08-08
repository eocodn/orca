import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionTransportStreamCallbackController } from './pty-connection-transport-stream-callback-controller'

function createHarness() {
  const calls: string[] = []
  let currentGeneration = 0
  let disposed = false
  const controller = createPtyConnectionTransportStreamCallbackController({
    cancelPendingFits: () => calls.push('cancel-fits'),
    advanceGeneration: () => {
      calls.push('advance-generation')
      currentGeneration += 1
      return currentGeneration
    },
    isGenerationCurrent: (generation) => generation === currentGeneration,
    isDisposed: () => disposed,
    onConnect: () => calls.push('connect'),
    onData: (data, _meta, generation) => calls.push(`data:${data}:${generation}`),
    onReplayData: (data, _meta, generation) => calls.push(`replay:${data}:${generation}`),
    onWriteUnavailable: () => calls.push('write-unavailable'),
    onRecoveryStateChange: (state) => calls.push(`recovery:${state.phase}`),
    onOutputPauseChanged: (paused, supported) => calls.push(`pause:${paused}:${supported}`)
  })

  return {
    calls,
    controller,
    dispose: () => {
      disposed = true
    }
  }
}

describe('createPtyConnectionTransportStreamCallbackController', () => {
  it('cancels pending fits before advancing the stream generation', () => {
    const state = createHarness()

    const captured = state.controller.capture(vi.fn())

    expect(captured.generation).toBe(1)
    expect(state.calls).toEqual(['cancel-fits', 'advance-generation'])
  })

  it('routes every current-generation callback through the captured authority', () => {
    const state = createHarness()
    const onError = vi.fn((message: string) => state.calls.push(`error:${message}`))
    const captured = state.controller.capture(onError)

    state.calls.length = 0
    captured.callbacks.onConnect?.()
    captured.callbacks.onData?.('live')
    captured.callbacks.onReplayData?.('replay')
    captured.callbacks.onError?.('boom')
    captured.callbacks.onWriteUnavailable?.()
    captured.callbacks.onRecoveryStateChange?.({
      phase: 'recovering',
      epoch: 2,
      attempt: 3
    })
    captured.callbacks.onOutputPauseChanged?.(true, true)

    expect(state.calls).toEqual([
      'connect',
      'data:live:1',
      'replay:replay:1',
      'error:boom',
      'write-unavailable',
      'recovery:recovering',
      'pause:true:true'
    ])
  })

  it('suppresses every stale or disposed callback after authority changes', () => {
    const state = createHarness()
    const firstError = vi.fn()
    const first = state.controller.capture(firstError)
    const second = state.controller.capture(vi.fn())

    state.calls.length = 0
    first.callbacks.onConnect?.()
    first.callbacks.onData?.('stale')
    first.callbacks.onReplayData?.('stale-replay')
    first.callbacks.onError?.('stale-error')
    first.callbacks.onWriteUnavailable?.()
    first.callbacks.onRecoveryStateChange?.({ phase: 'offline', epoch: 1, attempt: 1 })
    first.callbacks.onOutputPauseChanged?.(true, false)

    expect(state.calls).toEqual([])
    expect(firstError).not.toHaveBeenCalled()

    state.dispose()
    second.callbacks.onConnect?.()
    second.callbacks.onData?.('disposed')
    second.callbacks.onReplayData?.('disposed-replay')
    second.callbacks.onError?.('disposed-error')
    second.callbacks.onWriteUnavailable?.()
    second.callbacks.onRecoveryStateChange?.({ phase: 'disposed', epoch: 2, attempt: 2 })
    second.callbacks.onOutputPauseChanged?.(false, true)

    expect(state.calls).toEqual([])
  })
})
