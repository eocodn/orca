import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { PersistedUIState } from '../../../shared/types'
import { getDefaultUIState } from '../../../shared/constants'
import { RpcDispatcher } from './dispatcher'
import { defineMethod, defineStreamingMethod, type RpcRequest } from './core'
import type { OrcaRuntimeService } from '../orca-runtime'

function makeRequest(method: string, params: unknown = {}): RpcRequest {
  return {
    id: 'req-1',
    authToken: 'tok',
    method,
    params
  }
}

function makeRuntime(ui: PersistedUIState = getDefaultUIState()): OrcaRuntimeService {
  let currentUI = ui
  return {
    getRuntimeId: () => 'test-runtime',
    getUIState: vi.fn(() => currentUI),
    recordFeatureInteraction: vi.fn((id) => {
      const featureInteractions = currentUI.featureInteractions ?? {}
      const existing = featureInteractions[id]
      currentUI = {
        ...currentUI,
        featureInteractions: {
          ...featureInteractions,
          [id]: {
            firstInteractedAt: existing?.firstInteractedAt ?? Date.now(),
            interactionCount: (existing?.interactionCount ?? 0) + 1
          }
        }
      }
      return currentUI
    }),
    updateUIState: vi.fn((updates: Partial<PersistedUIState>) => {
      currentUI = { ...currentUI, ...updates }
      return currentUI
    })
  } as unknown as OrcaRuntimeService
}

const METHODS = [
  defineMethod({
    name: 'browser.click',
    params: z.object({}),
    handler: () => ({ clicked: true })
  }),
  defineMethod({
    name: 'browser.tabCreate',
    params: z.object({}),
    handler: () => ({ browserPageId: 'page-1' })
  }),
  defineMethod({
    name: 'browser.tabShow',
    params: z.object({}),
    handler: () => ({ tab: { id: 'page-1' } })
  }),
  defineMethod({
    name: 'browser.viewport',
    params: z.object({}),
    handler: () => ({ ok: true })
  }),
  defineMethod({
    name: 'browser.eval',
    params: z.object({}),
    handler: () => ({ value: 'ok' })
  }),
  defineStreamingMethod({
    name: 'browser.screencast',
    params: z.object({}),
    handler: async (_params, _options, emit) => {
      emit({ type: 'frame' })
      emit({ type: 'end' })
    }
  }),
  defineStreamingMethod({
    name: 'browser.screencast.binaryOnly',
    params: z.object({}),
    handler: async () => {}
  }),
  defineMethod({
    name: 'browser.screencast.unsubscribe',
    params: z.object({}),
    handler: () => ({ ok: true })
  }),
  defineMethod({
    name: 'browser.profileImportFromBrowser',
    params: z.object({}),
    handler: () => ({ ok: true })
  }),
  defineMethod({
    name: 'browser.profileList',
    params: z.object({}),
    handler: () => ({ profiles: [] })
  }),
  defineMethod({
    name: 'browser.profileClearDefaultCookies',
    params: z.object({}),
    handler: () => ({ cleared: false })
  }),
  defineMethod({
    name: 'browser.fail',
    params: z.object({}),
    handler: () => {
      throw new Error('nope')
    }
  })
]

describe('RpcDispatcher feature interactions', () => {
  it('keeps setup and cookie import separate from actual runtime use', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: METHODS })

    await dispatcher.dispatch(makeRequest('browser.profileImportFromBrowser'))
    await dispatcher.dispatch(makeRequest('browser.profileList'))
    await dispatcher.dispatch(makeRequest('browser.profileClearDefaultCookies'))

    expect(runtime.recordFeatureInteraction).toHaveBeenCalledWith('cookie-import')
    expect(runtime.recordFeatureInteraction).toHaveBeenCalledTimes(1)
  })

  it('does not record failed runtime methods', async () => {
    const runtime = makeRuntime()
    const dispatcher = new RpcDispatcher({ runtime, methods: METHODS })

    await dispatcher.dispatch(makeRequest('browser.fail'))

    expect(runtime.recordFeatureInteraction).not.toHaveBeenCalled()
  })

})
