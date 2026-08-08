import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAgentControlSidecarPlan,
  parseAgentControlSidecarArgs,
  readRustHostTriple,
  resolveAgentControlTarget
} from './agent-control-sidecar-plan.mjs'

const projectDir = resolve(import.meta.dirname, '../..')

describe('Agent Control Tauri sidecar plan', () => {
  it('parses a strict profile, optional target, and skip-build flag', () => {
    expect(
      parseAgentControlSidecarArgs([
        '--profile',
        'release',
        '--target',
        'x86_64-pc-windows-msvc',
        '--skip-build'
      ])
    ).toEqual({
      profile: 'release',
      target: 'x86_64-pc-windows-msvc',
      skipBuild: true
    })
    expect(() => parseAgentControlSidecarArgs([])).toThrow('missing_profile')
    expect(() => parseAgentControlSidecarArgs(['--profile', 'fast'])).toThrow('invalid_profile')
    expect(() =>
      parseAgentControlSidecarArgs(['--profile', 'debug', '--profile', 'release'])
    ).toThrow('duplicate_profile')
    expect(() =>
      parseAgentControlSidecarArgs(['--profile', 'debug', '--target', '../escape'])
    ).toThrow('invalid_target')
    expect(() => parseAgentControlSidecarArgs(['--profile', 'debug', '--wat'])).toThrow(
      'unknown_argument'
    )
  })

  it('resolves the target from explicit input, supported environment variables, then rustc host', () => {
    const rustcOutput = 'rustc 1.88.0\nhost: x86_64-unknown-linux-gnu\nrelease: 1.88.0\n'
    expect(readRustHostTriple(rustcOutput)).toBe('x86_64-unknown-linux-gnu')
    expect(
      resolveAgentControlTarget({
        explicitTarget: 'aarch64-pc-windows-msvc',
        env: { TAURI_TARGET_TRIPLE: 'ignored' },
        rustcOutput
      })
    ).toBe('aarch64-pc-windows-msvc')
    expect(
      resolveAgentControlTarget({
        explicitTarget: null,
        env: {
          TAURI_TARGET_TRIPLE: 'x86_64-pc-windows-msvc',
          TAURI_ENV_TARGET_TRIPLE: 'ignored'
        },
        rustcOutput
      })
    ).toBe('x86_64-pc-windows-msvc')
    expect(
      resolveAgentControlTarget({
        explicitTarget: null,
        env: { ADE_TAURI_TARGET: 'aarch64-apple-darwin' },
        rustcOutput
      })
    ).toBe('aarch64-apple-darwin')
    expect(
      resolveAgentControlTarget({ explicitTarget: null, env: {}, rustcOutput })
    ).toBe('x86_64-unknown-linux-gnu')
  })

  it('builds exact Windows release and Linux debug plans without stale-path guessing', () => {
    const windows = createAgentControlSidecarPlan({
      projectDir,
      profile: 'release',
      targetTriple: 'x86_64-pc-windows-msvc'
    })
    expect(windows.cargoArgs).toEqual([
      'build',
      '--manifest-path',
      'rust/Cargo.toml',
      '--package',
      'ade-control',
      '--target',
      'x86_64-pc-windows-msvc',
      '--locked',
      '--release'
    ])
    expect(windows.sourcePath).toBe(
      resolve(projectDir, 'rust/target/x86_64-pc-windows-msvc/release/ade-control.exe')
    )
    expect(windows.destinationPath).toBe(
      resolve(projectDir, 'src-tauri/binaries/ade-control-x86_64-pc-windows-msvc.exe')
    )

    const linux = createAgentControlSidecarPlan({
      projectDir,
      profile: 'debug',
      targetTriple: 'x86_64-unknown-linux-gnu',
      cargoTargetDir: 'tmp/control-target'
    })
    expect(linux.cargoArgs.at(-1)).toBe('--locked')
    expect(linux.sourcePath).toBe(
      resolve(projectDir, 'tmp/control-target/x86_64-unknown-linux-gnu/debug/ade-control')
    )
    expect(linux.destinationPath).toBe(
      resolve(projectDir, 'src-tauri/binaries/ade-control-x86_64-unknown-linux-gnu')
    )
  })
})
