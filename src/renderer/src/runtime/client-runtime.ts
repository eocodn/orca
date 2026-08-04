import type { PreloadApi } from '../../../preload/api-preload-surface'

export type ClientRuntimeRuntimeService = PreloadApi['runtime']
export type ClientRuntimeRemoteHostService = PreloadApi['runtimeEnvironments']
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
}
export type ClientRuntimeTerminalService = PreloadApi['pty']
export type ClientRuntimeIntegrationService = {
  github: PreloadApi['gh']
  gitlab: PreloadApi['gl']
  linear: PreloadApi['linear']
  jira: PreloadApi['jira']
  hooks: PreloadApi['hooks']
  hostedReview: PreloadApi['hostedReview']
}

export type ClientRuntime = {
  runtime: ClientRuntimeRuntimeService
  remoteHost: ClientRuntimeRemoteHostService
  file: ClientRuntimeFileService
  git: ClientRuntimeGitService
  session: ClientRuntimeSessionService
  app: ClientRuntimeAppService
  ssh: ClientRuntimeSshService
  browser: ClientRuntimeBrowserService
  workspace: ClientRuntimeWorkspaceService
  terminal: ClientRuntimeTerminalService
  integration: ClientRuntimeIntegrationService
}

type ClientRuntimeHostAdapter = {
  runtime: ClientRuntimeRuntimeService
  runtimeEnvironments: ClientRuntimeRemoteHostService
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
  pty: ClientRuntimeTerminalService
  gh: PreloadApi['gh']
  gl: PreloadApi['gl']
  linear: PreloadApi['linear']
  jira: PreloadApi['jira']
  hooks: PreloadApi['hooks']
  hostedReview: PreloadApi['hostedReview']
}

// Why: renderer services must not encode whether their host is desktop preload,
// Web transport, or the future Rust/Tauri adapter.
export function createClientRuntime(adapter: ClientRuntimeHostAdapter): ClientRuntime {
  return {
    runtime: adapter.runtime,
    remoteHost: adapter.runtimeEnvironments,
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
      worktrees: adapter.worktrees
    },
    terminal: adapter.pty,
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
  return createClientRuntime(window.api)
}
