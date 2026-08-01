import { describe, expect, it, vi } from 'vitest'

const { resolveEnvironment, getPreferredPairingOffer } = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(() => ({ id: 'stable-environment' })),
  getPreferredPairingOffer: vi.fn(() => ({ endpoint: 'wss://old-runtime.example' }))
}))

vi.mock('./environments', () => ({ resolveEnvironment }))
vi.mock('../../shared/runtime-environments', () => ({ getPreferredPairingOffer }))

import { resolveRuntimeClientSelection } from './execution-host'

describe('resolveRuntimeClientSelection', () => {
  it('atomically binds a saved host identity to its selected pairing endpoint', () => {
    expect(resolveRuntimeClientSelection('/data', null, 'gpu')).toEqual({
      pairing: { endpoint: 'wss://old-runtime.example' },
      executionHostId: 'runtime:stable-environment'
    })
    expect(resolveEnvironment).toHaveBeenCalledTimes(1)
    expect(getPreferredPairingOffer).toHaveBeenCalledWith({ id: 'stable-environment' })
  })

  it('does not manufacture a stable host identity from a raw pairing session', () => {
    expect(resolveRuntimeClientSelection('/data', null, null)).toEqual({
      pairing: null,
      executionHostId: 'local'
    })
  })
})
