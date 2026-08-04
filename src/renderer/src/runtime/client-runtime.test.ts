import { describe, expect, it, vi } from 'vitest'
import {
  createClientRuntime,
  getClientRuntime,
  type ClientRuntimeAppService,
  type ClientRuntimeFileService,
  type ClientRuntimeGitService,
  type ClientRuntimeSessionService,
  type ClientRuntimeSshService,
  type ClientRuntimeBrowserService,
  type ClientRuntimeTerminalService,
  type ClientRuntimeWorkspaceService
} from './client-runtime'

describe('ClientRuntime service boundary', () => {
  it('exposes runtime, git, and remote-host services without changing their contracts', () => {
    const runtime = {
      call: vi.fn(),
      getStatus: vi.fn()
    }
    const git = {} as ClientRuntimeGitService
    const session = {} as ClientRuntimeSessionService
    const app = {} as ClientRuntimeAppService
    const ssh = {} as ClientRuntimeSshService
    const browser = {} as ClientRuntimeBrowserService
    const workspace = {} as ClientRuntimeWorkspaceService
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService

    const clientRuntime = createClientRuntime({
      runtime,
      git,
      session,
      app,
      ssh,
      browser,
      repos: workspace.repos,
      projects: workspace.projects,
      projectGroups: workspace.projectGroups,
      worktrees: workspace.worktrees,
      runtimeEnvironments: remoteHost,
      fs: file,
      pty: terminal
    })

    expect(clientRuntime.runtime).toBe(runtime)
    expect(clientRuntime.git).toBe(git)
    expect(clientRuntime.session).toBe(session)
    expect(clientRuntime.app).toBe(app)
    expect(clientRuntime.ssh).toBe(ssh)
    expect(clientRuntime.browser).toBe(browser)
    expect(clientRuntime.workspace.repos).toBe(workspace.repos)
    expect(clientRuntime.remoteHost).toBe(remoteHost)
    expect(clientRuntime.file).toBe(file)
    expect(clientRuntime.terminal).toBe(terminal)
  })

  it('reads the current host adapter when a renderer entry point asks for it', () => {
    const runtime = { call: vi.fn(), getStatus: vi.fn() }
    const git = {} as ClientRuntimeGitService
    const session = {} as ClientRuntimeSessionService
    const app = {} as ClientRuntimeAppService
    const ssh = {} as ClientRuntimeSshService
    const browser = {} as ClientRuntimeBrowserService
    const workspace = {} as ClientRuntimeWorkspaceService
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService
    vi.stubGlobal('window', {
      api: {
        runtime,
        git,
        session,
        app,
        ssh,
        browser,
        repos: workspace.repos,
        projects: workspace.projects,
        projectGroups: workspace.projectGroups,
        worktrees: workspace.worktrees,
        runtimeEnvironments: remoteHost,
        fs: file,
        pty: terminal
      }
    })

    expect(getClientRuntime().runtime).toBe(runtime)
    expect(getClientRuntime().git).toBe(git)
    expect(getClientRuntime().session).toBe(session)
    expect(getClientRuntime().app).toBe(app)
    expect(getClientRuntime().ssh).toBe(ssh)
    expect(getClientRuntime().browser).toBe(browser)
    expect(getClientRuntime().workspace.repos).toBe(workspace.repos)
    expect(getClientRuntime().remoteHost).toBe(remoteHost)
    expect(getClientRuntime().file).toBe(file)
    expect(getClientRuntime().terminal).toBe(terminal)
  })
})
