import type { PreloadApi } from '../../../preload/api-preload-surface'
import { getRegisteredClientRuntime } from './client-runtime-resolver'
import type { ClientRuntimeHostService } from './client-runtime-host-services'
import { createCapabilityUnavailableService } from './client-runtime-adapter'

export type ClientRuntimeRuntimeService = PreloadApi['runtime']
export type ClientRuntimeRemoteHostService = PreloadApi['runtimeEnvironments']
export type ClientRuntimeRemoteWorkspaceService = PreloadApi['remoteWorkspace']
export type ClientRuntimeFileService = PreloadApi['fs']
export type ClientRuntimeGitService = PreloadApi['git']
export type ClientRuntimeSessionService = PreloadApi['session']
export type ClientRuntimeAppService = PreloadApi['app']
export type ClientRuntimeSshService = PreloadApi['ssh']
export type ClientRuntimeBrowserService = PreloadApi['browser']
export type ClientRuntimeWorkspaceService = {
  repos: PreloadApi['repos']
  projects: PreloadApi['projects']
  projectGroups: PreloadApi['projectGroups']
  worktrees: PreloadApi['worktrees']
  ports: PreloadApi['workspacePorts']
}
export type ClientRuntimeTerminalService = PreloadApi['pty']
export type ClientRuntimePreviewService = PreloadApi['terminalPreview']
export type ClientRuntimeDeviceService = PreloadApi['mobile']
export type ClientRuntimeShellService = PreloadApi['shell']
export type ClientRuntimeIntegrationService = {
  github: PreloadApi['gh']
  gitlab: PreloadApi['gl']
  linear: PreloadApi['linear']
  jira: PreloadApi['jira']
  hooks: PreloadApi['hooks']
  hostedReview: PreloadApi['hostedReview']
}

export type ClientRuntime = {
  /** Narrow Rust host command surface; unavailable on Electron/Web adapters. */
  host: ClientRuntimeHostService
  /** Alias retained for callers that need to identify the Tauri bridge explicitly. */
  tauriHost: ClientRuntimeHostService
  runtime: ClientRuntimeRuntimeService
  remoteHost: ClientRuntimeRemoteHostService
  remoteWorkspace: ClientRuntimeRemoteWorkspaceService
  file: ClientRuntimeFileService
  git: ClientRuntimeGitService
  session: ClientRuntimeSessionService
  app: ClientRuntimeAppService
  ssh: ClientRuntimeSshService
  browser: ClientRuntimeBrowserService
  workspace: ClientRuntimeWorkspaceService
  terminal: ClientRuntimeTerminalService
  preview: ClientRuntimePreviewService
  device: ClientRuntimeDeviceService
  shell: ClientRuntimeShellService
  integration: ClientRuntimeIntegrationService
}

export type ClientRuntimeHostAdapter = {
  runtime: ClientRuntimeRuntimeService
  runtimeEnvironments: ClientRuntimeRemoteHostService
  remoteWorkspace: ClientRuntimeRemoteWorkspaceService
  fs: ClientRuntimeFileService
  git: ClientRuntimeGitService
  session: ClientRuntimeSessionService
  app: ClientRuntimeAppService
  ssh: ClientRuntimeSshService
  browser: ClientRuntimeBrowserService
  repos: PreloadApi['repos']
  projects: PreloadApi['projects']
  projectGroups: PreloadApi['projectGroups']
  worktrees: PreloadApi['worktrees']
  workspacePorts: PreloadApi['workspacePorts']
  pty: ClientRuntimeTerminalService
  terminalPreview: ClientRuntimePreviewService
  mobile: ClientRuntimeDeviceService
  shell: ClientRuntimeShellService
  gh: PreloadApi['gh']
  gl: PreloadApi['gl']
  linear: PreloadApi['linear']
  jira: PreloadApi['jira']
  hooks: PreloadApi['hooks']
  hostedReview: PreloadApi['hostedReview']
  /** Optional because Electron/Web adapters do not expose ade-host commands. */
  tauriHost?: ClientRuntimeHostService
}

// Why: renderer services must not encode whether their host is desktop preload,
// Web transport, or the future Rust/Tauri adapter.
export function createClientRuntime(
  adapter: ClientRuntimeHostAdapter,
  unavailableHost: ClientRuntimeHostService = createCapabilityUnavailableService<ClientRuntimeHostService>(
    'host'
  ),
  tauriHost?: ClientRuntimeHostService
): ClientRuntime {
  const host = tauriHost ?? adapter.tauriHost ?? unavailableHost
  return {
    host,
    tauriHost: host,
    runtime: adapter.runtime,
    remoteHost: adapter.runtimeEnvironments,
    remoteWorkspace: adapter.remoteWorkspace,
    file: adapter.fs,
    git: adapter.git,
    session: adapter.session,
    app: adapter.app,
    ssh: adapter.ssh,
    browser: adapter.browser,
    workspace: {
      repos: adapter.repos,
      projects: adapter.projects,
      projectGroups: adapter.projectGroups,
      worktrees: adapter.worktrees,
      ports: adapter.workspacePorts
    },
    terminal: adapter.pty,
    preview: adapter.terminalPreview,
    device: adapter.mobile,
    shell: adapter.shell,
    integration: {
      github: adapter.gh,
      gitlab: adapter.gl,
      linear: adapter.linear,
      jira: adapter.jira,
      hooks: adapter.hooks,
      hostedReview: adapter.hostedReview
    }
  }
}

export function getClientRuntime(): ClientRuntime {
  // Resolver registration is performed by the desktop or web entrypoint.
  return getRegisteredClientRuntime()
}
