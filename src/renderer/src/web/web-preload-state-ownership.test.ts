import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const webDirectory = resolve(import.meta.dirname)
const compatibilitySource = readFileSync(
  resolve(webDirectory, 'web-preload-compatibility.ts'),
  'utf8'
)
const consumerSources = [
  'web-preload-runtime-apis.ts',
  'web-preload-runtime-bridge.ts',
  'web-preload-settings-persistence.ts',
  'web-preload-worktree-operations.ts'
].map((fileName) => ({
  fileName,
  source: readFileSync(resolve(webDirectory, fileName), 'utf8')
}))

describe('web preload mutable state ownership', () => {
  it('exposes setters for state shared across split preload modules', () => {
    for (const setter of [
      'setActiveEnvironment',
      'setActiveClient',
      'setActiveClientEnvironmentId',
      'setCachedWorktrees',
      'setCachedDetectedWorktrees'
    ]) {
      expect(compatibilitySource).toMatch(new RegExp(`export function ${setter}\\(`))
    }
  })

  it('does not assign to imported mutable state from consumer modules', () => {
    for (const { fileName, source } of consumerSources) {
      for (const stateName of [
        'activeEnvironment',
        'activeClient',
        'activeClientEnvironmentId',
        'cachedWorktrees',
        'cachedDetectedWorktrees'
      ]) {
        expect(source, `${fileName} must use the state owner setter for ${stateName}`).not.toMatch(
          new RegExp(`^\\s*${stateName}\\s*=`, 'm')
        )
      }
    }
  })
})
