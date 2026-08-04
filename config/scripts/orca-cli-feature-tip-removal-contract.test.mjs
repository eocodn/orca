import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('public Orca CLI feature-tip removal contract', () => {
  it('does not advertise the removed Orca CLI tip', () => {
    const source = readProjectFile('src/shared/feature-tips.ts')

    expect(source).not.toContain("id: 'orca-cli'")
    expect(source).not.toContain("action: 'setup-cli'")
  })

  it('does not mount the removed CLI feature-tip visual or setup terminal', () => {
    const source = readProjectFile('src/renderer/src/components/feature-tips/FeatureTipsModal.tsx')

    expect(source).not.toContain('CliFeatureTipVisual')
    expect(source).not.toContain('CliSkillSetupTerminal')
    expect(source).not.toContain('installCliFromFeatureTip')
    expect(source).not.toContain('ORCHESTRATION_ENABLED_STORAGE_KEY')
  })

  it('removes the deleted CLI feature-tip implementation files', () => {
    for (const relativePath of [
      'src/renderer/src/components/feature-tips/CliFeatureTipVisual.tsx',
      'src/renderer/src/components/feature-tips/CliSkillSetupTerminal.tsx',
      'src/renderer/src/components/feature-tips/feature-tip-cli-install-action.ts',
      'src/renderer/src/components/feature-tips/feature-tip-cli-install-action.test.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('keeps feature-tip actions free of the removed setup action', () => {
    expect(
      readProjectFile('src/renderer/src/components/feature-tips/FeatureTipActions.tsx')
    ).not.toContain('setup-cli')
  })
})
