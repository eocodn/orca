import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const runtimeFiles = [
  'src/renderer/src/runtime/abortable-runtime-environment-call.ts',
  'src/renderer/src/runtime/runtime-file-mutation-client.ts',
  'src/renderer/src/runtime/runtime-file-read-client.ts',
  'src/renderer/src/runtime/runtime-file-search-client.ts',
  'src/renderer/src/runtime/runtime-file-watch-client.ts',
  'src/renderer/src/runtime/runtime-client-events.ts',
  'src/renderer/src/runtime/runtime-rpc-client.ts',
  'src/renderer/src/runtime/runtime-rpc-environment-call.ts',
  'src/renderer/src/runtime/runtime-terminal-inspection.ts',
  'src/renderer/src/runtime/runtime-repo-client.ts',
  'src/renderer/src/runtime/runtime-git-ai-client.ts',
  'src/renderer/src/runtime/runtime-git-read-client.ts',
  'src/renderer/src/runtime/runtime-git-remote-links.ts',
  'src/renderer/src/runtime/runtime-git-staging-client.ts',
  'src/renderer/src/runtime/runtime-git-sync-client.ts',
  'src/renderer/src/runtime/runtime-graph-window-publisher.ts',
  'src/renderer/src/runtime/web-runtime-session-terminal-creation.ts',
  'src/renderer/src/runtime/web-runtime-session-terminal-operations.ts',
  'src/renderer/src/runtime/web-session-tabs-sync-hook.ts',
  'src/renderer/src/runtime/remote-runtime-terminal-stream.ts',
  'src/renderer/src/runtime/web-session-terminal-orphan-recovery.ts',
  'src/renderer/src/runtime/runtime-jira-payload-stream.ts',
  'src/renderer/src/runtime/runtime-provider-accounts-client.ts',
  'src/renderer/src/components/terminal-pane/remote-runtime-pty-transport-creation-recovery.ts',
  'src/renderer/src/components/terminal-pane/terminal-fit-restore.ts',
  'src/renderer/src/components/terminal-pane/terminal-file-open-routing.ts',
  'src/renderer/src/components/terminal-pane/terminal-native-file-drop.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-recovery.ts',
  'src/renderer/src/components/terminal-pane/use-terminal-pane-global-effects.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-context-menu-actions-hook.ts',
  'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-view-surface-layout.ts',
  'src/renderer/src/app-shell-actions.ts',
  'src/renderer/src/components/browser-pane/BrowserPane.tsx',
  'src/renderer/src/components/browser-pane/browser-pane-remote-surface-runtime.ts',
  'src/renderer/src/components/new-workspace-composer-card-core.tsx',
  'src/renderer/src/components/settings/runtime-environments-surface.tsx',
  'src/renderer/src/components/sidebar/AddRemoteHostDialog.tsx',
  'src/renderer/src/components/sidebar/HostSectionHeaderMenu.tsx',
  'src/renderer/src/components/status-bar/SshStatusSegment.tsx',
  'src/renderer/src/components/status-bar/runtime-environment-explicit-connect.ts',
  'src/renderer/src/hooks/ipc-events-mobile-state.ts',
  'src/renderer/src/lib/sidebar-worktree-activation.ts',
  'src/renderer/src/store/slices/remote-server-updates.ts',
  'src/renderer/src/store/slices/repos-state-fetched-project-group-catalog-support.ts',
  'src/renderer/src/store/slices/runtime-status.ts',
  'src/renderer/src/store/slices/settings.ts',
  'src/renderer/src/components/editor/editor-restored-tab-conflict-scan.ts',
  'src/renderer/src/components/editor/useEditorPanelContentState.ts',
  'src/renderer/src/components/editor/useLocalImageSrc.ts',
  'src/renderer/src/components/editor/useLocalLogTail.ts',
  'src/renderer/src/components/right-sidebar/ai-vault-session-log-open.ts',
  'src/renderer/src/components/right-sidebar/file-explorer-row-actions.ts',
  'src/renderer/src/components/right-sidebar/useFileExplorerWatch.ts',
  'src/renderer/src/components/settings/McpConfigSection.tsx',
  'src/renderer/src/components/settings/WorktreeSymlinksSection.tsx',
  'src/renderer/src/components/settings/mcp-config-inspection.ts',
  'src/renderer/src/components/sidebar/useSidebarProjectDrop.ts',
  'src/renderer/src/components/tab-bar/tab-create-entry-action.ts',
  'src/renderer/src/hooks/composer-state-attachment-actions.ts',
  'src/renderer/src/hooks/editor-external-watch-events.ts',
  'src/renderer/src/hooks/useEditorExternalWatch.ts',
  'src/renderer/src/hooks/useGlobalFileDrop.ts',
  'src/renderer/src/store/slices/editor-state-slice-update-file-search-state-actions.ts',
  'src/renderer/src/components/onboarding/onboarding-action-controller.ts',
  'src/renderer/src/components/settings/WorkspaceDirectorySetting.tsx',
  'src/renderer/src/components/sidebar/AddProjectFromFolderDialog.tsx',
  'src/renderer/src/components/sidebar/AddRepoDialog.tsx',
  'src/renderer/src/components/sidebar/AddRepoSteps.tsx',
  'src/renderer/src/components/sidebar/NonGitFolderDialog.tsx',
  'src/renderer/src/components/sidebar/useAddRepoCloneFlow.ts',
  'src/renderer/src/components/sidebar/useAddRepoLocalFolderFlow.ts',
  'src/renderer/src/components/sidebar/useCreateProjectDefaults.ts',
  'src/renderer/src/components/sidebar/useCreateRepo.ts',
  'src/renderer/src/hooks/ipc-events-worktree.ts',
  'src/renderer/src/hooks/use-ipc-events-surface.ts',
  'src/renderer/src/store/slices/github-state-refresh-all-git-hub-actions.ts',
  'src/renderer/src/store/slices/repos-state-delete-project-host-setup-actions.ts',
  'src/renderer/src/store/slices/repos-state-move-project-to-group-actions.ts',
  'src/renderer/src/store/slices/repos-state-remove-project-actions.ts',
  'src/renderer/src/store/slices/repos-state-update-repo-actions.ts',
  'src/renderer/src/store/slices/terminals-state-shutdown-completed-agent-pane-for-hibernation-actions.ts',
  'src/renderer/src/store/slices/terminals-state-close-tab-actions.ts',
  'src/renderer/src/store/slices/terminals-state-shutdown-worktree-terminals-actions.ts',
  'src/renderer/src/store/slices/workspace-cleanup-state.ts',
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/app-shell-page-startup-effects.ts',
  'src/renderer/src/components/feature-wall/feature-wall-assets.ts',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-lifecycle.ts',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-tab-actions.ts',
  'src/renderer/src/components/github-project/GhAuthErrorHelp.tsx',
  'src/renderer/src/components/onboarding/OnboardingInlineCommandTerminal.tsx',
  'src/renderer/src/components/settings/AdvancedPane.tsx',
  'src/renderer/src/components/settings/FloatingWorkspacePane.tsx',
  'src/renderer/src/components/settings/TerminalWindowSection.tsx',
  'src/renderer/src/components/sidebar/SidebarSettingsHelpMenu.tsx',
  'src/renderer/src/components/terminal-pane/terminal-render-desync-sentinel.ts',
  'src/renderer/src/components/update-card-core.tsx',
  'src/renderer/src/hooks/useUnreadDockBadge.ts',
  'src/renderer/src/lib/floating-workspace-tab-creation.ts',
  'src/renderer/src/lib/keyboard-layout/option-as-alt-probe.ts',
  'src/renderer/src/components/new-workspace-composer-card-core.tsx',
  'src/renderer/src/components/right-sidebar/ports-panel-surface.tsx',
  'src/renderer/src/components/settings/SshPane.tsx',
  'src/renderer/src/components/settings/SshPassphraseDialog.tsx',
  'src/renderer/src/components/sidebar/AddRemoteHostDialog.tsx',
  'src/renderer/src/components/sidebar/AddRepoSteps.tsx',
  'src/renderer/src/components/sidebar/ForgetSshWorkspaceDialog.tsx',
  'src/renderer/src/components/sidebar/HostRemoveDialog.tsx',
  'src/renderer/src/components/sidebar/HostSectionHeaderMenu.tsx',
  'src/renderer/src/components/sidebar/SshDisconnectedDialog.tsx',
  'src/renderer/src/components/sidebar/remote-file-browser-surface.tsx',
  'src/renderer/src/components/sidebar/use-add-repo-host-selection.ts',
  'src/renderer/src/components/status-bar/SshTargetStatusRow.tsx',
  'src/renderer/src/components/terminal-pane/TerminalSshReconnectOverlay.tsx',
  'src/renderer/src/components/terminal-pane/pty-connection-session-orchestrator-runtime.ts',
  'src/renderer/src/hooks/composer-state-runtime-effects.ts',
  'src/renderer/src/hooks/ipc-events-ssh.ts',
  'src/renderer/src/components/browser-pane/BrowserPane.tsx',
  'src/renderer/src/components/browser-pane/BrowserToolbarMenu.tsx',
  'src/renderer/src/components/browser-pane/useGrabMode.ts',
  'src/renderer/src/components/browser-pane/webview-registry.ts',
  'src/renderer/src/components/floating-terminal/floating-terminal-panel-tab-actions.ts',
  'src/renderer/src/hooks/ipc-events-browser.ts',
  'src/renderer/src/lib/floating-workspace-terminal-actions.ts',
  'src/renderer/src/store/slices/browser-state-close-browser-tab-actions.ts',
  'src/renderer/src/store/slices/browser-state-create-browser-page-actions.ts',
  'src/renderer/src/store/slices/browser-state-create-browser-session-profile-actions.ts',
  'src/renderer/src/store/slices/browser-state-focus-browser-tab-in-worktree-actions.ts',
  'src/renderer/src/store/slices/browser-state-import-cookies-from-browser-actions.ts',
  'src/renderer/src/store/slices/browser-state-set-browser-page-viewport-preset-actions.ts',
  'src/renderer/src/store/slices/repos-state-get-fresh-folder-workspace-path-status-actions.ts',
  'src/renderer/src/store/slices/repos-state-update-folder-workspace-actions.ts',
  'src/renderer/src/components/sidebar/AutoRenameFailedDialog.tsx',
  'src/renderer/src/hooks/composer-state-smart-source-actions.ts',
  'src/renderer/src/lib/github-pr-start-point.ts',
  'src/renderer/src/lib/worktree-sort-order-persistence.ts',
  'src/renderer/src/store/slices/diff-comments-state.ts',
  'src/renderer/src/store/slices/worktrees-state-apply-worktree-lineage-update-support.ts',
  'src/renderer/src/store/slices/worktrees-state-create-worktree-actions.ts',
  'src/renderer/src/store/slices/worktrees-state-mark-worktrees-deleting-actions.ts',
  'src/renderer/src/store/slices/worktrees-state-normalize-not-admitted-provider-result-support.ts',
  'src/renderer/src/store/slices/worktrees-state-remove-worktree-actions.ts',
  'src/renderer/src/store/slices/worktrees-state-settings-for-repo-owner-support.ts',
  'src/renderer/src/store/slices/worktrees-state-update-worktree-git-identity-actions.ts',
  'src/renderer/src/components/shared/useDaemonActions.tsx',
  'src/renderer/src/components/shared/kill-all-terminal-surfaces.ts',
  'src/renderer/src/components/status-bar/resource-usage-status-surface.tsx',
  'src/renderer/src/components/status-bar/use-resource-session-inventory.ts',
  'src/renderer/src/components/terminal-surface.tsx',
  'src/renderer/src/components/terminal/terminal-provider-snapshot-capability.ts',
  'src/renderer/src/lib/launch-worktree-background-terminals.ts',
  'src/renderer/src/lib/launch-agent-background-session.ts',
  'src/renderer/src/lib/retire-unowned-background-terminal.ts',
  'src/renderer/src/components/settings/ManageSessionsSection.tsx',
  'src/renderer/src/components/right-sidebar/use-checks-panel-terminal-worktree.ts',
  'src/renderer/src/components/right-sidebar/SourceControl.tsx',
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/app-shell-page-startup-effects.ts',
  'src/renderer/src/hooks/ipc-events-session.ts'
]

const sessionFiles = [
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/app-shell-page-startup-effects.ts',
  'src/renderer/src/hooks/ipc-events-session.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-policies.ts'
]

const integrationFiles = [
  'src/renderer/src/runtime/runtime-hooks-client.ts',
  'src/renderer/src/runtime/runtime-linear-issue-client.ts',
  'src/renderer/src/runtime/runtime-linear-project-client.ts',
  'src/renderer/src/runtime/runtime-jira-client.ts',
  'src/renderer/src/runtime/runtime-jira-summary-client.ts',
  'src/renderer/src/runtime/local-jira-search-cancellation.ts'
]
const previewFiles = [
  'src/renderer/src/components/dashboard-popout/AgentTerminalPreview.tsx',
  'src/renderer/src/components/dashboard-popout/preview-grid-claim.ts',
  'src/renderer/src/components/dashboard-popout/preview-terminal-paste.ts'
]
const deviceFiles = [
  'src/renderer/src/components/mobile/MobilePage.tsx',
  'src/renderer/src/components/mobile/paired-mobile-devices.ts',
  'src/renderer/src/components/mobile/use-mobile-page-paired-devices.ts',
  'src/renderer/src/components/mobile/use-mobile-pairing-generation.ts',
  'src/renderer/src/components/mobile/WindowsFirewallNotice.tsx',
  'src/renderer/src/components/settings/MobilePairingConnectionOptions.tsx',
  'src/renderer/src/components/settings/MobilePane.tsx',
  'src/renderer/src/components/settings/RuntimePairingUrlGenerator.tsx',
  'src/renderer/src/hooks/ipc-events-ui.ts'
]
const workspacePortFiles = [
  'src/renderer/src/lib/workspace-port-scan-client.ts',
  'src/renderer/src/lib/workspace-port-actions.ts',
  'src/renderer/src/components/ports/WorkspacePortScanner.tsx'
]
const remoteWorkspaceFiles = [
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/hooks/ipc-events-ssh.ts',
  'src/renderer/src/hooks/use-ipc-events-surface.ts'
]

const terminalFiles = [
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-context.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-connection.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-controls.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-lifecycle.ts',
  'src/renderer/src/components/terminal-pane/pty-buffer-serializer.ts',
  'src/renderer/src/components/terminal-pane/pty-dispatcher.ts',
  'src/renderer/src/components/terminal-pane/resolve-split-cwd.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-effects.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-policies.ts',
  'src/renderer/src/components/terminal-pane/terminal-pty-ack-gate.ts',
  'src/renderer/src/components/terminal-pane/terminal-view-attributes-publisher.ts'
]

async function readRuntimeFile(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

describe('ClientRuntime renderer boundary', () => {
  it('routes runtime RPC entry points through the explicit ClientRuntime adapter', async () => {
    const sources = await Promise.all(runtimeFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(
        /window\.api\.(?:runtime(?:Environments)?|fs|pty|git|session|repos)/
      )
    }
  })

  it('keeps the adapter free of Electron-specific transport calls', async () => {
    const source = await readFile(
      path.join(root, 'src/renderer/src/runtime/client-runtime.ts'),
      'utf8'
    )

    expect(source).not.toMatch(/ipcRenderer|contextBridge|electron/i)
    expect(source).toContain('createClientRuntime')
  })

  it('routes session persistence and scrollback through the session adapter', async () => {
    const sources = await Promise.all(sessionFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.session/)
    }
  })

  it('routes terminal transport and lifecycle calls through the terminal adapter', async () => {
    const sources = await Promise.all(terminalFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.pty/)
    }
  })

  it('routes integration runtime calls through the integration adapter', async () => {
    const sources = await Promise.all(integrationFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.(?:hooks|linear|jira)/)
    }
  })

  it('routes terminal preview calls through the preview adapter', async () => {
    const sources = await Promise.all(previewFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.terminalPreview/)
    }
  })

  it('routes device calls through the device adapter', async () => {
    const sources = await Promise.all(deviceFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.mobile/)
    }
  })

  it('routes workspace port calls through the workspace adapter', async () => {
    const sources = await Promise.all(workspacePortFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.workspacePorts/)
    }
  })

  it('routes remote workspace calls through the remote host adapter', async () => {
    const sources = await Promise.all(remoteWorkspaceFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.remoteWorkspace/)
    }
  })
})
