import { isAbsolute, resolve } from 'node:path'

const TARGET_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export function readExplicitTarget(args) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--target') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('missing_target')
      }
      values.push(value)
      index += 1
    } else if (arg.startsWith('--target=')) {
      values.push(arg.slice('--target='.length))
    }
  }
  if (values.length > 1) {
    throw new Error('duplicate_target')
  }
  if (values.length === 0) {
    return null
  }
  return validateTargetTriple(values[0])
}

export function readRustHostTriple(output) {
  const match = /^host:\s*(\S+)\s*$/m.exec(output)
  if (!match) {
    throw new Error('missing_rust_host')
  }
  return validateTargetTriple(match[1])
}

export function validateTargetTriple(value) {
  if (!TARGET_PATTERN.test(value)) {
    throw new Error('invalid_target')
  }
  return value
}

export function createTauriSidecarBuildPlan({ projectDir, targetTriple, cargoTargetDir }) {
  const target = validateTargetTriple(targetTriple)
  const extension = target.includes('windows') ? '.exe' : ''
  const targetRoot = cargoTargetDir
    ? isAbsolute(cargoTargetDir)
      ? cargoTargetDir
      : resolve(projectDir, cargoTargetDir)
    : resolve(projectDir, 'rust/target')
  return {
    targetTriple: target,
    targetRoot,
    cargoArgs: [
      'build',
      '--manifest-path',
      'rust/Cargo.toml',
      '--locked',
      '--package',
      'ade-worker',
      '--release',
      '--target',
      target
    ],
    sourcePath: resolve(targetRoot, target, 'release', `ade-worker${extension}`),
    destinationPath: resolve(projectDir, 'src-tauri/binaries', `ade-worker-${target}${extension}`),
    installedName: `ade-worker${extension}`
  }
}
