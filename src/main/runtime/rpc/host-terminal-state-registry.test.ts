import { describe, expect, it } from 'vitest'
import { HostTerminalStateRegistry } from './host-terminal-state-registry'

describe('HostTerminalStateRegistry', () => {
  it('does not publish a partial mutation when generation overflows', () => {
    const registry = new HostTerminalStateRegistry()
    const terminals = (
      registry as unknown as {
        terminals: Map<
          string,
          {
            terminal_id: string
            generation: number
            status: 'running'
            exit_code: null
            failure_reason: null
            output_sequence: number
            tail: string
          }
        >
      }
    ).terminals
    terminals.set('terminal-1', {
      terminal_id: 'terminal-1',
      generation: Number.MAX_SAFE_INTEGER,
      status: 'running',
      exit_code: null,
      failure_reason: null,
      output_sequence: 0,
      tail: ''
    })

    expect(() =>
      registry.apply({
        envelope: { request_id: 'request-overflow', capability: 'terminal', protocol_version: 1 },
        terminal_id: 'terminal-1',
        expected_generation: Number.MAX_SAFE_INTEGER,
        operation: { type: 'output', sequence: 1, data: 'discarded' }
      })
    ).toThrow('generation_overflow')
    expect(registry.snapshot('terminal-1')).toMatchObject({
      generation: Number.MAX_SAFE_INTEGER,
      output_sequence: 0,
      tail: ''
    })
  })
})
