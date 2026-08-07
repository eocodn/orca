import { describe, expect, it, vi } from 'vitest'
import {
  createInitialCacheTimerSeedController,
  shouldSeedCacheTimerOnInitialTitle
} from './cache-timer-seeding'

describe('shouldSeedCacheTimerOnInitialTitle', () => {
  it('does not seed for fresh Claude tabs that have not been restored', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: '✳ Claude Code',
        allowInitialIdleSeed: false,
        existingTimerStartedAt: null,
        promptCacheTimerEnabled: true
      })
    ).toBe(false)
  })

  it('seeds for restored Claude tabs that are already idle', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: '✳ Claude Code',
        allowInitialIdleSeed: true,
        existingTimerStartedAt: null,
        promptCacheTimerEnabled: true
      })
    ).toBe(true)
  })

  it('does not seed for restored Claude tabs that are still working', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: '⠂ Claude Code',
        allowInitialIdleSeed: true,
        existingTimerStartedAt: null,
        promptCacheTimerEnabled: true
      })
    ).toBe(false)
  })

  it('does not seed when a timer already exists for the pane', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: '✳ Claude Code',
        allowInitialIdleSeed: true,
        existingTimerStartedAt: Date.now(),
        promptCacheTimerEnabled: true
      })
    ).toBe(false)
  })

  it('treats null settings as provisionally enabled during startup hydration', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: '✳ Claude Code',
        allowInitialIdleSeed: true,
        existingTimerStartedAt: null,
        promptCacheTimerEnabled: null
      })
    ).toBe(true)
  })
})

describe('createInitialCacheTimerSeedController', () => {
  it('consumes the first title even when restored seeding is not allowed yet', () => {
    const seed = vi.fn()
    const controller = createInitialCacheTimerSeedController({
      getExistingTimerStartedAt: () => null,
      getPromptCacheTimerEnabled: () => true,
      seed
    })

    controller.observeTitle('✳ Claude Code')
    controller.setAllowed(true)
    controller.observeTitle('✳ Claude Code')

    expect(seed).not.toHaveBeenCalled()
  })

  it('seeds once for the first restored idle Claude title', () => {
    const seed = vi.fn()
    const controller = createInitialCacheTimerSeedController({
      getExistingTimerStartedAt: () => null,
      getPromptCacheTimerEnabled: () => true,
      seed
    })

    controller.setAllowed(true)
    controller.observeTitle('✳ Claude Code')
    controller.observeTitle('✳ Claude Code')

    expect(seed).toHaveBeenCalledTimes(1)
  })

  it('does not seed when the first restored title is working or non-Claude', () => {
    const workingSeed = vi.fn()
    const working = createInitialCacheTimerSeedController({
      getExistingTimerStartedAt: () => null,
      getPromptCacheTimerEnabled: () => true,
      seed: workingSeed
    })
    working.setAllowed(true)
    working.observeTitle('⠂ Claude Code')

    const otherSeed = vi.fn()
    const other = createInitialCacheTimerSeedController({
      getExistingTimerStartedAt: () => null,
      getPromptCacheTimerEnabled: () => true,
      seed: otherSeed
    })
    other.setAllowed(true)
    other.observeTitle('shell')

    expect(workingSeed).not.toHaveBeenCalled()
    expect(otherSeed).not.toHaveBeenCalled()
  })

  it('reads current timer and settings state when the first title arrives', () => {
    let existingTimerStartedAt: number | null = null
    let promptCacheTimerEnabled: boolean | null = true
    const seed = vi.fn()
    const controller = createInitialCacheTimerSeedController({
      getExistingTimerStartedAt: () => existingTimerStartedAt,
      getPromptCacheTimerEnabled: () => promptCacheTimerEnabled,
      seed
    })

    controller.setAllowed(true)
    existingTimerStartedAt = 123
    promptCacheTimerEnabled = false
    controller.observeTitle('✳ Claude Code')

    expect(seed).not.toHaveBeenCalled()
  })
})
