import { describe, expect, it } from 'vitest'
import { classifyAutomationCronSchedule } from './automation-schedule-classifier'
import { createHookListenerState } from './agent-hook-listener'
import { appOpenedSchema } from './telemetry-event-core-schemas'
import { contextualTourShownSchema } from './telemetry-event-education-schemas'
import { onboardingStartedSchema } from './telemetry-event-education-schemas'
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

  it('keeps concrete telemetry schemas identical to the public registry', () => {
    const appOpenedPayload = { nth_repo_added: 2 }
    const onboardingStartedPayload = { cohort: 'fresh_install' }
    const contextualTourShownPayload = {
      tour_id: 'browser',
      source: 'browser_visible',
      was_feature_previously_interacted: false
    }

    expect(appOpenedSchema).toBe(eventSchemas.app_opened)
    expect(onboardingStartedSchema).toBe(eventSchemas.onboarding_started)
    expect(contextualTourShownSchema).toBe(eventSchemas.contextual_tour_shown)
    expect(appOpenedSchema.parse(appOpenedPayload)).toEqual(appOpenedPayload)
    expect(onboardingStartedSchema.parse(onboardingStartedPayload)).toEqual(onboardingStartedPayload)
    expect(contextualTourShownSchema.parse(contextualTourShownPayload)).toEqual(
      contextualTourShownPayload
    )
  })
})
