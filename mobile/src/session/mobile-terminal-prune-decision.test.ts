import { describe, expect, it } from 'vitest'
import {
  createTerminalPrunePredicate,
  resolveRetainedTerminalHandles,
  shouldPruneTerminalHandle
} from './mobile-terminal-prune-decision'

describe('terminal list pruning', () => {
  const liveHandles = new Set(['term-2'])

  it('prunes a handle the list no longer reports', () => {
    expect(shouldPruneTerminalHandle({ handle: 'term-1', liveHandles })).toBe(true)
  })

  it('keeps a handle the list still reports', () => {
    expect(shouldPruneTerminalHandle({ handle: 'term-2', liveHandles })).toBe(false)
  })

  it('binds the same list state for repeated checks', () => {
    const shouldPrune = createTerminalPrunePredicate({ liveHandles })
    expect(shouldPrune('term-1')).toBe(true)
    expect(shouldPrune('term-2')).toBe(false)
  })

  it('returns the authoritative live handle set', () => {
    expect([...resolveRetainedTerminalHandles({ liveHandles })]).toEqual(['term-2'])
  })
})
