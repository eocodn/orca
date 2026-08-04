import type { PreloadApi } from '../../../preload/api-preload-surface'

export type ClientRuntimeRuntimeService = Pick<PreloadApi['runtime'], 'call'>
export type ClientRuntimeRemoteHostService = Pick<
  PreloadApi['runtimeEnvironments'],
  'call' | 'subscribe'
>
export type ClientRuntimeFileService = PreloadApi['fs']
export type ClientRuntimeGitService = PreloadApi['git']
export type ClientRuntimeTerminalService = Pick<
  PreloadApi['pty'],
  'inspectProcess' | 'confirmForegroundProcess' | 'write' | 'writeAccepted'
>

export type ClientRuntime = {
  runtime: ClientRuntimeRuntimeService
  remoteHost: ClientRuntimeRemoteHostService
  file: ClientRuntimeFileService
  git: ClientRuntimeGitService
  terminal: ClientRuntimeTerminalService
}

type ClientRuntimeHostAdapter = {
  runtime: ClientRuntimeRuntimeService
  runtimeEnvironments: ClientRuntimeRemoteHostService
  fs: ClientRuntimeFileService
  git: ClientRuntimeGitService
  pty: ClientRuntimeTerminalService
}

// Why: renderer services must not encode whether their host is desktop preload,
// Web transport, or the future Rust/Tauri adapter.
export function createClientRuntime(adapter: ClientRuntimeHostAdapter): ClientRuntime {
  return {
    runtime: adapter.runtime,
    remoteHost: adapter.runtimeEnvironments,
    file: adapter.fs,
    git: adapter.git,
    terminal: adapter.pty
  }
}

export function getClientRuntime(): ClientRuntime {
  return createClientRuntime(window.api)
}
