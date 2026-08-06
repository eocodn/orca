import type { TauriHostBridge } from './tauri-host-bridge'

/**
 * The Rust host command surface is intentionally narrower than PreloadApi.
 * These services are the only host operations available to a Tauri renderer.
 */
export type ClientRuntimeHostService = TauriHostBridge & {
  workspace: Pick<TauriHostBridge, 'registerWorkspace'>
  git: Pick<TauriHostBridge, 'gitWorktreeList'>
  file: Pick<TauriHostBridge, 'fileRequest'>
  terminal: Pick<TauriHostBridge, 'terminalRequest'>
  pty: Pick<TauriHostBridge, 'ptyHostStatus' | 'claimPtyWorkspace' | 'ptyRequest'>
}

export function createClientRuntimeHostService(bridge: TauriHostBridge): ClientRuntimeHostService {
  return {
    ...bridge,
    workspace: { registerWorkspace: bridge.registerWorkspace },
    git: { gitWorktreeList: bridge.gitWorktreeList },
    file: { fileRequest: bridge.fileRequest },
    terminal: { terminalRequest: bridge.terminalRequest },
    pty: {
      ptyHostStatus: bridge.ptyHostStatus,
      claimPtyWorkspace: bridge.claimPtyWorkspace,
      ptyRequest: bridge.ptyRequest
    }
  }
}
