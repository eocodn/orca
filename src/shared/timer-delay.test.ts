import { describe, expect, it } from 'vitest'
import {
  isSafeTimerDelayMs,
  MAX_TIMER_DELAY_MS,
  parsePositiveSafeIntegerNumericText
} from './timer-delay'

describe('timer delay policy', () => {
  it.each([0, 1, MAX_TIMER_DELAY_MS])('accepts timer delay %s', (value) => {
    expect(isSafeTimerDelayMs(value)).toBe(true)
  })

  it.each([-1, 1.5, MAX_TIMER_DELAY_MS + 1, Number.MAX_SAFE_INTEGER + 1])(
    'rejects timer delay %s',
    (value) => {
      expect(isSafeTimerDelayMs(value)).toBe(false)
    }
  )

  // Values the CLI's own Number() coercion accepts must parse to the same
  // budget here, or the caller's timer expires before the CLI's does.
  it.each([
    ['+1000', 1_000],
    ['1000.0', 1_000],
    ['1e3', 1_000],
    ['1.0000000000000000001', 1],
    ['+1.0000000000000000001', 1],
    ['600000.000000000000001', 600_000]
  ])('parses CLI-compatible positive integer text %s', (raw, expected) => {
    expect(parsePositiveSafeIntegerNumericText(raw)).toBe(expected)
  })

  it.each(['', '0', '-1', '1.5', 'Infinity', '9007199254740992'])(
    'rejects invalid CLI-compatible integer text %s',
    (raw) => {
      expect(parsePositiveSafeIntegerNumericText(raw)).toBeNull()
    }
  )
})
