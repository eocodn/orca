import { describe, expect, it } from 'vitest'
import {
  getHostProtocolDescriptor,
  HOST_PROTOCOL_VERSION,
  validateHostProtocol
} from './host-protocol'

describe('Host protocol descriptor', () => {
  it('publishes the version and capabilities shared by desktop, web, and Android clients', () => {
    expect(getHostProtocolDescriptor()).toEqual({
      version: HOST_PROTOCOL_VERSION,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git']
    })
  })

  it('rejects malformed or unsupported descriptors without guessing a fallback', () => {
    expect(validateHostProtocol(undefined)).toEqual({ ok: false, reason: 'missing' })
    expect(validateHostProtocol({ version: 99, capabilities: [] })).toEqual({
      ok: false,
      reason: 'unsupported-version'
    })
    expect(
      validateHostProtocol({ version: HOST_PROTOCOL_VERSION, capabilities: ['unknown'] })
    ).toEqual({
      ok: false,
      reason: 'invalid-capabilities'
    })
  })
})
