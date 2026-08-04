import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolvePtyIncarnationState } from './pty-runtime-lifecycle'

describe('oversized source responsibility boundaries', () => {
  it('keeps PTY incarnation admission state explicit', () => {
    expect(
      resolvePtyIncarnationState({ current: 'pty-2', pending: 'pty-1', cleanupPending: false })
    ).toBe('replacement')
    expect(
      resolvePtyIncarnationState({ current: undefined, pending: undefined, cleanupPending: true })
    ).toBe('cleanup_pending')
  })

  it('resolves source-control bases at a pure boundary', () => {
    const source = readFileSync(
      new URL(
        '../../renderer/src/components/right-sidebar/source-control-base-ref.ts',
        import.meta.url
      ),
      'utf8'
    )
    expect(source).toMatch(/export function resolveSourceControlBaseRef/u)
    expect(source).toMatch(/export function resolveSourceControlCompareBaseRef/u)
  })

  it('keeps split runtime declarations on separate boundaries', () => {
    const contextSource = readFileSync(
      new URL('./orca-runtime-context-2.ts', import.meta.url),
      'utf8'
    )
    const multiplexSource = readFileSync(
      new URL('./rpc/methods/terminal-multiplex-method.ts', import.meta.url),
      'utf8'
    )

    expect(contextSource).toContain('generation: number\n}')
    expect(multiplexSource).toMatch(
      /export const TERMINAL_MULTIPLEX_METHODS: RpcAnyMethod\[\] = \[\n  defineStreamingMethod\(/u
    )
  })
})
