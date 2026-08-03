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
export function createTerminalSliceCreateTabActions2(set: SliceSet, get: SliceGet) {
  return {
  createTab: (worktreeId, targetGroupId, shellOverride, options) => {
    let tab!: TerminalTab
    set((s) => {
      const orphanTerminalIds = getOrphanTerminalIds(s, worktreeId)
      const orphanCleanupPatch = buildOrphanTerminalCleanupPatch(s, worktreeId, orphanTerminalIds)
      const existing = (s.tabsByWorktree[worktreeId] ?? []).filter(
        (entry) => !orphanTerminalIds.has(entry.id)
      )
      // Why: honor a caller-supplied tab id but mint on collision — aliasing two PTYs to one id corrupts agent-status routing. See docs/cli-terminal-hook-pane-key.md.
      // Why: only honor a non-empty trimmed hint; useIpcEvents spreads `id` whenever tabId !== undefined, so a stray '' would break paneKey routing.
      const trimmedHint = typeof options?.id === 'string' ? options.id.trim() : ''
      const hintedId =
        trimmedHint.length > 0 && isValidHostTerminalTabId(trimmedHint) ? trimmedHint : undefined
      const idCollides =
        hintedId !== undefined &&
        Object.values(s.tabsByWorktree).some((tabs) => tabs.some((entry) => entry.id === hintedId))
      if (idCollides) {
        console.warn(
          `[createTab] tabId hint ${hintedId} already exists; minting a fresh id (hook attribution will degrade for this terminal)`
        )
      }
      const id = hintedId !== undefined && !idCollides ? hintedId : createBrowserUuid()
      const shouldActivate = options?.activate !== false
      const nextOrdinal = getNextTerminalOrdinal(existing)
      const defaultTitle = `Terminal ${nextOrdinal}`
      const quickCommandLabel = options?.quickCommandLabel?.trim()
      const startupCwd = options?.startupCwd
      const remoteConnectionId = getRemoteConnectionIdForWorktree(s, worktreeId)
      const isRemoteWorktree = Boolean(remoteConnectionId)
      const isWslWorktree = worktreeUsesWslPath(s, worktreeId)
      const createdShellOverride = resolveCreatedTabShellOverride(
        shellOverride,
        s.settings?.terminalWindowsShell,
        // Why: SSH PTYs ignore local Windows shell selection; a local shell icon would mislabel a remote terminal.
        isRemoteWorktree,
        remoteConnectionId
          ? ((s.sshConnectionStates.get(remoteConnectionId)
              ?.remotePlatform as NodeJS.Platform | null) ?? null)
          : null,
        // Why: new terminals enter the worktree's repo-scoped WSL distro even when the global Windows shell is PowerShell/cmd.exe.
        isWslWorktree,
        isRemoteWorktree ? undefined : getLocalProjectExecutionRuntimeContext(s, worktreeId)
      )
      tab = {
        id,
        // Why: CLI-created background sessions already own a PTY, so reveal attaches instead of spawning a duplicate.
        ptyId: options?.initialPtyId ?? null,
        worktreeId,
        // Why: reuse the lowest free ordinal so a fresh terminal stays "Terminal 1" after older tabs close, not a monotonic counter.
        title: defaultTitle,
        defaultTitle,
        ...(quickCommandLabel ? { quickCommandLabel } : {}),
        customTitle: null,
        color: null,
        sortOrder: existing.length,
        createdAt: Date.now(),
        ...(createdShellOverride !== undefined ? { shellOverride: createdShellOverride } : {}),
        ...(startupCwd && startupCwd.length > 0 ? { startupCwd } : {}),
        ...(options?.launchAgent ? { launchAgent: options.launchAgent } : {}),
        // Why: mark click-caused (not work-caused) spawns so updateTabPtyId skips the activity/sortEpoch bump that would reorder Recent/Smart on click.
        ...(options?.pendingActivationSpawn ? { pendingActivationSpawn: true } : {})
      }
      const validTargetGroupId =
        targetGroupId && s.groupsByWorktree[worktreeId]?.some((group) => group.id === targetGroupId)
          ? targetGroupId
          : undefined
      const { group, groupsByWorktree, activeGroupIdByWorktree } = ensureGroup(
        s.groupsByWorktree,
        s.activeGroupIdByWorktree,
        worktreeId,
        validTargetGroupId ?? s.activeGroupIdByWorktree[worktreeId]
      )
      const nextActiveGroupIdByWorktree =
        shouldActivate && validTargetGroupId
          ? { ...activeGroupIdByWorktree, [worktreeId]: validTargetGroupId }
          : activeGroupIdByWorktree
      const existingUnifiedTabs = s.unifiedTabsByWorktree[worktreeId] ?? []
      const existingTerminalTab = findTabByEntityInGroup(
        s.unifiedTabsByWorktree,
        worktreeId,
        group.id,
        id,
        'terminal'
      )
      const groupsForWorktree = groupsByWorktree[worktreeId] ?? []
      const cleanedGroups =
        orphanTerminalIds.size === 0
          ? groupsForWorktree
          : groupsForWorktree.map((entry) => {
              // Why: repair every group before adding the new tab, or inactive/background creation can revive stale focus.
              const tabOrder = dedupeTabOrder(entry.tabOrder).filter(
                (tabId) => !orphanTerminalIds.has(tabId)
              )
              const recentTabIds = sanitizeRecentTabIds(entry.recentTabIds, tabOrder)
              const replacedActiveTabId = Boolean(
                entry.activeTabId && orphanTerminalIds.has(entry.activeTabId)
              )
              const fallbackActiveTabId = recentTabIds.at(-1) ?? tabOrder[0] ?? null
              const activeTabId = replacedActiveTabId ? fallbackActiveTabId : entry.activeTabId
              return {
                ...entry,
                activeTabId,
                tabOrder,
                recentTabIds:
                  replacedActiveTabId && activeTabId
                    ? pushRecentTabId(recentTabIds, activeTabId)
                    : recentTabIds
              }
            })
      const cleanedTargetGroup = cleanedGroups.find((entry) => entry.id === group.id) ?? group
      const cleanedGroupOrder = dedupeTabOrder(cleanedTargetGroup.tabOrder).filter(
        (tabId) => !orphanTerminalIds.has(tabId)
      )
      const unifiedTab = existingTerminalTab ?? {
        id,
        entityId: id,
        groupId: group.id,
        worktreeId,
        contentType: 'terminal' as const,
        label: tab.title,
        ...(tab.quickCommandLabel?.trim()
          ? { quickCommandLabel: tab.quickCommandLabel.trim() }
          : {}),
        customLabel: tab.customTitle,
        color: tab.color,
        sortOrder: cleanedGroupOrder.length,
        createdAt: tab.createdAt,
        // Why: omit for non-agent tabs so they keep the implicit 'terminal' view mode.
        ...(options?.viewMode ? { viewMode: options.viewMode } : {})
      }
      const nextGroupOrder = dedupeTabOrder([...cleanedGroupOrder, unifiedTab.id])
      const nextRecent = shouldActivate
        ? pushRecentTabId(sanitizeRecentTabIds(group.recentTabIds, nextGroupOrder), unifiedTab.id)
        : sanitizeRecentTabIds(cleanedTargetGroup.recentTabIds, nextGroupOrder)
      const cleanedActiveTabIdForWorktree = orphanCleanupPatch.activeTabIdByWorktree[worktreeId]
      const cleanedGroupActiveTabId =
        cleanedTargetGroup.activeTabId && !orphanTerminalIds.has(cleanedTargetGroup.activeTabId)
          ? cleanedTargetGroup.activeTabId
          : null
      const nextActiveTabIdForWorktree = shouldActivate
        ? tab.id
        : (cleanedActiveTabIdForWorktree ?? cleanedGroupActiveTabId ?? tab.id)
      return {
        ...orphanCleanupPatch,
        tabsByWorktree: {
          ...orphanCleanupPatch.tabsByWorktree,
          [worktreeId]: [...existing, tab]
        },
        // Why: publish the unified tab atomically with the runtime tab so a transient legacy mount can't race the split host.
        unifiedTabsByWorktree: {
          ...s.unifiedTabsByWorktree,
          [worktreeId]: existingTerminalTab
            ? existingUnifiedTabs
            : [...existingUnifiedTabs, unifiedTab]
        },
        groupsByWorktree: {
          ...groupsByWorktree,
          [worktreeId]: updateGroup(cleanedGroups, {
            ...cleanedTargetGroup,
            activeTabId: shouldActivate
              ? unifiedTab.id
              : (cleanedGroupActiveTabId ?? unifiedTab.id),
            tabOrder: nextGroupOrder,
            recentTabIds: nextRecent
          })
        },
        activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
        layoutByWorktree: {
          ...s.layoutByWorktree,
          [worktreeId]: s.layoutByWorktree[worktreeId] ?? { type: 'leaf', groupId: group.id }
        },
        activeTabId: shouldActivate ? tab.id : orphanCleanupPatch.activeTabId,
        activeTabIdByWorktree: {
          ...orphanCleanupPatch.activeTabIdByWorktree,
          [worktreeId]: nextActiveTabIdForWorktree
        },
        ptyIdsByTabId: {
          ...orphanCleanupPatch.ptyIdsByTabId,
          [tab.id]: options?.initialPtyId ? [options.initialPtyId] : []
        },
        terminalLayoutsByTabId: {
          ...orphanCleanupPatch.terminalLayoutsByTabId,
          [tab.id]: emptyLayoutSnapshot()
        }
      }
    })
    const shouldRecordInteraction =
      options?.recordInteraction ?? (!options?.pendingActivationSpawn && !options?.initialPtyId)
    if (shouldRecordInteraction) {
      get().recordFeatureInteraction?.('terminal-tabs')
    }
    return tab
  },
  openNewTerminalTabInActiveWorkspace: async (groupId) => {
    const state = get()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return
    }
    const workspaceScope = parseWorkspaceKey(worktreeId)
    const worktreeRoute =
      worktreeId === FLOATING_TERMINAL_WORKTREE_ID || workspaceScope?.type === 'folder'
        ? null
        : resolveWorktreeOperationRouteResult(state, worktreeId)
    if (worktreeRoute && worktreeRoute.kind !== 'resolved') {
      return
    }
    const runtimeEnvironmentId = worktreeRoute
      ? worktreeRoute.route.runtimeEnvironmentId
      : getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    if (runtimeEnvironmentId) {
      const { createWebRuntimeSessionTerminal } = await import('@/runtime/web-runtime-session')
      await createWebRuntimeSessionTerminal({
        worktreeId,
        environmentId: runtimeEnvironmentId,
        targetGroupId: groupId,
        activate: true
      })
      return
    }
    const terminal = get().createTab(worktreeId, groupId)
    get().setActiveTab(terminal.id)
    get().setActiveTabType('terminal')
    const latest = get()
    const currentTerminals = latest.tabsByWorktree[worktreeId] ?? []
    const currentEditors = latest.openFiles.filter((file) => file.worktreeId === worktreeId)
    const currentBrowsers = latest.browserTabsByWorktree[worktreeId] ?? []
    const stored = latest.tabBarOrderByWorktree[worktreeId]
    const validIds = new Set([
      ...currentTerminals.map((tab) => tab.id),
      ...currentEditors.map((file) => file.id),
      ...currentBrowsers.map((tab) => tab.id)
    ])
    const base = (stored ?? []).filter((id) => validIds.has(id))
    const inBase = new Set(base)
    for (const id of validIds) {
      if (!inBase.has(id)) {
        base.push(id)
      }
    }
    // Why: Cmd+J shares the titlebar-button creation path, so append the new terminal after mixed editor/browser tabs, not first.
    get().setTabBarOrder(worktreeId, [...base.filter((id) => id !== terminal.id), terminal.id])
    focusTerminalTabSurface(terminal.id)
  },
  }
}
