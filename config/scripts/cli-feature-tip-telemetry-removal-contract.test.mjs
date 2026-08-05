import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('CLI feature-tip telemetry removal contract', () => {
  it('removes CLI feature-tip telemetry exports and event names', () => {
    expect(
      existsSync(resolve(projectRoot, 'src/renderer/src/components/feature-tips/feature-tip-telemetry.ts'))
    ).toBe(false)
  })

  it('removes CLI feature-tip telemetry callers from app-shell modules', () => {
    for (const relativePath of [
      'src/renderer/src/app-shell-page-onboarding-effects.ts',
      'src/renderer/src/app-shell-page-orchestration.tsx',
      'src/renderer/src/app-shell-page-renderer.tsx',
      'src/renderer/src/app-shell-page-session-effects.ts',
      'src/renderer/src/app-shell-page-shortcut-effects.ts',
      'src/renderer/src/app-shell-page-startup-effects.ts'
    ]) {
      expect(readProjectFile(relativePath)).not.toContain('trackOrcaCliFeatureTip')
    }
  })
})
