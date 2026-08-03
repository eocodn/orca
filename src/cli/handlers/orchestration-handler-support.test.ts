import { describe, expect, it } from 'vitest'

import * as support from './orchestration-handler-support'

describe('orchestration handler support boundary', () => {
  it('exports every runtime helper used by split handler modules', () => {
    expect(support.resolveCoordinatorTerminalHandle).toBeTypeOf('function')
    expect(support.resolveOrchestrationTerminalHandle).toBeTypeOf('function')
    expect(support.flushStdout).toBeTypeOf('function')
  })
})
