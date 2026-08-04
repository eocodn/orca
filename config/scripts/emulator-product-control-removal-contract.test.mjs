import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function projectPath(relativePath) {
  return resolve(projectRoot, relativePath)
}

function readProjectFile(relativePath) {
  return readFileSync(projectPath(relativePath), 'utf8')
}

describe('emulator product-control removal contract', () => {
  it('removes the emulator backend and runtime command entry points', () => {
    expect(existsSync(projectPath('src/main/emulator'))).toBe(false)
    expect(existsSync(projectPath('src/main/runtime/orca-runtime-emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/main/runtime/rpc/methods/emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/cli/handlers/emulator.ts'))).toBe(false)
    expect(existsSync(projectPath('src/cli/specs/emulator.ts'))).toBe(false)
  })

  it('removes the renderer and preload product-control entry points', () => {
    expect(existsSync(projectPath('src/renderer/src/components/emulator-pane'))).toBe(false)
    expect(existsSync(projectPath('src/renderer/src/lib/open-mobile-emulator-tab.ts'))).toBe(false)
    expect(existsSync(projectPath('src/preload/api-browser-emulator.ts'))).toBe(false)
    expect(readProjectFile('src/shared/types-tabs.ts')).not.toMatch(/simulator/)
  })
})