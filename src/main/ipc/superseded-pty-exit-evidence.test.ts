import { afterEach, describe, expect, it, vi } from 'vitest'
import { PtyExitEvidence as SupersededPtyExitEvidence } from './superseded-pty-exit-evidence'

describe('SupersededPtyExitEvidence', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retains exact evidence independently for concurrent incarnations', () => {
    const evidence = new SupersededPtyExitEvidence()

    evidence.remember('pty-shared', 'inc-old')
    evidence.remember('pty-shared', 'inc-new')

    expect(evidence.consume('pty-shared', 'inc-old')).toBe(true)
    expect(evidence.consume('pty-shared', 'inc-new')).toBe(true)
    expect(evidence.size).toBe(0)
  })

  it('bounds evidence per PTY id', () => {
    const evidence = new SupersededPtyExitEvidence()

    for (let index = 0; index < 129; index += 1) {
      evidence.remember('pty-reused', `inc-${index}`)
    }

    expect(evidence.consume('pty-reused', 'inc-0')).toBe(false)
    expect(evidence.consume('pty-reused', 'inc-128')).toBe(true)
  })

  it('bounds evidence across all PTY ids', () => {
    const evidence = new SupersededPtyExitEvidence()

    for (let index = 0; index < 4_097; index += 1) {
      evidence.remember(`pty-${index}`, `inc-${index}`)
    }

    expect(evidence.size).toBe(4_096)
    expect(evidence.consume('pty-0', 'inc-0')).toBe(false)
    expect(evidence.consume('pty-4096', 'inc-4096')).toBe(true)
  })

  it('refreshes an existing exact entry without retaining its old timer', () => {
    vi.useFakeTimers()
    const evidence = new SupersededPtyExitEvidence()

    evidence.remember('pty-refresh', 'inc-refresh')
    vi.advanceTimersByTime(29_000)
    evidence.remember('pty-refresh', 'inc-refresh')
    vi.advanceTimersByTime(2_000)

    expect(evidence.consume('pty-refresh', 'inc-refresh')).toBe(true)
    vi.advanceTimersByTime(29_000)
    expect(evidence.size).toBe(0)
  })
})
