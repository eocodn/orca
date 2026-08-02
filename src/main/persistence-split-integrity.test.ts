import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('persistence split integrity', () => {
  it('keeps the loader dependency members available as module APIs', () => {
    const dependencies = readSource('./persistence-store-repository-load-dependencies.ts')
    const loaderApi = readSource('./persistence-store-repository-load-api.ts')
    const primaryLoader = readSource('./persistence-store-repository-load-primary-state.ts')
    const finalizationLoader = readSource('./persistence-store-repository-load-finalization.ts')

    for (const api of [
      'readFileSync',
      'decrypt',
      'normalizeLoadedOnboardingState',
      'logPersistenceStartupMilestone'
    ]) {
      expect(loaderApi).toMatch(
        new RegExp('export const \\{[\\s\\S]*\\b' + api + '\\b[\\s\\S]*\\}')
      )
    }
    expect(dependencies).toMatch(/export const persistenceLoadDependencies/)
    expect(primaryLoader).toMatch(/loadDependencies\.readFileSync/)
    expect(finalizationLoader).toMatch(/from '\.\/persistence-store-repository-load-api'/)
  })

  it('does not bind a phase superclass twice after the split', () => {
    const phaseFiles = [
      'persistence-store-automation-state.ts',
      'persistence-store-project-state.ts',
      'persistence-store-settings-state.ts',
      'persistence-store-session-state.ts',
      'persistence-store-pty-state.ts',
      'persistence-store-ssh-state.ts',
      'persistence-store-write-lifecycle.ts',
      'persistence-store-state-phase-9.ts',
      'persistence-store-state-phase-10.ts',
      'persistence-store-state-phase-11.ts',
      'persistence-store-state-phase-12.ts',
      'persistence-store-state-phase-13.ts',
      'persistence-store-state-phase-14.ts'
    ]

    for (const file of phaseFiles) {
      const imports = readSource(`./${file}`).match(/^import \{ StorePhase\d+ \} from .+$/gm) ?? []
      expect(imports, file).toHaveLength(1)
    }
  })
})
