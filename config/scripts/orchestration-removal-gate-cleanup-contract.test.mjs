import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

describe('orchestration removal gate cleanup contract', () => {
  it('does not retain reliability gates for removed orchestration surfaces', () => {
    const source = readFileSync(resolve(projectRoot, 'config/reliability-gates.jsonc'), 'utf8')
    for (const forbidden of [
      'terminal-input.agent-prompt-injection',
      'orchestration.worker-terminal-delivery',
      'src/cli/handlers/orchestration.test.ts',
      'src/main/runtime/orchestration/coordinator.ts',
      'tests/e2e/orchestration-legacy-worker-restart-recovery.spec.ts'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('does not retain max-line baselines for removed orchestration files', () => {
    const source = readFileSync(resolve(projectRoot, 'config/max-lines-baseline.txt'), 'utf8')
    for (const forbidden of [
      'src/main/runtime/orchestration/coordinator.ts',
      'src/main/runtime/rpc/methods/orchestration.ts'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
