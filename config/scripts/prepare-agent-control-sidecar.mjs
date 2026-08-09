import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createAgentControlSidecarPlan,
  parseAgentControlSidecarArgs,
  resolveAgentControlTarget
} from './agent-control-sidecar-plan.mjs'
import { resolveTauriRustBuildCommand } from './tauri-rust-build-command.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const options = parseAgentControlSidecarArgs(process.argv.slice(2))
const rustcOutput = options.target ? '' : execFileSync(rustcCommand(), ['-vV'], { encoding: 'utf8' })
const targetTriple = resolveAgentControlTarget({
  explicitTarget: options.target,
  env: process.env,
  rustcOutput
})
const plan = createAgentControlSidecarPlan({
  projectDir,
  profile: options.profile,
  targetTriple,
  cargoTargetDir: process.env.CARGO_TARGET_DIR
})

rmSync(plan.destinationPath, { force: true })
if (!options.skipBuild) {
  const result = spawnSync(cargoCommand(), plan.cargoArgs, {
    cwd: projectDir,
    env: { ...process.env, CARGO_TARGET_DIR: plan.targetRoot },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`ade_control_build_failed:${result.status ?? result.signal ?? 'unknown'}`)
  }
}

const source = statSync(plan.sourcePath)
if (!source.isFile()) throw new Error(`ade_control_artifact_missing:${plan.sourcePath}`)
mkdirSync(dirname(plan.destinationPath), { recursive: true })
copyFileSync(plan.sourcePath, plan.destinationPath)
if (!plan.targetTriple.includes('windows')) chmodSync(plan.destinationPath, 0o755)

console.log(
  JSON.stringify({
    service: 'agent-control-sidecar-preparation',
    state: 'ready',
    profile: plan.profile,
    target: plan.targetTriple,
    source: plan.sourcePath,
    destination: plan.destinationPath,
    installedName: plan.installedName,
    bytes: statSync(plan.destinationPath).size
  })
)

function cargoCommand() {
  return resolveTauriRustBuildCommand(process.env, process.platform)
}

function rustcCommand() {
  return process.platform === 'win32' ? 'rustc.exe' : 'rustc'
}
