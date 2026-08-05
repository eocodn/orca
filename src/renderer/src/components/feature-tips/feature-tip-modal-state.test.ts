import { describe, expect, it } from 'vitest'
import { getFeatureTipForModal } from './feature-tip-modal-state'

function getTip(overrides: Partial<Parameters<typeof getFeatureTipForModal>[0]> = {}) {
  return getFeatureTipForModal({
    modalData: {},
    seenTipIds: [],
    featureInteractions: {},
    ...overrides
  })
}

describe('feature tip modal state', () => {
  it('falls back to the command palette tip first', () => {
    expect(getTip()?.id).toBe('cmd-j-palette')
  })

  it('returns no tip when the command palette tip is seen', () => {
    expect(getTip({ seenTipIds: ['cmd-j-palette'] })).toBeNull()
  })
})
