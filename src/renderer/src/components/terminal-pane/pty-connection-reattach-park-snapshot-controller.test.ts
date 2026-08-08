import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionReattachParkSnapshotController } from './pty-connection-reattach-park-snapshot-controller'
import type { PtyBufferSnapshot } from './pty-transport-types'

const HEADLESS_SNAPSHOT = {
  data: 'main-model',
  cols: 120,
  rows: 40,
  source: 'headless'
} satisfies PtyBufferSnapshot

function createHarness(
  overrides: {
    parked?: boolean
    current?: boolean
    remote?: boolean
    mainSnapshot?: PtyBufferSnapshot | null
    rendererSnapshot?: PtyBufferSnapshot | null
  } = {}
) {
  const consumeParkMountEvidence = vi.fn(() => overrides.parked ?? true)
  const getMainBufferSnapshot = vi.fn(async () => overrides.mainSnapshot ?? HEADLESS_SNAPSHOT)
  const serializeRendererSnapshot = vi.fn(
    async () =>
      overrides.rendererSnapshot ?? {
        data: 'renderer-model',
        cols: 100,
        rows: 30
      }
  )
  const isCurrent = vi.fn(() => overrides.current ?? true)
  const controller = createPtyConnectionReattachParkSnapshotController({
    consumeParkMountEvidence,
    isCurrent,
    isRemoteRuntimePtyId: () => overrides.remote ?? false,
    isSshParkingEnabled: () => true,
    getMainBufferSnapshot,
    serializeRendererSnapshot
  })

  return {
    controller,
    consumeParkMountEvidence,
    getMainBufferSnapshot,
    serializeRendererSnapshot,
    isCurrent
  }
}

describe('createPtyConnectionReattachParkSnapshotController', () => {
  it('does not probe a model snapshot when the reattach did not follow a park', () => {
    const state = createHarness({ parked: false })

    const selection = state.controller.select({
      ptyId: 'ssh:conn@@pty',
      isReattach: true,
      hasStructuralReplay: true,
      hasRelayReplay: true
    })

    expect(selection).toEqual({ status: 'selected', modelSnapshot: null })

    expect(state.getMainBufferSnapshot).not.toHaveBeenCalled()
    expect(state.serializeRendererSnapshot).not.toHaveBeenCalled()
  })

  it('serializes the renderer model for a parked local reattach without structural replay', async () => {
    const state = createHarness({})

    const result = await state.controller.select({
      ptyId: 'local-pty',
      isReattach: true,
      hasStructuralReplay: false,
      hasRelayReplay: false
    })

    expect(result).toEqual({
      status: 'selected',
      modelSnapshot: expect.objectContaining({ data: 'renderer-model' })
    })
    expect(state.serializeRendererSnapshot).toHaveBeenCalledOnce()
    expect(state.getMainBufferSnapshot).not.toHaveBeenCalled()
  })

  it('selects the authoritative headless model for a parked SSH reattach', async () => {
    const state = createHarness({})

    await expect(
      state.controller.select({
        ptyId: 'ssh:conn@@pty',
        isReattach: true,
        hasStructuralReplay: false,
        hasRelayReplay: false
      })
    ).resolves.toEqual({ status: 'selected', modelSnapshot: HEADLESS_SNAPSHOT })

    expect(state.getMainBufferSnapshot).toHaveBeenCalledOnce()
    expect(state.serializeRendererSnapshot).not.toHaveBeenCalled()
  })

  it('uses one memoized main-model probe for a parked SSH relay replay', async () => {
    const state = createHarness({})

    await expect(
      state.controller.select({
        ptyId: 'ssh:conn@@pty',
        isReattach: true,
        hasStructuralReplay: true,
        hasRelayReplay: true
      })
    ).resolves.toEqual({ status: 'selected', modelSnapshot: HEADLESS_SNAPSHOT })

    expect(state.getMainBufferSnapshot).toHaveBeenCalledOnce()
  })

  it('rejects a snapshot result that became stale while awaiting the parked model', async () => {
    const state = createHarness({})
    state.isCurrent.mockReturnValueOnce(false)

    await expect(
      state.controller.select({
        ptyId: 'ssh:conn@@pty',
        isReattach: true,
        hasStructuralReplay: false,
        hasRelayReplay: false
      })
    ).resolves.toEqual({ status: 'stale' })
  })
})
