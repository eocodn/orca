import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { exposeUtcTimestamp, isEquivalentPaneKey } from './orchestration/db-contract-helpers'
import { resolvePtyIncarnationState } from './pty-runtime-lifecycle'
import {
  resolveSourceControlBaseRef,
  resolveSourceControlCompareBaseRef
} from '../../renderer/src/components/right-sidebar/source-control-base-ref'

describe('oversized source responsibility boundaries', () => {
  it('keeps orchestration contract helpers deterministic outside the database class', () => {
    expect(exposeUtcTimestamp('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05Z')
    expect(isEquivalentPaneKey('tab:leaf-a', 'tab:leaf-a')).toBe(true)
  })

  it('keeps PTY incarnation admission state explicit', () => {
    expect(
      resolvePtyIncarnationState({ current: 'pty-2', pending: 'pty-1', cleanupPending: false })
    ).toBe('replacement')
    expect(
      resolvePtyIncarnationState({ current: undefined, pending: undefined, cleanupPending: true })
    ).toBe('cleanup_pending')
  })

  it('resolves source-control bases at a pure boundary', () => {
    expect(
      resolveSourceControlBaseRef({
        worktreeBaseRef: 'refs/remotes/origin/main',
        repoBaseRef: 'main',
        defaultBaseRef: 'develop'
      })
    ).toBe('refs/remotes/origin/main')
    expect(
      resolveSourceControlCompareBaseRef({
        enabled: true,
        upstreamName: 'origin/main',
        fallbackBaseRef: 'main'
      })
    ).toBe('origin/main')
  })

  it('keeps split runtime declarations on separate boundaries', () => {
    const contextSource = readFileSync(new URL('./orca-runtime-context-2.ts', import.meta.url), 'utf8')
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
