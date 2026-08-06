import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createTauriSidecarBuildPlan,
  readExplicitTarget,
  readRustHostTriple
} from './tauri-sidecar-build-plan.mjs'

const projectDir = resolve(import.meta.dirname, '../..')

describe('Tauri sidecar build plan', () => {
  it('prefers one explicit target and rejects ambiguous target arguments', () => {
    expect(readExplicitTarget(['--target', 'x86_64-pc-windows-msvc'])).toBe(
      'x86_64-pc-windows-msvc'
    )
    expect(readExplicitTarget(['--target=aarch64-apple-darwin'])).toBe('aarch64-apple-darwin')
    expect(() =>
      readExplicitTarget(['--target', 'x86_64-pc-windows-msvc', '--target=aarch64-pc-windows-msvc'])
    ).toThrow('duplicate_target')
    expect(() => readExplicitTarget(['--target', '../escape'])).toThrow('invalid_target')
  })

  it('reads the exact rustc host triple without guessing from the OS', () => {
    expect(
      readRustHostTriple(
        'rustc 1.88.0\nbinary: rustc\nhost: x86_64-unknown-linux-gnu\nrelease: 1.88.0'
      )
    ).toBe('x86_64-unknown-linux-gnu')
    expect(() => readRustHostTriple('rustc 1.88.0')).toThrow('missing_rust_host')
  })

  it('builds Windows and Linux paths from the same target triple', () => {
    const windows = createTauriSidecarBuildPlan({
      projectDir,
      targetTriple: 'x86_64-pc-windows-msvc'
    })
    expect(windows.cargoArgs).toEqual([
      'build',
      '--manifest-path',
      'rust/Cargo.toml',
      '--locked',
      '--package',
      'ade-worker',
      '--release',
      '--target',
      'x86_64-pc-windows-msvc'
    ])
    expect(windows.sourcePath).toBe(
      resolve(projectDir, 'rust/target/x86_64-pc-windows-msvc/release/ade-worker.exe')
    )
    expect(windows.destinationPath).toBe(
      resolve(projectDir, 'src-tauri/binaries/ade-worker-x86_64-pc-windows-msvc.exe')
    )

    const linux = createTauriSidecarBuildPlan({
      projectDir,
      targetTriple: 'x86_64-unknown-linux-gnu',
      cargoTargetDir: 'tmp/rust-target'
    })
    expect(linux.sourcePath).toBe(
      resolve(projectDir, 'tmp/rust-target/x86_64-unknown-linux-gnu/release/ade-worker')
    )
    expect(linux.destinationPath).toBe(
      resolve(projectDir, 'src-tauri/binaries/ade-worker-x86_64-unknown-linux-gnu')
    )
  })
})
