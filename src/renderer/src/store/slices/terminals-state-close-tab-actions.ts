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
import type { SessionOptionValue } from '../../../../shared/agent-session-option-types'
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
export function createTerminalSliceCloseTabActions3(set: SliceSet, get: SliceGet) {
  return {
  closeTab: (tabId, opts) => {
    const closeReason = opts?.reason ?? 'user'
    const retiresSession = closeReason === 'user' || closeReason === 'cleanup'
    const retirementPlan =
      opts?.precomputedRetirementPlan?.tabId === tabId
        ? opts.precomputedRetirementPlan
        : buildTerminalTabRetirementPlan(get(), tabId)
    let closingWorktreeId: string | null = null

    // Why: a parked tab has no mounted TerminalPane cleanup, so revoke its observer/candidate state before provider exit races.
    retireParkedTerminalTab(tabId)
    if (retiresSession) {
      const fallbackWorktreeRoute = retirementPlan.worktreeId
        ? resolveTerminalWorktreeRoute(get(), retirementPlan.worktreeId)
        : { runtimeEnvironmentId: null }
      const retirementTasks: Promise<unknown>[] = opts?.localPtyTeardownOwnedExternally
        ? []
        : retirementPlan.localOrSshPtyIds.map(async (ptyId) => window.api.pty.kill(ptyId))
      const localOrSshTaskCount = retirementTasks.length
      if (!opts?.remoteCloseOwnedByHost) {
        for (const terminal of retirementPlan.runtimeTerminals) {
          if (!terminal.environmentId && !fallbackWorktreeRoute) {
            continue
          }
          const environmentId =
            terminal.environmentId ?? fallbackWorktreeRoute?.runtimeEnvironmentId
          retirementTasks.push(
            callRuntimeRpc(
              environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
              'terminal.close',
              { terminal: terminal.handle }
            )
          )
        }
      }
      if (retirementPlan.unroutablePtyIds.length > 0) {
        // Why: log the worktree SHAPE, never the id — worktree ids embed absolute paths. The old
        // "runtime handles" wording described ids that are usually plain local ones, hiding STA-2639.
        console.warn('[terminal-retirement] skipped PTYs with no resolvable owner', {
          tabId,
          worktreeKind: classifyTerminalRetirementWorktree(retirementPlan.worktreeId),
          count: retirementPlan.unroutablePtyIds.length
        })
      }
      // Why: keep close synchronous and idempotent — provider failures must not reject into the UI or block ownership revocation.
      void Promise.allSettled(retirementTasks).then((results) => {
        const localOrSshFailures = results
          .slice(0, localOrSshTaskCount)
          .filter((result) => result.status === 'rejected').length
        const runtimeFailures = results
          .slice(localOrSshTaskCount)
          .filter((result) => result.status === 'rejected').length
        if (localOrSshFailures > 0 || runtimeFailures > 0) {
          console.warn('[terminal-retirement] provider teardown failed', {
            tabId,
            localOrSshFailures,
            runtimeFailures
          })
        }
      })
    }

    set((s) => {
      const next = { ...s.tabsByWorktree }
      let closedTab: TerminalTab | null = null
      let closedWorktreeId: string | null = null
      for (const wId of Object.keys(next)) {
        const before = next[wId]
        const closing = before.find((t) => t.id === tabId)
        if (closing) {
          closingWorktreeId = wId
          // Why: capture the first-matched tab's snapshot for the Cmd+Shift+T reopen stack (see capturedSnapshot below).
          if (!closedTab) {
            closedTab = closing
            closedWorktreeId = wId
          }
        }
        const after = before.filter((t) => t.id !== tabId)
        if (after.length !== before.length) {
          next[wId] = after
        }
      }
      // Why: only explicit user closes feed the Cmd+Shift+T reopen stack; cleanup/PTY-exit closes must not pollute undo history.
      const capturedSnapshot =
        closeReason === 'user' &&
        opts?.captureRecentlyClosed !== false &&
        closedTab &&
        closedWorktreeId
          ? {
              ...(closedTab.startupCwd ? { startupCwd: closedTab.startupCwd } : {}),
              ...(closedTab.shellOverride ? { shellOverride: closedTab.shellOverride } : {}),
              ...(closedTab.customTitle ? { customTitle: closedTab.customTitle } : {}),
              ...(closedTab.color ? { color: closedTab.color } : {})
            }
          : null
      const nextExpanded = { ...s.expandedPaneByTabId }
      delete nextExpanded[tabId]
      const nextCanExpand = { ...s.canExpandPaneByTabId }
      delete nextCanExpand[tabId]
      const nextLayouts = { ...s.terminalLayoutsByTabId }
      delete nextLayouts[tabId]
      const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
      delete nextPtyIdsByTabId[tabId]
      const nextLastKnownRelay = { ...s.lastKnownRelayPtyIdByTabId }
      delete nextLastKnownRelay[tabId]
      const nextDeferredSshSessionIdsByTabId = { ...s.deferredSshSessionIdsByTabId }
      delete nextDeferredSshSessionIdsByTabId[tabId]
      const nextPendingReconnectPtyIdByTabId = { ...s.pendingReconnectPtyIdByTabId }
      delete nextPendingReconnectPtyIdByTabId[tabId]
      const nextRuntimePaneTitlesByTabId = { ...s.runtimePaneTitlesByTabId }
      delete nextRuntimePaneTitlesByTabId[tabId]
      const nextDirectSshPaneRetryByTabId = { ...s.directSshPaneRetryByTabId }
      delete nextDirectSshPaneRetryByTabId[tabId]
      const nextDirectSshLivePtyBindingByTabId = {
        ...s.directSshLivePtyBindingByTabId
      }
      delete nextDirectSshLivePtyBindingByTabId[tabId]
      const nextDirectSshPaneRetryHistoryByTabId = {
        ...s.directSshPaneRetryHistoryByTabId
      }
      delete nextDirectSshPaneRetryHistoryByTabId[tabId]
      // Why: keep the same reference when the closing tab had no unread flag, so unrelated closes don't force full-state selector re-eval.
      let nextUnreadTerminalTabs = s.unreadTerminalTabs
      if (s.unreadTerminalTabs[tabId]) {
        nextUnreadTerminalTabs = { ...s.unreadTerminalTabs }
        delete nextUnreadTerminalTabs[tabId]
      }
      let nextUnreadTerminalPanes = s.unreadTerminalPanes
      for (const paneKey of Object.keys(s.unreadTerminalPanes)) {
        if (paneKey.startsWith(`${tabId}:`)) {
          if (nextUnreadTerminalPanes === s.unreadTerminalPanes) {
            nextUnreadTerminalPanes = { ...s.unreadTerminalPanes }
          }
          delete nextUnreadTerminalPanes[paneKey]
        }
      }
      let nextUnreadAgentCompletionPanes = s.unreadAgentCompletionPanes
      for (const paneKey of Object.keys(s.unreadAgentCompletionPanes)) {
        if (paneKey.startsWith(`${tabId}:`)) {
          if (nextUnreadAgentCompletionPanes === s.unreadAgentCompletionPanes) {
            nextUnreadAgentCompletionPanes = { ...s.unreadAgentCompletionPanes }
          }
          delete nextUnreadAgentCompletionPanes[paneKey]
        }
      }
      const nextLastTerminalInputAtByPaneKey = { ...s.lastTerminalInputAtByPaneKey }
      for (const paneKey of Object.keys(nextLastTerminalInputAtByPaneKey)) {
        if (paneKey.startsWith(`${tabId}:`)) {
          delete nextLastTerminalInputAtByPaneKey[paneKey]
        }
      }
      const nextSleepingAgentSessionsByPaneKey = retiresSession
        ? removeSleepingAgentSessionsForTab(s.sleepingAgentSessionsByPaneKey, tabId)
        : s.sleepingAgentSessionsByPaneKey
      const nextPendingStartupByTabId = { ...s.pendingStartupByTabId }
      delete nextPendingStartupByTabId[tabId]
      const nextAutomaticAgentResumeClaimsByTabId = { ...s.automaticAgentResumeClaimsByTabId }
      delete nextAutomaticAgentResumeClaimsByTabId[tabId]
      const nextPendingInitialCwdByTabId = { ...s.pendingInitialCwdByTabId }
      delete nextPendingInitialCwdByTabId[tabId]
      const nextPendingSetupSplitByTabId = { ...s.pendingSetupSplitByTabId }
      delete nextPendingSetupSplitByTabId[tabId]
      const nextPendingIssueCommandSplitByTabId = { ...s.pendingIssueCommandSplitByTabId }
      delete nextPendingIssueCommandSplitByTabId[tabId]
      const nextCacheTimer = { ...s.cacheTimerByKey }
      // Why: cache timer keys are `${tabId}:${leafId}` composites; remove all entries for the closing tab.
      for (const key of Object.keys(nextCacheTimer)) {
        if (key.startsWith(`${tabId}:`)) {
          delete nextCacheTimer[key]
        }
      }
      // Why: keep activeTabIdByWorktree in sync when closing a background-worktree tab, else the stale remembered tab falls back to tabs[0] on switch.
      const nextActiveTabIdByWorktree = { ...s.activeTabIdByWorktree }
      for (const [wId, tabs] of Object.entries(next)) {
        if (nextActiveTabIdByWorktree[wId] === tabId) {
          nextActiveTabIdByWorktree[wId] = tabs[0]?.id ?? null
        }
      }

      // Why: keep tabBarOrderByWorktree in sync so stale terminal IDs don't linger and shift positions on later tab operations.
      const nextTabBarOrderByWorktree: Record<string, string[]> = {
        ...s.tabBarOrderByWorktree
      }
      for (const wId of Object.keys(nextTabBarOrderByWorktree)) {
        const order = nextTabBarOrderByWorktree[wId]
        if (order?.includes(tabId)) {
          nextTabBarOrderByWorktree[wId] = order.filter((entryId) => entryId !== tabId)
        }
      }

      // Why: clean up unconsumed snapshot/cold-restore data (e.g. tab closed before TerminalPane mounted) to prevent unbounded store growth across restarts.
      let nextSnapshots = s.pendingSnapshotByPtyId
      let nextColdRestores = s.pendingColdRestoreByPtyId
      const closingPtyIds = new Set([
        ...retirementPlan.localOrSshPtyIds,
        ...retirementPlan.runtimeTerminals.map((terminal) => terminal.ptyId),
        ...retirementPlan.cleanupOnlyPtyIds,
        ...retirementPlan.unroutablePtyIds
      ])
      for (const closingId of closingPtyIds) {
        if (closingId in nextSnapshots) {
          nextSnapshots = { ...nextSnapshots }
          delete nextSnapshots[closingId]
        }
        if (closingId in nextColdRestores) {
          nextColdRestores = { ...nextColdRestores }
          delete nextColdRestores[closingId]
        }
      }

      return {
        tabsByWorktree: next,
        activeTabId: s.activeTabId === tabId ? null : s.activeTabId,
        activeTabIdByWorktree: nextActiveTabIdByWorktree,
        ptyIdsByTabId: nextPtyIdsByTabId,
        lastKnownRelayPtyIdByTabId: nextLastKnownRelay,
        deferredSshSessionIdsByTabId: nextDeferredSshSessionIdsByTabId,
        pendingReconnectPtyIdByTabId: nextPendingReconnectPtyIdByTabId,
        runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId,
        directSshPaneRetryByTabId: nextDirectSshPaneRetryByTabId,
        directSshLivePtyBindingByTabId: nextDirectSshLivePtyBindingByTabId,
        directSshPaneRetryHistoryByTabId: nextDirectSshPaneRetryHistoryByTabId,
        ...(nextSleepingAgentSessionsByPaneKey !== s.sleepingAgentSessionsByPaneKey
          ? { sleepingAgentSessionsByPaneKey: nextSleepingAgentSessionsByPaneKey }
          : {}),
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
        lastTerminalInputAtByPaneKey: nextLastTerminalInputAtByPaneKey,
        expandedPaneByTabId: nextExpanded,
        canExpandPaneByTabId: nextCanExpand,
        terminalLayoutsByTabId: nextLayouts,
        pendingStartupByTabId: nextPendingStartupByTabId,
        automaticAgentResumeClaimsByTabId: nextAutomaticAgentResumeClaimsByTabId,
        pendingInitialCwdByTabId: nextPendingInitialCwdByTabId,
        pendingSetupSplitByTabId: nextPendingSetupSplitByTabId,
        pendingIssueCommandSplitByTabId: nextPendingIssueCommandSplitByTabId,
        cacheTimerByKey: nextCacheTimer,
        tabBarOrderByWorktree: nextTabBarOrderByWorktree,
        pendingSnapshotByPtyId: nextSnapshots,
        pendingColdRestoreByPtyId: nextColdRestores,
        ...(capturedSnapshot && closedWorktreeId
          ? {
              recentlyClosedTerminalTabsByWorktree: pushClosedTerminalTabSnapshot(
                s.recentlyClosedTerminalTabsByWorktree,
                closedWorktreeId,
                capturedSnapshot
              ),
              recentlyClosedTabKindsByWorktree: pushRecentlyClosedTabKind(
                s.recentlyClosedTabKindsByWorktree,
                closedWorktreeId,
                'terminal'
              )
            }
          : {})
      }
    })
    // Why: closing a tab sweeps live and retained agent-status for it; use dropAgentStatusByTabPrefix so retention suppressors block a same-frame live→gone re-snapshot.
    // Why: Pi can leave a completed row keyed under an already-missing tab id; pass the worktree to sweep that orphan while preserving active pre-render child rows.
    get().dropAgentStatusByTabPrefix(
      tabId,
      closingWorktreeId ? { worktreeId: closingWorktreeId } : undefined
    )
    // Why: retired pane keys never recur, so stranded foreground entries would accumulate for the renderer's whole lifetime.
    get().clearPaneForegroundAgentByTabPrefix(tabId)
    // Why: closing a tab permanently retires its panes (reopen mints a fresh leafId), so drop hibernation output epochs to keep the module map from growing forever.
    forgetAgentHibernationTabOutput(tabId)
    // Why: same rationale — retired tab ids never recur, so drop the foreground last-seen and consumed agent-startup delivery guards.
    forgetForegroundTerminalTabs([tabId])
    forgetAgentStartupDeliveriesForTabs([tabId])
    for (const tabs of Object.values(get().unifiedTabsByWorktree)) {
      const workspaceItem = tabs.find(
        (entry) => entry.contentType === 'terminal' && entry.entityId === tabId
      )
      if (workspaceItem) {
        get().closeUnifiedTab(workspaceItem.id, {
          recordInteraction: opts?.recordInteraction,
          terminalRetirementHandled: true
        })
      }
    }
  },
  }
}
