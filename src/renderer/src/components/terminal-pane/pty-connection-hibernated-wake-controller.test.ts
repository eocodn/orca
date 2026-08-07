import { describe, expect, it, vi } from 'vitest'
import { createPtyConnectionHibernatedWakeController } from './pty-connection-hibernated-wake-controller'

type RecordRef = { id: string }

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function createHarness() {
  const record = { id: 'session-1' }
  let currentRecord: RecordRef | null = record
  let currentPtyId: string | null = 'pty-1'
  const controller = createPtyConnectionHibernatedWakeController<RecordRef>({
    isDisposed: () => false,
    isCurrentOwner: () => true,
    getCurrentRecord: () => currentRecord,
    getCurrentPtyId: () => currentPtyId,
    getClaimKey: (targetRecord) => `claim:${targetRecord.id}`
  })

  return {
    controller,
    record,
    setCurrentRecord: (next: RecordRef | null) => {
      currentRecord = next
    },
    setCurrentPtyId: (next: string | null) => {
      currentPtyId = next
    }
  }
}

describe('createPtyConnectionHibernatedWakeController', () => {
  it('consumes an armed target once and exposes its in-flight provider claim', async () => {
    const harness = createHarness()
    const wake = createDeferred<string | null>()
    const wakeAgent = vi.fn(() => wake.promise)
    harness.controller.setWake(wakeAgent)
    harness.controller.arm({ ptyId: 'pty-1', record: harness.record })

    const claimed = new Set<string>()
    expect(harness.controller.consume(claimed)).toBe('claim:session-1')
    expect(claimed).toEqual(new Set(['claim:session-1']))
    expect(wakeAgent).toHaveBeenCalledTimes(1)
    expect(harness.controller.hasArmedTarget()).toBe(false)

    const secondVisitorClaims = new Set<string>()
    expect(harness.controller.claimInFlight(secondVisitorClaims)).toBe('claim:session-1')
    expect(secondVisitorClaims).toEqual(new Set(['claim:session-1']))
    expect(harness.controller.claimInFlight(secondVisitorClaims)).toBeNull()

    wake.resolve('pty-2')
    await wake.promise
    await Promise.resolve()
    expect(harness.controller.claimInFlight()).toBeNull()
  })

  it('does not consume when the provider session was already claimed by this wake event', () => {
    const harness = createHarness()
    const wakeAgent = vi.fn(async () => 'pty-2')
    harness.controller.setWake(wakeAgent)
    harness.controller.arm({ ptyId: 'pty-1', record: harness.record })

    expect(harness.controller.consume(new Set(['claim:session-1']))).toBeNull()
    expect(wakeAgent).not.toHaveBeenCalled()
    expect(harness.controller.hasArmedTarget()).toBe(true)
  })

  it('re-arms the exact target when the replacement spawn resolves without a PTY id', async () => {
    const harness = createHarness()
    const wakeAgent = vi.fn(async () => null)
    harness.controller.setWake(wakeAgent)
    harness.controller.arm({ ptyId: 'pty-1', record: harness.record })

    expect(harness.controller.consume()).toBe('claim:session-1')
    await Promise.resolve()
    await Promise.resolve()
    expect(harness.controller.hasArmedTarget()).toBe(true)

    expect(harness.controller.consume()).toBe('claim:session-1')
    expect(wakeAgent).toHaveBeenCalledTimes(2)
  })

  it('clears armed and pending state when record or PTY authority becomes stale', () => {
    const harness = createHarness()
    harness.controller.latchPending({ ptyId: 'pty-1', record: harness.record })
    harness.controller.arm({ ptyId: 'pty-1', record: harness.record })
    harness.setCurrentRecord({ id: 'session-1' })

    expect(harness.controller.consume()).toBeNull()
    expect(harness.controller.hasArmedTarget()).toBe(false)
    expect(harness.controller.arm({ ptyId: 'pty-1', record: harness.record }).pendingMatches).toBe(
      false
    )

    harness.controller.arm({ ptyId: 'pty-1', record: harness.record })
    harness.setCurrentRecord(harness.record)
    harness.setCurrentPtyId('pty-2')
    expect(harness.controller.consume()).toBeNull()
    expect(harness.controller.hasArmedTarget()).toBe(false)
  })

  it('preserves only a matching mid-kill pending wake when the suppressed exit arms', () => {
    const harness = createHarness()
    harness.controller.latchPending({ ptyId: 'pty-1', record: harness.record })
    expect(harness.controller.arm({ ptyId: 'pty-1', record: harness.record }).pendingMatches).toBe(
      true
    )

    const otherRecord = { id: 'session-2' }
    harness.controller.latchPending({ ptyId: 'pty-2', record: otherRecord })
    expect(harness.controller.arm({ ptyId: 'pty-1', record: harness.record }).pendingMatches).toBe(
      false
    )
  })

  it('latches and clears a pending mobile wake without mutating the armed target', () => {
    const harness = createHarness()
    const claimed = new Set<string>()

    expect(
      harness.controller.latchPending({ ptyId: 'pty-1', record: harness.record }, claimed)
    ).toBe('claim:session-1')
    expect(claimed).toEqual(new Set(['claim:session-1']))
    expect(harness.controller.hasArmedTarget()).toBe(false)
    expect(
      harness.controller.latchPending(
        { ptyId: 'pty-1', record: harness.record },
        new Set(['claim:session-1'])
      )
    ).toBeNull()

    harness.controller.clearPendingForPty('pty-1')
    expect(harness.controller.arm({ ptyId: 'pty-1', record: harness.record }).pendingMatches).toBe(
      false
    )
  })
})
