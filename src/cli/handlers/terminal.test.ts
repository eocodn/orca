import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { parseArgs } from '../args'
import { printHelp } from '../help'
import { COMMAND_SPECS } from '../specs'
import { TERMINAL_HANDLERS } from './terminal'

describe('terminal close CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the default close RPC unchanged', async () => {
    const call = vi.fn().mockResolvedValue({
      result: { close: { handle: 'term-1', tabId: 'tab-1', ptyKilled: true } }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: new Map([['terminal', 'term-1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.close', { terminal: 'term-1' })
  })

  it('routes --tab to the durable whole-tab RPC', async () => {
    const parsed = parseArgs(['terminal', 'close', '--terminal', 'term-1', '--tab'])
    const call = vi.fn().mockResolvedValue({
      result: {
        close: {
          handle: 'term-1',
          tabId: 'tab-1',
          closeMode: 'tab',
          ptyKilled: false
        }
      }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal close']({
      flags: parsed.flags,
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(parsed.flags.get('tab')).toBe(true)
    expect(call).toHaveBeenCalledWith('terminal.closeTab', { terminal: 'term-1' })
  })

  it('documents that --tab waits for durable persistence', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'close'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('orca terminal close [--terminal <handle>] [--tab] [--json]')
    expect(help).toContain('durable persistence')
  })
})

describe('terminal inspect and resize CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the authoritative terminal inspection contract', async () => {
    const call = vi.fn().mockResolvedValue({ result: { terminal: { handle: 'term-1' } } })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal inspect']({
      flags: new Map([['terminal', 'term-1']]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.inspect', { terminal: 'term-1' })
  })

  it('requires an observed incarnation and forwards exact integer dimensions', async () => {
    const parsed = parseArgs([
      'terminal',
      'resize',
      '--terminal',
      'term-1',
      '--incarnation',
      'pty-1:inc-1',
      '--cols',
      '132',
      '--rows',
      '41'
    ])
    const call = vi.fn().mockResolvedValue({ result: { resize: { handle: 'term-1' } } })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal resize']({
      flags: parsed.flags,
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.resize', {
      terminal: 'term-1',
      incarnation: 'pty-1:inc-1',
      cols: 132,
      rows: 41
    })
  })

  it.each([
    ['cols', '1e2'],
    ['cols', '+80'],
    ['cols', ' 80 '],
    ['cols', '1001'],
    ['rows', '501'],
    ['rows', '40.5']
  ])('rejects non-canonical or out-of-range --%s value %s locally', async (name, value) => {
    const flags = new Map<string, string | boolean>([
      ['terminal', 'term-1'],
      ['incarnation', 'pty-1:inc-1'],
      ['cols', '80'],
      ['rows', '24'],
      [name, value]
    ])
    const call = vi.fn()

    await expect(
      TERMINAL_HANDLERS['terminal resize']({
        flags,
        client: { call } as unknown as RuntimeClient,
        cwd: '/tmp/worktree',
        json: true
      })
    ).rejects.toThrow(`--${name}`)
    expect(call).not.toHaveBeenCalled()
  })

  it('accepts the exact dimension maxima locally', async () => {
    const call = vi.fn().mockResolvedValue({ result: { resize: { handle: 'term-1' } } })
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await TERMINAL_HANDLERS['terminal resize']({
      flags: new Map([
        ['terminal', 'term-1'],
        ['incarnation', 'pty-1:inc-1'],
        ['cols', '1000'],
        ['rows', '500']
      ]),
      client: { call } as unknown as RuntimeClient,
      cwd: '/tmp/worktree',
      json: true
    })

    expect(call).toHaveBeenCalledWith('terminal.resize', {
      terminal: 'term-1',
      incarnation: 'pty-1:inc-1',
      cols: 1000,
      rows: 500
    })
  })

  it('documents the incarnation fence and authoritative readback', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    printHelp(COMMAND_SPECS, ['terminal', 'resize'])

    const help = String(log.mock.calls[0]?.[0])
    expect(help).toContain('--incarnation <id>')
    expect(help).toContain('authoritative')
  })
})
