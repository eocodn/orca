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
export function createTerminalSliceTabsByWorktreeActions(set: SliceSet, get: SliceGet) {
  return {
  tabsByWorktree: {},
  activeTabId: null,
  activeTabIdByWorktree: {},
  ptyIdsByTabId: {},
  runtimePaneTitlesByTabId: {},
  unreadTerminalTabs: {},
  unreadTerminalPanes: {},
  unreadAgentCompletionPanes: {},
  suppressedPtyExitIds: {},
  pendingPtyShutdownIds: {},
  pendingCodexPaneRestartIds: {},
  codexRestartNoticeByPtyId: {},
  directSshPaneRetryByTabId: {},
  directSshLivePtyBindingByTabId: {},
  directSshPaneRetryHistoryByTabId: {},
  expandedPaneByTabId: {},
  canExpandPaneByTabId: {},
  terminalLayoutsByTabId: {},
  pendingStartupByTabId: {},
  pendingInitialCwdByTabId: {},
  pendingSetupSplitByTabId: {},
  pendingIssueCommandSplitByTabId: {},
  automaticAgentResumeClaimsByTabId: {},
  nativeChatLaunchPromptByTabId: {},
  nativeChatLaunchDraftByTabId: {},
  tabBarOrderByWorktree: {},
  workspaceSessionReady: false,
  restoredRuntimeHostIdByWorkspaceSessionKey: {},
  defaultTerminalTabsAppliedByWorktreeId: {},
  markDefaultTerminalTabsApplied: (worktreeId) =>
    set((s) => {
      if (s.defaultTerminalTabsAppliedByWorktreeId[worktreeId]) {
        return {}
      }
      return {
        defaultTerminalTabsAppliedByWorktreeId: {
          ...s.defaultTerminalTabsAppliedByWorktreeId,
          [worktreeId]: true
        }
      }
    }),
  hydrationSucceeded: false,
  setHydrationSucceeded: (value) => {
    set({ hydrationSucceeded: value })
  },
  pendingReconnectWorktreeIds: [],
  pendingReconnectTabByWorktree: {},
  pendingReconnectPtyIdByTabId: {},
  lastKnownRelayPtyIdByTabId: {},
  pendingSnapshotByPtyId: {},
  pendingColdRestoreByPtyId: {},
  deferredSshReconnectTargets: [],
  deferredSshSessionIdsByTabId: {},
  cacheTimerByKey: {},
  lastTerminalInputAtByPaneKey: {},
  recentQuickCommandIdByGroup: {},
  setRecentQuickCommandForGroup: (groupId, quickCommandId) => {
    set((s) => ({
      recentQuickCommandIdByGroup: {
        ...s.recentQuickCommandIdByGroup,
        [groupId]: quickCommandId
      }
    }))
  },
  claimAutomaticAgentResume: (tabId, claim) => {
    set((s) => ({
      automaticAgentResumeClaimsByTabId: {
        ...s.automaticAgentResumeClaimsByTabId,
        [tabId]: claim
      }
    }))
  },
  seedNativeChatLaunchPrompt: (prompt) => {
    set((s) => ({
      nativeChatLaunchPromptByTabId: {
        ...s.nativeChatLaunchPromptByTabId,
        [prompt.tabId]: prompt
      }
    }))
  },
  markNativeChatLaunchPromptFailed: (tabId) => {
    set((s) => {
      const current = s.nativeChatLaunchPromptByTabId[tabId]
      if (!current || current.failed) {
        return {}
      }
      return {
        nativeChatLaunchPromptByTabId: {
          ...s.nativeChatLaunchPromptByTabId,
          [tabId]: { ...current, failed: true }
        }
      }
    })
  },
  clearNativeChatLaunchPrompt: (tabId) => {
    set((s) => {
      if (!s.nativeChatLaunchPromptByTabId[tabId]) {
        return {}
      }
      const next = { ...s.nativeChatLaunchPromptByTabId }
      delete next[tabId]
      return { nativeChatLaunchPromptByTabId: next }
    })
  },
  seedNativeChatLaunchDraft: (draft) => {
    set((s) => ({
      nativeChatLaunchDraftByTabId: {
        ...s.nativeChatLaunchDraftByTabId,
        [draft.tabId]: draft
      }
    }))
  },
  markNativeChatLaunchDraftAdopted: (tabId) => {
    set((s) => {
      const current = s.nativeChatLaunchDraftByTabId[tabId]
      if (!current || current.adopted) {
        return {}
      }
      return {
        nativeChatLaunchDraftByTabId: {
          ...s.nativeChatLaunchDraftByTabId,
          [tabId]: { ...current, adopted: true }
        }
      }
    })
  },
  resolveNativeChatLaunchDraft: (tabId, resolution) => {
    set((s) => {
      const current = s.nativeChatLaunchDraftByTabId[tabId]
      if (
        !current ||
        current.resolved ||
        current.createdAt !== resolution.createdAt ||
        current.text !== resolution.text
      ) {
        return {}
      }
      return {
        nativeChatLaunchDraftByTabId: {
          ...s.nativeChatLaunchDraftByTabId,
          [tabId]: { ...current, resolved: true }
        }
      }
    })
  },
  clearNativeChatLaunchDraft: (tabId) => {
    set((s) => {
      if (!s.nativeChatLaunchDraftByTabId[tabId]) {
        return {}
      }
      const next = { ...s.nativeChatLaunchDraftByTabId }
      delete next[tabId]
      return { nativeChatLaunchDraftByTabId: next }
    })
  },
  recordTerminalInput: (paneKey, timestamp = Date.now()) => {
    if (!paneKey || !Number.isFinite(timestamp)) {
      return
    }
    recordTerminalInputActivity({
      paneKey,
      timestamp,
      // Why: the first stamp for a pane must land synchronously; automation take-over
      // detection subscribes and compares undefined→value across a launch.
      forceWrite: get().lastTerminalInputAtByPaneKey[paneKey] === undefined,
      commit: {
        insert: (key, at) =>
          set((s) => ({
            lastTerminalInputAtByPaneKey: { ...s.lastTerminalInputAtByPaneKey, [key]: at }
          })),
        refreshExisting: (entries) =>
          set((s) => {
            let next: Record<string, number> | null = null
            for (const [key, at] of entries) {
              // Why: teardown (close pane/tab/worktree purge) deletes keys; a late flush must not resurrect them.
              const current = s.lastTerminalInputAtByPaneKey[key]
              if (current === undefined || current >= at) {
                continue
              }
              next ??= { ...s.lastTerminalInputAtByPaneKey }
              next[key] = at
            }
            return next ? { lastTerminalInputAtByPaneKey: next } : {}
          })
      }
    })
  },
  setCacheTimerStartedAt: (key, ts) => {
    set((s) => {
      const next = { ...s.cacheTimerByKey, [key]: ts }
      // Why: a real pane write clears any ':seed' sentinel from seedCacheTimersForIdleTabs, avoiding phantom timers when the seed key doesn't match the real pane.
      const colonIdx = key.indexOf(':')
      if (colonIdx !== -1) {
        const tabId = key.slice(0, colonIdx)
        const suffix = key.slice(colonIdx + 1)
        if (suffix !== 'seed') {
          delete next[`${tabId}:seed`]
        }
      }
      return { cacheTimerByKey: next }
    })
  },
  seedCacheTimersForIdleTabs: () => {
    // Why: tabs already idle when the feature is enabled mid-session missed their working→idle transition, so seed timers for them.
    const s = get()
    const now = Date.now()
    const updates: Record<string, number> = {}
    for (const tabs of Object.values(s.tabsByWorktree)) {
      for (const tab of tabs) {
        if (!tab.title || !isClaudeAgent(tab.title)) {
          continue
        }
        const status = classifyTitleActivity(tab.title)
        if (status === null || status === 'working') {
          continue
        }
        // Why: the store doesn't know which pane holds the idle session, so use a ':seed' sentinel; setCacheTimerStartedAt clears it on any real pane write.
        const key = `${tab.id}:seed`
        if (s.cacheTimerByKey[key] == null) {
          updates[key] = now
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      set((s) => ({
        cacheTimerByKey: { ...s.cacheTimerByKey, ...updates }
      }))
    }
  },
  setDeferredSshReconnectTargets: (targetIds) => set({ deferredSshReconnectTargets: targetIds }),
  removeDeferredSshReconnectTarget: (targetId) =>
    set((s) => ({
      deferredSshReconnectTargets: s.deferredSshReconnectTargets.filter((id) => id !== targetId)
    })),
  removeDeferredSshSessionId: (tabId) =>
    set((s) => {
      if (!s.deferredSshSessionIdsByTabId[tabId]) {
        return {}
      }
      const next = { ...s.deferredSshSessionIdsByTabId }
      delete next[tabId]
      return { deferredSshSessionIdsByTabId: next }
    }),
  }
}