import { describe, expect, it } from 'vitest'
import {
  FEATURE_TIPS,
  getOrderedUnseenFeatureTips,
  normalizeFeatureTipIds,
  type FeatureTipId
} from './feature-tips'

describe('feature tips', () => {
  it('orders new unseen tips before older unseen tips', () => {
    const tips = getOrderedUnseenFeatureTips({ seenTipIds: new Set<FeatureTipId>() })

    expect(tips.map((tip) => tip.id)).toEqual(['cmd-j-palette'])
  })

  it('skips tips the user has already seen', () => {
    const tips = getOrderedUnseenFeatureTips({
      seenTipIds: new Set<FeatureTipId>(['cmd-j-palette'])
    })

    expect(tips).toEqual([])
  })

  it('normalizes persisted tip ids while ignoring removed entries', () => {
    expect(
      normalizeFeatureTipIds([
        'feature-tour',
        'orca-cli',
        'bogus',
        'cmd-j-palette',
      ])
    ).toEqual(['cmd-j-palette'])
  })

  it('describes the command palette tip as a passive acknowledgement', () => {
    const paletteTip = FEATURE_TIPS.find((tip) => tip.id === 'cmd-j-palette')

    expect(paletteTip).toMatchObject({
      action: 'learn-cmd-j-palette',
      priority: 'new',
      eyebrow: 'Tip',
      ctaLabel: 'Got it'
    })
    expect(paletteTip?.description).toContain('worktrees')
    expect(paletteTip?.description).toContain('spin up a new worktree')
  })


})
