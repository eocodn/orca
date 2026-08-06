import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import { useAppStore } from '@/store'
import {
  agentProviderSessionsEqual,
  isResumableTuiAgent,
  normalizeAgentProviderSession
} from '../../../../shared/agent-session-resume'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import type { PtyConnectionDeps } from './pty-connection-types'
import type { PtyConnectionStartupState } from './pty-connection-startup-state'
import type {
  ColdRestoreAgentResumeStartup,
  FreshSpawnOptions,
  PendingStartupCommand
} from './pty-connection-e2e-support'
import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'

type ColdRestoreStartupArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  cacheKey: string
  paneIdentityEnv: Record<string, string>
  getColdRestoreAgentResumePlatform: () => NodeJS.Platform
  hasPendingStartupCommand: () => boolean
  getSleepingRecordForPane: PtyConnectionStartupState['getSleepingRecordForPane']
  isLegacyWorkerAutomaticResumeBlocked: () => boolean
  clearSleepingRecordProviderDuplicates: PtyConnectionStartupState['clearSleepingRecordProviderDuplicates']
  startFreshSpawn: (
    startupOverride?: PendingStartupCommand | null,
    options?: FreshSpawnOptions
  ) => Promise<string | null>
}

export function createPtyConnectionColdRestoreStartup({
  pane,
  deps,
  cacheKey,
  paneIdentityEnv,
  getColdRestoreAgentResumePlatform,
  hasPendingStartupCommand,
  getSleepingRecordForPane,
  isLegacyWorkerAutomaticResumeBlocked,
  clearSleepingRecordProviderDuplicates,
  startFreshSpawn
}: ColdRestoreStartupArgs) {
  let sessionRestoredBannerShown: SessionRestoredBannerReason | null = null

  const showSessionRestoredBanner = (reason: SessionRestoredBannerReason = 'restored'): void => {
    if (
      sessionRestoredBannerShown === reason ||
      sessionRestoredBannerShown === 'resume-unavailable'
    ) {
      return
    }
    sessionRestoredBannerShown = reason
    deps.onShowSessionRestoredBanner(pane.id, reason)
  }

  const buildColdRestoreAgentResumeStartup = (): ColdRestoreAgentResumeStartup | null => {
    if (hasPendingStartupCommand()) {
      return null
    }
    const state = useAppStore.getState()
    const entry = state.agentStatusByPaneKey[cacheKey]
    const sleepingRecordEntry = getSleepingRecordForPane(state)
    const sleepingRecord = sleepingRecordEntry?.record
    if (isLegacyWorkerAutomaticResumeBlocked()) {
      return null
    }
    const useLiveEntry = entry && entry.state !== 'done'
    const agent = useLiveEntry ? entry.agentType : sleepingRecord?.agent
    if (!agent || !isResumableTuiAgent(agent)) {
      return null
    }
    const providerSession = normalizeAgentProviderSession(
      useLiveEntry ? entry.providerSession : sleepingRecord?.providerSession
    )
    if (!providerSession) {
      return null
    }
    const matchingSleepingLaunchConfig =
      sleepingRecord?.launchConfig &&
      (!useLiveEntry ||
        (sleepingRecord.agent === agent &&
          agentProviderSessionsEqual(agent, sleepingRecord.providerSession, providerSession)))
        ? sleepingRecord.launchConfig
        : undefined
    const launchConfig =
      (useLiveEntry && entry ? state.getAgentLaunchConfigForStatusEntry(entry) : undefined) ??
      matchingSleepingLaunchConfig
    const startupPlan = buildAgentResumeStartupPlan({
      agent,
      providerSession,
      cmdOverrides: state.settings?.agentCmdOverrides ?? {},
      agentArgs:
        launchConfig !== undefined
          ? launchConfig.agentArgs
          : resolveTuiAgentLaunchArgs(agent, state.settings?.agentDefaultArgs),
      agentEnv:
        launchConfig !== undefined
          ? launchConfig.agentEnv
          : resolveTuiAgentLaunchEnv(agent, state.settings?.agentDefaultEnv),
      ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
      ...(launchConfig?.ompResumeFilePath
        ? { ompResumeFilePath: launchConfig.ompResumeFilePath }
        : {}),
      platform: getColdRestoreAgentResumePlatform()
    })
    if (!startupPlan) {
      return null
    }
    const launchToken = createBrowserUuid()
    return {
      agent,
      command: startupPlan.launchCommand,
      env: { ...startupPlan.env, ORCA_AGENT_LAUNCH_TOKEN: launchToken },
      launchConfig: startupPlan.launchConfig,
      resumeProviderSession: providerSession,
      launchToken,
      useLiveEntry: Boolean(useLiveEntry),
      hasSleepingRecord: Boolean(sleepingRecord),
      sleepingRecordEntry
    }
  }

  const applyColdRestoreAgentResumeStartup = (
    startup: ColdRestoreAgentResumeStartup | null
  ): boolean => {
    if (!startup) {
      return false
    }
    useAppStore.getState().registerAgentLaunchConfig(cacheKey, startup.launchConfig, {
      agentType: startup.agent,
      launchToken: startup.launchToken,
      tabId: deps.tabId,
      leafId: pane.leafId
    })
    return true
  }

  const clearSleepingRecordAfterColdRestoreSpawn = (
    startup: ColdRestoreAgentResumeStartup | null
  ): void => {
    if (startup && !startup.useLiveEntry && startup.sleepingRecordEntry) {
      clearSleepingRecordProviderDuplicates(useAppStore.getState(), startup.sleepingRecordEntry)
    }
  }

  const mergeStartupEnvWithPaneIdentity = (
    env: Record<string, string> | undefined
  ): Record<string, string> | undefined =>
    env
      ? {
          ...env,
          ...paneIdentityEnv,
          ...(env.ORCA_AGENT_LAUNCH_TOKEN
            ? { ORCA_AGENT_LAUNCH_TOKEN: env.ORCA_AGENT_LAUNCH_TOKEN }
            : {})
        }
      : undefined

  const startFreshColdRestoreAgentResume = (
    startup: ColdRestoreAgentResumeStartup | null = buildColdRestoreAgentResumeStartup(),
    options: FreshSpawnOptions = {}
  ): Promise<string | null> => {
    applyColdRestoreAgentResumeStartup(startup)
    return startFreshSpawn(startup, options)
  }

  return {
    showSessionRestoredBanner,
    buildColdRestoreAgentResumeStartup,
    applyColdRestoreAgentResumeStartup,
    clearSleepingRecordAfterColdRestoreSpawn,
    mergeStartupEnvWithPaneIdentity,
    startFreshColdRestoreAgentResume
  }
}
