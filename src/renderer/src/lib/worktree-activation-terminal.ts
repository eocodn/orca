import type {
  GlobalSettings,
  SetupSplitDirection,
  Tab,
  TuiAgent,
  WorktreeDefaultTabsLaunch,
  WorktreeSetupLaunch
} from '../../../shared/types'
import type { AgentProviderSessionMetadata, SleepingAgentLaunchConfig } from '../../../shared/agent-session-resume'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import { shouldAutoCreateInitialTerminal } from '@/components/terminal/initial-terminal'
import { buildSetupRunnerCommand } from './setup-runner'
import { createSequencedSetupAgentCommands } from '../../../shared/setup-agent-sequencing'
import { getSetupRunnerCommandPlatformForPath } from '../../../shared/setup-runner-command'
import { agentKindToTuiAgent } from '../../../shared/agent-kind'
import { useAppStore } from '@/store'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import {
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive,
  isWebTerminalSurfaceTabId
} from '@/runtime/web-runtime-session'
import { queueHookCommandsForFirstWorktreeTab } from '@/lib/hook-command-delayed-delivery'
import { getRuntimeEnvironmentIdForWorktree, type WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner'
import { type WorktreeStartupPayload, type WorktreeActivationStore, type IssueCommandLaunch } from './worktree-activation-types'

export function ensureWorktreeHasInitialTerminal(
  store: WorktreeActivationStore,
  worktreeId: string,
  startup?: WorktreeStartupPayload,
  setup?: WorktreeSetupLaunch,
  issueCommand?: IssueCommandLaunch,
  defaultTabs?: WorktreeDefaultTabsLaunch,
  opts?: { activateCreatedTabs?: boolean }
): string | null {
  const { renderableTabCount } = store.reconcileWorktreeTabModel(worktreeId)
  // Why: creating a terminal just because the legacy terminal slice is empty gives editor/browser-only worktrees an unexpected extra tab.
  const ownerState =
    store.settings !== undefined || store.repos !== undefined || store.worktreesByRepo !== undefined
      ? store
      : useAppStore.getState()
  let sequencedStartup = startup
  let wrappedSetupCommandStr: string | undefined

  if (startup && setup?.waitForAgentStartup === true) {
    const platform = getSetupRunnerCommandPlatformForPath(
      setup.runnerScriptPath,
      navigator.userAgent.includes('Windows') ? 'windows' : 'posix'
    )
    const sequenced = createSequencedSetupAgentCommands({
      runnerScriptPath: setup.runnerScriptPath,
      startupCommand: startup.command,
      platform
    })
    sequencedStartup = {
      ...startup,
      command: sequenced.startupCommand,
      ...(sequenced.startupEnv ? { env: { ...startup.env, ...sequenced.startupEnv } } : {})
    }
    wrappedSetupCommandStr = sequenced.setupCommand
  }

  // Why: web clients mirror the server's session tabs, so avoid spawning a duplicate host terminal before the mirror lands.
  if (isWebRuntimeSessionActive(getRuntimeEnvironmentIdForWorktree(ownerState, worktreeId))) {
    const existingTerminalTabId = store.tabsByWorktree[worktreeId]?.[0]?.id
    if (existingTerminalTabId && (setup || issueCommand)) {
      queueSetupAndIssueCommands(
        store,
        worktreeId,
        existingTerminalTabId,
        setup,
        issueCommand,
        wrappedSetupCommandStr,
        opts
      )
      return existingTerminalTabId
    }
    if (setup || issueCommand) {
      // Why: runtime-owned worktrees mirror session tabs async, so hold commands for the first mirrored tab instead of dropping them.
      queueHookCommandsForFirstWorktreeTab({
        worktreeId,
        deliver: (state, firstTerminalTabId) =>
          queueSetupAndIssueCommands(
            state,
            worktreeId,
            firstTerminalTabId,
            setup,
            issueCommand,
            wrappedSetupCommandStr,
            opts
          )
      })
    }
    return null
  }

  if (!shouldAutoCreateInitialTerminal(renderableTabCount)) {
    const existingTerminalTabId = store.tabsByWorktree[worktreeId]?.[0]?.id
    if (existingTerminalTabId && (setup || issueCommand)) {
      // Why: main may have adopted the startup tab but failed to spawn setup; renderer must still launch the returned fallback setup.
      queueSetupAndIssueCommands(
        store,
        worktreeId,
        existingTerminalTabId,
        setup,
        issueCommand,
        wrappedSetupCommandStr,
        opts
      )
      return existingTerminalTabId
    }
    return null
  }

  const templatedTabId = applyDefaultTerminalTabs(
    store,
    worktreeId,
    sequencedStartup,
    setup,
    issueCommand,
    defaultTabs,
    wrappedSetupCommandStr,
    opts
  )
  if (templatedTabId) {
    return templatedTabId
  }

  // Why: tag this activation-created tab so its PTY spawn doesn't count as activity and reshuffle the Recent sort.
  // Why: stamp the seeded agent before hooks arrive so provider chrome can resolve it immediately.
  const launchAgent =
    sequencedStartup?.launchAgent ??
    (sequencedStartup?.telemetry
      ? (agentKindToTuiAgent(sequencedStartup.telemetry.agent_kind) ?? undefined)
      : undefined)
  const terminalTab = store.createTab(worktreeId, undefined, undefined, {
    pendingActivationSpawn: true,
    ...(launchAgent
      ? {
          launchAgent,
        }
      : {}),
    ...(opts?.activateCreatedTabs === false ? { activate: false } : {})
  })
  if (opts?.activateCreatedTabs !== false) {
    store.setActiveTab(terminalTab.id)
  }

  // Why: queue the seeded startup on the initial pane so the terminal begins in the requested agent session instead of an idle shell.
  if (sequencedStartup) {
    store.queueTabStartupCommand(terminalTab.id, sequencedStartup)
  }
  queueSetupAndIssueCommands(
    store,
    worktreeId,
    terminalTab.id,
    setup,
    issueCommand,
    wrappedSetupCommandStr,
    opts
  )

  return terminalTab.id
}

function applyDefaultTerminalTabs(
  store: WorktreeActivationStore,
  worktreeId: string,
  startup: WorktreeStartupPayload | undefined,
  setup: WorktreeSetupLaunch | undefined,
  issueCommand: IssueCommandLaunch | undefined,
  defaultTabs: WorktreeDefaultTabsLaunch | undefined,
  wrappedSetupCommandStr: string | undefined,
  opts: { activateCreatedTabs?: boolean } | undefined
): string | null {
  if (!defaultTabs || store.defaultTerminalTabsAppliedByWorktreeId[worktreeId]) {
    return null
  }
  store.markDefaultTerminalTabsApplied(worktreeId)
  if (defaultTabs.tabs.length === 0) {
    return null
  }

  let firstTabId: string | null = null
  for (const [index, template] of defaultTabs.tabs.entries()) {
    const isStartupTab = index === 0 && startup !== undefined
    const launchAgent =
      isStartupTab && startup?.launchAgent
        ? startup.launchAgent
        : isStartupTab && startup?.telemetry
          ? (agentKindToTuiAgent(startup.telemetry.agent_kind) ?? undefined)
          : undefined
    const tab = store.createTab(worktreeId, undefined, undefined, {
      pendingActivationSpawn: true,
      recordInteraction: false,
      ...(launchAgent
        ? {
            launchAgent,
          }
        : {}),
      ...(opts?.activateCreatedTabs === false ? { activate: false } : {})
    })
    if (index === 0) {
      firstTabId = tab.id
    }
    if (template.title) {
      store.setTabCustomTitle(tab.id, template.title, { recordInteraction: false })
    }
    if (template.color) {
      store.setTabColor(tab.id, template.color)
    }
    const templateCommand = template.command?.trim()
    if (templateCommand && defaultTabs.runCommands && !(index === 0 && startup)) {
      store.queueTabStartupCommand(tab.id, { command: templateCommand })
    }
  }

  if (!firstTabId) {
    return null
  }
  if (opts?.activateCreatedTabs !== false) {
    store.setActiveTab(firstTabId)
  }
  if (startup) {
    store.queueTabStartupCommand(firstTabId, startup)
  }
  queueSetupAndIssueCommands(
    store,
    worktreeId,
    firstTabId,
    setup,
    issueCommand,
    wrappedSetupCommandStr,
    opts
  )
  return firstTabId
}

function queueSetupAndIssueCommands(
  store: WorktreeActivationStore,
  worktreeId: string,
  terminalTabId: string,
  setup: WorktreeSetupLaunch | undefined,
  issueCommand: IssueCommandLaunch | undefined,
  wrappedSetupCommandStr: string | undefined,
  opts: { activateCreatedTabs?: boolean } | undefined
): void {
  // Why: setup launch location is user-configurable — 'new-tab' keeps setup output off the primary pane; splits keep it adjacent.
  if (setup) {
    const mode = useAppStore.getState().settings?.setupScriptLaunchMode ?? 'new-tab'
    const setupCommand = {
      command:
        wrappedSetupCommandStr ?? setup.command ?? buildSetupRunnerCommand(setup.runnerScriptPath),
      env: setup.envVars
    }
    if (mode === 'new-tab') {
      const setupTab = store.createTab(worktreeId, undefined, undefined, {
        recordInteraction: false,
        ...(opts?.activateCreatedTabs === false ? { activate: false } : {})
      })
      // Why: createTab auto-activates the new tab; revert so focus stays on the primary terminal while Setup runs in the background.
      if (opts?.activateCreatedTabs !== false) {
        store.setActiveTab(terminalTabId)
      }
      // Why: customTitle overrides the auto "Terminal N" label everywhere the tab renders, so it's the authoritative label source.
      store.setTabCustomTitle(setupTab.id, 'Setup', { recordInteraction: false })
      store.queueTabStartupCommand(setupTab.id, setupCommand)
    } else {
      store.queueTabSetupSplit(terminalTabId, {
        ...setupCommand,
        direction: mode === 'split-horizontal' ? 'horizontal' : 'vertical'
      })
    }
  }

  // Why: issue automation runs in its own split, queued independently from setup so both can start in parallel (separate concerns).
  if (issueCommand) {
    // Why: WorktreeSetupLaunch carries a runner-script file to shell out to; the TaskPage variant is already an expanded command string.
    const queuedIssueCommand =
      'runnerScriptPath' in issueCommand
        ? {
            command: buildSetupRunnerCommand(issueCommand.runnerScriptPath),
            env: issueCommand.envVars
          }
        : { command: issueCommand.command, env: issueCommand.env }
    store.queueTabIssueCommandSplit(terminalTabId, queuedIssueCommand)
  }
}
