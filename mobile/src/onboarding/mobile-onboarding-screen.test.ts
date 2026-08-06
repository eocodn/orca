import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MobileOnboardingScreen from '../../app/mobile-onboarding'

const mocks = vi.hoisted(() => ({
  params: { hostId: 'paired-host', steps: 'notifications' },
  replace: vi.fn(),
  reducedMotionEnabled: false,
  animatedTiming: vi.fn(),
  ensureNotificationPermissions: vi.fn(),
  savePushNotificationsEnabled: vi.fn()
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    isReduceMotionEnabled: vi.fn(() => Promise.resolve(mocks.reducedMotionEnabled))
  },
  Animated: {
    Value: class {},
    View: 'AnimatedView',
    multiply: vi.fn(() => 0),
    timing: mocks.animatedTiming
  },
  BackHandler: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() }))
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 390, height: 844 })
}))

vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => mocks.params,
  useRouter: () => ({ replace: mocks.replace })
}))

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: 'OrcaLogo' }))
vi.mock('./MobileOnboardingPage', () => ({ MobileOnboardingPage: 'MobileOnboardingPage' }))
vi.mock('../notifications/mobile-notifications', () => ({
  ensureNotificationPermissions: mocks.ensureNotificationPermissions
}))
vi.mock('../storage/preferences', () => ({
  savePushNotificationsEnabled: mocks.savePushNotificationsEnabled
}))

describe('MobileOnboardingScreen', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    mocks.params = { hostId: 'paired-host', steps: 'notifications' }
    mocks.replace.mockReset()
    mocks.reducedMotionEnabled = false
    mocks.animatedTiming.mockReset().mockReturnValue({
      start: (callback: (result: { finished: boolean }) => void) => callback({ finished: true })
    })
    mocks.ensureNotificationPermissions.mockReset().mockResolvedValue(true)
    mocks.savePushNotificationsEnabled.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    vi.restoreAllMocks()
  })

  async function renderScreen() {
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (typeof args[0] !== 'string' || !args[0].includes('react-test-renderer is deprecated')) {
        throw new Error(String(args[0]))
      }
    })
    await act(async () => {
      renderer = create(createElement(MobileOnboardingScreen))
    })
    consoleError.mockRestore()
  }

  function pages() {
    return renderer!.root.findAllByType('MobileOnboardingPage')
  }

  it('saves a skipped notification choice and opens the paired host', async () => {
    await renderScreen()

    await act(async () => pages()[0].props.onNotificationChoice('skip'))

    expect(mocks.ensureNotificationPermissions).not.toHaveBeenCalled()
    expect(mocks.savePushNotificationsEnabled).toHaveBeenCalledWith(false)
    expect(mocks.replace).toHaveBeenCalledWith('/h/paired-host')
  })

  it('requests notification permission before saving an enabled choice', async () => {
    mocks.ensureNotificationPermissions.mockResolvedValue(true)
    await renderScreen()

    await act(async () => pages()[0].props.onNotificationChoice('enable'))

    expect(mocks.ensureNotificationPermissions).toHaveBeenCalledTimes(1)
    expect(mocks.savePushNotificationsEnabled).toHaveBeenCalledWith(true)
    expect(mocks.replace).toHaveBeenCalledWith('/h/paired-host')
  })

  it('keeps the notification step retryable when persistence fails', async () => {
    mocks.savePushNotificationsEnabled
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    await renderScreen()

    await act(async () => pages()[0].props.onNotificationChoice('skip'))
    expect(pages()[0].props.error).toBe('Notification settings could not be updated. Try again.')

    await act(async () => pages()[0].props.onNotificationChoice('skip'))
    expect(mocks.savePushNotificationsEnabled).toHaveBeenCalledTimes(2)
    expect(mocks.replace).toHaveBeenCalledWith('/h/paired-host')
  })
})
