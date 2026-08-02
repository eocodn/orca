import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type {
  RuntimeMobileSessionCreateTerminalResult,
  RuntimeMobileSessionTabCloseResult,
  RuntimeMobileSessionTabMove,
  RuntimeMobileSessionTabMoveResult,
  RuntimeMobileSessionTabsResult,
  RuntimeSessionTabCloseReason,
} from '../../../shared/runtime-types'
import type { AppState } from '../store/types'
import { getRuntimeEnvironmentIdForWorktree } from '../lib/worktree-runtime-owner'
import { useAppStore } from '../store'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { recordWebSessionFocusIntent } from './web-session-focus-intent'
import { clearWebSessionCloseIntent, recordWebSessionCloseIntent } from './web-session-close-intent'
import {
  clearWebSessionReorderIntent,
  recordWebSessionReorderIntent
} from './web-session-reorder-intent'
import type { WebSessionIntentOwner } from './web-session-intent-owner'
import {
  isWebTerminalSurfaceTabId,
  toHostSessionTabId,
  toWebTerminalSurfaceTabId
} from './web-terminal-surface-id'
import {
  listRemoteRuntimeSessionTabsAfterCurrentInFlight,
  listRemoteRuntimeSessionTabsDeduped
} from './remote-runtime-session-tabs-inflight'
import { translate } from '../i18n/i18n'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import { toRuntimeExecutionHostId } from '../../../shared/execution-host'
import {
  captureRuntimeEnvironmentCall,
  captureWebSessionIntentOwner,
  matchesWebSessionIntentOwner,
  pendingRuntimeWorktreeRecoveryRefreshes,
  RUNTIME_WORKTREE_RECOVERY_REFRESH_DELAYS_MS
} from './web-runtime-session-terminal-creation'
export {
  HOST_TERMINAL_SURFACE_SEPARATOR,
  isWebTerminalSurfaceTabId,
  toHostSessionTabId,
  toWebTerminalSurfaceTabId,
  WEB_TERMINAL_SURFACE_TAB_PREFIX
} from './web-terminal-surface-id'

export function isWebRuntimeSessionActive(
  activeRuntimeEnvironmentId: string | null | undefined
): boolean {
  // Why: headless serve sessions are owned by the remote runtime, whether the client is web or desktop Electron.
  return Boolean(activeRuntimeEnvironmentId?.trim())
}

export type { WebRuntimeTerminalCreateOutcome } from './web-runtime-session-terminal-creation'
export {
  createWebRuntimeAgentSessionTerminal,
  createWebRuntimeAgentSessionTerminalWithLaunchDraft,
  createWebRuntimeSessionTerminal
} from './web-runtime-session-terminal-creation'



export { createWebRuntimeSessionBrowserTab } from './web-runtime-session-browser-creation'



export function stageWebRuntimeBrowserTab(args: {
  environmentId: string
  worktreeId: string
  remotePageId: string
  url?: string
  targetGroupId?: string
  restoreFocus?: boolean
}): void {
  const remotePageId = args.remotePageId.trim()
  if (!remotePageId) {
    return
  }

  const existing = findLocalBrowserPageForRemotePage(
    useAppStore.getState(),
    args.environmentId,
    remotePageId
  )
  if (args.restoreFocus !== false) {
    selectWebRuntimeSessionWorktree(args.worktreeId, args.environmentId)
  }

  if (existing) {
    if (args.restoreFocus !== false) {
      useAppStore
        .getState()
        .focusBrowserTabInWorktree(args.worktreeId, existing.pageId, { surfacePane: true })
    }
    return
  }

  const url = args.url?.trim() || 'about:blank'
  // Why: the snapshot can arrive after React renders a fallback; stage the handle now so the worktree stays selected.
  const browserTab = useAppStore.getState().createBrowserTab(args.worktreeId, url, {
    title: url === 'about:blank' ? 'New Browser Tab' : url,
    focusAddressBar: true,
    browserRuntimeEnvironmentId: args.environmentId,
    targetGroupId: args.targetGroupId
  })
  const pageId = browserTab.activePageId ?? browserTab.pageIds?.[0] ?? null
  if (!pageId) {
    return
  }
  useAppStore.getState().setRemoteBrowserPageHandle(pageId, {
    environmentId: args.environmentId,
    remotePageId
  })
}

export function selectWebRuntimeSessionWorktree(worktreeId: string, environmentId: string): void {
  useAppStore.getState().setActiveWorktree(worktreeId, toRuntimeExecutionHostId(environmentId))
}

export function findLocalBrowserPageForRemotePage(
  state: AppState,
  environmentId: string,
  remotePageId: string
): { pageId: string } | null {
  for (const pages of Object.values(state.browserPagesByWorkspace)) {
    for (const page of pages) {
      const handle = state.remoteBrowserPageHandlesByPageId[page.id]
      if (handle?.environmentId === environmentId && handle.remotePageId === remotePageId) {
        return { pageId: page.id }
      }
    }
  }
  return null
}

export async function refreshWebRuntimeSessionTabsSnapshot(
  environmentId: string,
  worktreeId: string,
  options: {
    expectedEnvironmentPairingRevision?: number
    acceptCurrentSnapshot?: boolean
    confirmAgentSessionHandoff?: {
      provisionalTabId: string
      hostTabId: string
      hostTerminalHandle: string
    }
  } = {}
): Promise<void> {
  const expectedEnvironmentPairingRevision =
    options.expectedEnvironmentPairingRevision ?? getRuntimeEnvironmentRevision(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(
    environmentId,
    expectedEnvironmentPairingRevision
  )
  try {
    if (options.acceptCurrentSnapshot) {
      const { acceptReplayedWebSessionTabsSnapshot } = await import('./web-session-tabs-sync')
      // Why: the host snapshot may have arrived before structured create returned;
      // re-accept its current version after the exact provisional handoff is known.
      acceptReplayedWebSessionTabsSnapshot(environmentId, worktreeId)
    }
    const listSessionTabs = options.confirmAgentSessionHandoff
      ? listRemoteRuntimeSessionTabsAfterCurrentInFlight
      : listRemoteRuntimeSessionTabsDeduped
    const snapshot = await listSessionTabs({
      environmentId,
      worktreeId,
      load: async () => {
        const response = await callEnvironment({
          method: 'session.tabs.list',
          params: {
            worktree: toRuntimeWorktreeSelector(worktreeId)
          },
          timeoutMs: 15_000
        })
        return unwrapRuntimeRpcResult(
          response as RuntimeRpcResponse<RuntimeMobileSessionTabsResult>
        )
      }
    })
    if (options.confirmAgentSessionHandoff) {
      const { confirmWebAgentSessionHandoffAfterCreate } =
        await import('./web-agent-session-handoff')
      // Why: this list completed after structured creation, so absence now proves the exact host tab already retired.
      confirmWebAgentSessionHandoffAfterCreate({
        environmentId,
        worktreeId,
        ...options.confirmAgentSessionHandoff
      })
    }
    const { applyFreshWebSessionTabsSnapshot, applyWebSessionTabsStorePatch } =
      await import('./web-session-tabs-sync')
    if (getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision) {
      return
    }
    applyWebSessionTabsStorePatch((state) => {
      // Why: eager refreshes can resolve after the user switched worktrees; update tabs without stealing focus.
      const patch = applyFreshWebSessionTabsSnapshot(state, snapshot, environmentId)
      return patch === state ? state : patch
    })
  } catch (error) {
    // Why: host creation already succeeded; the long-lived session.tabs subscription catches up if this eager refresh fails.
    console.warn(
      '[web-runtime-session] failed to refresh session-tabs snapshot:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function scheduleRuntimeWorktreeRecoveryRefresh(
  environmentId: string,
  worktreeId: string,
  expectedEnvironmentPairingRevision = getRuntimeEnvironmentRevision(environmentId)
): void {
  const initialState = useAppStore.getState()
  if (!('tabsByWorktree' in initialState)) {
    return
  }
  if ((initialState.tabsByWorktree[worktreeId] ?? []).length > 0) {
    return
  }
  const key = `${environmentId}\0${expectedEnvironmentPairingRevision ?? ''}\0${worktreeId}`
  const token = Symbol(key)
  pendingRuntimeWorktreeRecoveryRefreshes.set(key, token)
  void (async () => {
    try {
      for (const delayMs of RUNTIME_WORKTREE_RECOVERY_REFRESH_DELAYS_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
        if (pendingRuntimeWorktreeRecoveryRefreshes.get(key) !== token) {
          return
        }
        if (getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision) {
          return
        }
        await refreshWebRuntimeSessionTabsSnapshot(environmentId, worktreeId, {
          expectedEnvironmentPairingRevision
        })
        if ((useAppStore.getState().tabsByWorktree[worktreeId] ?? []).length > 0) {
          return
        }
      }
    } finally {
      if (pendingRuntimeWorktreeRecoveryRefreshes.get(key) === token) {
        pendingRuntimeWorktreeRecoveryRefreshes.delete(key)
      }
    }
  })()
}

export async function activateWebRuntimeSessionWorktree(args: {
  worktreeId: string
  environmentId?: string | null
}): Promise<boolean> {
  const environmentId =
    args.environmentId?.trim() ??
    useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() ??
    null
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return false
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)

  try {
    const response = await callEnvironment({
      method: 'worktree.activate',
      params: {
        worktree: toRuntimeWorktreeSelector(args.worktreeId),
        // Why: notifyClients:false keeps navigation local when this client reaches an older host.
        notifyClients: false,
        navigation: 'caller'
      },
      timeoutMs: 15_000
    })
    unwrapRuntimeRpcResult(response as RuntimeRpcResponse<unknown>)
    // Why: a restarted HUB can recover its SSH pane after this client's subscription replayed an empty startup snapshot.
    await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
      expectedEnvironmentPairingRevision: intentOwner.pairingRevision,
      acceptCurrentSnapshot: true
    })
    // Why: HUB reachability can precede its nested SSH relay; bounded owner-scoped re-lists converge without asking the paired client to connect SSH itself.
    scheduleRuntimeWorktreeRecoveryRefresh(
      environmentId,
      args.worktreeId,
      intentOwner.pairingRevision
    )
    return true
  } catch (error) {
    console.warn(
      '[web-runtime-session] failed to activate worktree:',
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

export async function activateWebRuntimeSessionTab(args: {
  worktreeId: string
  tabId: string
  environmentId?: string | null
}): Promise<boolean> {
  return callWebRuntimeSessionTabMethod('session.tabs.activate', args)
}

export async function closeWebRuntimeSessionTab(args: {
  worktreeId: string
  tabId: string
  environmentId?: string | null
  reason: RuntimeSessionTabCloseReason
  publicationEpoch?: string | null
  terminalHandle?: string | null
}): Promise<boolean> {
  return callWebRuntimeSessionTabMethod('session.tabs.close', args)
}

export async function moveWebRuntimeSessionTab(
  args: RuntimeMobileSessionTabMove & {
    worktreeId: string
    environmentId?: string | null
  }
): Promise<boolean> {
  const environmentId =
    args.environmentId?.trim() ??
    useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() ??
    null
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return false
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)

  if (args.kind === 'reorder') {
    // Why: record local order synchronously before async host resolution, so a pre-move snapshot can't snap the tab back.
    recordWebSessionReorderIntent(
      intentOwner,
      args.worktreeId,
      args.targetGroupId,
      args.tabOrder,
      Date.now()
    )
  }

  try {
    const { resolveHostSessionTabIdForWebSessionTab } = await import('./web-session-tabs-sync')
    const state = useAppStore.getState()
    const resolveHostBackedTabId = (tabId: string): string | null =>
      resolveHostSessionTabIdForWebSessionTab(state, {
        environmentId,
        worktreeId: args.worktreeId,
        tabId
      }) ?? (isWebTerminalSurfaceTabId(tabId) ? toHostSessionTabId(tabId) : null)
    const toHostTabId = (tabId: string): string => resolveHostBackedTabId(tabId) ?? tabId
    const movedHostTabId =
      args.kind === 'reorder' ? resolveHostBackedTabId(args.tabId) : toHostTabId(args.tabId)
    if (!movedHostTabId) {
      clearWebSessionReorderIntent(intentOwner, args.worktreeId, args.targetGroupId)
      return false
    }
    const reorderedHostTabOrder =
      args.kind === 'reorder'
        ? args.tabOrder
            .map(resolveHostBackedTabId)
            .filter((tabId): tabId is string => Boolean(tabId))
        : null
    if (reorderedHostTabOrder && !reorderedHostTabOrder.includes(movedHostTabId)) {
      clearWebSessionReorderIntent(intentOwner, args.worktreeId, args.targetGroupId)
      return false
    }
    const targetHostIndex =
      args.kind === 'move-to-group' && typeof args.index === 'number'
        ? (state.groupsByWorktree?.[args.worktreeId]
            ?.find((group) => group.id === args.targetGroupId)
            ?.tabOrder.slice(0, args.index)
            .map(resolveHostBackedTabId)
            .filter((tabId): tabId is string => Boolean(tabId)).length ?? args.index)
        : args.kind === 'move-to-group'
          ? args.index
          : undefined
    const base = {
      worktree: toRuntimeWorktreeSelector(args.worktreeId),
      tabId: movedHostTabId,
      targetGroupId: args.targetGroupId
    }
    const move =
      args.kind === 'reorder'
        ? {
            ...base,
            kind: 'reorder' as const,
            // Why: the host reorder API only accepts host tab ids, so local-only tabs must be omitted from the mirrored order.
            tabOrder: reorderedHostTabOrder
          }
        : args.kind === 'split'
          ? {
              ...base,
              kind: 'split' as const,
              splitDirection: args.splitDirection
            }
          : {
              ...base,
              kind: 'move-to-group' as const,
              // Why: web groups can contain local-only tabs, so host insertion indexes count only the filtered host-backed order.
              index: targetHostIndex
            }
    const response = await callEnvironment({
      method: 'session.tabs.move',
      params: move,
      timeoutMs: 15_000
    })
    unwrapRuntimeRpcResult(response as RuntimeRpcResponse<RuntimeMobileSessionTabMoveResult>)
    return true
  } catch (error) {
    if (args.kind === 'reorder') {
      clearWebSessionReorderIntent(intentOwner, args.worktreeId, args.targetGroupId)
    }
    console.warn(
      '[web-runtime-session] failed to move tab:',
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

async function callWebRuntimeSessionTabMethod(
  method: 'session.tabs.activate' | 'session.tabs.close',
  args: {
    worktreeId: string
    tabId: string
    environmentId?: string | null
    reason?: RuntimeSessionTabCloseReason
    publicationEpoch?: string | null
    terminalHandle?: string | null
  }
): Promise<boolean> {
  const environmentId =
    args.environmentId?.trim() ??
    useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() ??
    null
  if (!environmentId || !isWebRuntimeSessionActive(environmentId)) {
    return false
  }
  const intentOwner = captureWebSessionIntentOwner(environmentId)
  const callEnvironment = captureRuntimeEnvironmentCall(environmentId, intentOwner.pairingRevision)
  const closeIntentTabIds = new Set<string>()

  const isClose = method === 'session.tabs.close'
  const isLifecycleClose = isClose && args.reason !== 'user'
  if (isLifecycleClose && (!args.publicationEpoch || !args.terminalHandle)) {
    // Why: missing host-generation or terminal-incarnation evidence means keep;
    // a tab id alone can be stale or reused after reconnect.
    const { acceptReplayedWebSessionTabsSnapshot } = await import('./web-session-tabs-sync')
    acceptReplayedWebSessionTabsSnapshot(environmentId, args.worktreeId)
    await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId)
    console.warn('[web-runtime-session] suppressed lifecycle close without incarnation evidence', {
      closeReason: args.reason
    })
    return false
  }

  const immediateHostTabId = toHostSessionTabId(args.tabId)
  if (isClose) {
    // Why: record before async id resolution so a stale snapshot cannot flash the closed tab back.
    closeIntentTabIds.add(immediateHostTabId)
    recordWebSessionCloseIntent(intentOwner, args.worktreeId, immediateHostTabId, Date.now())
  }

  try {
    const { resolveHostSessionTabIdForWebSessionTab } = await import('./web-session-tabs-sync')
    const state = useAppStore.getState()
    const hostTabId =
      resolveHostSessionTabIdForWebSessionTab(state, {
        environmentId,
        worktreeId: args.worktreeId,
        tabId: args.tabId
      }) ?? toHostSessionTabId(args.tabId)
    if (isClose) {
      // Why: suppress until the host confirms removal, else an in-flight pre-close snapshot flashes the tab back.
      closeIntentTabIds.add(hostTabId)
      recordWebSessionCloseIntent(intentOwner, args.worktreeId, hostTabId, Date.now())
    }
    const response = await callEnvironment({
      // Why: old hosts cannot route this additive method, so a generation
      // cutover fails closed before their destructive legacy close handler.
      method: isLifecycleClose ? 'session.tabs.closeLifecycle' : method,
      params: {
        worktree: toRuntimeWorktreeSelector(args.worktreeId),
        tabId: hostTabId,
        ...(method === 'session.tabs.activate'
          ? {
              // Why: the additive intent protects new hosts while notifyClients:false protects old hosts.
              notifyClients: false,
              navigation: 'caller' as const
            }
          : {}),
        ...(isLifecycleClose
          ? {
              reason: args.reason,
              publicationEpoch: args.publicationEpoch,
              terminal: args.terminalHandle
            }
          : isClose
            ? { reason: args.reason }
            : {})
      },
      timeoutMs: 15_000
    })
    const result = unwrapRuntimeRpcResult(
      response as RuntimeRpcResponse<RuntimeMobileSessionTabCloseResult | undefined>
    )
    if (isClose) {
      if (result?.refused === true && result.snapshotRepublished === true) {
        // Why: the host kept an authoritative live PTY. Stop hiding its mirror
        // only when it republished; dead-leaf refusals must stay suppressed.
        clearWebSessionCloseIntent(intentOwner, args.worktreeId, immediateHostTabId)
        clearWebSessionCloseIntent(intentOwner, args.worktreeId, hostTabId)
        const { acceptReplayedWebSessionTabsSnapshot } = await import('./web-session-tabs-sync')
        acceptReplayedWebSessionTabsSnapshot(environmentId, args.worktreeId)
      }
      await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
        expectedEnvironmentPairingRevision: intentOwner.pairingRevision
      })
    }
    return true
  } catch (error) {
    for (const hostTabId of closeIntentTabIds) {
      clearWebSessionCloseIntent(intentOwner, args.worktreeId, hostTabId)
    }
    if (isLifecycleClose) {
      const { acceptReplayedWebSessionTabsSnapshot } = await import('./web-session-tabs-sync')
      acceptReplayedWebSessionTabsSnapshot(environmentId, args.worktreeId)
      await refreshWebRuntimeSessionTabsSnapshot(environmentId, args.worktreeId, {
        expectedEnvironmentPairingRevision: intentOwner.pairingRevision
      })
    }
    console.warn(
      `[web-runtime-session] failed to ${isClose ? 'close' : 'activate'} tab:`,
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

export {
  clearWebRuntimeTerminalBuffer,
  closeWebRuntimeTerminal,
  consumePendingWebRuntimeSplitMirrorTelemetry,
  setWebRuntimeTabProps,
  splitWebRuntimeTerminal,
  updateWebRuntimePaneLayout
} from './web-runtime-session-terminal-operations'


      )
    })
  return true
}
