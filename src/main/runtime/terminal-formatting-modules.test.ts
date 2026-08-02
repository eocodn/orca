import { describe, expect, it } from 'vitest'
import { normalizeTerminalChunk } from './terminal-output-normalization'
import { parseAnsiControlSequence } from './terminal-tail-ansi'

describe('terminal formatting modules', () => {
  it('keeps split ANSI controls pending until the next PTY chunk completes them', () => {
    expect(normalizeTerminalChunk('ready\u001b[', '')).toEqual({
      text: 'ready',
      pendingAnsi: '\u001b['
    })
    expect(normalizeTerminalChunk('2K', '\u001b[')).toEqual({
      text: '\u001b[2K',
      pendingAnsi: ''
    })
  })

  it('parses only complete canonical CSI sequences', () => {
    expect(parseAnsiControlSequence('\u001b[2K', 0)).toMatchObject({
      kind: 'csi',
      final: 'K',
      params: '2'
    })
    expect(parseAnsiControlSequence('\u001b[', 0)).toBeNull()
  })
})
