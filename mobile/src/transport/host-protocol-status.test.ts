import { describe, expect, it } from 'vitest'
import { readHostProtocolStatus } from './host-protocol-status'

describe('mobile Host protocol descriptor', () => {
  it('accepts the Rust Host descriptor advertised by status.get', () => {
    expect(
      readHostProtocolStatus({
        version: 1,
        capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git']
      })
    ).toEqual({
      version: 1,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git']
    })
  })

  it('rejects unknown capabilities instead of treating them as supported', () => {
    expect(readHostProtocolStatus({ version: 1, capabilities: ['future.capability'] })).toBeNull()
  })
})
