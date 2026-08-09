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
  it('pins the official v2 CLI and prepares the worker before the Tauri build', () => {
    expect(packageJson.devDependencies['@tauri-apps/cli']).toMatch(/^\^2\./)
    expect(packageJson.scripts['build:tauri']).toBe(
      'node config/scripts/build-tauri.mjs --no-bundle'
    )
    expect(packageJson.scripts['build:tauri:windows-installer']).toBe(
      'node config/scripts/build-tauri.mjs --runner cargo-xwin --target x86_64-pc-windows-msvc'
    )
    const buildScript = readFileSync(join(projectDir, 'config/scripts/build-tauri.mjs'), 'utf8')
    expect(buildScript.indexOf('prepare-tauri-sidecar.mjs')).toBeLessThan(
      buildScript.indexOf("'tauri', 'build'")
    )
    expect(packageJson.scripts['build:web']).toContain('verify-web-build.mjs')
  })

  it('points Tauri at the web artifact and target-suffixed worker sidecar', () => {
    expect(tauriConfig.build.frontendDist).toBe('../out/web')
    expect(tauriConfig.build.beforeBuildCommand).toContain('pnpm build:web')
    expect(tauriConfig.bundle.externalBin).toEqual([
      'binaries/ade-worker',
      'binaries/ade-control'
    ])
    expect(tauriConfig.bundle.icon).toContain('../resources/build/icon.ico')
    expect(readFileSync(join(projectDir, 'src/renderer/web-index.html'), 'utf8')).toContain(
      'src/web/main.tsx'
    )
    expect(existsSync(join(projectDir, 'resources/build/icon.png'))).toBe(true)
    expect(existsSync(join(projectDir, 'resources/build/icon.ico'))).toBe(true)
  })

  it('keeps Windows NSIS overlay and verifies all Linux release executables', () => {
    expect(windowsConfig.bundle.active).toBe(true)
    expect(windowsConfig.bundle.targets).toEqual(['nsis'])
    const service = compose.services['tauri-contract']
    expect(service.image).toBe('ade-control-tauri-contract:stable')
    expect(service.build.dockerfile).toBe('Dockerfile.tauri-contract')
    expect(service.command.join(' ')).toContain('pnpm run build:tauri')
    expect(service.command.join(' ')).toContain('test -x src-tauri/target/release/ade-worker')
    expect(service.command.join(' ')).toContain('test -x src-tauri/target/release/ade-control')
  })
})
