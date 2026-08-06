import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('Tauri PTY authority boundary', () => {
  it('routes PTY through ade-host rather than a Tauri-local registry', () => {
    const cargo = read('src-tauri/Cargo.toml')
    const lib = read('src-tauri/src/lib.rs')
    const ptyHostState = read('src-tauri/src/pty_host_state.rs')

    expect(cargo).toContain('ade-host = { path = "../rust/ade-host" }')
    expect(cargo).not.toContain('ade-terminal =')
    expect(ptyHostState).toContain('ade_host::pty_service')
    expect(lib).not.toContain('mod pty_contract;')
    expect(lib).not.toContain('PtyExecutionState')
  })

  it('keeps workspace ownership explicit before PTY dispatch', () => {
    const lib = read('src-tauri/src/lib.rs')
    const bridge = read('src/renderer/src/runtime/tauri-host-bridge.ts')

    expect(lib).toContain('claim_pty_workspace')
    expect(lib).toContain('pty_host_status')
    expect(bridge).toContain("claimPtyWorkspace: 'claim_pty_workspace'")
    expect(bridge).toContain("ptyHostStatus: 'pty_host_status'")
    expect(bridge).toContain("ptyRequest: 'pty_request'")
  })
})
