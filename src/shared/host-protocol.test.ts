import { describe, expect, it } from 'vitest'
import {
  getHostProtocolDescriptor,
  HOST_PROTOCOL_VERSION,
  validateHostProtocol,
  validateHostProtocolEnvelope,
  validateHostTerminalRequest
} from './host-protocol'

describe('Host protocol descriptor', () => {
  it('publishes the version and capabilities shared by desktop, web, and Android clients', () => {
    expect(getHostProtocolDescriptor()).toEqual({
      version: HOST_PROTOCOL_VERSION,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'git', 'file']
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

  it('validates the Rust-compatible envelope wire shape strictly', () => {
    expect(
      validateHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'workspace.write',
        protocol_version: 1
      })
    ).toEqual({
      ok: true,
      envelope: {
        request_id: 'request-1',
        capability: 'workspace.write',
        protocol_version: 1
      }
    })
    expect(
      validateHostProtocolEnvelope({
        request_id: ' ',
        capability: 'workspace.write',
        protocol_version: 1
      })
    ).toEqual({ ok: false, reason: 'empty-request-id' })
    expect(
      validateHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'unknown',
        protocol_version: 1
      })
    ).toEqual({ ok: false, reason: 'invalid-capability' })
    expect(
      validateHostProtocolEnvelope({
        request_id: 'request-1',
        capability: 'terminal',
        protocol_version: 1,
        unexpected: true
      })
    ).toEqual({ ok: false, reason: 'missing' })
  })

  it('validates terminal requests without mutating malformed input', () => {
    const request = {
      envelope: { request_id: 'request-1', capability: 'terminal', protocol_version: 1 },
      terminal_id: 'terminal-1',
      expected_generation: 1,
      operation: { type: 'output', sequence: 2, data: 'ready' }
    }

    expect(validateHostTerminalRequest(request)).toEqual({ ok: true, request })
    expect(
      validateHostTerminalRequest({
        ...request,
        operation: { type: 'output', sequence: 0, data: 'stale' }
      })
    ).toEqual({ ok: false, reason: 'invalid-output-sequence' })
    expect(validateHostTerminalRequest({ ...request, unexpected: true })).toEqual({
      ok: false,
      reason: 'invalid-operation'
    })
  })
})
