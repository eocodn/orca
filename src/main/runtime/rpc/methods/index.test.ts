import { describe, expect, it } from 'vitest'
import { buildRegistry } from '../core'
import { ALL_RPC_METHODS } from './index'

describe('RPC method aggregation', () => {
  it('keeps the production method manifest free of duplicate names', () => {
    expect(() => buildRegistry(ALL_RPC_METHODS)).not.toThrow()
  })
})
