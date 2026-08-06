import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createClientRuntime,
  getClientRuntime,
  type ClientRuntimeAppService,
  type ClientRuntimeFileService,
  type ClientRuntimeGitService,
  type ClientRuntimeSessionService,
  type ClientRuntimeSshService,
  type ClientRuntimeBrowserService,
  type ClientRuntimeIntegrationService,
  type ClientRuntimePreviewService,
  type ClientRuntimeDeviceService,
  type ClientRuntimeTerminalService,
  type ClientRuntimeWorkspaceService,
  type ClientRuntimeRemoteWorkspaceService,
  type ClientRuntimeShellService
} from './client-runtime'
import { createElectronClientRuntimeAdapter } from './electron-client-runtime-adapter'
import { createWebClientRuntimeAdapter } from './web-client-runtime-adapter'
import { createTauriClientRuntimeAdapter } from './tauri-client-runtime-adapter'
import {
  getRegisteredClientRuntimeKind,
  registerClientRuntimeAdapter,
  resetClientRuntimeAdapterForTests
} from './client-runtime-resolver'
import { ClientRuntimeCapabilityUnavailableError } from './client-runtime-adapter'

describe('ClientRuntime service boundary', () => {
  it('characterizes Electron and paired web adapters by preserving API identity', () => {
    const api = { runtime: {}, fs: {}, git: {} } as never

    const electron = createElectronClientRuntimeAdapter(api)
    expect(electron.kind).toBe('electron')
    expect(electron.host).toBe(api)

    const web = createWebClientRuntimeAdapter(api)
    expect(web.kind).toBe('web')
    expect(web.host).toBe(api)
  })

  it('resolves only the explicitly registered adapter and supports concurrent reads', async () => {
    const api = { runtime: {} } as never
    registerClientRuntimeAdapter(createWebClientRuntimeAdapter(api))
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        expect(getRegisteredClientRuntimeKind()).toBe('web')
      })
    )
    resetClientRuntimeAdapterForTests()
  })

  it('does not infer an adapter from window.api after registration is cleared', () => {
    vi.stubGlobal('window', { api: { runtime: {} } })
    resetClientRuntimeAdapterForTests()

    expect(() => getClientRuntime()).toThrow('ClientRuntime adapter has not been registered.')
  })

  it('reports Tauri capabilities as typed unavailable errors', () => {
    const tauri = createTauriClientRuntimeAdapter()
    expect(tauri.kind).toBe('tauri')
    expect(() => (tauri.host.pty as never as { start: () => void }).start()).toThrow(
      ClientRuntimeCapabilityUnavailableError
    )
    expect(() => (tauri.host.pty as never as { start: () => void }).start()).toThrow(
      'capability_unavailable'
    )
  })

  afterEach(() => resetClientRuntimeAdapterForTests())

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
    const integration = {
      github: {} as ClientRuntimeIntegrationService['github'],
      gitlab: {} as ClientRuntimeIntegrationService['gitlab'],
      linear: {} as ClientRuntimeIntegrationService['linear'],
      jira: {} as ClientRuntimeIntegrationService['jira'],
      hooks: {} as ClientRuntimeIntegrationService['hooks'],
      hostedReview: {} as ClientRuntimeIntegrationService['hostedReview']
    }
    const workspace = {} as ClientRuntimeWorkspaceService
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const remoteWorkspace = {} as ClientRuntimeRemoteWorkspaceService
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService
    const preview = {} as ClientRuntimePreviewService
    const device = {} as ClientRuntimeDeviceService
    const shell = {} as ClientRuntimeShellService

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
      workspacePorts: workspace.ports,
      runtimeEnvironments: remoteHost,
      remoteWorkspace,
      fs: file,
      pty: terminal,
      terminalPreview: preview,
      mobile: device,
      shell,
      gh: integration.github,
      gl: integration.gitlab,
      linear: integration.linear,
      jira: integration.jira,
      hooks: integration.hooks,
      hostedReview: integration.hostedReview
    })

    expect(clientRuntime.runtime).toBe(runtime)
    expect(clientRuntime.git).toBe(git)
    expect(clientRuntime.session).toBe(session)
    expect(clientRuntime.app).toBe(app)
    expect(clientRuntime.ssh).toBe(ssh)
    expect(clientRuntime.browser).toBe(browser)
    expect(clientRuntime.integration.github).toBe(integration.github)
    expect(clientRuntime.integration.gitlab).toBe(integration.gitlab)
    expect(clientRuntime.integration.linear).toBe(integration.linear)
    expect(clientRuntime.integration.jira).toBe(integration.jira)
    expect(clientRuntime.integration.hooks).toBe(integration.hooks)
    expect(clientRuntime.integration.hostedReview).toBe(integration.hostedReview)
    expect(clientRuntime.workspace.repos).toBe(workspace.repos)
    expect(clientRuntime.workspace.ports).toBe(workspace.ports)
    expect(clientRuntime.remoteHost).toBe(remoteHost)
    expect(clientRuntime.remoteWorkspace).toBe(remoteWorkspace)
    expect(clientRuntime.file).toBe(file)
    expect(clientRuntime.terminal).toBe(terminal)
    expect(clientRuntime.preview).toBe(preview)
    expect(clientRuntime.device).toBe(device)
    expect(clientRuntime.shell).toBe(shell)
  })

  it('reads the current host adapter when a renderer entry point asks for it', () => {
    const runtime = { call: vi.fn(), getStatus: vi.fn() }
    const git = {} as ClientRuntimeGitService
    const session = {} as ClientRuntimeSessionService
    const app = {} as ClientRuntimeAppService
    const ssh = {} as ClientRuntimeSshService
    const browser = {} as ClientRuntimeBrowserService
    const integration = {
      github: {} as ClientRuntimeIntegrationService['github'],
      gitlab: {} as ClientRuntimeIntegrationService['gitlab'],
      linear: {} as ClientRuntimeIntegrationService['linear'],
      jira: {} as ClientRuntimeIntegrationService['jira'],
      hooks: {} as ClientRuntimeIntegrationService['hooks'],
      hostedReview: {} as ClientRuntimeIntegrationService['hostedReview']
    }
    const workspace = {} as ClientRuntimeWorkspaceService
    const remoteHost = { call: vi.fn(), subscribe: vi.fn(), getStatus: vi.fn() }
    const remoteWorkspace = {} as ClientRuntimeRemoteWorkspaceService
    const file = {} as ClientRuntimeFileService
    const terminal = {} as ClientRuntimeTerminalService
    const preview = {} as ClientRuntimePreviewService
    const device = {} as ClientRuntimeDeviceService
    const shell = {} as ClientRuntimeShellService
    vi.stubGlobal('window', {
      api: {
        runtime,
        git,
        session,
        app,
        ssh,
        browser,
        gh: integration.github,
        gl: integration.gitlab,
        linear: integration.linear,
        jira: integration.jira,
        hooks: integration.hooks,
        hostedReview: integration.hostedReview,
        repos: workspace.repos,
        projects: workspace.projects,
        projectGroups: workspace.projectGroups,
        worktrees: workspace.worktrees,
        workspacePorts: workspace.ports,
        runtimeEnvironments: remoteHost,
        remoteWorkspace,
        fs: file,
        pty: terminal,
        terminalPreview: preview,
        mobile: device,
        shell
      }
    })
    registerClientRuntimeAdapter(createElectronClientRuntimeAdapter(window.api))

    expect(getClientRuntime().runtime).toBe(runtime)
    expect(getClientRuntime().git).toBe(git)
    expect(getClientRuntime().session).toBe(session)
    expect(getClientRuntime().app).toBe(app)
    expect(getClientRuntime().ssh).toBe(ssh)
    expect(getClientRuntime().browser).toBe(browser)
    expect(getClientRuntime().integration).toEqual(integration)
    expect(getClientRuntime().workspace.repos).toBe(workspace.repos)
    expect(getClientRuntime().workspace.ports).toBe(workspace.ports)
    expect(getClientRuntime().remoteHost).toBe(remoteHost)
    expect(getClientRuntime().remoteWorkspace).toBe(remoteWorkspace)
    expect(getClientRuntime().file).toBe(file)
    expect(getClientRuntime().terminal).toBe(terminal)
    expect(getClientRuntime().preview).toBe(preview)
    expect(getClientRuntime().device).toBe(device)
    expect(getClientRuntime().shell).toBe(shell)
  })
})
