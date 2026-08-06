import { useAppStore } from '@/store'
import { isFreshNonDoneAgentStatus } from '../../../../shared/agent-status-types'
import { resolveCompatibleAgentTypeForOwner } from '../../../../shared/agent-title-owner'
import {
  AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS,
  AGENT_TASK_COMPLETE_NOTIFICATION_MAX_WAIT_MS,
  canDispatchAgentNotificationAfterGrace
} from './agent-task-complete-policy'
import type {
  AgentCompletionCoordinator,
  AgentCompletionDispatchMeta,
  AgentCompletionStatusSnapshot
} from './agent-completion-coordinator-types'
import {
  isAgentTaskCompleteNotificationEnabled,
  isAgentTaskCompleteTrackingEnabled,
  subscribeAgentTaskCompleteTrackingEnabled
} from './pty-connection-agent-tracking'
import type { PtyConnectionDeps } from './pty-connection-types'

type AgentNotificationControllerArgs = {
  deps: PtyConnectionDeps
  paneKey: string
  agentCompletionCoordinator: AgentCompletionCoordinator
  isDisposed: () => boolean
}

type ScheduleAgentTaskCompleteOptions = {
  allowDoneDetailAfterGrace?: boolean
  agentStatusSnapshot?: AgentCompletionStatusSnapshot
  agentCompletionSource?: AgentCompletionDispatchMeta['source']
}

export function createPtyConnectionAgentNotificationController({
  deps,
  paneKey,
  agentCompletionCoordinator,
  isDisposed
}: AgentNotificationControllerArgs) {
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let statusUnsubscribe: (() => void) | null = null
  let generation = 0
  let wasTrackingEnabled = isAgentTaskCompleteTrackingEnabled()
  let requiresFreshWorking = !wasTrackingEnabled
  let wasOsNotificationEnabled = isAgentTaskCompleteNotificationEnabled()
  let terminalBellTimer: ReturnType<typeof setTimeout> | null = null
  let pendingTerminalBell = false

  const clearTerminalBellTimer = (): void => {
    if (terminalBellTimer !== null) {
      clearTimeout(terminalBellTimer)
      terminalBellTimer = null
    }
  }

  const clearPendingAgentTaskCompleteNotification = (): void => {
    if (graceTimer !== null) {
      clearTimeout(graceTimer)
      graceTimer = null
    }
    if (maxTimer !== null) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    if (statusUnsubscribe !== null) {
      statusUnsubscribe()
      statusUnsubscribe = null
    }
  }

  const hasPendingAgentTaskCompleteNotification = (): boolean =>
    isAgentTaskCompleteNotificationEnabled() &&
    (agentCompletionCoordinator.hasPendingHookDoneCompletion() ||
      graceTimer !== null ||
      maxTimer !== null ||
      statusUnsubscribe !== null)

  const scheduleTerminalBellNotification = (): void => {
    if (terminalBellTimer !== null) {
      return
    }
    terminalBellTimer = setTimeout(() => {
      terminalBellTimer = null
      if (isDisposed()) {
        pendingTerminalBell = false
        return
      }
      if (hasPendingAgentTaskCompleteNotification()) {
        return
      }
      pendingTerminalBell = false
      deps.dispatchNotification({ source: 'terminal-bell', paneKey })
    }, AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS)
  }

  const schedulePendingTerminalBellNotification = (): void => {
    if (pendingTerminalBell) {
      scheduleTerminalBellNotification()
    }
  }

  const syncAgentTaskCompleteTrackingEnabled = (): boolean => {
    const enabled = isAgentTaskCompleteTrackingEnabled()
    const osNotificationsEnabled = isAgentTaskCompleteNotificationEnabled()
    if (!osNotificationsEnabled && wasOsNotificationEnabled && pendingTerminalBell) {
      scheduleTerminalBellNotification()
    }
    if (!enabled && wasTrackingEnabled) {
      generation += 1
      requiresFreshWorking = true
      clearPendingAgentTaskCompleteNotification()
      schedulePendingTerminalBellNotification()
    } else if (enabled && !wasTrackingEnabled) {
      requiresFreshWorking = true
    }
    wasTrackingEnabled = enabled
    wasOsNotificationEnabled = osNotificationsEnabled
    return enabled
  }

  const markFreshWorking = (): boolean => {
    if (!syncAgentTaskCompleteTrackingEnabled()) {
      return false
    }
    requiresFreshWorking = false
    return true
  }

  const scheduleAgentTaskCompleteNotification = (
    title: string,
    options: ScheduleAgentTaskCompleteOptions = {}
  ): void => {
    if (!syncAgentTaskCompleteTrackingEnabled() || requiresFreshWorking) {
      return
    }
    clearPendingAgentTaskCompleteNotification()
    let graceElapsed = false
    const generationAtSchedule = generation
    const agentStatusAtSchedule = useAppStore.getState().agentStatusByPaneKey[paneKey]
    const hasNewerActiveHookStatus = (): boolean => {
      const currentStatus = useAppStore.getState().agentStatusByPaneKey[paneKey]
      const scheduledAgentType = agentStatusAtSchedule?.agentType
      const currentAgentForScheduledTurn = resolveCompatibleAgentTypeForOwner(
        currentStatus?.agentType,
        scheduledAgentType
      )
      const hasDifferentKnownAgent = Boolean(
        currentStatus?.agentType &&
        scheduledAgentType &&
        currentStatus.agentType !== 'unknown' &&
        scheduledAgentType !== 'unknown' &&
        currentAgentForScheduledTurn !== scheduledAgentType
      )
      return (
        options.agentCompletionSource === 'process-exit' &&
        isFreshNonDoneAgentStatus(currentStatus) &&
        (!agentStatusAtSchedule ||
          currentStatus.state !== agentStatusAtSchedule.state ||
          currentStatus.stateStartedAt !== agentStatusAtSchedule.stateStartedAt ||
          hasDifferentKnownAgent)
      )
    }

    const dispatch = (): void => {
      clearPendingAgentTaskCompleteNotification()
      if (
        generationAtSchedule !== generation ||
        !syncAgentTaskCompleteTrackingEnabled() ||
        hasNewerActiveHookStatus() ||
        isDisposed()
      ) {
        return
      }
      const shouldDispatchOsNotification = isAgentTaskCompleteNotificationEnabled()
      pendingTerminalBell = false
      clearTerminalBellTimer()
      deps.dispatchNotification({
        source: 'agent-task-complete',
        terminalTitle: title,
        paneKey,
        ...(options.agentCompletionSource
          ? { agentCompletionSource: options.agentCompletionSource }
          : {}),
        ...(shouldDispatchOsNotification ? {} : { suppressOsNotification: true }),
        ...(options.agentStatusSnapshot ? { agentStatusSnapshot: options.agentStatusSnapshot } : {})
      })
    }

    const dispatchIfDetailed = (): void => {
      if (hasNewerActiveHookStatus()) {
        clearPendingAgentTaskCompleteNotification()
        return
      }
      if (!graceElapsed) {
        return
      }
      const entry = useAppStore.getState().agentStatusByPaneKey[paneKey]
      if (canDispatchAgentNotificationAfterGrace(entry, options)) {
        dispatch()
      }
    }

    statusUnsubscribe = useAppStore.subscribe(dispatchIfDetailed)
    graceTimer = setTimeout(() => {
      graceTimer = null
      graceElapsed = true
      dispatchIfDetailed()
    }, AGENT_TASK_COMPLETE_NOTIFICATION_GRACE_MS)
    maxTimer = setTimeout(dispatch, AGENT_TASK_COMPLETE_NOTIFICATION_MAX_WAIT_MS)
  }

  const onBell = (): void => {
    deps.markWorktreeUnread(deps.worktreeId)
    deps.markTerminalTabUnread(deps.tabId)
    if (useAppStore.getState().settings?.experimentalTerminalAttention === true) {
      deps.markTerminalPaneUnread(paneKey)
    }
    pendingTerminalBell = true
    if (!hasPendingAgentTaskCompleteNotification()) {
      scheduleTerminalBellNotification()
    }
  }

  let settingsUnsubscribe = subscribeAgentTaskCompleteTrackingEnabled(() => {
    if (syncAgentTaskCompleteTrackingEnabled()) {
      agentCompletionCoordinator.startProcessTracking()
    }
  })

  const dispose = (): void => {
    clearPendingAgentTaskCompleteNotification()
    pendingTerminalBell = false
    clearTerminalBellTimer()
    settingsUnsubscribe?.()
    settingsUnsubscribe = null
  }

  return {
    onBell,
    scheduleAgentTaskCompleteNotification,
    syncAgentTaskCompleteTrackingEnabled,
    markFreshWorking,
    clearPendingAgentTaskCompleteNotification,
    schedulePendingTerminalBellNotification,
    dispose
  }
}
