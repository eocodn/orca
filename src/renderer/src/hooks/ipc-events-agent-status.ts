import { useAppStore } from '../store'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import {
  isAgentStatusForRecentlyClosedTab,
  hasRuntimeBackedWorktreeAttribution,
  applyResolvedAgentTerminalTitleToTab,
  resolvePaneKey,
  resolveWorktreeConnection,
  resolveHookPayloadAgentType
} from './ipc-events-agent-status-model'
import {
  normalizeAgentStatusPayload,
  type AgentStatusClearIpcPayload,
  type AgentStatusIpcPayload
} from '../../../shared/agent-status-types'
import {
  resolveAgentStatusIdentity,
  shouldSuppressInheritedTerminalStatus
} from '../../../shared/agent-status-identity'
import { isWslHookRelayConnectionId } from '../../../shared/wsl-hook-relay-contract'
import { track } from '@/lib/telemetry'
import {
  observeAgentHookCompletionForNotification,
  syncAgentHookCompletionNotificationsForStoreUpdate
} from './agent-hook-completion-notifications'
import { shouldSuppressCodexAutoApprovalStatus } from '@/components/terminal-pane/codex-auto-approval-notification-suppression'
import { resolveAgentStatusTerminalTitle } from '@/lib/agent-status-terminal-title'
import { CLOSE_TERMINAL_PANE_EVENT } from '@/constants/terminal'
import {
  resolveLegacyWorkerTerminalRecoveryAction,
  rollbackLegacyWorkerTerminalSurfaceInStore
} from './legacy-worker-terminal-recovery-event'

const PENDING_AGENT_STATUS_RETRY_MS = 100
const PENDING_AGENT_STATUS_TTL_MS = 15_000
const MAX_PENDING_AGENT_STATUS_EVENTS = 100

type PendingAgentStatusEvent = {
  data: AgentStatusIpcPayload
  firstSeenAt: number
  replay: boolean
}

type AgentStatusApplyResult = 'applied' | 'pending' | 'dropped'

type AgentStatusSurfaceContext = {
  unsubs: Array<() => void>
}

export function registerAgentStatusEvents({ unsubs }: AgentStatusSurfaceContext): void {
  const pendingAgentStatusEvents: PendingAgentStatusEvent[] = []
  const transientClearWatermarkByConnectionId = new Map<string, number>()
  let agentStatusEffectDisposed = false
  let pendingAgentStatusRetryTimer: ReturnType<typeof setTimeout> | null = null
  // Why: setAgentStatus notifies synchronously and re-enters this flush mid-drain; guard re-entrancy.
  let isFlushingAgentStatuses = false

// Why: re-parse main-process agent status here so the renderer applies the same normalization regardless of hook vs OSC source.
// Startup pushes are ignored until workspace session hydration finishes; the snapshot pull below replays main's cache once tab identity exists.
function schedulePendingAgentStatusFlush(): void {
  if (pendingAgentStatusRetryTimer !== null || pendingAgentStatusEvents.length === 0) {
    return
  }
  pendingAgentStatusRetryTimer = globalThis.setTimeout(() => {
    pendingAgentStatusRetryTimer = null
    flushPendingAgentStatuses()
  }, PENDING_AGENT_STATUS_RETRY_MS)
}

function enqueuePendingAgentStatus(
  data: AgentStatusIpcPayload,
  options?: { replay?: boolean }
): void {
  pendingAgentStatusEvents.push({
    data,
    firstSeenAt: Date.now(),
    replay: options?.replay === true
  })
  while (pendingAgentStatusEvents.length > MAX_PENDING_AGENT_STATUS_EVENTS) {
    pendingAgentStatusEvents.shift()
  }
  schedulePendingAgentStatusFlush()
}

function flushPendingAgentStatuses(): void {
  // Why: guard re-entrancy — a subscriber firing mid-loop must not reprocess queued events the outer flush already owns.
  if (isFlushingAgentStatuses) {
    return
  }
  if (pendingAgentStatusEvents.length === 0) {
    return
  }
  isFlushingAgentStatuses = true
  try {
    const now = Date.now()
    const remaining: PendingAgentStatusEvent[] = []
    for (const event of pendingAgentStatusEvents) {
      if (now - event.firstSeenAt > PENDING_AGENT_STATUS_TTL_MS) {
        continue
      }
      const result = applyAgentStatus(event.data, { retry: true, replay: event.replay })
      if (result === 'pending') {
        remaining.push(event)
      }
    }
    pendingAgentStatusEvents.length = 0
    pendingAgentStatusEvents.push(...remaining)
    if (pendingAgentStatusEvents.length === 0 && pendingAgentStatusRetryTimer !== null) {
      globalThis.clearTimeout(pendingAgentStatusRetryTimer)
      pendingAgentStatusRetryTimer = null
    }
  } finally {
    isFlushingAgentStatuses = false
  }
  schedulePendingAgentStatusFlush()
}

const applyAgentStatus = (
  data: AgentStatusIpcPayload,
  options?: { replay?: boolean; retry?: boolean }
): AgentStatusApplyResult => {
  const store = useAppStore.getState()
  if (!store.workspaceSessionReady) {
    return 'dropped'
  }
  if (isAgentStatusForRecentlyClosedTab(store, data.paneKey)) {
    return 'dropped'
  }
  const paneKey = resolveAgentPaneAuthorityKey(data.paneKey)
  const ownerTabId = parsePaneKey(paneKey)?.tabId ?? data.tabId
  const payload = normalizeAgentStatusPayload({
    state: data.state,
    prompt: data.prompt,
    agentType: data.agentType,
    model: data.model,
    toolName: data.toolName,
    toolInput: data.toolInput,
    // Why: the live AskUserQuestion prompt rides this field; omitting it drops the native question card on web/mobile.
    interactivePrompt: data.interactivePrompt,
    lastAssistantMessage: data.lastAssistantMessage,
    interrupted: data.interrupted,
    // Why: same trap as interactivePrompt — this rebuild is a field whitelist, so subagent child rows vanish if omitted.
    subagents: data.subagents
  })
  if (!payload) {
    return 'dropped'
  }
  let {
    exists,
    title,
    identityTitle,
    repoConnectionId,
    repoConnectionResolved,
    owningWorktreeId
  } = resolvePaneKey(store, paneKey)
  if (!exists && data.worktreeId && hasRuntimeBackedWorktreeAttribution(data)) {
    // Why: orchestration worker hooks may carry worktree attribution before this renderer has a tab for the pane.
    // Require runtime identity too — worktreeId-only snapshots can be stale rows from closed/remounted panes.
    const fallbackOwnership = resolveWorktreeConnection(store, data.worktreeId)
    if (fallbackOwnership.worktreeExists) {
      owningWorktreeId = data.worktreeId
      repoConnectionId = fallbackOwnership.repoConnectionId
      repoConnectionResolved = fallbackOwnership.repoConnectionResolved
      exists = true
    }
  }
  if (!exists) {
    // Why: startup snapshot replay can beat tab/layout hydration too.
    // Reuse the same bounded retry queue when the row still carries
    // runtime-backed worktree provenance so the cached status can adopt
    // once the pane becomes visible.
    if (options?.replay === true) {
      if (data.worktreeId && hasRuntimeBackedWorktreeAttribution(data)) {
        if (options?.retry !== true) {
          enqueuePendingAgentStatus(data, { replay: true })
        }
        return 'pending'
      }
      return 'dropped'
    }
    if (options?.retry !== true) {
      // Why: empty paneKeys are dropped in main before IPC fanout. Reaching
      // this branch means a non-empty paneKey escaped without a matching
      // renderer tab, so track the adoption/routing failure separately.
      track('agent_hook_unattributed', { reason: 'unknown_tab_id' })
      enqueuePendingAgentStatus(data)
    }
    return 'pending'
  }
  if (options?.replay !== true && options?.retry !== true) {
    for (let index = pendingAgentStatusEvents.length - 1; index >= 0; index -= 1) {
      if (pendingAgentStatusEvents[index].data.paneKey === data.paneKey) {
        pendingAgentStatusEvents.splice(index, 1)
      }
    }
  }
  // Why: drop in-flight events stamped with a dead connection's id after SSH disconnect/reconnect — see docs/design/agent-status-over-ssh.md §5.
  // Why: startup snapshot replay can beat SSH repo hydration; accept when worktreeId matches the tab until repo ownership resolves.
  // Why: WSL relay stamps a `wsl:<distro>` connectionId but the pane is a local repo (ownership null); normalize so the strict check below doesn't drop it.
  const ownershipConnectionId = isWslHookRelayConnectionId(data.connectionId)
    ? null
    : data.connectionId
  const transientClearWatermark =
    typeof data.connectionId === 'string'
      ? transientClearWatermarkByConnectionId.get(data.connectionId)
      : undefined
  // Why: delayed snapshots/queued relay events must not resurrect a status cleared by a newer disconnect on this connection.
  if (transientClearWatermark !== undefined && data.receivedAt <= transientClearWatermark) {
    return 'dropped'
  }
  const canAcceptPendingRemoteOwnership =
    ownershipConnectionId !== undefined &&
    ownershipConnectionId !== null &&
    !repoConnectionResolved &&
    data.worktreeId !== undefined &&
    data.worktreeId === owningWorktreeId
  if (
    ownershipConnectionId !== undefined &&
    ownershipConnectionId !== repoConnectionId &&
    !canAcceptPendingRemoteOwnership
  ) {
    return 'dropped'
  }
  const existingStatus = store.agentStatusByPaneKey[paneKey]
  if (existingStatus && data.receivedAt < existingStatus.updatedAt) {
    // Why: the store rejects out-of-order status rows; keep metadata-only session identity on the same event boundary.
    return 'dropped'
  }
  if (data.providerSessionOnly) {
    if (!data.providerSession || data.agentType !== 'pi') {
      return 'dropped'
    }
    store.recordAgentProviderSession(
      paneKey,
      'pi',
      data.providerSession,
      { updatedAt: data.receivedAt },
      {
        tabId: ownerTabId,
        worktreeId: data.worktreeId ?? owningWorktreeId,
        // Why: persist the WSL-normalized ownership id, not raw relay provenance; a `wsl:*` connectionId would misroute later resumes.
        ...(ownershipConnectionId !== undefined ? { connectionId: ownershipConnectionId } : {})
      },
      data.launchToken ? { launchToken: data.launchToken } : undefined
    )
    return 'applied'
  }
  const resolvedPayload = resolveHookPayloadAgentType(payload, identityTitle ?? title)
  const statusPayload = data.orchestration
    ? { ...resolvedPayload, orchestration: data.orchestration }
    : resolvedPayload
  const statusPayloadWithTurnBoundary = data.promptInteractionKey
    ? { ...statusPayload, promptInteractionKey: data.promptInteractionKey }
    : statusPayload
  const identity = resolveAgentStatusIdentity({
    existing: existingStatus
      ? {
          agentType: existingStatus.agentType,
          state: existingStatus.state,
          updatedAt: existingStatus.updatedAt
        }
      : undefined,
    incoming: statusPayload.agentType,
    now: data.receivedAt
  })
  if (
    existingStatus &&
    shouldSuppressInheritedTerminalStatus({
      inheritedFromActivePane: identity.inheritedFromActivePane,
      incomingState: statusPayload.state
    })
  ) {
    // Why: guards against a stale main-process child completion resurrecting terminal status.
    return 'dropped'
  }
  if (
    shouldSuppressCodexAutoApprovalStatus(statusPayload, {
      paneKey,
      tabId: ownerTabId,
      terminalHandle: data.terminalHandle,
      launchToken: data.launchToken,
      providerSession: data.providerSession,
      existingProviderSession: existingStatus?.providerSession
    })
  ) {
    // Why: Codex yolo permission hooks are not user-actionable; they must not drive status, titles, badges, or notifications.
    return 'dropped'
  }
  const terminalTitle = resolveAgentStatusTerminalTitle(statusPayload, title)
  const statusWorktreeId = data.worktreeId ?? owningWorktreeId
  store.setAgentStatus(
    paneKey,
    statusPayloadWithTurnBoundary,
    terminalTitle,
    {
      updatedAt: data.receivedAt,
      stateStartedAt: data.stateStartedAt
    },
    {
      tabId: ownerTabId,
      worktreeId: statusWorktreeId,
      terminalHandle: data.terminalHandle,
      ...(ownershipConnectionId !== undefined ? { connectionId: ownershipConnectionId } : {})
    },
    data.providerSession || data.launchToken
      ? {
          ...(data.providerSession ? { providerSession: data.providerSession } : {}),
          ...(data.launchToken ? { launchToken: data.launchToken } : {})
        }
      : undefined
  )
  applyResolvedAgentTerminalTitleToTab(store, paneKey, title, terminalTitle)
  if (options?.replay !== true && statusWorktreeId) {
    // Why: local Codex/Claude hooks arrive via this main-process IPC path, not the PTY OSC fallback, so task-complete notifications must observe accepted hook state here too.
    const notificationPayload =
      typeof data.stateStartedAt === 'number'
        ? { ...resolvedPayload, stateStartedAt: data.stateStartedAt }
        : resolvedPayload
    observeAgentHookCompletionForNotification({
      paneKey,
      worktreeId: statusWorktreeId,
      payload: notificationPayload
    })
  }
  return 'applied'
}

let snapshotRequestedForReadyWindow = false
let snapshotRequestId = 0
const requestAgentStatusSnapshotIfReady = (): void => {
  const store = useAppStore.getState()
  if (!store.workspaceSessionReady) {
    snapshotRequestedForReadyWindow = false
    return
  }
  if (snapshotRequestedForReadyWindow) {
    return
  }
  const getSnapshot = window.api.agentStatus.getSnapshot
  if (typeof getSnapshot !== 'function') {
    return
  }
  snapshotRequestedForReadyWindow = true
  const requestId = ++snapshotRequestId
  void getSnapshot()
    .then((entries) => {
      if (agentStatusEffectDisposed || requestId !== snapshotRequestId) {
        return
      }
      const current = useAppStore.getState()
      if (!current.workspaceSessionReady) {
        return
      }
      for (const entry of entries) {
        applyAgentStatus(entry, { replay: true })
      }
      const getMigrationUnsupportedSnapshot =
        window.api.agentStatus.getMigrationUnsupportedSnapshot
      if (typeof getMigrationUnsupportedSnapshot !== 'function') {
        return
      }
      void getMigrationUnsupportedSnapshot().then((unsupportedEntries) => {
        if (agentStatusEffectDisposed || requestId !== snapshotRequestId) {
          return
        }
        const unsupportedStore = useAppStore.getState()
        if (!unsupportedStore.workspaceSessionReady) {
          return
        }
        for (const entry of unsupportedEntries) {
          if (entry.paneKey && resolvePaneKey(unsupportedStore, entry.paneKey).exists) {
            unsupportedStore.setMigrationUnsupportedPty(entry)
          }
        }
      })
    })
    .catch((err) => {
      // Why: stay latched on failure; the store subscriber fires on every update, so resetting here would turn a persistent IPC failure into a retry storm (flag clears on workspaceSessionReady toggle).
      console.warn('[agent-status] failed to load startup snapshot:', err)
    })
}

unsubs.push(
  window.api.agentStatus.onSet((data) => {
    applyAgentStatus(data)
  })
)
const unsubscribeAgentStatusClear = window.api.agentStatus.onClear?.(
  (data: AgentStatusClearIpcPayload) => {
    if (typeof data !== 'object' || data === null) {
      return
    }
    if ('transient' in data && data.transient === true) {
      if (
        typeof data.connectionId !== 'string' ||
        data.connectionId.length === 0 ||
        !Number.isFinite(data.clearedAt)
      ) {
        return
      }
      const previousWatermark =
        transientClearWatermarkByConnectionId.get(data.connectionId) ?? -1
      const effectiveWatermark = Math.max(previousWatermark, data.clearedAt)
      transientClearWatermarkByConnectionId.set(data.connectionId, effectiveWatermark)
      for (let index = pendingAgentStatusEvents.length - 1; index >= 0; index -= 1) {
        const pending = pendingAgentStatusEvents[index].data
        if (
          pending.connectionId === data.connectionId &&
          pending.receivedAt <= effectiveWatermark
        ) {
          pendingAgentStatusEvents.splice(index, 1)
        }
      }
      useAppStore.getState().clearTransientAgentStatuses(data.connectionId, effectiveWatermark)
      return
    }
    if (!('paneKey' in data) || typeof data.paneKey !== 'string') {
      return
    }
    const store = useAppStore.getState()
    if (store.agentStatusByPaneKey[data.paneKey]?.state === 'done') {
      return
    }
    store.removeAgentStatus(data.paneKey)
  }
)
if (unsubscribeAgentStatusClear) {
  unsubs.push(unsubscribeAgentStatusClear)
}
const unsubscribeMigrationUnsupported = window.api.agentStatus.onMigrationUnsupported?.(
  (entry) => {
    const store = useAppStore.getState()
    if (!store.workspaceSessionReady) {
      return
    }
    if (entry.paneKey && resolvePaneKey(store, entry.paneKey).exists) {
      store.setMigrationUnsupportedPty(entry)
    }
  }
)
if (unsubscribeMigrationUnsupported) {
  unsubs.push(unsubscribeMigrationUnsupported)
}
const unsubscribeMigrationUnsupportedClear =
  window.api.agentStatus.onMigrationUnsupportedClear?.(({ ptyId }) => {
    useAppStore.getState().clearMigrationUnsupportedPty(ptyId)
  })
if (unsubscribeMigrationUnsupportedClear) {
  unsubs.push(unsubscribeMigrationUnsupportedClear)
}
const unsubscribeLegacyWorkerTerminalRecovery =
  window.api.agentStatus.onLegacyWorkerTerminalRecovery?.((event) => {
    const action = resolveLegacyWorkerTerminalRecoveryAction(event)
    if (action.kind === 'rollback-surface') {
      window.dispatchEvent(
        new CustomEvent(CLOSE_TERMINAL_PANE_EVENT, { detail: action.detail })
      )
      rollbackLegacyWorkerTerminalSurfaceInStore(useAppStore.getState(), action.detail)
    } else if (action.kind === 'clear-sleeping') {
      useAppStore.getState().clearSleepingAgentSession(action.paneKey)
    }
  })
if (unsubscribeLegacyWorkerTerminalRecovery) {
  unsubs.push(unsubscribeLegacyWorkerTerminalRecovery)
}

// Why: main hook server is the durable source of truth; pull the snapshot only after tabs are ready so early startup pushes can be ignored, not buffered.
requestAgentStatusSnapshotIfReady()
const unsubscribeAgentStatusStore = useAppStore.subscribe((state, previousState) => {
  requestAgentStatusSnapshotIfReady()
  flushPendingAgentStatuses()
  syncAgentHookCompletionNotificationsForStoreUpdate(state, previousState)
})


  unsubs.push(() => {
    agentStatusEffectDisposed = true
    snapshotRequestId += 1
    if (pendingAgentStatusRetryTimer !== null) {
      globalThis.clearTimeout(pendingAgentStatusRetryTimer)
    }
    pendingAgentStatusEvents.length = 0
    unsubscribeAgentStatusStore()
  })
}
