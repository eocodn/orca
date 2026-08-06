import { registerAppHandlers } from './app'
import { registerCliHandlers } from './cli'
import { registerPreflightHandlers } from './preflight'
import type { Store } from '../persistence'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { StatsCollector } from '../stats/collector'
import { registerFilesystemHandlers } from './filesystem'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'
import { registerFilesystemWatcherHandlers } from './filesystem-watcher'
import { registerGitHubHandlers } from './github'
import { registerGitLabHandlers } from './gitlab'
import { registerHostedReviewHandlers } from './hosted-review'
import { registerLinearHandlers } from './linear'
import { registerJiraHandlers } from './jira'
import { registerFeedbackHandlers } from './feedback'
import { registerCrashReportingHandlers } from './crash-reporting'
import { registerExportHandlers } from './export'
import { registerStatsHandlers } from './stats'
import { registerMemoryHandlers } from './memory'
import { registerRuntimeHandlers } from './runtime'
import { registerRuntimeEnvironmentHandlers } from './runtime-environments'
import { registerNotificationHandlers } from './notifications'
import { registerNotebookHandlers } from './notebook'
import { registerOnboardingHandlers } from './onboarding'
import { registerDashboardPopoutHandlers } from './dashboard-popout'
import { registerTerminalPreviewHandlers } from './terminal-preview'
import { registerDeveloperPermissionHandlers } from './developer-permissions'
import { setTrustedBrowserRendererWebContentsId, registerBrowserHandlers } from './browser'
import { registerSessionHandlers } from './session'
import { registerSettingsHandlers } from './settings'
import { registerDiagnosticsHandlers } from './diagnostics'
import { registerSkillsHandlers } from './skills'
import { registerWorkspaceSpaceHandlers } from './workspace-space'
import { registerWorkspacePortHandlers } from './workspace-ports'
import { registerLocalhostWorktreeLabelHandlers } from './localhost-worktree-labels'
import { registerKeybindingHandlers } from './keybindings'
import { registerShellHandlers } from './shell'
import { registerPetHandlers } from './pet'
import { registerPluginHandlers } from './plugins'
import { registerUIHandlers, setTrustedUIRendererWebContentsId } from './ui'
import { registerTerminalRenderDesyncEvidenceHandler } from './terminal-render-desync-evidence'
import { registerOrcaProfileHandlers } from './orca-profiles'
import { registerAgentHookHandlers } from './agent-hooks'
import { getPtyIdForPaneKey } from './pty'
import { registerUpdaterHandlers } from '../window/attach-main-window-services'
import {
  registerClipboardHandlers,
  setTrustedClipboardRendererWebContentsId
} from '../window/clipboard-ipc-handlers'
import type { AgentAwakeService } from '../agent-awake-service'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import type { KeybindingService } from '../keybindings/keybinding-service'
import type { PluginService } from '../plugins/plugin-service'

let registered = false

type CoreHandlerLifecycleOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onOrcaProfileAuthMutation?: () => void
  onBeforeOrcaProfileSignOut?: () => void
}

export function registerCoreHandlers(
  store: Store,
  runtime: OrcaRuntimeService,
  stats: StatsCollector,
  mainWindowWebContentsId: number | null = null,
  commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers,
  agentAwakeService?: AgentAwakeService,
  crashReports?: CrashReportStore,
  keybindings?: KeybindingService,
  lifecycleOptions: CoreHandlerLifecycleOptions = {},
  pluginService?: PluginService
): void {
  // Why: on macOS the app can stay alive after all windows close, then
  // openMainWindow() is called again on 'activate'. ipcMain.handle() throws
  // if a channel is registered twice, so we guard to register only once and
  // just update the per-window web-contents ID on subsequent calls.
  setTrustedBrowserRendererWebContentsId(mainWindowWebContentsId)
  setTrustedClipboardRendererWebContentsId(mainWindowWebContentsId)
  setTrustedUIRendererWebContentsId(mainWindowWebContentsId)
  if (registered) {
    return
  }
  registerAppHandlers(store, { onBeforeRelaunch: lifecycleOptions.onBeforeRelaunch })
  registerCliHandlers()
  registerPreflightHandlers()
  registerAgentHookHandlers(runtime, { getPtyIdForPaneKey })
  registerGitHubHandlers(store, stats)
  registerGitLabHandlers(store)
  registerHostedReviewHandlers(store, stats)
  registerLinearHandlers()
  registerJiraHandlers()
  registerFeedbackHandlers()
  if (crashReports) {
    registerCrashReportingHandlers(crashReports)
  }
  registerExportHandlers()
  registerStatsHandlers(stats)
  registerMemoryHandlers(store)
  registerNotificationHandlers(store, runtime)
  registerNotebookHandlers(store)
  registerOnboardingHandlers(store)
  registerDashboardPopoutHandlers(store, keybindings)
  registerTerminalPreviewHandlers(runtime)
  registerDeveloperPermissionHandlers()
  // Why: diagnostics handlers are wired alongside telemetry but the two
  // lanes never share a code path — `ipc/diagnostics.ts` imports only from
  // `src/main/observability/`, never from `src/main/telemetry/`. Order is
  // not load-bearing; both register independent ipcMain channels.
  registerDiagnosticsHandlers()
  registerTerminalRenderDesyncEvidenceHandler()
  registerSettingsHandlers(store, agentAwakeService)
  registerSkillsHandlers(store)
  if (keybindings) {
    registerKeybindingHandlers(keybindings, () => {
      void pluginService?.reconcileActivationState()
    })
  }
  if (pluginService) {
    registerPluginHandlers(store, pluginService, runtime)
  }
  registerOrcaProfileHandlers(store, {
    onBeforeRelaunch: lifecycleOptions.onBeforeRelaunch,
    onAuthMutation: lifecycleOptions.onOrcaProfileAuthMutation,
    onBeforeSignOut: lifecycleOptions.onBeforeOrcaProfileSignOut
  })
  registerBrowserHandlers()
  registerShellHandlers(store)
  registerPetHandlers()
  registerSessionHandlers(store)
  registerUIHandlers(store)
  registerWorkspaceSpaceHandlers(store)
  registerWorkspacePortHandlers(store)
  registerLocalhostWorktreeLabelHandlers(store)
  if (commitMessageAgentEnv) {
    registerFilesystemHandlers(store, commitMessageAgentEnv)
  } else {
    registerFilesystemHandlers(store)
  }
  registerFilesystemWatcherHandlers()
  registerRuntimeHandlers(runtime)
  registerRuntimeEnvironmentHandlers(store)
  registerClipboardHandlers(store)
  registerUpdaterHandlers(store)
  registered = true
}
