import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const readJson = (relativePath) => JSON.parse(readFileSync(join(projectDir, relativePath), 'utf8'))
const packageJson = readJson('package.json')
const tauriConfig = readJson('src-tauri/tauri.conf.json')
const windowsConfig = readJson('src-tauri/tauri.windows.conf.json')
const compose = parse(readFileSync(join(projectDir, 'compose.control.yml'), 'utf8'))

describe('Tauri build path', () => {
  it('pins the official v2 CLI and builds the generated frontend before compiling', () => {
    expect(packageJson.devDependencies['@tauri-apps/cli']).toMatch(/^\^2\./)
    expect(packageJson.scripts['build:tauri']).toContain('pnpm run build:web')
    expect(packageJson.scripts['build:tauri']).toContain('pnpm exec tauri build --no-bundle')
    expect(packageJson.scripts['build:web']).toContain('verify-web-build.mjs')
  })

  it('points Tauri at the real web artifact and includes its bootstrap entry', () => {
    expect(tauriConfig.build.frontendDist).toBe('../out/web')
    expect(tauriConfig.build.beforeBuildCommand).toContain('pnpm build:web')
    expect(readFileSync(join(projectDir, 'src/renderer/web-index.html'), 'utf8')).toContain(
      'src/web/main.tsx'
    )
    expect(existsSync(join(projectDir, 'resources/build/icon.png'))).toBe(true)
  })

  it('keeps Windows NSIS overlay and runs the Linux compile smoke in Docker', () => {
    expect(windowsConfig.bundle.active).toBe(true)
    expect(windowsConfig.bundle.targets).toEqual(['nsis'])
    const service = compose.services['tauri-contract']
    expect(service.image).toBe('ade-control-tauri-contract:stable')
    expect(service.build.dockerfile).toBe('Dockerfile.tauri-contract')
    expect(service.command.join(' ')).toContain('pnpm run build:tauri')
  })
})
