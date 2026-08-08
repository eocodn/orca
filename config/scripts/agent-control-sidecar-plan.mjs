import { isAbsolute, resolve } from 'node:path'

const TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/
const PROFILES = new Set(['debug', 'release'])

export function parseAgentControlSidecarArgs(args) {
  let profile = null
  let target = null
  let skipBuild = false

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--profile') {
      if (profile !== null) throw new Error('duplicate_profile')
      const value = args[index + 1]
      if (value === undefined) throw new Error('missing_profile')
      profile = validateProfile(value)
      index += 1
      continue
    }
    if (argument.startsWith('--profile=')) {
      if (profile !== null) throw new Error('duplicate_profile')
      profile = validateProfile(argument.slice('--profile='.length))
      continue
    }
    if (argument === '--target') {
      if (target !== null) throw new Error('duplicate_target')
      const value = args[index + 1]
      if (value === undefined) throw new Error('missing_target')
      target = validateTargetTriple(value)
      index += 1
      continue
    }
    if (argument.startsWith('--target=')) {
      if (target !== null) throw new Error('duplicate_target')
      target = validateTargetTriple(argument.slice('--target='.length))
      continue
    }
    if (argument === '--skip-build') {
      if (skipBuild) throw new Error('duplicate_skip_build')
      skipBuild = true
      continue
    }
    throw new Error(`unknown_argument:${argument}`)
  }

  if (profile === null) throw new Error('missing_profile')
  return { profile, target, skipBuild }
}

export function readRustHostTriple(output) {
  const match = /^host:\s*(\S+)\s*$/m.exec(output)
  if (!match) throw new Error('missing_rust_host')
  return validateTargetTriple(match[1])
}

export function resolveAgentControlTarget({ explicitTarget, env, rustcOutput }) {
  if (explicitTarget) return validateTargetTriple(explicitTarget)
  const environmentTarget =
    env.TAURI_TARGET_TRIPLE ??
    env.TAURI_ENV_TARGET_TRIPLE ??
    env.ADE_TAURI_TARGET ??
    env.CARGO_BUILD_TARGET ??
    env.TAURI_TARGET
  if (environmentTarget) return validateTargetTriple(environmentTarget)
  return readRustHostTriple(rustcOutput)
}

export function createAgentControlSidecarPlan({
  projectDir,
  profile,
  targetTriple,
  cargoTargetDir
}) {
  const checkedProfile = validateProfile(profile)
  const target = validateTargetTriple(targetTriple)
  const targetRoot = cargoTargetDir
    ? isAbsolute(cargoTargetDir)
      ? cargoTargetDir
      : resolve(projectDir, cargoTargetDir)
    : resolve(projectDir, 'rust/target')
  const extension = target.includes('windows') ? '.exe' : ''
  const cargoArgs = [
    'build',
    '--manifest-path',
    'rust/Cargo.toml',
    '--package',
    'ade-control',
    '--target',
    target,
    '--locked'
  ]
  if (checkedProfile === 'release') cargoArgs.push('--release')
  return {
    profile: checkedProfile,
    targetTriple: target,
    targetRoot,
    cargoArgs,
    sourcePath: resolve(targetRoot, target, checkedProfile, `ade-control${extension}`),
    destinationPath: resolve(
      projectDir,
      'src-tauri/binaries',
      `ade-control-${target}${extension}`
    ),
    installedName: `ade-control${extension}`
  }
}

function validateProfile(value) {
  if (!PROFILES.has(value)) throw new Error('invalid_profile')
  return value
}

function validateTargetTriple(value) {
  if (!TARGET_PATTERN.test(value)) throw new Error('invalid_target')
  return value
}
