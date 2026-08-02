import { describe, expect, it } from 'vitest'
import {
  buildPreview,
  buildTerminalWaitText,
  computeTerminalTailWaitState,
  tailGainedNewerBlockedReason
} from './terminal-tail-wait-state'

describe('terminal tail wait state', () => {
  it('builds a bounded visible preview from the retained tail', () => {
    expect(buildPreview([' first ', 'second'], ' third ')).toBe('first\nsecond\nthird')
  })

  it('detects actionable signals from the retained wait text', () => {
    const state = computeTerminalTailWaitState(
      ['Update available! Press Enter to continue.'],
      '',
      'short preview'
    )
    expect(state.fromTail).toBe(true)
    expect(state.waitText).toContain('Update available')
    expect(state.signal?.reason).toBe('codex-update-prompt')
  })

  it('builds wait text from complete and partial lines', () => {
    expect(buildTerminalWaitText(['model: gpt'], 'directory: /repo', 'preview')).toBe(
      'model: gpt\ndirectory: /repo'
    )
  })

  it('stamps a later blocked signal after an earlier one', () => {
    const previous = computeTerminalTailWaitState(
      ['Update available! Press Enter to continue.'],
      '',
      ''
    )
    const next = computeTerminalTailWaitState(
      [
        'Update available! Press Enter to continue.',
        'Choose working directory to continue. Press Enter to continue.'
      ],
      '',
      ''
    )
    expect(tailGainedNewerBlockedReason(previous, next, `\n${next.waitText.split('\n')[1]}`)).toBe(
      true
    )
  })
})
