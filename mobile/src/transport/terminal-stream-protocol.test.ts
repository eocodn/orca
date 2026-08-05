import { describe, expect, it } from 'vitest'
import { decodeTerminalStreamJson } from './terminal-stream-protocol'

describe('mobile terminal stream JSON decoder', () => {
  it('rejects payloads beyond the shared byte limit', () => {
    const payload = new TextEncoder().encode(JSON.stringify({ data: 'x'.repeat(8 * 1024 * 1024) }))

    expect(decodeTerminalStreamJson(payload)).toBeNull()
  })

  it('rejects payloads beyond the shared nesting limit', () => {
    const payload = new TextEncoder().encode(`${'['.repeat(33)}0${']'.repeat(33)}`)

    expect(decodeTerminalStreamJson(payload)).toBeNull()
  })
})
