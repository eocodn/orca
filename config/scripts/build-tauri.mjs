import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  readExplicitTarget,
  readRustHostTriple,
  validateTargetTriple
} from './tauri-sidecar-build-plan.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const tauriArgs = process.argv.slice(2).filter((arg) => arg !== '--')
const explicitTarget = readExplicitTarget(tauriArgs)
const environmentTarget = process.env.TAURI_TARGET ?? process.env.CARGO_BUILD_TARGET
const targetTriple =
  explicitTarget ??
  (environmentTarget ? validateTargetTriple(environmentTarget) : readRustHostTriple(rustcVersion()))

run(process.execPath, [
  resolve(projectDir, 'config/scripts/prepare-tauri-sidecar.mjs'),
  '--target',
  targetTriple
])
const forwardedArgs =
  explicitTarget || !environmentTarget ? tauriArgs : [...tauriArgs, '--target', targetTriple]
run(pnpmCommand(), ['exec', 'tauri', 'build', ...forwardedArgs])

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `tauri_build_step_failed:${command}:${result.status ?? result.signal ?? 'unknown'}`
    )
  }
}

function rustcVersion() {
  return execFileSync(process.platform === 'win32' ? 'rustc.exe' : 'rustc', ['-vV'], {
    encoding: 'utf8'
  })
}

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}
