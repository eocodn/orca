import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createTauriSidecarBuildPlan,
  readExplicitTarget,
  readRustHostTriple,
  validateTargetTriple
} from './tauri-sidecar-build-plan.mjs'
import { resolveTauriRustBuildCommand } from './tauri-rust-build-command.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const targetTriple = resolveTargetTriple(process.argv.slice(2), process.env)
const plan = createTauriSidecarBuildPlan({
  projectDir,
  targetTriple,
  cargoTargetDir: process.env.ADE_WORKER_TARGET_DIR ?? process.env.CARGO_TARGET_DIR
})

const result = spawnSync(cargoCommand(), plan.cargoArgs, {
  cwd: projectDir,
  env: { ...process.env, CARGO_TARGET_DIR: plan.targetRoot },
  stdio: 'inherit'
})
if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  throw new Error(`ade_worker_build_failed:${result.status ?? result.signal ?? 'unknown'}`)
}

mkdirSync(dirname(plan.destinationPath), { recursive: true })
copyFileSync(plan.sourcePath, plan.destinationPath)
if (!plan.targetTriple.includes('windows')) {
  chmodSync(plan.destinationPath, 0o755)
}
const bytes = statSync(plan.destinationPath).size
const sha256 = createHash('sha256').update(readFileSync(plan.destinationPath)).digest('hex')
console.log(
  JSON.stringify({
    service: 'tauri-sidecar-preparation',
    state: 'ready',
    target: plan.targetTriple,
    source: plan.sourcePath,
    destination: plan.destinationPath,
    installedName: plan.installedName,
    bytes,
    sha256
  })
)

function resolveTargetTriple(args, env) {
  const explicit = readExplicitTarget(args)
  if (explicit) {
    return explicit
  }
  const environmentTarget = env.TAURI_TARGET ?? env.CARGO_BUILD_TARGET
  if (environmentTarget) {
    return validateTargetTriple(environmentTarget)
  }
  const rustcOutput = execFileSync(rustcCommand(), ['-vV'], { encoding: 'utf8' })
  return readRustHostTriple(rustcOutput)
}

function cargoCommand() {
  return resolveTauriRustBuildCommand(process.env, process.platform)
}

function rustcCommand() {
  return process.platform === 'win32' ? 'rustc.exe' : 'rustc'
}
