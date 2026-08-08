import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('Windows 10/WSL2 live acceptance gate', () => {
  it('keeps the live Rust matrix fail-closed and explicitly runner-only', () => {
    const source = read('rust/ade-worker/tests/live_target_matrix.rs')
    const names = [...source.matchAll(/live_test!\(\s*([a-z0-9_]+),/g)].map((match) => match[1])
    expect(names).toHaveLength(12)
    expect(new Set(names).size).toBe(12)
    for (const target of ['windows_native', 'wsl2']) {
      for (const operation of ['file', 'git', 'pty']) {
        for (const context of ['folder', 'worktree']) {
          expect(names).toContain(`${target}_${operation}_${context}`)
        }
      }
    }
    expect(source).toContain('#[ignore = "requires Windows live acceptance runner"]')
    expect(source).toContain('ADE_ACCEPTANCE_CONTROL_ENDPOINT')
    expect(source).toContain('ADE_ACCEPTANCE_WINDOWS_WORKER_BIN')
    expect(source).toContain('ADE_ACCEPTANCE_WSL_WORKER_BIN')
    expect(source).not.toContain('acceptance environment not configured')
  })

  it('builds native control/worker plus an architecture-matched Linux WSL worker', () => {
    const source = read('scripts/build-windows-live-workers.ps1')
    const dockerfile = read('Dockerfile.windows-live-workers')
    expect(source).not.toContain('cargo.exe')
    expect(source).toContain('wsl.exe')
    expect(source).toContain('wslpath')
    expect(source).toContain("'docker'")
    expect(source).toContain("'buildx'")
    expect(source).toContain('Dockerfile.windows-live-workers')
    expect(source).toContain('x86_64-unknown-linux-gnu')
    expect(source).toContain('aarch64-unknown-linux-gnu')
    expect(source).toContain('WslBuildUser')
    expect(source).toContain('control_binary')
    expect(source).toContain('windows_worker_binary')
    expect(source).toContain('wsl_worker_binary')
    expect(source).toContain('live_matrix_binary')
    expect(source).toContain('worker_version')
    expect(source).toContain('worker-version.txt')
    expect(source).toContain('SelfTest')
    expect(source).toContain('Write-Output $json')
    expect(source).not.toContain('[Console]::Out.WriteLine(($Value | ConvertTo-Json')
    expect(dockerfile).toContain('mingw-w64')
    expect(dockerfile).toContain('x86_64-pc-windows-gnu')
    expect(dockerfile).toContain('--test live_target_matrix')
    expect(dockerfile).toContain('--no-run')
    expect(dockerfile).toContain('ade-control.exe')
    expect(dockerfile).toContain('ade-worker.exe')
    expect(dockerfile).toContain('live-target-matrix.exe')
    expect(dockerfile).toContain('worker-version.txt')
    expect(dockerfile).toContain("tr -d '\\r'")
  })

  it('runs every exact ignored cell through persistent Agent Control and emits JSON', () => {
    const source = read('scripts/run-windows-live-acceptance.ps1')
    expect(source).toContain('LiveMatrixBinary')
    expect(source).not.toContain('cargo.exe')
    expect(source).not.toContain('process_argument_contains_quote')
    expect(source).toContain('[object]$CommandArgs = $null')
    expect(source).not.toContain('[object]$Args = $null')
    expect(source).toContain("'control_status'")
    expect(source).toContain("'worker_update'")
    expect(source).toContain("'worker_status'")
    expect(source).toContain("'--ignored','--exact','--nocapture'")
    expect(source).toContain('windows_required')
    expect(source).toContain('matrix_contract_unmapped')
    expect(source).toContain('matrix_contract_ambiguous')
    expect(source).toContain('ADE_ACCEPTANCE_CONTROL_ENDPOINT')
    expect(source).toContain('ADE_ACCEPTANCE_WINDOWS_WORKER_BIN')
    expect(source).toContain('ADE_ACCEPTANCE_WSL_WORKER_BIN')
    expect(source).toContain('Move-Item -LiteralPath $temp -Destination $full -Force')
    expect(source).toContain('SelfTest')
  })

  it('uses only a dedicated Windows 10/WSL2 self-hosted GitHub Actions gate', () => {
    const source = read('.github/workflows/windows-live-acceptance.yml')
    const workflow = parseYaml(source)
    expect(workflow.on.workflow_dispatch).toBeTruthy()
    expect(workflow.on.workflow_call).toBeTruthy()
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.on.push).toBeUndefined()
    const job = workflow.jobs['windows-live-acceptance']
    expect(job['runs-on']).toEqual(['self-hosted', 'ade-windows10-wsl2'])
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(30)
    expect(workflow.concurrency).toBeTruthy()
    expect(source).not.toContain('windows-latest')
    expect(source).not.toContain('continue-on-error')
    expect(source).toContain('actions/checkout@v6')
    expect(source).toContain('actions/upload-artifact@v7')
    expect(source).toContain('build-windows-live-workers.ps1')
    expect(source).toContain('run-windows-live-acceptance.ps1')
    expect(source).toContain('out/windows-live-acceptance.json')
    expect(source).toContain('Propagate acceptance result')
  })
})
