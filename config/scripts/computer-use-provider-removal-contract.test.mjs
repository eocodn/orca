import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('Computer Use provider removal contract', () => {
  it('removes native providers and main-process provider modules', () => {
    for (const relativePath of [
      'src/main/computer',
      'native/computer-use-macos',
      'native/computer-use-linux',
      'native/computer-use-windows',
      'src/main/ipc/computer-use-permissions.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('removes Computer Use preload and settings surfaces', () => {
    const preloadContract = readProjectFile('src/preload/preload-api-contract-agent-hooks.ts')
    const preloadImplementation = readProjectFile('src/preload/preload-api-agent-hooks.ts')
    expect(preloadContract).not.toMatch(/computerUsePermissions/)
    expect(preloadImplementation).not.toMatch(/computerUsePermissions/)

    for (const relativePath of [
      'src/renderer/src/components/settings/settings-page-primary-sections.tsx',
      'src/renderer/src/components/settings/settings-page-navigation-state.ts',
      'src/renderer/src/hooks/settings-navigation-metadata-builder.ts',
      'src/renderer/src/lib/settings-navigation-types.ts'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(/computer-use|ComputerUse/)
    }
    for (const relativePath of [
      'src/renderer/src/components/settings/ComputerUsePane.tsx',
      'src/renderer/src/components/settings/ComputerUseSkillSetupPanel.tsx',
      'src/renderer/src/components/settings/computer-use-search.ts',
      'src/renderer/src/components/settings/BrowserUseComputerUseNotice.tsx'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath)), relativePath).toBe(false)
    }
  })

  it('removes the dedicated Computer Use skill installer while retaining generic agent skills', () => {
    const installCommands = readProjectFile('src/shared/agent-feature-install-commands.ts')
    const rendererCommands = readProjectFile('src/renderer/src/lib/agent-feature-install-commands.ts')
    expect(installCommands).not.toMatch(/COMPUTER_USE|computer-use/)
    expect(rendererCommands).not.toMatch(/COMPUTER_USE|computer-use/)
    expect(existsSync(resolve(projectRoot, 'src/renderer/src/components/settings/BrowserPane.tsx'))).toBe(true)
  })

  it('removes provider translation keys and override rules', () => {
    for (const locale of ['en', 'es', 'ja', 'ko', 'zh']) {
      expect(readProjectFile(`src/renderer/src/i18n/locales/${locale}.json`), locale).not.toMatch(
        /computer.?use/i
      )
    }
    for (const relativePath of [
      'config/scripts/locale-key-overrides-catalog-first.mjs',
      'config/scripts/locale-ko-key-overrides.json',
      'config/scripts/locale-phrase-fixes.mjs',
      'config/scripts/locale-ja-phrase-fixes.mjs',
      'config/scripts/locale-ko-phrase-fixes.mjs',
      'config/scripts/locale-value-overrides.mjs',
      'config/scripts/locale-ko-value-overrides.mjs'
    ]) {
      expect(readProjectFile(relativePath), relativePath).not.toMatch(/computer.?use/i)
    }
  })
})
