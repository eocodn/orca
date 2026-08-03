 import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  Repo,
  SetupSplitDirection,
  Tab,
  TerminalLayoutSnapshot,
  TerminalTab,
  TuiAgent,
  Worktree,
  WorkspaceKey,
  WorkspaceSessionState
} from '../../../../shared/types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../../shared/agent-session-resume'
import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import {
  DEFAULT_REPO_BADGE_COLOR,
  FLOATING_TERMINAL_WORKTREE_ID
} from '../../../../shared/constants'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import { deriveGeneratedTabTitle } from '../../../../shared/agent-tab-title'
import { isDecorativeAgentTitleFrameChange } from '../../../../shared/agent-decorative-title-signature'
import {
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../../../../shared/stable-pane-id'
import { isValidHostTerminalTabId, isValidTerminalTabId } from '../../../../shared/terminal-tab-id'
import { buildByIdIndex, buildWorktreeByIdIndex } from './worktree-by-id-index'
import { isSameCodexRestartNoticeAccount } from './codex-restart-notice-account-identity'
import {
  getRepoIdFromWorktreeId,
  splitWorktreeIdForFilesystem
} from '../../../../shared/worktree-id'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/project-execution-runtime'
import type { StartupCommandDelivery } from '../../../../shared/codex-startup-delivery'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import { resolveLocalWindowsTerminalShellOverrideForTab } from '../../../../shared/local-windows-terminal-runtime'
import { WINDOWS_GIT_BASH_SHELL } from '../../../../shared/windows-terminal-shell'
import type { AgentStartedTelemetry } from '../../lib/worktree-activation'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { forgetAgentHibernationTabOutput } from '@/lib/agent-hibernation-output-activity'
import { forgetForegroundTerminalTabs } from '@/lib/foreground-terminal-tabs'
import { forgetAgentStartupDeliveriesForTabs } from '@/lib/agent-startup-delivery-guards'
import { clearTransientTerminalState, emptyLayoutSnapshot } from './terminal-helpers'
import { pushClosedTerminalTabSnapshot, pushRecentlyClosedTabKind } from './recently-closed-tabs'
import { isClaudeAgent } from '@/lib/agent-status'
import { recordTerminalInputActivity } from '@/lib/terminal-input-activity-coalescing'
import { classifyTitleActivity } from '@/lib/pane-agent-evidence'
import { buildOrphanTerminalCleanupPatch, getOrphanTerminalIds } from './terminal-orphan-helpers'
import {
  dedupeTabOrder,
  ensureGroup,
  findTabByEntityInGroup,
  pushRecentTabId,
  sanitizeRecentTabIds,
  updateGroup
} from './tab-group-state'
import {
  restorePtyDataHandlersAfterFailedShutdown,
  unregisterPtyDataHandlers
} from '@/components/terminal-pane/pty-transport'
// Why: use the store-free registry (not terminal-parked-tab-watchers, which imports @/store) to avoid re-entering store creation during this slice's eval.
import {
  disposeParkedTerminalWatchersForPtyIds,
  retireParkedTerminalTab
} from '@/components/terminal-pane/terminal-parked-watcher-registry'
import {
  clearCommittedPtyShutdownSettlements,
  hasCommittedPtyShutdownSettlement,
  markCommittedPtyShutdowns,
  noteCommittedPtyShutdownSettlements,
  settleDeferredPtyShutdownExits
} from '@/components/terminal-pane/pty-shutdown-exit-deferral'
import {
  normalizeTerminalLayoutSnapshot,
  resolvePtyBoundActiveLeafId
} from '@/components/terminal-pane/terminal-layout-leaf-ids'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { parseRemoteRuntimePtyId, toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { requestRemoteWorktreeSleep } from '@/runtime/remote-worktree-sleep'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getFolderWorkspaceConnectionId } from '@/lib/folder-workspace-connection'
import {
  clearDirectSshTerminalBindings,
  invalidateStaleDirectSshTerminalBindings,
  type DirectSshLivePtyBinding,
  type DirectSshPaneRetryAttempt,
  type DirectSshPaneRetryAttemptId,
  type DirectSshPaneRetryHistory,
  type DirectSshPaneRetryResult
} from './direct-ssh-terminal-recovery'
import {
  retryDirectSshTerminalPanes,
  retrySettledDirectSshTerminalPane
} from './direct-ssh-pane-retry-ledger'
import {
  directSshAuthoritiesEqual,
  settleDirectSshPaneRetryState,
  transferDirectSshPaneDetachLedger
} from './direct-ssh-terminal-authority-ledger'
import { resolveDirectSshTerminalWorkspaceKeys } from './direct-ssh-terminal-workspace-scope'
import { hasWorktreeSleepIntent } from '@/lib/worktree-sleep-intent'
import { sanitizeTerminalLayoutPaneTitles } from '@/lib/terminal-pane-title-sanitization'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import type { NativeChatLaunchDraft, NativeChatLaunchPrompt } from '@/lib/native-chat-launch-prompt'
import {
  addAdditionalValidWorkspaceKeys,
  type WorkspaceSessionHydrationOptions
} from '@/lib/workspace-session-hydration-keys'
import {
  buildValidWorktreeIdsForSessionHydration,
  collectPersistedWorktreeIdsForSessionHydration
} from './degraded-repo-worktree-validity'
import {
  collectHibernatedCompletionEvidenceForWorktree,
  collectSleepingAgentSessionRecordsForWorktree,
  removeSleepingRecordsReplacedByManualWorktreeSleep,
  type AgentStatusWorktreeShutdownReason
} from './agent-status'
import {
  buildTerminalTabRetirementPlan,
  classifyTerminalRetirementWorktree,
  isTerminalTabPresent,
  removeSleepingAgentSessionsForTab,
  type TerminalTabCloseReason,
  type TerminalTabRetirementPlan
} from './terminal-tab-retirement'
import { getNextTerminalOrdinal, isRemoteRuntimePtyId, isCurrentDirectSshAuthority, resolveDirectSshTerminalKeys, getPendingActivationSpawnCount, consumePendingActivationSpawn, getFallbackTabTitle, getPathDisplayName, buildRuntimeSessionPlaceholders, getTerminalTabOwnerWorktreeId, updateUnifiedTerminalLabel, updateUnifiedTerminalGeneratedLabel, getTabIdFromPaneKey, isWindowsRendererRuntime, isAllowedRemoteWindowsTerminalShell, resolveCreatedTabShellOverride, worktreeUsesWslPath, worktreeUsesRemoteConnection, getRemoteConnectionIdForWorktree, resolveTerminalStopRuntimeEnvironmentId, sortedUniquePtyIds, equalStringSets, uniquePtyIds, resolvePrimaryLayoutPtyId, withTerminalTabPtyId, replaceHydratedRecordKeys, targetScopedWorkspaceHydrationPatch } from './terminals-state'
import type { AutomaticAgentResumeClaim, CodexRestartNotice, TerminalSlice, HydrateWorkspaceSessionOptions, ReconnectPersistedTerminalsOptions, WorkspaceHydrationPatch } from './terminals-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createTerminalSliceShutdownWorktreeTerminalsActions10(set: SliceSet, get: SliceGet) {
  return {
  shutdownWorktreeTerminals: async (worktreeId, opts) => {
    const keepIdentifiers = opts?.keepIdentifiers ?? false
    const shutdownReason: AgentStatusWorktreeShutdownReason =
      opts?.shutdownReason ?? (keepIdentifiers ? 'manual-sleep' : 'remove-worktree')
    const tabs = get().tabsByWorktree[worktreeId] ?? []
    const ptyIds = tabs.flatMap((tab) => get().ptyIdsByTabId[tab.id] ?? [])
    const rendererShutdownPtyIds = sortedUniquePtyIds(ptyIds)
    const expectedRuntimePtyIds = sortedUniquePtyIds(opts?.expectedRuntimePtyIds)
    const runtimeEnvironmentId = resolveTerminalStopRuntimeEnvironmentId(get(), worktreeId)
    // Why: only renderer-bound ids emit pane exit callbacks, so they are the complete guard set (expectedRuntimePtyIds are raw RPC handles).
    const exitGuardPtyIds = rendererShutdownPtyIds
    const sleepingAgentSessionRecords = keepIdentifiers
      ? collectSleepingAgentSessionRecordsForWorktree(get(), worktreeId, {
          paneKeys: opts?.sleepingPaneKeys,
          ...(shutdownReason === 'manual-sleep' ? { captureMode: 'manual-worktree-sleep' } : {}),
          ...(shutdownReason === 'auto-hibernate-completed-agent'
            ? { captureMode: 'completed-agent-hibernation' }
            : {})
        })
      : {}
    const retainedCompletionEvidence =
      shutdownReason === 'auto-hibernate-completed-agent'
        ? collectHibernatedCompletionEvidenceForWorktree(get(), worktreeId, opts?.sleepingPaneKeys)
        : []
    let handlerSnapshots: ReturnType<typeof unregisterPtyDataHandlers> = []
    let partialRendererStopSettled = false
    const markShutdownPending = (): void => {
      set((s) => {
        const nextPending = { ...s.pendingPtyShutdownIds }
        for (const ptyId of exitGuardPtyIds) {
          nextPending[ptyId] = (nextPending[ptyId] ?? 0) + 1
        }
        return {
          suppressedPtyExitIds: {
            ...s.suppressedPtyExitIds,
            ...Object.fromEntries(exitGuardPtyIds.map((ptyId) => [ptyId, true] as const))
          },
          pendingPtyShutdownIds: nextPending
        }
      })
    }
    const rollbackShutdown = (): void => {
      if (handlerSnapshots.length > 0) {
        restorePtyDataHandlersAfterFailedShutdown(handlerSnapshots)
      }
      set((s) => {
        const nextSuppressed = { ...s.suppressedPtyExitIds }
        const nextPending = { ...s.pendingPtyShutdownIds }
        for (const ptyId of exitGuardPtyIds) {
          const remainingOwners = (nextPending[ptyId] ?? 0) - 1
          if (remainingOwners > 0) {
            nextPending[ptyId] = remainingOwners
          } else {
            delete nextPending[ptyId]
            if (!hasCommittedPtyShutdownSettlement(ptyId)) {
              delete nextSuppressed[ptyId]
            }
          }
        }
        return {
          suppressedPtyExitIds: nextSuppressed,
          pendingPtyShutdownIds: nextPending
        }
      })
      const settledPtyIds = exitGuardPtyIds.filter((ptyId) => !get().isPtyShutdownPending(ptyId))
      const committedPtyIds = settledPtyIds.filter(hasCommittedPtyShutdownSettlement)
      const rolledBackPtyIds = settledPtyIds.filter(
        (ptyId) => !hasCommittedPtyShutdownSettlement(ptyId)
      )
      markCommittedPtyShutdowns(committedPtyIds)
      settleDeferredPtyShutdownExits(committedPtyIds, 'committed')
      settleDeferredPtyShutdownExits(rolledBackPtyIds, 'rolled-back')
      clearCommittedPtyShutdownSettlements(settledPtyIds)
    }
    const stopRendererPtys = async (): Promise<{
      stoppedPtyIds: string[]
      failure?: PromiseRejectedResult
    }> => {
      const localPtyIds = rendererShutdownPtyIds.filter((ptyId) => !ptyId.startsWith('remote:'))
      const results = await Promise.allSettled(
        localPtyIds.map((ptyId) => window.api.pty.kill(ptyId, { keepHistory: keepIdentifiers }))
      )
      const stoppedPtyIds = [
        ...(runtimeEnvironmentId
          ? rendererShutdownPtyIds.filter((ptyId) => ptyId.startsWith('remote:'))
          : []),
        ...localPtyIds.filter((_, index) => results[index]?.status === 'fulfilled')
      ]
      disposeParkedTerminalWatchersForPtyIds(stoppedPtyIds)
      return {
        stoppedPtyIds,
        failure: results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
      }
    }
    const settlePartialRendererStop = (stoppedPtyIds: readonly string[]): void => {
      partialRendererStopSettled = true
      const stopped = new Set(stoppedPtyIds)
      const stoppedSnapshots = handlerSnapshots.filter((snapshot) => stopped.has(snapshot.ptyId))
      const failedSnapshots = handlerSnapshots.filter((snapshot) => !stopped.has(snapshot.ptyId))
      for (const snapshot of stoppedSnapshots) {
        snapshot.commit?.()
      }
      restorePtyDataHandlersAfterFailedShutdown(failedSnapshots)
      noteCommittedPtyShutdownSettlements(stoppedPtyIds)
      set((s) => {
        const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
        for (const tab of tabs) {
          nextPtyIdsByTabId[tab.id] = (s.ptyIdsByTabId[tab.id] ?? []).filter(
            (ptyId) => !stopped.has(ptyId)
          )
        }
        const nextPending = { ...s.pendingPtyShutdownIds }
        const nextSuppressed = { ...s.suppressedPtyExitIds }
        for (const ptyId of exitGuardPtyIds) {
          const remainingOwners = (nextPending[ptyId] ?? 0) - 1
          if (remainingOwners > 0) {
            nextPending[ptyId] = remainingOwners
          } else {
            delete nextPending[ptyId]
            if (!stopped.has(ptyId)) {
              delete nextSuppressed[ptyId]
            }
          }
        }
        return {
          ptyIdsByTabId: nextPtyIdsByTabId,
          pendingPtyShutdownIds: nextPending,
          suppressedPtyExitIds: nextSuppressed
        }
      })
      const failedPtyIds = exitGuardPtyIds.filter((ptyId) => !stopped.has(ptyId))
      markCommittedPtyShutdowns(stoppedPtyIds)
      settleDeferredPtyShutdownExits(stoppedPtyIds, 'committed')
      settleDeferredPtyShutdownExits(failedPtyIds, 'rolled-back')
      clearCommittedPtyShutdownSettlements(exitGuardPtyIds)
    }

    // Why (ordering invariant, DESIGN_DOC §3.3.c): capture serializer buffers before pty.kill (panes unmount on exit); SSH-critical since the relay drops remote history on kill.
    // Why: capture() writes through the store via setTabLayout, so the set() below must spread s.terminalLayoutsByTabId in a functional updater, not a captured snapshot, or it clobbers the capture.
    if (keepIdentifiers) {
      for (const tab of tabs) {
        const capture = shutdownBufferCaptures.get(tab.id)
        if (capture) {
          try {
            capture({ includeLocalBuffers: false })
          } catch {
            // Don't let one tab's capture failure block the rest.
          }
        }
      }
    }

    if (expectedRuntimePtyIds.length === 0) {
      markShutdownPending()
      handlerSnapshots = unregisterPtyDataHandlers(rendererShutdownPtyIds) ?? []
      try {
        if (runtimeEnvironmentId) {
          await (shutdownReason === 'manual-sleep'
            ? requestRemoteWorktreeSleep({
                environmentId: runtimeEnvironmentId,
                worktreeId
              })
            : callRuntimeRpc(
                { kind: 'environment', environmentId: runtimeEnvironmentId },
                'terminal.stop',
                { worktree: toRuntimeWorktreeSelector(worktreeId) },
                { timeoutMs: 15_000 }
              ))
        }

        // Why: client-owned teardown waits for the owner RPC so a failure leaves renderer bindings retryable.
        const rendererStop = await stopRendererPtys()
        if (rendererStop.failure) {
          settlePartialRendererStop(rendererStop.stoppedPtyIds)
          throw rendererStop.failure.reason
        }
      } catch (err) {
        if (!partialRendererStopSettled) {
          rollbackShutdown()
        }
        throw err
      }
    }

    if (expectedRuntimePtyIds.length > 0) {
      if (!runtimeEnvironmentId) {
        throw new Error('missing_runtime_for_exact_terminal_stop')
      }
      markShutdownPending()
      handlerSnapshots = unregisterPtyDataHandlers(rendererShutdownPtyIds) ?? []
      let stopResult: {
        stoppedPtyIds?: string[]
        livePtyIds?: string[]
        postStopVerified?: boolean
        postStopFailure?: string
        remainingLivePtyIds?: string[]
      }
      try {
        stopResult = await callRuntimeRpc<{
          stoppedPtyIds?: string[]
          livePtyIds?: string[]
        }>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'terminal.stopExact',
          {
            worktree: toRuntimeWorktreeSelector(worktreeId),
            expectedPtyIds: expectedRuntimePtyIds,
            keepHistory: keepIdentifiers
          },
          { timeoutMs: 15_000 }
        )
      } catch (err) {
        rollbackShutdown()
        throw err
      }
      const stoppedPtyIds = sortedUniquePtyIds(stopResult.stoppedPtyIds)
      const livePtyIds = sortedUniquePtyIds(stopResult.livePtyIds)
      if (
        !equalStringSets(stoppedPtyIds, expectedRuntimePtyIds) ||
        !equalStringSets(livePtyIds, expectedRuntimePtyIds)
      ) {
        rollbackShutdown()
        throw new Error('exact_terminal_stop_mismatch')
      }
      if (stopResult.postStopVerified !== true) {
        rollbackShutdown()
        throw new Error(stopResult.postStopFailure ?? 'exact_terminal_stop_unverified')
      }
      try {
        const rendererStop = await stopRendererPtys()
        if (rendererStop.failure) {
          settlePartialRendererStop(rendererStop.stoppedPtyIds)
          throw rendererStop.failure.reason
        }
      } catch (err) {
        if (!partialRendererStopSettled) {
          rollbackShutdown()
        }
        throw err
      }
    }

    for (const snapshot of handlerSnapshots) {
      snapshot.commit?.()
    }
    noteCommittedPtyShutdownSettlements(exitGuardPtyIds)

    set((s) => {
      const nextTabsByWorktree = keepIdentifiers
        ? s.tabsByWorktree
        : {
            ...s.tabsByWorktree,
            [worktreeId]: (s.tabsByWorktree[worktreeId] ?? []).map((tab, index) =>
              clearTransientTerminalState(tab, index)
            )
          }
      const nextPtyIdsByTabId = {
        ...s.ptyIdsByTabId,
        ...Object.fromEntries(tabs.map((tab) => [tab.id, [] as string[]] as const))
      }
      const nextRuntimePaneTitlesByTabId = keepIdentifiers
        ? s.runtimePaneTitlesByTabId
        : { ...s.runtimePaneTitlesByTabId }
      const nextSuppressedPtyExitIds = {
        ...s.suppressedPtyExitIds,
        ...Object.fromEntries(exitGuardPtyIds.map((ptyId) => [ptyId, true] as const))
      }
      const nextPendingPtyShutdownIds = { ...s.pendingPtyShutdownIds }
      for (const ptyId of exitGuardPtyIds) {
        const remainingOwners = (nextPendingPtyShutdownIds[ptyId] ?? 0) - 1
        if (remainingOwners > 0) {
          nextPendingPtyShutdownIds[ptyId] = remainingOwners
        } else {
          delete nextPendingPtyShutdownIds[ptyId]
        }
      }
      // Why: keep pendingCodexPaneRestartIds (same ptyId survives sleep→wake), but clear codexRestartNoticeByPtyId since wake's post-spawn ptyId may differ.
      const nextPendingCodexPaneRestartIds = keepIdentifiers
        ? s.pendingCodexPaneRestartIds
        : { ...s.pendingCodexPaneRestartIds }
      const nextCodexRestartNoticeByPtyId = { ...s.codexRestartNoticeByPtyId }
      for (const ptyId of exitGuardPtyIds) {
        if (!keepIdentifiers) {
          delete nextPendingCodexPaneRestartIds[ptyId]
        }
        delete nextCodexRestartNoticeByPtyId[ptyId]
      }
      // Why: setup-split and issue-command-split are transient new-tab one-shots, not sleep-recovery state; clear in both cases.
      const nextPendingSetupSplitByTabId = { ...s.pendingSetupSplitByTabId }
      const nextPendingIssueCommandSplitByTabId = { ...s.pendingIssueCommandSplitByTabId }
      // Why: remove-worktree must clear ptyIdsByLeafId (dead IDs → zombie reattach pane on remount); sleep preserves it so wake can reattach via pty.spawn.
      const nextTerminalLayoutsByTabId = { ...s.terminalLayoutsByTabId }
      // Why: unread dots survive worktree switches, but shutdown/sleep both kill the PTYs behind them, so dead-ptyId unread state is stale — clear in both.
      // Why: preserve the unreadTerminalTabs reference when no shutting-down tab was unread, avoiding a no-op state allocation that re-evaluates selectors.
      let nextUnreadTerminalTabs = s.unreadTerminalTabs
      let nextUnreadTerminalPanes = s.unreadTerminalPanes
      let nextUnreadAgentCompletionPanes = s.unreadAgentCompletionPanes
      let nextLastTerminalInputAtByPaneKey = s.lastTerminalInputAtByPaneKey
      for (const tab of tabs) {
        if (!keepIdentifiers) {
          delete nextRuntimePaneTitlesByTabId[tab.id]
        }
        delete nextPendingSetupSplitByTabId[tab.id]
        delete nextPendingIssueCommandSplitByTabId[tab.id]
        if (nextUnreadTerminalTabs[tab.id]) {
          if (nextUnreadTerminalTabs === s.unreadTerminalTabs) {
            nextUnreadTerminalTabs = { ...s.unreadTerminalTabs }
          }
          delete nextUnreadTerminalTabs[tab.id]
        }
        for (const paneKey of Object.keys(nextUnreadTerminalPanes)) {
          if (paneKey.startsWith(`${tab.id}:`)) {
            if (nextUnreadTerminalPanes === s.unreadTerminalPanes) {
              nextUnreadTerminalPanes = { ...s.unreadTerminalPanes }
            }
            delete nextUnreadTerminalPanes[paneKey]
          }
        }
        for (const paneKey of Object.keys(nextUnreadAgentCompletionPanes)) {
          if (paneKey.startsWith(`${tab.id}:`)) {
            if (nextUnreadAgentCompletionPanes === s.unreadAgentCompletionPanes) {
              nextUnreadAgentCompletionPanes = { ...s.unreadAgentCompletionPanes }
            }
            delete nextUnreadAgentCompletionPanes[paneKey]
          }
        }
        for (const paneKey of Object.keys(nextLastTerminalInputAtByPaneKey)) {
          if (paneKey.startsWith(`${tab.id}:`)) {
            if (nextLastTerminalInputAtByPaneKey === s.lastTerminalInputAtByPaneKey) {
              nextLastTerminalInputAtByPaneKey = { ...s.lastTerminalInputAtByPaneKey }
            }
            delete nextLastTerminalInputAtByPaneKey[paneKey]
          }
        }
        if (!keepIdentifiers) {
          const existingLayout = nextTerminalLayoutsByTabId[tab.id]
          if (existingLayout?.ptyIdsByLeafId) {
            nextTerminalLayoutsByTabId[tab.id] = {
              ...existingLayout,
              ptyIdsByLeafId: {}
            }
          }
        }
      }

      // Why: remove-worktree kills the relay PTY, so a persisted session ID would fail reattach; sleep preserves it for wake's re-spawn over the relay.
      const nextLastKnownRelay = keepIdentifiers
        ? s.lastKnownRelayPtyIdByTabId
        : { ...s.lastKnownRelayPtyIdByTabId }
      if (!keepIdentifiers) {
        for (const tab of tabs) {
          delete nextLastKnownRelay[tab.id]
        }
      }

      return {
        tabsByWorktree: nextTabsByWorktree,
        ptyIdsByTabId: nextPtyIdsByTabId,
        lastKnownRelayPtyIdByTabId: nextLastKnownRelay,
        runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId,
        suppressedPtyExitIds: nextSuppressedPtyExitIds,
        pendingPtyShutdownIds: nextPendingPtyShutdownIds,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds,
        codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId,
        pendingSetupSplitByTabId: nextPendingSetupSplitByTabId,
        pendingIssueCommandSplitByTabId: nextPendingIssueCommandSplitByTabId,
        terminalLayoutsByTabId: nextTerminalLayoutsByTabId,
        // Why: skip writing unreadTerminalTabs when unchanged to avoid a no-op state allocation that re-evaluates full-state selectors. Mirrors tabs.ts.
        ...(nextUnreadTerminalTabs !== s.unreadTerminalTabs
          ? { unreadTerminalTabs: nextUnreadTerminalTabs }
          : {}),
        ...(nextUnreadTerminalPanes !== s.unreadTerminalPanes
          ? { unreadTerminalPanes: nextUnreadTerminalPanes }
          : {}),
        ...(nextUnreadAgentCompletionPanes !== s.unreadAgentCompletionPanes
          ? { unreadAgentCompletionPanes: nextUnreadAgentCompletionPanes }
          : {}),
        ...(nextLastTerminalInputAtByPaneKey !== s.lastTerminalInputAtByPaneKey
          ? { lastTerminalInputAtByPaneKey: nextLastTerminalInputAtByPaneKey }
          : {})
      }
    })

    if (keepIdentifiers) {
      set((s) => {
        const base =
          shutdownReason === 'manual-sleep'
            ? removeSleepingRecordsReplacedByManualWorktreeSleep(
                s.sleepingAgentSessionsByPaneKey,
                worktreeId,
                opts?.sleepingPaneKeys
              ).records
            : s.sleepingAgentSessionsByPaneKey
        return {
          sleepingAgentSessionsByPaneKey: {
            ...base,
            ...sleepingAgentSessionRecords
          }
        }
      })
    } else {
      get().clearSleepingAgentSessionsByWorktree(worktreeId)
    }

    // Why: only automatic completed-agent sleep keeps passive completion evidence; manual sleep/remove fold the whole worktree surface.
    get().dropAgentStatusByWorktree(worktreeId, {
      shutdownReason,
      sleepingPaneKeys: opts?.sleepingPaneKeys,
      retainedCompletionEvidence
    })
    get().clearPaneForegroundAgentByWorktree(worktreeId)
    const settledPtyIds = exitGuardPtyIds.filter((ptyId) => !get().isPtyShutdownPending(ptyId))
    markCommittedPtyShutdowns(settledPtyIds)
    settleDeferredPtyShutdownExits(settledPtyIds, 'committed')
    clearCommittedPtyShutdownSettlements(settledPtyIds)
  },
  }
}
