/* import type { StateCreator } from 'zustand'
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
export function createTerminalSliceShutdownCompletedAgentPaneForHibernationActions8(set: SliceSet, get: SliceGet) {
  return {
  shutdownCompletedAgentPaneForHibernation: async (worktreeId, opts) => {
    const paneKeys = [opts.paneKey]
    const expectedRuntimePtyIds = sortedUniquePtyIds(
      opts.expectedRuntimePtyId ? [opts.expectedRuntimePtyId] : []
    )
    const rendererShutdownPtyIds = [opts.ptyId]
    const state = get()
    const runtimeEnvironmentId = resolveTerminalStopRuntimeEnvironmentId(state, worktreeId)
    // Why: pane transports emit renderer PTY ids, not raw exact-stop handles; guard only the identity that can deliver an exit callback.
    const exitGuardPtyIds = [opts.ptyId]
    const tab = (state.tabsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === opts.tabId
    )
    const parsed = parsePaneKey(opts.paneKey)
    const layout = state.terminalLayoutsByTabId[opts.tabId]
    const liveTabPtyIds = state.ptyIdsByTabId[opts.tabId] ?? []
    if (
      !tab ||
      !parsed ||
      parsed.tabId !== opts.tabId ||
      parsed.leafId !== opts.leafId ||
      layout?.ptyIdsByLeafId?.[opts.leafId] !== opts.ptyId ||
      (expectedRuntimePtyIds.length === 0 && !liveTabPtyIds.includes(opts.ptyId))
    ) {
      throw new Error('agent_hibernation_pane_binding_mismatch')
    }

    const sleepingAgentSessionRecords = collectSleepingAgentSessionRecordsForWorktree(
      state,
      worktreeId,
      {
        paneKeys,
        captureMode: 'completed-agent-hibernation'
      }
    )
    const retainedCompletionEvidence = collectHibernatedCompletionEvidenceForWorktree(
      state,
      worktreeId,
      paneKeys
    )
    if (!sleepingAgentSessionRecords[opts.paneKey]) {
      // Why: killing the PTY with no persisted resume record strands the pane unwakeable; abort instead of hibernating unrecoverably.
      throw new Error('agent_hibernation_capture_missing')
    }

    const capture = shutdownBufferCaptures.get(opts.tabId)
    if (capture) {
      try {
        capture({ includeLocalBuffers: false })
      } catch {
        // Don't let one tab's capture failure block the pane hibernation.
      }
    }

    // Why: pty:exit can reach the renderer before the kill promise resolves, so the sleeping record must be in the store before the kill (and rolled back on failure).
    const sleepingRecordKeys = Object.keys(sleepingAgentSessionRecords)
    const replacedSleepingRecords: Record<string, (typeof sleepingAgentSessionRecords)[string]> = {}
    for (const key of sleepingRecordKeys) {
      const existing = state.sleepingAgentSessionsByPaneKey[key]
      if (existing) {
        replacedSleepingRecords[key] = existing
      }
    }

    const rollbackTargetShutdownState = (): void => {
      set((s) => {
        const next = { ...s.suppressedPtyExitIds }
        for (const ptyId of exitGuardPtyIds) {
          delete next[ptyId]
        }
        const nextSleeping = { ...s.sleepingAgentSessionsByPaneKey }
        for (const key of sleepingRecordKeys) {
          const replaced = replacedSleepingRecords[key]
          if (replaced) {
            nextSleeping[key] = replaced
          } else {
            delete nextSleeping[key]
          }
        }
        return { suppressedPtyExitIds: next, sleepingAgentSessionsByPaneKey: nextSleeping }
      })
    }

    set((s) => ({
      suppressedPtyExitIds: {
        ...s.suppressedPtyExitIds,
        ...Object.fromEntries(exitGuardPtyIds.map((ptyId) => [ptyId, true] as const))
      },
      sleepingAgentSessionsByPaneKey: {
        ...s.sleepingAgentSessionsByPaneKey,
        ...sleepingAgentSessionRecords
      }
    }))

    if (expectedRuntimePtyIds.length > 0) {
      if (!runtimeEnvironmentId) {
        rollbackTargetShutdownState()
        throw new Error('missing_runtime_for_exact_terminal_stop')
      }
      let stopResult: {
        stoppedPtyIds?: string[]
        livePtyIds?: string[]
        postStopVerified?: boolean
        postStopFailure?: string
      }
      try {
        stopResult = await callRuntimeRpc<{
          stoppedPtyIds?: string[]
          livePtyIds?: string[]
          postStopVerified?: boolean
          postStopFailure?: string
        }>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'terminal.stopExact',
          {
            worktree: toRuntimeWorktreeSelector(worktreeId),
            expectedPtyIds: expectedRuntimePtyIds,
            keepHistory: true,
            targetOnly: true
          },
          { timeoutMs: 15_000 }
        )
      } catch (err) {
        rollbackTargetShutdownState()
        throw err
      }
      const stoppedPtyIds = sortedUniquePtyIds(stopResult.stoppedPtyIds)
      const livePtyIds = sortedUniquePtyIds(stopResult.livePtyIds)
      const targetWasLive = expectedRuntimePtyIds.every((ptyId) => livePtyIds.includes(ptyId))
      if (!equalStringSets(stoppedPtyIds, expectedRuntimePtyIds) || !targetWasLive) {
        rollbackTargetShutdownState()
        throw new Error('exact_terminal_stop_mismatch')
      }
      if (stopResult.postStopVerified !== true) {
        rollbackTargetShutdownState()
        throw new Error(stopResult.postStopFailure ?? 'exact_terminal_stop_unverified')
      }
      for (const snapshot of unregisterPtyDataHandlers(rendererShutdownPtyIds) ?? []) {
        snapshot.commit?.()
      }
    } else if (!opts.ptyId.startsWith('remote:')) {
      // Why: pty.kill can flush final data before exit; unregister first so stale handlers can't fire phantom notifications during hibernation.
      const handlerSnapshots = unregisterPtyDataHandlers(rendererShutdownPtyIds) ?? []
      try {
        await window.api.pty.kill(opts.ptyId, { keepHistory: true })
      } catch (err) {
        restorePtyDataHandlersAfterFailedShutdown(handlerSnapshots)
        rollbackTargetShutdownState()
        throw err
      }
      for (const snapshot of handlerSnapshots) {
        snapshot.commit?.()
      }
    }

    set((s) => {
      const existingPtyIds = s.ptyIdsByTabId[opts.tabId] ?? []
      const shutdownPtyIdSet = new Set(rendererShutdownPtyIds)
      const remainingPtyIds = existingPtyIds.filter((ptyId) => !shutdownPtyIdSet.has(ptyId))
      const nextTabsByWorktree = { ...s.tabsByWorktree }
      const tabs = nextTabsByWorktree[worktreeId] ?? []
      const tabIndex = tabs.findIndex((candidate) => candidate.id === opts.tabId)
      if (tabIndex !== -1) {
        const nextTabs = [...tabs]
        nextTabs[tabIndex] = {
          ...nextTabs[tabIndex],
          ptyId: remainingPtyIds.at(-1) ?? null
        }
        nextTabsByWorktree[worktreeId] = nextTabs
      }

      const nextCodexRestartNoticeByPtyId = { ...s.codexRestartNoticeByPtyId }
      for (const ptyId of exitGuardPtyIds) {
        delete nextCodexRestartNoticeByPtyId[ptyId]
      }
      const nextLastKnownRelay =
        remainingPtyIds.length === 0
          ? { ...s.lastKnownRelayPtyIdByTabId }
          : s.lastKnownRelayPtyIdByTabId
      if (remainingPtyIds.length === 0) {
        delete nextLastKnownRelay[opts.tabId]
      }

      let nextRuntimePaneTitlesByTabId = s.runtimePaneTitlesByTabId
      const numericPaneId = Number(opts.leafId)
      if (
        Number.isInteger(numericPaneId) &&
        s.runtimePaneTitlesByTabId[opts.tabId]?.[numericPaneId]
      ) {
        const nextByPane = { ...s.runtimePaneTitlesByTabId[opts.tabId] }
        delete nextByPane[numericPaneId]
        nextRuntimePaneTitlesByTabId = { ...s.runtimePaneTitlesByTabId }
        if (Object.keys(nextByPane).length > 0) {
          nextRuntimePaneTitlesByTabId[opts.tabId] = nextByPane
        } else {
          delete nextRuntimePaneTitlesByTabId[opts.tabId]
        }
      }

      const nextUnreadTerminalPanes = { ...s.unreadTerminalPanes }
      const nextUnreadAgentCompletionPanes = { ...s.unreadAgentCompletionPanes }
      const nextLastTerminalInputAtByPaneKey = { ...s.lastTerminalInputAtByPaneKey }
      delete nextUnreadTerminalPanes[opts.paneKey]
      delete nextUnreadAgentCompletionPanes[opts.paneKey]
      delete nextLastTerminalInputAtByPaneKey[opts.paneKey]

      return {
        tabsByWorktree: nextTabsByWorktree,
        ptyIdsByTabId: {
          ...s.ptyIdsByTabId,
          [opts.tabId]: remainingPtyIds
        },
        lastKnownRelayPtyIdByTabId: nextLastKnownRelay,
        suppressedPtyExitIds: {
          ...s.suppressedPtyExitIds,
          ...Object.fromEntries(exitGuardPtyIds.map((ptyId) => [ptyId, true] as const))
        },
        codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId,
        ...(nextRuntimePaneTitlesByTabId !== s.runtimePaneTitlesByTabId
          ? { runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId }
          : {}),
        unreadTerminalPanes: nextUnreadTerminalPanes,
        unreadAgentCompletionPanes: nextUnreadAgentCompletionPanes,
        lastTerminalInputAtByPaneKey: nextLastTerminalInputAtByPaneKey
      }
    })

    get().dropHibernatedAgentStatusPane(worktreeId, opts.paneKey, {
      retainedCompletionEvidence
    })
  },
  clearDirectSshTargetPtyBindings: (targetId) => {
    let clearedCount = 0
    set((s) => {
      const result = clearDirectSshTerminalBindings(s, resolveDirectSshTerminalKeys(s, targetId))
      clearedCount = result.clearedCount
      return result.patch ?? s
    })
    return clearedCount
  },
  invalidateStaleDirectSshTargetPtyBindings: (authority) => {
    let clearedCount = 0
    set((s) => {
      if (!isCurrentDirectSshAuthority(s, authority)) {
        return s
      }
      const result = invalidateStaleDirectSshTerminalBindings(
        s,
        resolveDirectSshTerminalKeys(s, authority.targetId),
        authority
      )
      clearedCount = result.clearedCount
      return result.patch ?? s
    })
    return clearedCount
  },
  retryDirectSshTargetPanes: (authority, now = Date.now()) => {
    let retriedCount = 0
    set((s) => {
      if (!isCurrentDirectSshAuthority(s, authority)) {
        return s
      }
      const result = retryDirectSshTerminalPanes(
        s,
        resolveDirectSshTerminalKeys(s, authority.targetId),
        authority,
        now
      )
      retriedCount = result.retriedCount
      return result.patch ?? s
    })
    return retriedCount
  },
  }
}