import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('iOS runtime removal contract', () => {
  it('does not publish serve-sim or iOS emulator runtime inputs', () => {
    const packageJson = JSON.parse(readProjectFile('package.json'))
    const lockfile = readProjectFile('pnpm-lock.yaml')

    expect(packageJson.dependencies?.['serve-sim']).toBeUndefined()
    expect(lockfile).not.toContain('serve-sim')

    for (const relativePath of [
      'src/main/emulator/backends/ios-emulator-backend.ts',
      'src/main/emulator/simctl-simulator-devices.ts',
      'src/main/emulator/serve-sim-detached-session.ts',
      'src/main/emulator/serve-sim-execution.ts',
      'src/main/emulator/serve-sim-runtime-materializer.ts'
    ]) {
      expect(existsSync(resolve(projectRoot, relativePath))).toBe(false)
    }
  })

  it('does not retain iOS or serve-sim packaging hooks', () => {
    for (const relativePath of [
      'config/electron-builder-platform-hooks.cjs',
      'config/electron-builder.config.cjs',
      'config/packaged-runtime-node-modules.cjs',
      'src/main/main-process-ready-plugin-lifecycle.ts'
    ]) {
      expect(readProjectFile(relativePath)).not.toMatch(/serve-sim|ServeSim|simctl/i)
    }
  })
})