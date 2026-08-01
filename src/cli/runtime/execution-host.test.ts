import { describe, expect, it, vi } from 'vitest'

const { resolveEnvironment } = vi.hoisted(() => ({
  resolveEnvironment: vi.fn(() => ({ id: 'stable-environment' }))
}))

vi.mock('./environments', () => ({ resolveEnvironment }))

import { resolveRuntimeClientExecutionHostId } from './execution-host'

describe('resolveRuntimeClientExecutionHostId', () => {
  it('separates a saved host identity from runtime incarnation identity', () => {
    expect(resolveRuntimeClientExecutionHostId('/data', true, 'gpu')).toBe(
      'runtime:stable-environment'
    )
    expect(resolveEnvironment).toHaveBeenCalledWith('/data', 'gpu')
  })

  it('does not manufacture a stable host identity from a raw pairing session', () => {
    expect(resolveRuntimeClientExecutionHostId('/data', true, null)).toBeNull()
    expect(resolveRuntimeClientExecutionHostId('/data', false, null)).toBe('local')
  })
})
