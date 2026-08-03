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
export function createTerminalSliceClearRuntimePaneTitleActions5(set: SliceSet, get: SliceGet) {
  return {
  clearRuntimePaneTitle: (tabId, paneId) => {
    set((s) => {
      const currentByPane = s.runtimePaneTitlesByTabId[tabId]
      if (!currentByPane || !(paneId in currentByPane)) {
        return s
      }
      const prevTitle = currentByPane[paneId]
      const nextByPane = { ...currentByPane }
      delete nextByPane[paneId]

      const next = { ...s.runtimePaneTitlesByTabId }
      if (Object.keys(nextByPane).length > 0) {
        next[tabId] = nextByPane
      } else {
        delete next[tabId]
      }

      // Why: clearing a classified title changes the smart-sort title-heuristic verdict, so it needs a re-sort. See setRuntimePaneTitle.
      const hadClassification = classifyTitleActivity(prevTitle ?? '') !== null
      // Why: same active-worktree gate as setRuntimePaneTitle — click-driven teardown clears must not re-rank the sidebar; skip when owner is missing (orphaned).
      const ownerWorktreeId = hadClassification
        ? getTerminalTabOwnerWorktreeId(s.tabsByWorktree, tabId)
        : null
      const isActive = ownerWorktreeId !== null && ownerWorktreeId === s.activeWorktreeId
      const shouldBump = hadClassification && ownerWorktreeId !== null && !isActive
      return {
        runtimePaneTitlesByTabId: next,
        ...(shouldBump ? { sortEpoch: s.sortEpoch + 1 } : {})
      }
    })
  },
  markTerminalTabUnread: (tabId) => {
    const state = get()
    const ownerTab = Object.values(state.tabsByWorktree ?? {})
      .flat()
      .find((t) => t.id === tabId)
    if (!ownerTab) {
      return
    }
    // Why: terminal attention persists until real interaction ("show until interact"); keystroke/pointerdown clears via clearTerminalTabUnread, tab/group activation clears directly.
    set((s) => {
      if (s.unreadTerminalTabs[tabId]) {
        return s
      }
      return { unreadTerminalTabs: { ...s.unreadTerminalTabs, [tabId]: true as const } }
    })
  },
  markTerminalPaneUnread: (paneKey) => {
    set((s) => {
      if (s.unreadTerminalPanes[paneKey]) {
        return s
      }
      return { unreadTerminalPanes: { ...s.unreadTerminalPanes, [paneKey]: true as const } }
    })
  },
  markAgentCompletionPaneUnread: (paneKey) => {
    set((s) => {
      if (s.unreadAgentCompletionPanes[paneKey]) {
        return s
      }
      return {
        unreadAgentCompletionPanes: {
          ...s.unreadAgentCompletionPanes,
          [paneKey]: true as const
        }
      }
    })
  },
  clearTerminalTabUnread: (tabId) => {
    set((s) => {
      if (!s.unreadTerminalTabs[tabId]) {
        return s
      }
      const copy = { ...s.unreadTerminalTabs }
      delete copy[tabId]
      return { unreadTerminalTabs: copy }
    })
  },
  clearTerminalPaneUnread: (paneKey) => {
    set((s) => {
      if (!s.unreadTerminalPanes[paneKey] && !s.unreadAgentCompletionPanes[paneKey]) {
        return s
      }
      const nextUnreadTerminalPanes = { ...s.unreadTerminalPanes }
      const nextUnreadAgentCompletionPanes = { ...s.unreadAgentCompletionPanes }
      delete nextUnreadTerminalPanes[paneKey]
      delete nextUnreadAgentCompletionPanes[paneKey]
      return {
        unreadTerminalPanes: nextUnreadTerminalPanes,
        unreadAgentCompletionPanes: nextUnreadAgentCompletionPanes
      }
    })
  },
  setTabCustomTitle: (tabId, title, opts) => {
    set((s) => {
      const next = { ...s.tabsByWorktree }
      for (const wId of Object.keys(next)) {
        next[wId] = next[wId].map((t) => (t.id === tabId ? { ...t, customTitle: title } : t))
      }
      scheduleRuntimeGraphSync()
      return { tabsByWorktree: next }
    })
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'terminal' && entry.entityId === tabId)
    if (item) {
      get().setTabCustomLabel(item.id, title, opts)
    }
  },
  setTabColor: (tabId, color) => {
    set((s) => {
      const next = { ...s.tabsByWorktree }
      for (const wId of Object.keys(next)) {
        next[wId] = next[wId].map((t) => (t.id === tabId ? { ...t, color } : t))
      }
      return { tabsByWorktree: next }
    })
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'terminal' && entry.entityId === tabId)
    if (item) {
      get().setUnifiedTabColor(item.id, color)
      // Why: tab color is host-authoritative for remote-server tabs; mirror it so it persists instead of reverting on the next snapshot.
      const state = get()
      const owningWorktreeId = Object.keys(state.unifiedTabsByWorktree).find((wId) =>
        (state.unifiedTabsByWorktree[wId] ?? []).some((entry) => entry.id === item.id)
      )
      if (
        owningWorktreeId &&
        resolveTerminalWorktreeRoute(state, owningWorktreeId)?.runtimeEnvironmentId
      ) {
        void import('@/runtime/web-runtime-session').then(({ setWebRuntimeTabProps }) =>
          setWebRuntimeTabProps({ worktreeId: owningWorktreeId, tabId: item.id, color })
        )
      }
    }
  },
  }
}
