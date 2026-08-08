import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const workflowPath = resolve(projectDir, '.github/workflows/windows-live-acceptance.yml')
const source = readFileSync(workflowPath, 'utf8')
const workflow = parse(source)
const job = workflow.jobs['windows-live-acceptance']

describe('Windows live acceptance workflow', () => {
  it('is a manual/callable gate on the dedicated self-hosted Windows 10 WSL2 runner', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(workflow.on).toHaveProperty('workflow_call')
    expect(workflow.on).not.toHaveProperty('push')
    expect(workflow.on).not.toHaveProperty('pull_request')
    expect(job['runs-on']).toEqual(['self-hosted', 'ade-windows10-wsl2'])
    expect(job['timeout-minutes']).toBeGreaterThan(0)
    expect(source).toContain("'Windows 10'")
    expect(source).toContain("'git.exe'")
    expect(source).not.toContain("'cargo.exe'")
    expect(source).not.toContain('windows-latest')
    expect(source).not.toContain('continue-on-error')
  })

  it('builds exact native/WSL binaries, uploads the report, then propagates the original result', () => {
    const steps = job.steps
    expect(steps.some((step) => step.run?.includes('build-windows-live-workers.ps1'))).toBe(true)
    expect(steps.some((step) => step.run?.includes('run-windows-live-acceptance.ps1'))).toBe(true)
    expect(source).not.toContain('@arguments')
    expect(source).toContain("-Distro '${{ inputs.distro }}'")
    expect(source).toContain("-WslBuildUser '${{ inputs.wsl_build_user }}'")
    expect(source).not.toContain('Windows live worker build failed with exit $LASTEXITCODE')
    expect(source).toContain('live_matrix=$($result.live_matrix_binary)')
    expect(source).toContain('worker_version=$($result.worker_version)')
    expect(source).toContain("$builtWorkerVersion = '${{ steps.build.outputs.worker_version }}'")
    expect(source).not.toContain("github-${{ github.sha }}")
    expect(source).toContain('-LiveMatrixBinary')
    expect(source).toContain("$reportPath = 'out/windows-live-acceptance.json'")
    const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v7')
    expect(upload.with.path).toBe('out/windows-live-acceptance.json')
    expect(upload.with['if-no-files-found']).toBe('error')
    expect(steps.at(-1).name).toBe('Propagate acceptance result')
    expect(source).toContain('exit_code=$exitCode')
  })

  it('keeps runtime service user separate from the optional WSL toolchain build user', () => {
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('service_user')
    expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('wsl_build_user')
    expect(source).toContain('-WslBuildUser')
    expect(source).toContain('-ServiceUser')
  })
})
