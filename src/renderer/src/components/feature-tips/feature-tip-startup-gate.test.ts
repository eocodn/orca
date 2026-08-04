import { describe, expect, it } from 'vitest'
import { getDefaultOnboardingState, getDefaultVoiceSettings } from '../../../../shared/constants'
import type { GlobalSettings, OnboardingState } from '../../../../shared/types'
import { getFeatureTipsAppOpenDecision } from './feature-tip-startup-gate'

const existingUserOnboarding: OnboardingState = {
  ...getDefaultOnboardingState(),
  closedAt: Date.parse('2026-05-17T00:00:00.000Z'),
  outcome: 'completed',
  lastCompletedStep: 4
}

const firstTimeOnboarding = getDefaultOnboardingState()

function makeSettings(voiceEnabled = false): Pick<GlobalSettings, 'voice'> {
  return {
    voice: {
      ...getDefaultVoiceSettings(),
      enabled: voiceEnabled
    }
  }
}

function decide(overrides: Partial<Parameters<typeof getFeatureTipsAppOpenDecision>[0]> = {}) {
  return getFeatureTipsAppOpenDecision({
    activeModal: 'none',
    featureInteractions: {},
    featureTipsSeenIds: [],
    onboarding: existingUserOnboarding,
    persistedUIReady: true,
    promptedThisSession: false,
    settings: makeSettings(),
    suppressedByOnboardingThisSession: false,
    ...overrides
  })
}

describe('feature tip startup gate', () => {
  it('opens the command palette tip first for an existing user', () => {
    expect(decide()).toEqual({ kind: 'open', tipId: 'cmd-j-palette' })
  })

  it('opens the voice tip after the command palette tip was seen', () => {
    expect(decide({ featureTipsSeenIds: ['cmd-j-palette'] })).toEqual({
      kind: 'open',
      tipId: 'voice-dictation'
    })
  })

  it('skips the voice tip when dictation is already enabled', () => {
    expect(decide({ settings: makeSettings(true) })).toEqual({
      kind: 'open',
      tipId: 'cmd-j-palette'
    })
    expect(decide({ featureTipsSeenIds: ['cmd-j-palette'], settings: makeSettings(true) })).toEqual(
      {
        kind: 'skip'
      }
    )
  })

  it('suppresses feature tips while first-time onboarding is showing', () => {
    expect(decide({ onboarding: firstTimeOnboarding })).toEqual({
      kind: 'suppress-for-onboarding'
    })
  })

  it('does not open later in the same session after onboarding suppression', () => {
    expect(decide({ suppressedByOnboardingThisSession: true })).toEqual({ kind: 'skip' })
  })

  it('skips when the UI is not ready or another modal is active', () => {
    expect(decide({ persistedUIReady: false })).toEqual({ kind: 'skip' })
    expect(decide({ activeModal: 'settings' })).toEqual({ kind: 'skip' })
  })
})
