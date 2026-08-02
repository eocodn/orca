import { describe, expect, it } from 'vitest'
import { KEYBINDING_DEFINITIONS } from './keybinding-definitions'

describe('keybinding registry integrity', () => {
  it('contains each action definition exactly once', () => {
    const actionIds = KEYBINDING_DEFINITIONS.map((definition) => definition.id)

    expect(new Set(actionIds).size).toBe(actionIds.length)
  })
})
