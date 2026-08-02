import { describe, expect, it } from 'vitest'
import { classifyAutomationCronSchedule } from './automation-schedule-classifier'
import { createHookListenerState } from './agent-hook-listener'
import { eventSchemas } from './telemetry-events'
import { DIGIT_INDEX_KEY_PATTERN } from './keybinding-registry'
import { copyRecord } from './source-control-ai-normalization'

describe('shared split module boundaries', () => {
  it('keeps split implementations reachable through their public module APIs', () => {
    expect(DIGIT_INDEX_KEY_PATTERN.test('1')).toBe(true)
    expect(copyRecord({ value: 1 })).toEqual({ value: 1 })
    expect(typeof createHookListenerState).toBe('function')
    expect(typeof classifyAutomationCronSchedule).toBe('function')
    expect(eventSchemas).toBeDefined()
  })
})
