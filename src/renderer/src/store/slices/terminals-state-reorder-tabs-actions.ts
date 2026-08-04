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
export function createTerminalSliceReorderTabsActions4(set: SliceSet, get: SliceGet) {
  return {
  reorderTabs: (worktreeId, tabIds) => {
    set((s) => {
      const tabs = s.tabsByWorktree[worktreeId] ?? []
      const tabMap = new Map(tabs.map((t) => [t.id, t]))
      const orderedSet = new Set(tabIds)
      const missingTabs = tabs.filter((t) => !orderedSet.has(t.id))

      const reordered = [
        ...tabIds.map((id) => tabMap.get(id)!).filter(Boolean),
        ...missingTabs
      ].map((tab, i) => ({ ...tab, sortOrder: i }))

      return {
        tabsByWorktree: { ...s.tabsByWorktree, [worktreeId]: reordered }
      }
    })
  },
  setTabBarOrder: (worktreeId, order) => {
    set((s) => {
      // Update unified visual order
      const newTabBarOrder = { ...s.tabBarOrderByWorktree, [worktreeId]: order }

      // Keep terminal tab sortOrder in sync for persistence
      const tabs = s.tabsByWorktree[worktreeId]
      if (!tabs) {
        return { tabBarOrderByWorktree: newTabBarOrder }
      }
      const tabMap = new Map(tabs.map((t) => [t.id, t]))
      // Extract terminal IDs in their new relative order
      const terminalIdsInOrder = order.filter((id) => tabMap.has(id))
      const orderedSet = new Set(terminalIdsInOrder)
      const missingTabs = tabs.filter((t) => !orderedSet.has(t.id))

      const updatedTabs = [
        ...terminalIdsInOrder.map((id) => tabMap.get(id)!).filter(Boolean),
        ...missingTabs
      ].map((tab, i) => ({ ...tab, sortOrder: i }))

      return {
        tabBarOrderByWorktree: newTabBarOrder,
        tabsByWorktree: { ...s.tabsByWorktree, [worktreeId]: updatedTabs }
      }
    })
  },
  setActiveTab: (tabId) => {
    set((s) => {
      // Why: focusing a terminal tab clears its bell, but only for the active worktree — clearing a not-yet-visible background tab (worktree activation / jump-to-agent) would swallow the signal.
      let tabOwnerWorktreeId: string | null = null
      for (const [wId, tabs] of Object.entries(s.tabsByWorktree)) {
        if (tabs.some((t) => t.id === tabId)) {
          tabOwnerWorktreeId = wId
          break
        }
      }
      const nextUnreadTerminalTabs =
        tabOwnerWorktreeId === s.activeWorktreeId && s.unreadTerminalTabs[tabId]
          ? (() => {
              const copy = { ...s.unreadTerminalTabs }
              delete copy[tabId]
              return copy
            })()
          : s.unreadTerminalTabs
      // Why: only pin global activeTabId to active-worktree tabs — markTerminalTabUnread treats it as "the visible tab" and would swallow BELs on a background tab (e.g. jump-to-agent).
      const isActiveWorktreeTab = tabOwnerWorktreeId === s.activeWorktreeId
      return {
        activeTabId: isActiveWorktreeTab ? tabId : s.activeTabId,
        activeTabIdByWorktree: tabOwnerWorktreeId
          ? { ...s.activeTabIdByWorktree, [tabOwnerWorktreeId]: tabId }
          : s.activeTabIdByWorktree,
        unreadTerminalTabs: nextUnreadTerminalTabs
      }
    })
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'terminal' && entry.entityId === tabId)
    if (item) {
      get().activateTab(item.id)
    }
  },
  setActiveTabForWorktree: (worktreeId, tabId) => {
    set((s) => ({
      activeTabIdByWorktree: {
        ...s.activeTabIdByWorktree,
        [worktreeId]: tabId
      }
    }))
  },
  updateTabTitle: (tabId, title) => {
    set((s) => {
      // Why: mutate only the owning worktree's tab array — rebuilding all of them would break shallow-equality selectors and spuriously re-render background worktrees on every OSC title frame.
      const ownerWorktreeId = getTerminalTabOwnerWorktreeId(s.tabsByWorktree, tabId)
      if (!ownerWorktreeId) {
        return s
      }
      const tabs = s.tabsByWorktree[ownerWorktreeId] ?? []
      const tabIndex = tabs.findIndex((t) => t.id === tabId)
      const currentTab = tabs[tabIndex]
      if (!currentTab) {
        return s
      }
      const nextTitle = title.trim() || getFallbackTabTitle(currentTab)
      const currentUnifiedTabs = s.unifiedTabsByWorktree[ownerWorktreeId] ?? []
      if (isDecorativeAgentTitleFrameChange(currentTab.title, nextTitle)) {
        const unifiedTabsWithCurrentLabel = updateUnifiedTerminalLabel(
          currentUnifiedTabs,
          tabId,
          currentTab.title
        )
        return unifiedTabsWithCurrentLabel
          ? {
              unifiedTabsByWorktree: {
                ...s.unifiedTabsByWorktree,
                [ownerWorktreeId]: unifiedTabsWithCurrentLabel
              }
            }
          : s
      }
      const unifiedTabsWithUpdatedLabel = updateUnifiedTerminalLabel(
        currentUnifiedTabs,
        tabId,
        nextTitle
      )
      if (currentTab.title === nextTitle) {
        return unifiedTabsWithUpdatedLabel
          ? {
              unifiedTabsByWorktree: {
                ...s.unifiedTabsByWorktree,
                [ownerWorktreeId]: unifiedTabsWithUpdatedLabel
              }
            }
          : s
      }
      const ownerTabs = tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              // Why: PTYs can briefly emit an empty title as an agent exits; keep the stable fallback instead of a blank tab.
              title: nextTitle,
              defaultTitle:
                tab.defaultTitle ??
                (/^Terminal \d+$/.test(tab.title) ? tab.title : undefined) ??
                (/^Terminal \d+$/.test(nextTitle) ? nextTitle : undefined)
            }
          : tab
      )
      scheduleRuntimeGraphSync()
      const nextTabsByWorktree = { ...s.tabsByWorktree, [ownerWorktreeId]: ownerTabs }
      // Why: title changes affect agent-status sort scoring, so re-sort — but only background worktrees; active-worktree changes are click-driven PTY-remount side-effects (bug PR #209).
      const isActive = ownerWorktreeId === s.activeWorktreeId
      const nextState: Partial<AppState> = isActive
        ? { tabsByWorktree: nextTabsByWorktree }
        : { tabsByWorktree: nextTabsByWorktree, sortEpoch: s.sortEpoch + 1 }
      if (unifiedTabsWithUpdatedLabel) {
        nextState.unifiedTabsByWorktree = {
          ...s.unifiedTabsByWorktree,
          [ownerWorktreeId]: unifiedTabsWithUpdatedLabel
        }
      }
      return nextState
    })
  },
  setGeneratedTabTitleFromAgentPrompt: (paneKey, prompt, options) => {
    // Why: setAgentStatus is high-frequency; skip derive/set unless the feature is on and this tab still needs a (re)generated title.
    if (get().settings?.tabAutoGenerateTitle !== true) {
      return
    }
    const tabId = getTabIdFromPaneKey(paneKey)
    if (!tabId || prompt.length === 0) {
      return
    }
    const ownerWorktreeId = getTerminalTabOwnerWorktreeId(get().tabsByWorktree, tabId)
    if (!ownerWorktreeId) {
      return
    }
    const tabs = get().tabsByWorktree[ownerWorktreeId] ?? []
    const currentTab = tabs.find((tab) => tab.id === tabId)
    if (!currentTab || currentTab.customTitle?.trim() || currentTab.quickCommandLabel?.trim()) {
      return
    }
    const existingGeneratedTitle = currentTab.generatedTitle?.trim()
    if (existingGeneratedTitle && options?.replaceExistingGeneratedTitle !== true) {
      return
    }
    const generatedTitle = deriveGeneratedTabTitle(prompt)
    if (!generatedTitle || existingGeneratedTitle === generatedTitle) {
      return
    }
    set((s) => {
      const ownerTabsForWrite = s.tabsByWorktree[ownerWorktreeId]
      if (!ownerTabsForWrite) {
        return s
      }
      const tabIndex = ownerTabsForWrite.findIndex((tab) => tab.id === tabId)
      const tabForWrite = ownerTabsForWrite[tabIndex]
      // Why: re-check inside set so concurrent renames / setting flips win.
      if (
        !tabForWrite ||
        s.settings?.tabAutoGenerateTitle !== true ||
        tabForWrite.customTitle?.trim() ||
        tabForWrite.quickCommandLabel?.trim()
      ) {
        return s
      }
      const latestGeneratedTitle = tabForWrite.generatedTitle?.trim()
      if (
        latestGeneratedTitle &&
        (latestGeneratedTitle === generatedTitle || options?.replaceExistingGeneratedTitle !== true)
      ) {
        return s
      }
      const ownerTabs = ownerTabsForWrite.map((tab) =>
        tab.id === tabId ? { ...tab, generatedTitle } : tab
      )
      const currentUnifiedTabs = s.unifiedTabsByWorktree[ownerWorktreeId] ?? []
      const unifiedTabsWithGeneratedLabel = updateUnifiedTerminalGeneratedLabel(
        currentUnifiedTabs,
        tabId,
        generatedTitle
      )
      scheduleRuntimeGraphSync()
      return {
        tabsByWorktree: {
          ...s.tabsByWorktree,
          [ownerWorktreeId]: ownerTabs
        },
        ...(unifiedTabsWithGeneratedLabel
          ? {
              unifiedTabsByWorktree: {
                ...s.unifiedTabsByWorktree,
                [ownerWorktreeId]: unifiedTabsWithGeneratedLabel
              }
            }
          : {})
      }
    })
  },
  clearTabLaunchAgent: (tabId) => {
    set((s) => {
      const ownerWorktreeId = getTerminalTabOwnerWorktreeId(s.tabsByWorktree, tabId)
      if (!ownerWorktreeId) {
        return s
      }
      const tabs = s.tabsByWorktree[ownerWorktreeId] ?? []
      const tabIndex = tabs.findIndex((t) => t.id === tabId)
      const currentTab = tabs[tabIndex]
      if (!currentTab?.launchAgent) {
        return s
      }
      const { launchAgent: _launchAgent, ...tabWithoutLaunchAgent } = currentTab
      void _launchAgent
      const nextTabs = [...tabs]
      nextTabs[tabIndex] = tabWithoutLaunchAgent
      scheduleRuntimeGraphSync()
      return { tabsByWorktree: { ...s.tabsByWorktree, [ownerWorktreeId]: nextTabs } }
    })
  },
  setRuntimePaneTitle: (tabId, paneId, title) => {
    set((s) => {
      const currentByPane = s.runtimePaneTitlesByTabId[tabId] ?? {}
      const prevTitle = currentByPane[paneId]
      if (prevTitle === title) {
        return s
      }
      if (prevTitle && isDecorativeAgentTitleFrameChange(prevTitle, title)) {
        return s
      }
      // Why: smart sort's title-heuristic fallback (Edge case 9) reads this map; a hookless 'working' → 'permission' title change must re-sort, but only on classification change.
      const classificationChanged =
        classifyTitleActivity(prevTitle ?? '') !== classifyTitleActivity(title)
      // Why: suppress the sortEpoch bump when the pane lives in the active worktree — its title change is a click side-effect (PTY remount), the bug PR #209 fixed; skip if orphaned.
      const ownerWorktreeId = classificationChanged
        ? getTerminalTabOwnerWorktreeId(s.tabsByWorktree, tabId)
        : null
      const isActive = ownerWorktreeId !== null && ownerWorktreeId === s.activeWorktreeId
      const shouldBump = classificationChanged && ownerWorktreeId !== null && !isActive
      return {
        runtimePaneTitlesByTabId: {
          ...s.runtimePaneTitlesByTabId,
          [tabId]: { ...currentByPane, [paneId]: title }
        },
        ...(shouldBump ? { sortEpoch: s.sortEpoch + 1 } : {})
      }
    })
  },
  }
}
