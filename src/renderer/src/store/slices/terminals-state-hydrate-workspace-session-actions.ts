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
export function createTerminalSliceHydrateWorkspaceSessionActions13(set: SliceSet, get: SliceGet) {
  return {
  hydrateWorkspaceSession: (session, options) => {
    set((s) => {
      const runtimeSessionPlaceholders = buildRuntimeSessionPlaceholders({
        repos: s.repos,
        runtimeHostIdByWorkspaceSessionKey: options?.runtimeHostIdByWorkspaceSessionKey ?? {},
        worktreesByRepo: s.worktreesByRepo
      })
      const validWorktreeIds = buildValidWorktreeIdsForSessionHydration(
        {
          repos: runtimeSessionPlaceholders.repos,
          worktreesByRepo: runtimeSessionPlaceholders.worktreesByRepo,
          detectedWorktreesByRepo: s.detectedWorktreesByRepo
        },
        collectPersistedWorktreeIdsForSessionHydration(session)
      )
      const knownRepoIds = new Set(runtimeSessionPlaceholders.repos.map((r) => r.id))
      // Why: the Floating Workspace isn't a repo worktree, but its tabs use the normal session pipeline so daemon PTYs survive app restart.
      validWorktreeIds.add(FLOATING_TERMINAL_WORKTREE_ID)
      for (const workspace of s.folderWorkspaces) {
        validWorktreeIds.add(folderWorkspaceKey(workspace.id))
      }
      addAdditionalValidWorkspaceKeys(validWorktreeIds, options)
      // Why pendingActivationSpawn: a restored worktree's first mount calls updateTabPtyId, which would bump lastActivityAt and bounce it to the top of Recent; the tag (consumed on the first pty update) suppresses that so only real activity bumps.
      const tabsByWorktree: Record<string, TerminalTab[]> = Object.fromEntries(
        Object.entries(session.tabsByWorktree)
          .filter(([worktreeId]) => validWorktreeIds.has(worktreeId))
          .map(([worktreeId, tabs]) => {
            const quickCommandLabelByTerminalId = new Map(
              (session.unifiedTabs?.[worktreeId] ?? [])
                .filter((tab) => tab.contentType === 'terminal' && tab.quickCommandLabel?.trim())
                .map((tab) => [tab.entityId, tab.quickCommandLabel!.trim()])
            )
            return [
              worktreeId,
              [...tabs]
                .filter((tab) => {
                  // Why: old web-client mirrors could persist host surface ids with "::"; makePaneKey reserves ":" as its separator.
                  return isValidTerminalTabId(tab.id)
                })
                .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
                .map((tab, index) => {
                  const quickCommandLabel =
                    tab.quickCommandLabel?.trim() || quickCommandLabelByTerminalId.get(tab.id)
                  return {
                    ...clearTransientTerminalState(tab, index),
                    ...(quickCommandLabel ? { quickCommandLabel } : {}),
                    sortOrder: index,
                    pendingActivationSpawn: true
                  }
                })
            ]
          })
          .filter(([, tabs]) => tabs.length > 0)
      )

      const validTabIds = new Set(
        Object.values(tabsByWorktree)
          .flat()
          .map((tab) => tab.id)
      )
      const sleepingAgentSessionsByPaneKey = Object.fromEntries(
        Object.entries(session.sleepingAgentSessionsByPaneKey ?? {}).filter(([, record]) =>
          validWorktreeIds.has(record.worktreeId)
        )
      )
      const fallbackActiveWorktreeId =
        !session.activeWorktreeId && session.activeRepoId && knownRepoIds.has(session.activeRepoId)
          ? (runtimeSessionPlaceholders.worktreesByRepo[session.activeRepoId]?.find(
              (worktree) => worktree.isMainWorktree
            )?.id ??
            runtimeSessionPlaceholders.worktreesByRepo[session.activeRepoId]?.[0]?.id ??
            null)
          : null
      const activeWorktreeId = (() => {
        if (session.activeWorktreeId && validWorktreeIds.has(session.activeWorktreeId)) {
          return session.activeWorktreeId
        }
        // Why: a workspace with no tabs is still valid; fall back from the active repo to avoid a blank landing screen when tabs were pruned or never created.
        return fallbackActiveWorktreeId
      })()
      const activeWorkspaceKey: WorkspaceKey | null =
        session.activeWorkspaceKey && validWorktreeIds.has(session.activeWorkspaceKey)
          ? session.activeWorkspaceKey
          : activeWorktreeId
            ? parseWorkspaceKey(activeWorktreeId)
              ? (activeWorktreeId as WorkspaceKey)
              : worktreeWorkspaceKey(activeWorktreeId)
            : null
      const activeWorkspaceExecutionHostId =
        activeWorkspaceKey && session.activeWorkspaceExecutionHostId
          ? session.activeWorkspaceExecutionHostId
          : null
      const activeTabId =
        session.activeTabId && validTabIds.has(session.activeTabId) ? session.activeTabId : null
      const activeRepoId =
        session.activeRepoId &&
        runtimeSessionPlaceholders.repos.some((repo) => repo.id === session.activeRepoId)
          ? session.activeRepoId
          : null

      // Why: workspaceSessionReady stays false here; reconnectPersistedTerminals sets it true after eager spawns so TerminalPane can't mount and spawn duplicate PTYs first.
      // Why: activeWorktreeIdsOnShutdown is authoritative when present; persisted tab/layout PTY IDs are only wake hints, not a full active-workspace list.
      const shutdownIds =
        session.activeWorktreeIdsOnShutdown ??
        Object.entries(session.tabsByWorktree)
          .filter(([, tabs]) => tabs.some((t) => t.ptyId))
          .map(([wId]) => wId)
      const pendingReconnectWorktreeIds = shutdownIds.filter((id) => validWorktreeIds.has(id))

      // Why: record which tabs had live PTYs from raw session data before clearTransientTerminalState nulls ptyIds, so reconnect binds the right tabs in multi-tab worktrees (not just tabs[0]).
      // Also include tabs whose relay session id survived in remoteSessionIdsByTabId (ptyId was null but the relay PTY is alive).
      const remoteSessionIds = session.remoteSessionIdsByTabId ?? {}
      const pendingReconnectTabByWorktree: Record<string, string[]> = {}
      for (const worktreeId of pendingReconnectWorktreeIds) {
        const rawTabs = session.tabsByWorktree[worktreeId] ?? []
        const liveTabIds = rawTabs
          .filter((t) => (t.ptyId || remoteSessionIds[t.id]) && validTabIds.has(t.id))
          .map((t) => t.id)
        if (liveTabIds.length > 0) {
          pendingReconnectTabByWorktree[worktreeId] = liveTabIds
        }
      }

      // Why: preserve each tab's prior ptyId so reconnect passes it as sessionId to the daemon's createOrAttach, triggering reattach instead of a fresh spawn.
      const pendingReconnectPtyIdByTabId: Record<string, string> = {}
      const placeholderWorktreeById = buildWorktreeByIdIndex(
        runtimeSessionPlaceholders.worktreesByRepo
      )
      const placeholderRepoById = buildByIdIndex(runtimeSessionPlaceholders.repos)
      for (const worktreeId of pendingReconnectWorktreeIds) {
        const worktree = placeholderWorktreeById.get(worktreeId)
        const repo = worktree ? placeholderRepoById.get(worktree.repoId) : null
        if (repo?.connectionId) {
          continue
        }
        const rawTabs = session.tabsByWorktree[worktreeId] ?? []
        for (const tab of rawTabs) {
          if (tab.ptyId && validTabIds.has(tab.id)) {
            pendingReconnectPtyIdByTabId[tab.id] = tab.ptyId
          }
        }
      }

      // Why: remote PTY reattach uses the relay's pty.attach RPC, not the local daemon; the loop above skips SSH repos, so no overlap.
      for (const [tabId, sessionId] of Object.entries(remoteSessionIds)) {
        if (validTabIds.has(tabId)) {
          pendingReconnectPtyIdByTabId[tabId] = sessionId
        }
      }

      // Restore per-worktree active tab; validate ids when the map exists, else derive for legacy sessions.
      let activeTabIdByWorktree: Record<string, string | null> = {}
      if (session.activeTabIdByWorktree) {
        for (const [wId, tabId] of Object.entries(session.activeTabIdByWorktree)) {
          if (validWorktreeIds.has(wId) && tabId && validTabIds.has(tabId)) {
            activeTabIdByWorktree[wId] = tabId
          }
        }
      } else {
        // Legacy sessions: best-effort derivation
        if (activeWorktreeId && activeTabId) {
          activeTabIdByWorktree[activeWorktreeId] = activeTabId
        }
        for (const [wId, tabs] of Object.entries(tabsByWorktree)) {
          if (!activeTabIdByWorktree[wId] && tabs.length > 0) {
            activeTabIdByWorktree[wId] = tabs[0].id
          }
        }
      }

      // Why: SSH worktrees aren't persisted in worktreesByRepo (discovered via relay); synthesize placeholders from session tabs so the sidebar shows them until SSH reconnect + fetchWorktrees replace them.
      // Why: only SSH gets placeholders; local metadata comes from the next successful fetch.
      const sshRepoIds = new Set(
        runtimeSessionPlaceholders.repos.filter((r) => r.connectionId).map((r) => r.id)
      )
      const worktreesByRepo = { ...runtimeSessionPlaceholders.worktreesByRepo }
      for (const worktreeId of Object.keys(tabsByWorktree)) {
        const repoId = getRepoIdFromWorktreeId(worktreeId)
        if (!sshRepoIds.has(repoId)) {
          continue
        }
        const existing = (worktreesByRepo[repoId] ?? []).find((w) => w.id === worktreeId)
        if (existing) {
          continue
        }
        // Why: strip the synthetic `::workspace:<uuid>` folder suffix so the placeholder path is a real cwd; `id` above keeps it for identity.
        const path = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath ?? ''
        // Why: SSH worktree paths may use backslash separators on Windows remotes.
        const displayName = path.split(/[/\\]/).pop() || path
        const placeholder: Worktree = {
          id: worktreeId,
          repoId,
          displayName,
          comment: '',
          linkedIssue: null,
          linkedPR: null,
          linkedLinearIssue: null,
          linkedGitLabMR: null,
          linkedGitLabIssue: null,
          isArchived: false,
          isUnread: false,
          isPinned: false,
          sortOrder: 0,
          lastActivityAt: 0,
          path,
          head: '',
          branch: '',
          isBare: false,
          isMainWorktree: false
        }
        worktreesByRepo[repoId] = [...(worktreesByRepo[repoId] ?? []), placeholder]
      }

      // Why: the restored-active worktree bypasses setActiveWorktree, so record it in everActivatedWorktreeIds here to keep a later re-click from re-tagging (which would suppress real activity).
      const nextEverActivated = new Set(s.everActivatedWorktreeIds)
      if (activeWorktreeId) {
        nextEverActivated.add(activeWorktreeId)
      }

      // Why indexed: the layout map below looks up a tab per persisted layout, and
      // re-flattening tabsByWorktree per entry is O(tabs x layouts).
      const allTabs = Object.values(tabsByWorktree).flat()
      const tabById = buildByIdIndex(allTabs)

      const hydrated: WorkspaceHydrationPatch = {
        activeRepoId,
        activeWorktreeId,
        activeWorkspaceKey,
        activeWorkspaceExecutionHostId,
        activeTabId,
        activeTabIdByWorktree,
        restoredRuntimeHostIdByWorkspaceSessionKey:
          options?.runtimeHostIdByWorkspaceSessionKey ?? {},
        repos: runtimeSessionPlaceholders.repos,
        tabsByWorktree,
        worktreesByRepo,
        // Why: restore the focus-recency map; pruning is deferred to App.tsx (post-hydration) because SSH worktrees may still be appearing in worktreesByRepo.
        lastVisitedAtByWorktreeId: session.lastVisitedAtByWorktreeId ?? {},
        defaultTerminalTabsAppliedByWorktreeId:
          session.defaultTerminalTabsAppliedByWorktreeId ?? {},
        automaticAgentResumeClaimsByTabId: {},
        sleepingAgentSessionsByPaneKey,
        pendingReconnectWorktreeIds,
        pendingReconnectTabByWorktree,
        pendingReconnectPtyIdByTabId,
        everActivatedWorktreeIds: nextEverActivated,
        // Why: seed nav history with the hydrated active worktree so the first activation has a Back target; hydration bypasses recordWorktreeVisit, so otherwise Back stays disabled until a second click.
        worktreeNavHistory: activeWorktreeId ? [activeWorktreeId] : [],
        worktreeNavHistoryIndex: activeWorktreeId ? 0 : -1,
        ptyIdsByTabId: Object.fromEntries(allTabs.map((tab) => [tab.id, []] as const)),
        // Why: daemon ptyIds survive app restart; preserve ptyIdsByLeafId so reconnect can reattach each split-pane leaf to its own session, not just the tab-level ptyId.
        terminalLayoutsByTabId: Object.fromEntries(
          Object.entries(session.terminalLayoutsByTabId)
            .filter(([tabId]) => validTabIds.has(tabId))
            .map(([tabId, layout]) => {
              // Why: old sessions can contain renderer-local pane:1-style leaf ids; normalize before runtime/mobile surfaces read them.
              const normalized = normalizeTerminalLayoutSnapshot(layout).snapshot
              const tab = tabById.get(tabId)
              const sanitized = tab ? sanitizeTerminalLayoutPaneTitles(normalized, tab) : normalized
              const activeLeafId = sanitized.root
                ? resolvePtyBoundActiveLeafId({
                    root: sanitized.root,
                    activeLeafId: sanitized.activeLeafId,
                    ptyIdsByLeafId: sanitized.ptyIdsByLeafId
                  })
                : sanitized.activeLeafId
              return [tabId, { ...sanitized, activeLeafId }]
            })
        )
      }
      return options?.replaceWorkspaceKeys
        ? targetScopedWorkspaceHydrationPatch(s, hydrated, session, options)
        : hydrated
    })
  },
  }
}
