import { describe, expect, it } from 'vitest'
import {
  getHostProtocolDescriptor,
  HOST_PROTOCOL_VERSION,
  validateHostProtocol,
  validateHostProtocolEnvelope,
  validateHostTerminalRequest
} from './host-protocol'
import { validateHostPtyRequest } from './host-pty-protocol'
import { validateHostPtyResponse } from './host-pty-response-protocol'

describe('Host protocol descriptor', () => {
  it('publishes the version and capabilities shared by desktop, web, and Android clients', () => {
    expect(getHostProtocolDescriptor()).toEqual({
      version: HOST_PROTOCOL_VERSION,
      capabilities: ['workspace.read', 'workspace.write', 'terminal', 'pty', 'git', 'file']
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
        capability: 'pty',
        protocol_version: 1
      })
    ).toEqual({
      ok: true,
      envelope: {
        request_id: 'request-1',
        capability: 'pty',
        protocol_version: 1
      }
    })
    expect(
      validateHostProtocolEnvelope({
        request_id: ' ',
        capability: 'pty',
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

  it('validates the shared PTY request lifecycle and target shape strictly', () => {
    const start = {
      envelope: { request_id: 'pty-start', capability: 'pty', protocol_version: 1 },
      workspace_id: 'workspace-1',
      worker_id: 'worker-1',
      session_id: 'session-1',
      session_generation: null,
      operation: {
        type: 'start',
        program: 'cmd.exe',
        args: ['/C', 'exit', '/B', '259'],
        current_dir: null,
        execution_target: { kind: 'windows-native' },
        cols: 80,
        rows: 24
      }
    }

    expect(validateHostPtyRequest(start)).toEqual({ ok: true, request: start })
    expect(
      validateHostPtyRequest({
        ...start,
        operation: {
          ...start.operation,
          execution_target: { kind: 'ssh', host: 'host-1', shell: 'posix' }
        }
      })
    ).toMatchObject({ ok: true })
    expect(
      validateHostPtyRequest({
        ...start,
        session_generation: 1
      })
    ).toEqual({ ok: false, reason: 'invalid-session-generation' })
    expect(
      validateHostPtyRequest({
        ...start,
        operation: { type: 'wait', timeout_ms: 0 },
        session_generation: 1
      })
    ).toEqual({ ok: false, reason: 'invalid-timeout' })
    expect(
      validateHostPtyRequest({
        ...start,
        operation: { ...start.operation, unexpected: true }
      })
    ).toEqual({ ok: false, reason: 'invalid-operation' })
  })

  it('validates the authoritative PTY response envelope and nullable fields', () => {
    const response = {
      envelope: { request_id: 'pty-poll', capability: 'pty', protocol_version: 1 },
      workspace_id: 'workspace-1',
      worker_id: 'worker-1',
      session_id: 'session-1',
      session_generation: 1,
      generation: 2,
      operation: 'poll',
      status: 'running',
      exit_code: null,
      output_sequence: 0,
      tail: '',
      failure_reason: null
    }

    expect(validateHostPtyResponse(response)).toEqual({ ok: true, response })
    expect(validateHostPtyResponse({ ...response, status: 'unknown' })).toEqual({
      ok: false,
      reason: 'invalid-status'
    })
    expect(
      validateHostPtyResponse({ ...response, generation: Number.MAX_SAFE_INTEGER + 1 })
    ).toEqual({ ok: false, reason: 'invalid-generation' })
    expect(validateHostPtyResponse({ ...response, status: 'exited', exit_code: null })).toEqual({
      ok: false,
      reason: 'invalid-status-payload'
    })
    expect(validateHostPtyResponse({ ...response, status: 'failed', failure_reason: ' ' })).toEqual(
      { ok: false, reason: 'invalid-status-payload' }
    )
  })
})
