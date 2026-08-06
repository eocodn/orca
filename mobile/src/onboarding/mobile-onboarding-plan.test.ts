import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldPresentNotificationOptIn } from '../notifications/notification-opt-in-gate'
import {
  loadMobileOnboardingSteps,
  mobileOnboardingDestination,
  parseMobileOnboardingSteps
} from './mobile-onboarding-plan'

vi.mock('../notifications/notification-opt-in-gate', () => ({
  shouldPresentNotificationOptIn: vi.fn()
}))

describe('mobile onboarding plan', () => {
  beforeEach(() => {
    vi.mocked(shouldPresentNotificationOptIn).mockReset().mockResolvedValue(false)
  })

  it.each([
    [true, ['notifications']],
    [false, []]
  ] as const)('builds the exact plan for notifications=%s', async (showNotifications, expected) => {
    vi.mocked(shouldPresentNotificationOptIn).mockResolvedValue(showNotifications)

    await expect(loadMobileOnboardingSteps()).resolves.toEqual(expected)
    expect(shouldPresentNotificationOptIn).toHaveBeenCalledOnce()
  })

  it.each([
    [[], undefined, '/'],
    [[], 'paired-host', '/h/paired-host'],
    [
      ['notifications'],
      'paired-host',
      {
        pathname: '/mobile-onboarding',
        params: { steps: 'notifications', hostId: 'paired-host' }
      }
    ]
  ] as const)('maps %j with host %s to the correct destination', (steps, hostId, destination) => {
    expect(mobileOnboardingDestination(steps, hostId)).toEqual(destination)
  })

  it('parses route steps in canonical order without duplicates', () => {
    expect(parseMobileOnboardingSteps('notifications,unknown,notifications')).toEqual([
      'notifications'
    ])
    expect(parseMobileOnboardingSteps('notifications')).toEqual(['notifications'])
  })

  it('defaults missing or invalid route state to the complete wizard', () => {
    expect(parseMobileOnboardingSteps(undefined)).toEqual(['notifications'])
    expect(parseMobileOnboardingSteps('unknown')).toEqual(['notifications'])
  })
})
