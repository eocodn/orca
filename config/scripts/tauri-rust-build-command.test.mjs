import { describe, expect, it } from 'vitest'
import { resolveTauriRustBuildCommand } from './tauri-rust-build-command.mjs'

describe('Tauri Rust build command', () => {
  it('uses native Cargo by default and only permits the cross-build runner explicitly', () => {
    expect(resolveTauriRustBuildCommand({}, 'linux')).toBe('cargo')
    expect(resolveTauriRustBuildCommand({}, 'win32')).toBe('cargo.exe')
    expect(
      resolveTauriRustBuildCommand({ ADE_TAURI_CARGO_RUNNER: 'cargo-xwin' }, 'linux')
    ).toBe('cargo-xwin')
    expect(() =>
      resolveTauriRustBuildCommand({ ADE_TAURI_CARGO_RUNNER: 'sh -c cargo' }, 'linux')
    ).toThrow('invalid_tauri_cargo_runner')
  })
})
