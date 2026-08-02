import { describe, expect, it } from 'vitest'
import { buildExternalAutomationEntries } from './automations-page-external-orchestration'
import type { ExternalAutomationManager } from '../../../../shared/automations-types'

describe('external automation orchestration', () => {
  it('keeps unavailable Hermes sources visible when they have no jobs', () => {
    const manager = {
      id: 'hermes:local',
      provider: 'hermes',
      target: { type: 'local' },
      status: 'unavailable',
      error: 'Hermes is not installed',
      jobs: [],
    } as unknown as ExternalAutomationManager

    expect(buildExternalAutomationEntries([manager])).toEqual([
      { kind: 'source', key: 'hermes:local:source', manager },
    ])
  })
})
