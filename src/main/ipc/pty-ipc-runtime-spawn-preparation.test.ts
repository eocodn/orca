import { describe, expect, it, vi } from 'vitest'
import {
  makePtySpawnPreparationOutcome,
  resolvePtySpawnPreparation,
  type PtySpawnPreparationOutcome
} from './pty-ipc-runtime-spawn-preparation-types'

describe('PTY spawn preparation deduplication', () => {
  it('returns an existing pane reservation as a duplicate outcome', () => {
    const existingResult = Promise.resolve({ id: 'pty-existing' })

    const outcome = makePtySpawnPreparationOutcome(
      { provider: 'must-not-run' },
      existingResult
    )

    expect(outcome).toEqual({ kind: 'duplicate', promise: existingResult })
    expect('prepared' in outcome).toBe(false)
  })

  it('keeps a missing reservation as a fresh prepared context', () => {
    const prepared = { provider: 'new-spawn' }

    const outcome: PtySpawnPreparationOutcome<typeof prepared, { id: string }> =
      makePtySpawnPreparationOutcome(prepared)

    expect(outcome).toEqual({ kind: 'fresh', prepared })
    expect('promise' in outcome).toBe(false)
  })

  it('does not execute a fresh context for a duplicate caller', async () => {
    const existingResult = Promise.resolve({ id: 'pty-existing' })
    const executeFreshPreparation = vi.fn(async () => ({ id: 'pty-fresh' }))
    const outcome = makePtySpawnPreparationOutcome(
      { provider: 'must-not-run' },
      existingResult
    )

    await expect(
      resolvePtySpawnPreparation(outcome, executeFreshPreparation)
    ).resolves.toEqual({ id: 'pty-existing' })
    expect(executeFreshPreparation).not.toHaveBeenCalled()
  })

  it('executes a fresh context normally', async () => {
    const executeFreshPreparation = vi.fn(async (prepared: { provider: string }) => ({
      id: prepared.provider
    }))
    const outcome = makePtySpawnPreparationOutcome({ provider: 'new-spawn' })

    await expect(
      resolvePtySpawnPreparation(outcome, executeFreshPreparation)
    ).resolves.toEqual({ id: 'new-spawn' })
    expect(executeFreshPreparation).toHaveBeenCalledWith({ provider: 'new-spawn' })
  })
})
