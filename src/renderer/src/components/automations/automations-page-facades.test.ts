import { describe, expect, it } from 'vitest'
import AutomationsPage from './AutomationsPage'
import OrchestratedAutomationsPage from './automations-page-orchestration'
import ControllerAutomationsPage from './automations-page-controller'

describe('automations page facades', () => {
  it('keeps every public entry point bound to a renderable page component', () => {
    expect(AutomationsPage).toBeTypeOf('function')
    expect(OrchestratedAutomationsPage).toBeTypeOf('function')
    expect(ControllerAutomationsPage).toBeTypeOf('function')
  })
})
