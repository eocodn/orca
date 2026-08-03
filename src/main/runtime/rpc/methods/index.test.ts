import { describe, expect, it } from 'vitest'
import { buildRegistry } from '../core'
import { ORCHESTRATION_METHODS } from './orchestration'
import { ALL_RPC_METHODS } from './index'

describe('RPC method aggregation', () => {
  it('keeps the production method manifest free of duplicate names', () => {
    expect(() => buildRegistry(ALL_RPC_METHODS)).not.toThrow()
  })

  it('keeps orchestration split surfaces free of duplicate names', () => {
    expect(() => buildRegistry(ORCHESTRATION_METHODS)).not.toThrow()
  })
})
