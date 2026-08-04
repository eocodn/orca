import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function projectPath(relativePath) {
  return resolve(projectRoot, relativePath)
}

function readPackage() {
  return JSON.parse(readFileSync(projectPath('package.json'), 'utf8'))
}

describe('public orca CLI and Skills removal contract', () => {
  it('leaves only the internal ade-control package entry point', () => {
    expect(readPackage().bin).toEqual({
      'ade-control': './out/cli/index.js'
    })
  })

  it('removes public Skills source, CLI handlers, and generated artifacts', () => {
    for (const relativePath of [
      'config/scripts/orca-dev.mjs',
      'config/scripts/orca-dev',
      'config/scripts/install-dev-cli.mjs',
      'config/scripts/serve-headless-fresh-profile-pairing.mjs',
      'src/cli/handlers/skills.ts',
      'src/cli/specs/skills.ts',
      'src/cli/skills.test.ts',
      'src/cli/bundled-skill-guides.ts',
      'skill-guides',
      'skill-stubs',
      'skills',
      'resources/skills',
      '.github/workflows/skill-update-roundtrip.yml'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
  })

  it('removes public skill-bundle generation scripts and package commands', () => {
    for (const relativePath of [
      'config/scripts/generate-bundled-skill-guides.mjs',
      'config/scripts/generate-bundled-skill-guides.test.mjs',
      'config/scripts/generate-skill-bundle-manifest.mjs',
      'config/scripts/generate-skill-bundle-manifest.test.mjs',
      'config/scripts/skill-bundle-manifest-files.mjs'
    ]) {
      expect(existsSync(projectPath(relativePath)), relativePath).toBe(false)
    }
    expect(JSON.stringify(readPackage().scripts)).not.toMatch(/skill/i)
  })
})