import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../../shared/remote-runtime-client-error-classification'
import type {
  RuntimeMobileSessionTerminalClientTab,
  RuntimeMobileSessionTabsResult
} from '../../../../shared/runtime-types'
import { runtimeTerminalErrorMessage } from '../../runtime/runtime-terminal-stream'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { listRemoteRuntimeSessionTabsDeduped } from '@/runtime/remote-runtime-session-tabs-inflight'
import type { RemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'

const HOST_SESSION_ATTACH_POLL_MS = 150
const HOST_SESSION_REPLACEMENT_POLL_MAX_MS = 1_000
const HOST_SESSION_ATTACH_TIMEOUT_MS = 15_000

export function installRemoteRuntimePtyHostSessionDiscovery(
  context: RemoteRuntimePtyTransportContext
): void {
  context.getHostSessionTerminalSurfaces = (
    snapshot,
    hostTabId,
    options
  ): RuntimeMobileSessionTerminalClientTab[] =>
    snapshot.tabs.filter(
      (tab): tab is RuntimeMobileSessionTerminalClientTab =>
        tab.type === 'terminal' &&
        (tab.parentTabId === hostTabId || tab.id === hostTabId) &&
        (!options.matchRequestedLeaf || !context.opts.leafId || tab.leafId === context.opts.leafId)
    )
  context.findReadyHostSessionHandle = (snapshot, hostTabId) => {
    const terminalTabs = context.getHostSessionTerminalSurfaces(snapshot, hostTabId, {
      matchRequestedLeaf: false
    })
    if (context.opts.leafId) {
      const requestedLeaf = terminalTabs.find(
        (tab) =>
          tab.status === 'ready' &&
          tab.parentTabId === hostTabId &&
          tab.leafId === context.opts.leafId
      )
      return requestedLeaf?.terminal ?? null
    }
    const preferred =
      terminalTabs.find(
        (tab) => tab.status === 'ready' && tab.parentTabId === hostTabId && tab.isActive
      ) ?? terminalTabs.find((tab) => tab.status === 'ready' && tab.parentTabId === hostTabId)
    return preferred?.terminal ?? null
  }
  context.hasHostSessionTerminalSurface = (snapshot, hostTabId) =>
    context.getHostSessionTerminalSurfaces(snapshot, hostTabId, {
      matchRequestedLeaf: true
    }).length > 0
  context.waitForHostSessionHandle = async (hostTabId, isCurrent) => {
    if (!context.opts.worktreeId) return undefined
    const worktree = toRuntimeWorktreeSelector(context.opts.worktreeId)
    let activated: RuntimeMobileSessionTabsResult
    try {
      activated = await context.callRuntime<RuntimeMobileSessionTabsResult>('session.tabs.activate', {
        worktree,
        tabId: hostTabId,
        ...(context.opts.leafId ? { leafId: context.opts.leafId } : {}),
        notifyClients: false,
        navigation: 'caller'
      })
    } catch (error) {
      const message = runtimeTerminalErrorMessage(error)
      if (message.includes('tab_not_found') || message.includes('terminal_not_found')) return null
      throw error
    }
    const immediate = context.findReadyHostSessionHandle(activated, hostTabId)
    if (immediate) return immediate
    const startedAt = Date.now()
    while (isCurrent()) {
      const remainingMs = HOST_SESSION_ATTACH_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingMs <= 0) return undefined
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(HOST_SESSION_ATTACH_POLL_MS, remainingMs))
      )
      const listed = await listRemoteRuntimeSessionTabsDeduped({
        environmentId: context.currentRuntimeEnvironmentId,
        worktreeId: context.opts.worktreeId!,
        load: () =>
          context.callRuntime<RuntimeMobileSessionTabsResult>('session.tabs.list', { worktree })
      })
      const handle = context.findReadyHostSessionHandle(listed, hostTabId)
      if (handle) return handle
      if (!context.hasHostSessionTerminalSurface(listed, hostTabId)) {
        const siblingStillExists =
          context.getHostSessionTerminalSurfaces(listed, hostTabId, {
            matchRequestedLeaf: false
          }).length > 0
        return siblingStillExists ? false : null
      }
    }
    return undefined
  }
  context.waitForHostSessionAttachRetry = (recoveryEpoch) =>
    new Promise((resolve) => {
      let settled = false
      const settle = (retry: boolean): void => {
        if (settled) return
        settled = true
        if (context.settleHostSessionAttachRetry === settle) {
          context.settleHostSessionAttachRetry = null
        }
        resolve(retry)
      }
      context.settleHostSessionAttachRetry?.(false)
      context.settleHostSessionAttachRetry = settle
      if (!context.recovery.schedule(recoveryEpoch, () => settle(true))) settle(false)
    })
  context.waitForHostSessionHandleWithRecovery = async (hostTabId, isCurrent) => {
    let recoveryEpoch = context.recovery.isActive ? context.recovery.currentEpoch : undefined
    while (isCurrent()) {
      try {
        const hostHandle = await context.waitForHostSessionHandle(hostTabId, isCurrent)
        if (!isCurrent()) return undefined
        if (recoveryEpoch !== undefined && !context.recovery.isCurrent(recoveryEpoch)) {
          return undefined
        }
        return hostHandle
      } catch (error) {
        if (
          !isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error)) ||
          !isCurrent()
        ) throw error
        if (recoveryEpoch !== undefined && !context.recovery.isCurrent(recoveryEpoch)) {
          return undefined
        }
        recoveryEpoch ??= context.recovery.begin()
        if (!(await context.waitForHostSessionAttachRetry(recoveryEpoch)) || !isCurrent()) {
          return undefined
        }
      }
    }
    return undefined
  }
  context.waitForResubscribeHostSessionHandle = async (
    hostTabId,
    previousHandle,
    requireReplacement
  ) => {
    if (!context.opts.worktreeId) return null
    const worktree = toRuntimeWorktreeSelector(context.opts.worktreeId)
    const startedAt = Date.now()
    let pollMs = HOST_SESSION_ATTACH_POLL_MS
    let lastListError: unknown = null
    const finishWithUnknownLiveness = (): undefined => {
      if (lastListError) {
        console.warn(
          '[remote-runtime-pty] host session inventory unavailable during reconnect:',
          runtimeTerminalErrorMessage(lastListError)
        )
      }
      return undefined
    }
    while (!context.destroyed && context.connected && context.handle === previousHandle) {
      const requestRemainingMs = HOST_SESSION_ATTACH_TIMEOUT_MS - (Date.now() - startedAt)
      if (requestRemainingMs <= 0) return finishWithUnknownLiveness()
      try {
        const listed = await listRemoteRuntimeSessionTabsDeduped({
          environmentId: context.currentRuntimeEnvironmentId,
          worktreeId: context.opts.worktreeId!,
          load: () =>
            context.callRuntime<RuntimeMobileSessionTabsResult>(
              'session.tabs.list',
              { worktree },
              requestRemainingMs
            )
        })
        lastListError = null
        const nextHandle = context.findReadyHostSessionHandle(listed, hostTabId)
        if (nextHandle && (!requireReplacement || nextHandle !== previousHandle)) return nextHandle
        if (!context.hasHostSessionTerminalSurface(listed, hostTabId)) return null
      } catch (error) {
        lastListError = error
      }
      const remainingMs = HOST_SESSION_ATTACH_TIMEOUT_MS - (Date.now() - startedAt)
      if (remainingMs <= 0) return finishWithUnknownLiveness()
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remainingMs)))
      pollMs = Math.min(pollMs * 2, HOST_SESSION_REPLACEMENT_POLL_MAX_MS)
    }
    return undefined
  }
}
