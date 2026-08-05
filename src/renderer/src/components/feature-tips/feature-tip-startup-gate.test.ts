import { describe, expect, it } from 'vitest'
import { getDefaultOnboardingState } from '../../../../shared/constants'
import type { OnboardingState } from '../../../../shared/types'
import { getFeatureTipsAppOpenDecision } from './feature-tip-startup-gate'

const existingUserOnboarding: OnboardingState = {
  ...getDefaultOnboardingState(),
  closedAt: Date.parse('2026-05-17T00:00:00.000Z'),
  outcome: 'completed',
  lastCompletedStep: 4
}

const firstTimeOnboarding = getDefaultOnboardingState()

function decide(overrides: Partial<Parameters<typeof getFeatureTipsAppOpenDecision>[0]> = {}) {
  return getFeatureTipsAppOpenDecision({
    activeModal: 'none',
    featureInteractions: {},
    featureTipsSeenIds: [],
    onboarding: existingUserOnboarding,
    persistedUIReady: true,
    promptedThisSession: false,
    settings: {},
    suppressedByOnboardingThisSession: false,
    ...overrides
  })
}

describe('feature tip startup gate', () => {
  it('opens the command palette tip first for an existing user', () => {
    expect(decide()).toEqual({ kind: 'open', tipId: 'cmd-j-palette' })
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
