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
export function createTerminalSliceReconnectPersistedTerminalsActions14(set: SliceSet, get: SliceGet) {
  return {
  reconnectPersistedTerminals: async (signal, options) => {
    if (
      signal?.aborted ||
      (options && !isCurrentDirectSshAuthority(get(), options.directSshAuthority))
    ) {
      return
    }
    const {
      pendingReconnectWorktreeIds,
      pendingReconnectTabByWorktree,
      pendingReconnectPtyIdByTabId,
      terminalLayoutsByTabId,
      tabsByWorktree,
      ptyIdsByTabId
    } = get()
    const scopedWorkspaceKeys = options ? new Set(options.workspaceKeys) : null
    const ids = (pendingReconnectWorktreeIds ?? []).filter(
      (id) => !scopedWorkspaceKeys || scopedWorkspaceKeys.has(id)
    )

    if (ids.length === 0) {
      if (options) {
        return
      }
      set({
        workspaceSessionReady: true,
        pendingReconnectWorktreeIds: [],
        pendingReconnectTabByWorktree: {},
        pendingReconnectPtyIdByTabId: {}
      })
      return
    }

    // Why: defer daemon createOrAttach to connectPanePty (real fitAddon dims) instead of eager-spawning at 80×24 and garbling on flush; this loop only records the session IDs to reattach.
    let reconnectedTabsByWorktree: Record<string, TerminalTab[]> | null = null
    let reconnectedPtyIdsByTabId: Record<string, string[]> | null = null
    // Why indexed: the loop neither sets state nor awaits, so one index over the
    // whole store snapshot serves every iteration.
    const worktreeById = buildWorktreeByIdIndex(get().worktreesByRepo)
    const repoById = buildByIdIndex(get().repos)
    for (const worktreeId of ids) {
      const tabs = tabsByWorktree[worktreeId] ?? []
      const worktree = worktreeById.get(worktreeId)
      const repo = worktree ? (repoById.get(worktree.repoId) ?? null) : null
      // Why: only allow deferred reattach when the SSH connection is active; reattaching to a not-yet-connected relay (deferred/passphrase targets) would fail.
      const sshTargetId = options?.directSshAuthority.targetId ?? repo?.connectionId ?? null
      const sshState = sshTargetId ? get().sshConnectionStates.get(sshTargetId) : null
      const sshConnected = sshTargetId != null && sshState?.status === 'connected'
      const supportsDeferredReattach = options ? sshConnected : !repo?.connectionId || sshConnected
      console.debug(
        `[reconnect-terminals] worktree=${worktreeId} connectionId=${repo?.connectionId} sshStatus=${sshState?.status} supportsDeferredReattach=${supportsDeferredReattach}`
      )
      const targetTabIds = pendingReconnectTabByWorktree[worktreeId] ?? []
      const tabsToReconnect: TerminalTab[] =
        targetTabIds.length > 0
          ? targetTabIds
              .map((id) => tabs.find((t) => t.id === id))
              .filter((t): t is TerminalTab => t != null)
          : tabs.slice(0, 1)
      if (tabsToReconnect.length === 0) {
        continue
      }

      for (const tab of tabsToReconnect) {
        const tabId = tab.id
        const layout = terminalLayoutsByTabId[tabId]
        const leafPtyMap = layout?.ptyIdsByLeafId ?? {}
        const pendingPtyId = pendingReconnectPtyIdByTabId[tabId]
        const tabLevelPtyId =
          options &&
          parseAppSshPtyId(pendingPtyId ?? '')?.connectionId !== options.directSshAuthority.targetId
            ? undefined
            : pendingPtyId
        const hasLeafMappings = Object.keys(leafPtyMap).length > 0

        // Why: set the wake-hint (tab.ptyId) and live-pty map (ptyIdsByTabId) so the worktree dot goes green before the pane mounts; actual reattach happens later in pty-connection.ts.
        console.debug(
          `[reconnect-terminals] tab=${tabId} tabLevelPtyId=${tabLevelPtyId} supportsDeferredReattach=${supportsDeferredReattach} hasLeafMappings=${hasLeafMappings}`
        )
        if (tabLevelPtyId) {
          reconnectedTabsByWorktree ??= { ...tabsByWorktree }
          const nextTabs = reconnectedTabsByWorktree[worktreeId]
          if (!nextTabs) {
            continue
          }

          // Why: populate ptyIdsByTabId so the sessions status segment maps daemon IDs to tabs; otherwise all sessions look like orphans until the pane mounts.
          const allPtyIds = hasLeafMappings
            ? (Object.values(leafPtyMap).filter(Boolean) as string[])
            : [tabLevelPtyId]
          reconnectedTabsByWorktree[worktreeId] = nextTabs.map((t) =>
            t.id === tabId ? { ...t, ptyId: tabLevelPtyId } : t
          )
          // Why: hide-sleeping reads ptyIdsByTabId for liveness; restored daemon sessions run before their pane remounts, so advertise them.
          reconnectedPtyIdsByTabId ??= { ...ptyIdsByTabId }
          reconnectedPtyIdsByTabId[tabId] = allPtyIds
        }
      }
    }

    // Why: deferred SSH targets haven't connected yet, so their ptyIds weren't restored above; stash session IDs in a map that survives cleanup for pty-connection.ts's deferred reconnect.
    const scopedTabIds = new Set(
      [...(scopedWorkspaceKeys ?? ids)].flatMap((workspaceKey) =>
        (tabsByWorktree[workspaceKey] ?? []).map((tab) => tab.id)
      )
    )
    const deferredSshSessionIdsByTabId: Record<string, string> = options
      ? Object.fromEntries(
          Object.entries(get().deferredSshSessionIdsByTabId).filter(
            ([tabId]) => !scopedTabIds.has(tabId)
          )
        )
      : {}
    for (const worktreeId of ids) {
      const worktree = worktreeById.get(worktreeId)
      // Why: SSH worktrees aren't in worktreesByRepo at cold start; fall back to the repo id in the composite worktree id so sessions still reach the deferred map.
      const repoId = worktree?.repoId ?? getRepoIdFromWorktreeId(worktreeId)
      const repo = repoId ? (repoById.get(repoId) ?? null) : null
      const connectionId = options?.directSshAuthority.targetId ?? repo?.connectionId
      if (!connectionId) {
        continue
      }
      // Why: a repo can outlive its SSH target when the target was removed out of
      // band (a crash between removal and cleanup, or edited out of the config).
      // Once the authoritative target list has loaded, don't re-defer sessions for
      // a target it no longer lists — a stranded deferred id reads as liveness and
      // the orphan sweep could never remove the dead tab. Defer while the list is
      // still unknown so a normal cold-start reconnect isn't dropped (#9911).
      if (get().sshTargetsHydrated && !get().sshTargetLabels.has(connectionId)) {
        continue
      }
      const sshConnected = get().sshConnectionStates.get(connectionId)?.status === 'connected'
      if (sshConnected) {
        continue
      }
      const tabs = tabsByWorktree[worktreeId] ?? []
      for (const tab of tabs) {
        const sessionId = pendingReconnectPtyIdByTabId[tab.id]
        if (sessionId && (!options || parseAppSshPtyId(sessionId)?.connectionId === connectionId)) {
          deferredSshSessionIdsByTabId[tab.id] = sessionId
        }
      }
    }

    if (
      signal?.aborted ||
      (options && !isCurrentDirectSshAuthority(get(), options.directSshAuthority))
    ) {
      return
    }
    const remainingReconnectWorktreeIds = options
      ? pendingReconnectWorktreeIds.filter((id) => !scopedWorkspaceKeys?.has(id))
      : []
    const remainingReconnectTabByWorktree = options
      ? Object.fromEntries(
          Object.entries(pendingReconnectTabByWorktree).filter(
            ([workspaceKey]) => !scopedWorkspaceKeys?.has(workspaceKey)
          )
        )
      : {}
    const remainingReconnectPtyIdByTabId = options
      ? Object.fromEntries(
          Object.entries(pendingReconnectPtyIdByTabId).filter(([tabId]) => !scopedTabIds.has(tabId))
        )
      : {}
    set({
      ...(reconnectedTabsByWorktree ? { tabsByWorktree: reconnectedTabsByWorktree } : {}),
      ...(reconnectedPtyIdsByTabId ? { ptyIdsByTabId: reconnectedPtyIdsByTabId } : {}),
      ...(options ? {} : { workspaceSessionReady: true }),
      pendingReconnectWorktreeIds: remainingReconnectWorktreeIds,
      pendingReconnectTabByWorktree: remainingReconnectTabByWorktree,
      pendingReconnectPtyIdByTabId: remainingReconnectPtyIdByTabId,
      deferredSshSessionIdsByTabId
    })
  }
  }
}