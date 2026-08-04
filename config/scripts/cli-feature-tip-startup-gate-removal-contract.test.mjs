import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('CLI feature-tip startup gate removal contract', () => {
  it('keeps the shared and modal feature-tip state independent of CLI install state', () => {
    for (const relativePath of [
      'src/shared/feature-tips.ts',
      'src/renderer/src/components/feature-tips/feature-tip-modal-state.ts',
      'src/renderer/src/components/feature-tips/feature-tip-startup-gate.ts',
      'src/renderer/src/components/feature-tips/FeatureTipsModal.tsx'
    ]) {
      const source = readProjectFile(relativePath)
      expect(source).not.toContain('cliInstalled')
      expect(source).not.toContain('CliInstallStatus')
      expect(source).not.toContain('isCliFeatureTipCompleted')
    }
  })

  it('does not query the removed CLI install API during app startup', () => {
    const source = readProjectFile('src/renderer/src/app-shell-page-onboarding-effects.ts')
    expect(source).not.toContain('featureTipCliInstalled')
    expect(source).not.toContain('setFeatureTipCliInstalled')
    expect(source).not.toContain('window.api.cli')
  })
})
