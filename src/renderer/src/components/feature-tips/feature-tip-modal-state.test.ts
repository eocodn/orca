import { describe, expect, it } from 'vitest'
import { getDefaultVoiceSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/types'
import { getFeatureTipForModal } from './feature-tip-modal-state'

function makeSettings(voiceEnabled = false): Pick<GlobalSettings, 'voice'> {
  return {
    voice: {
      ...getDefaultVoiceSettings(),
      enabled: voiceEnabled
    }
  }
}

function getTip(overrides: Partial<Parameters<typeof getFeatureTipForModal>[0]> = {}) {
  return getFeatureTipForModal({
    modalData: {},
    seenTipIds: [],
    featureInteractions: {},
    settings: makeSettings(),
    ...overrides
  })
}

describe('feature tip modal state', () => {
  it('keeps rendering the opened tip after app open has marked it seen', () => {
    expect(
      getTip({ modalData: { tipId: 'voice-dictation' }, seenTipIds: ['voice-dictation'] })?.id
    ).toBe('voice-dictation')
  })

  it('falls back to the command palette tip first', () => {
    expect(getTip()?.id).toBe('cmd-j-palette')
  })

  it('falls back to voice after the command palette tip was handled', () => {
    expect(getTip({ seenTipIds: ['cmd-j-palette'] })?.id).toBe('voice-dictation')
  })

  it('returns no tip when every retained tip is seen or completed', () => {
    expect(getTip({ seenTipIds: ['voice-dictation', 'cmd-j-palette'] })).toBeNull()
    expect(getTip({ seenTipIds: ['cmd-j-palette'], settings: makeSettings(true) })).toBeNull()
  })

  it('returns no unpinned tip after the user already interacted with the feature', () => {
    expect(
      getTip({
        seenTipIds: ['cmd-j-palette'],
        featureInteractions: {
          'voice-dictation': { firstInteractedAt: 100, interactionCount: 1 }
        }
      })
    ).toBeNull()
  })
})
