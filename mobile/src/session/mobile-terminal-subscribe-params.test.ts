import { describe, expect, it } from 'vitest'
import { buildMobileTerminalSubscribeParams } from './mobile-terminal-subscribe-params'

describe('buildMobileTerminalSubscribeParams', () => {
  it('advertises the binary terminal stream and preserves the measured viewport', () => {
    expect(
      buildMobileTerminalSubscribeParams('terminal-1', 'phone-1', { cols: 45, rows: 20 })
    ).toEqual({
      terminal: 'terminal-1',
      client: { id: 'phone-1', type: 'mobile' },
      capabilities: { terminalBinaryStream: 1 },
      viewport: { cols: 45, rows: 20 }
    })
  })

  it('omits an unmeasured viewport without changing capability negotiation', () => {
    expect(buildMobileTerminalSubscribeParams('terminal-1', 'phone-1', null)).toEqual({
      terminal: 'terminal-1',
      client: { id: 'phone-1', type: 'mobile' },
      capabilities: { terminalBinaryStream: 1 }
    })
  })
})
