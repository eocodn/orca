import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(join(projectDir, path), 'utf8')

describe('Windows Tauri package delivery', () => {
  it('builds an unsigned NSIS installer in Docker and uploads exact evidence', () => {
    const workflow = parse(read('.github/workflows/windows-tauri-package.yml'))
    const job = workflow.jobs['windows-tauri-package']
    const source = read('.github/workflows/windows-tauri-package.yml')

    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(job['runs-on']).toBe('ubuntu-24.04')
    expect(source).toContain('Dockerfile.windows-tauri-package')
    expect(source).toContain('orca-ade-windows-unsigned-${{ github.run_id }}')
    expect(source).toContain('windows-tauri-package.json')
    expect(source).toContain('SHA256SUMS')
    expect(source).not.toContain('continue-on-error')
  })

  it('requires the installer, app, both sidecars, and checksums from one build', () => {
    const dockerfile = read('Dockerfile.windows-tauri-package')

    expect(dockerfile).toContain('cargo install --locked cargo-xwin')
    expect(dockerfile).toContain('pnpm run build:tauri:windows-installer')
    expect(dockerfile).toContain('ade-worker.exe')
    expect(dockerfile).toContain('ade-control.exe')
    expect(dockerfile).toContain('-setup.exe')
    expect(dockerfile).toContain('windows-tauri-package.json')
    expect(dockerfile).toContain('SHA256SUMS')
  })
})
