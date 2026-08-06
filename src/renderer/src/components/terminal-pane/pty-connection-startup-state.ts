import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getProviderSessionClaimKey } from '@/lib/sleeping-agent-pane-ownership'
import {
  agentProviderSessionsEqual,
  type SleepingAgentSessionRecord
} from '../../../../shared/agent-session-resume'
import { recognizeAgentProcessFromCommandLine } from '../../../../shared/agent-process-recognition'
import { parseLegacyNumericPaneKey } from '../../../../shared/stable-pane-id'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal-kitty-keyboard-mode-tracker'
import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/types'
import {
  beginAgentStartupDeliveryAttempt,
  releaseAgentStartupDeliveryAttempt
} from '@/lib/agent-startup-delayed-delivery'
import type { PtyConnectionDeps } from './pty-connection-types'
import type { PtyConnectResult } from './pty-transport'

type StartupStateArgs = {
  pane: ManagedPane
  deps: PtyConnectionDeps
  paneStartup: PtyConnectionDeps['startup'] | null
  cacheKey: string
}

export type PtyConnectionStartupState = ReturnType<typeof createPtyConnectionStartupState>

export function createPtyConnectionStartupState({
  pane,
  deps,
  paneStartup,
  cacheKey
}: StartupStateArgs) {
  const kittyKeyboardModes = (() => {
    const existing = deps.paneKittyKeyboardModesRef.current.get(pane.id)
    if (existing) {
      return existing
    }
    const created = new TerminalKittyKeyboardModeTracker()
    deps.paneKittyKeyboardModesRef.current.set(pane.id, created)
    return created
  })()
  const getSleepingRecordForPane = (
    state: ReturnType<typeof useAppStore.getState>
  ): { paneKey: string; record: SleepingAgentSessionRecord } | null => {
    const stableRecord = state.sleepingAgentSessionsByPaneKey[cacheKey]
    if (stableRecord) {
      return { paneKey: cacheKey, record: stableRecord }
    }
    const legacyMatches = Object.entries(state.sleepingAgentSessionsByPaneKey).filter(
      ([paneKey, record]) => {
        const legacy = parseLegacyNumericPaneKey(paneKey)
        return (
          legacy?.tabId === deps.tabId &&
          record.worktreeId === deps.worktreeId &&
          (!record.tabId || record.tabId === deps.tabId)
        )
      }
    )
    const exactLegacyMatch = legacyMatches.find(([paneKey]) => {
      const legacy = parseLegacyNumericPaneKey(paneKey)
      return legacy?.numericPaneId === String(pane.id)
    })
    const providerSessionKeys = new Set(
      legacyMatches.map(([, record]) => getProviderSessionClaimKey(record))
    )
    const oldestLegacyMatch = legacyMatches
      .slice()
      .sort(([, a], [, b]) => a.capturedAt - b.capturedAt || a.updatedAt - b.updatedAt)[0]
    // Why: duplicate legacy aliases can point at one provider session; consume
    // the oldest capture as canonical and clear its aliases after resume.
    const selectedLegacyMatch =
      exactLegacyMatch ??
      (providerSessionKeys.size === 1
        ? legacyMatches.length === 1
          ? legacyMatches[0]
          : oldestLegacyMatch
        : null)
    if (!selectedLegacyMatch) {
      return null
    }
    const [paneKey, record] = selectedLegacyMatch
    return { paneKey, record }
  }
  const isLegacyWorkerAutomaticResumeBlocked = (): boolean =>
    getSleepingRecordForPane(useAppStore.getState())?.record.automaticResumeBlockedBy ===
    'legacy-orchestration-worker'
  const clearSleepingRecordProviderDuplicates = (
    state: ReturnType<typeof useAppStore.getState>,
    consumed: { paneKey: string; record: SleepingAgentSessionRecord }
  ): void => {
    state.clearSleepingAgentSession(consumed.paneKey)
    for (const [paneKey, record] of Object.entries(state.sleepingAgentSessionsByPaneKey)) {
      if (
        paneKey !== consumed.paneKey &&
        record.worktreeId === consumed.record.worktreeId &&
        record.agent === consumed.record.agent &&
        agentProviderSessionsEqual(
          record.agent,
          record.providerSession,
          consumed.record.providerSession
        )
      ) {
        // Why: legacy pane aliases can leave multiple sleeping rows for one
        // provider session; once this pane resumes it, every alias is stale.
        state.clearSleepingAgentSession(paneKey)
      }
    }
  }
  const launchToken = paneStartup?.launchConfig
    ? (paneStartup.launchToken ?? createBrowserUuid())
    : undefined
  const startupDraftAgent = paneStartup?.launchAgent ?? paneStartup?.initialAgentStatus?.agent
  const startupDraftAgentConfig = startupDraftAgent ? TUI_AGENT_CONFIG[startupDraftAgent] : null
  const startupDraftPrompt =
    typeof paneStartup?.draftPrompt === 'string' && paneStartup.draftPrompt.trim()
      ? paneStartup.draftPrompt
      : null
  const startupDraftPromptNeedsPaste =
    startupDraftPrompt !== null &&
    !startupDraftAgentConfig?.draftPromptFlag &&
    !startupDraftAgentConfig?.draftPromptEnvVar
  const startupDraftDelivery = { claimed: false, pasteAttempted: false }
  const claimStartupDraftPasteDelivery = (): boolean => {
    if (!startupDraftPromptNeedsPaste || launchToken === undefined) {
      return false
    }
    if (startupDraftDelivery.claimed) {
      return true
    }
    startupDraftDelivery.claimed = beginAgentStartupDeliveryAttempt({
      worktreeId: deps.worktreeId,
      tabId: deps.tabId,
      launchToken
    })
    return startupDraftDelivery.claimed
  }
  const releaseUnattemptedStartupDraftPasteDelivery = (): void => {
    if (
      !startupDraftDelivery.claimed ||
      startupDraftDelivery.pasteAttempted ||
      launchToken === undefined
    ) {
      return
    }
    releaseAgentStartupDeliveryAttempt({
      worktreeId: deps.worktreeId,
      tabId: deps.tabId,
      launchToken
    })
    startupDraftDelivery.claimed = false
  }
  if (paneStartup?.launchConfig) {
    useAppStore.getState().registerAgentLaunchConfig(cacheKey, paneStartup.launchConfig, {
      agentType: paneStartup.launchAgent ?? paneStartup.initialAgentStatus?.agent,
      ...(launchToken ? { launchToken } : {}),
      tabId: deps.tabId,
      leafId: pane.leafId
    })
  } else if (paneStartup) {
    useAppStore.getState().clearAgentLaunchConfig(cacheKey)
  }
  const registerEffectiveLaunchConfig = (
    effectiveLaunchConfig: PtyConnectResult['launchConfig'] | undefined,
    metadata?: { launchToken?: string; launchAgent?: TuiAgent }
  ): void => {
    if (!effectiveLaunchConfig) {
      if (metadata?.launchAgent) {
        useAppStore.getState().setPaneForegroundAgent(cacheKey, {
          agent: metadata.launchAgent,
          shellForeground: false
        })
      }
      return
    }
    const persistedLaunchAgent = recognizeAgentProcessFromCommandLine(
      effectiveLaunchConfig.agentCommand
    )?.agent
    useAppStore.getState().registerAgentLaunchConfig(cacheKey, effectiveLaunchConfig, {
      agentType:
        metadata?.launchAgent ??
        paneStartup?.launchAgent ??
        paneStartup?.initialAgentStatus?.agent ??
        persistedLaunchAgent,
      ...((metadata?.launchToken ?? launchToken)
        ? { launchToken: metadata?.launchToken ?? launchToken }
        : {}),
      tabId: deps.tabId,
      leafId: pane.leafId
    })
  }
  const clearRegisteredStartupLaunchConfig = (): void => {
    useAppStore.getState().clearAgentLaunchConfig(cacheKey)
  }
  const neutralTerminalTitle = (): string => {
    const state = useAppStore.getState()
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )
    return tab?.defaultTitle?.trim() || 'Terminal'
  }

  return {
    kittyKeyboardModes,
    getSleepingRecordForPane,
    isLegacyWorkerAutomaticResumeBlocked,
    clearSleepingRecordProviderDuplicates,
    launchToken,
    startupDraftAgentConfig,
    startupDraftPrompt,
    startupDraftDelivery,
    claimStartupDraftPasteDelivery,
    releaseUnattemptedStartupDraftPasteDelivery,
    registerEffectiveLaunchConfig,
    clearRegisteredStartupLaunchConfig,
    neutralTerminalTitle
  }
}
