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
export function createTerminalSliceConsumeSuppressedPtyExitActions11(set: SliceSet, get: SliceGet) {
  return {
  consumeSuppressedPtyExit: (ptyId) => {
    let wasSuppressed = false
    set((s) => {
      if (!s.suppressedPtyExitIds[ptyId]) {
        return {}
      }
      wasSuppressed = true
      const next = { ...s.suppressedPtyExitIds }
      delete next[ptyId]
      return { suppressedPtyExitIds: next }
    })
    return wasSuppressed
  },
  isPtyShutdownPending: (ptyId) => (get().pendingPtyShutdownIds[ptyId] ?? 0) > 0,
  suppressPtyExit: (ptyId) => {
    set((s) => ({
      suppressedPtyExitIds: { ...s.suppressedPtyExitIds, [ptyId]: true }
    }))
  },
  queueCodexPaneRestarts: (ptyIds) => {
    if (ptyIds.length === 0) {
      return
    }
    set((s) => {
      // Why: the prompt is answered the moment the user asks for a restart. A
      // pane whose tab isn't mounted can only restart when it next mounts, and
      // leaving the prompt up re-showed a button that now does nothing.
      const nextCodexRestartNoticeByPtyId = { ...s.codexRestartNoticeByPtyId }
      for (const ptyId of ptyIds) {
        const notice = nextCodexRestartNoticeByPtyId[ptyId]
        if (notice) {
          // Why: mirror of the strip in dismissCodexRestartNotices. A queued
          // restart leaves the pane on the old account until it relaunches, so
          // it must re-block input that an earlier dismissal had freed.
          const { dismissed: _dismissed, ...kept } = notice
          nextCodexRestartNoticeByPtyId[ptyId] = { ...kept, restartRequested: true }
        }
      }
      return {
        pendingCodexPaneRestartIds: {
          ...s.pendingCodexPaneRestartIds,
          ...Object.fromEntries(ptyIds.map((ptyId) => [ptyId, true] as const))
        },
        codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId
      }
    })
  },
  consumePendingCodexPaneRestart: (ptyId) => {
    let wasQueued = false
    set((s) => {
      if (!s.pendingCodexPaneRestartIds[ptyId]) {
        return {}
      }
      wasQueued = true
      const next = { ...s.pendingCodexPaneRestartIds }
      delete next[ptyId]
      return { pendingCodexPaneRestartIds: next }
    })
    return wasQueued
  },
  markCodexRestartNotices: (notices) => {
    if (notices.length === 0) {
      return []
    }
    const noticedPtyIds: string[] = []
    set((s) => {
      const next = { ...s.codexRestartNoticeByPtyId }
      const nextPendingCodexPaneRestartIds = { ...s.pendingCodexPaneRestartIds }
      for (const notice of notices) {
        const existing = next[notice.ptyId]
        // Why one record rather than two lookups: the label and the id of the
        // launch account have to come from the same source, or they can end up
        // describing two different accounts.
        const launch = existing ?? notice
        const target = { id: notice.nextAccountId, label: notice.nextAccountLabel }

        // Why: a live Codex pane keeps its original launch account until it actually restarts, so A -> B -> A must not leave a stale restart notice.
        if (
          isSameCodexRestartNoticeAccount(
            { id: launch.previousAccountId, label: launch.previousAccountLabel },
            target
          )
        ) {
          delete next[notice.ptyId]
          delete nextPendingCodexPaneRestartIds[notice.ptyId]
          continue
        }

        next[notice.ptyId] = {
          previousAccountLabel: launch.previousAccountLabel,
          nextAccountLabel: notice.nextAccountLabel,
          ...(launch.previousAccountId === undefined
            ? {}
            : { previousAccountId: launch.previousAccountId }),
          ...(notice.nextAccountId === undefined ? {} : { nextAccountId: notice.nextAccountId }),
          // Why: a queued restart relaunches under whatever account is selected
          // when it runs, so a later switch does not reopen an answered prompt.
          ...(existing?.restartRequested ? { restartRequested: true as const } : {}),
          // Why: a dismissal answered one question — "keep the launch account
          // instead of this one". Only a genuinely different target re-asks it,
          // so a later C reopens the prompt while adding an account or
          // reauthenticating the active one (both re-mark live panes with the
          // selection unchanged) must not resurrect it and re-mute the pane.
          ...(existing?.dismissed &&
          isSameCodexRestartNoticeAccount(
            { id: existing.nextAccountId, label: existing.nextAccountLabel },
            target
          )
            ? { dismissed: true as const }
            : {})
        }
        noticedPtyIds.push(notice.ptyId)
      }
      return {
        codexRestartNoticeByPtyId: next,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds
      }
    })
    return noticedPtyIds
  },
  clearCodexRestartNotice: (ptyId) => {
    set((s) => {
      if (!s.codexRestartNoticeByPtyId[ptyId]) {
        return {}
      }
      const next = { ...s.codexRestartNoticeByPtyId }
      const nextPendingCodexPaneRestartIds = { ...s.pendingCodexPaneRestartIds }
      delete next[ptyId]
      delete nextPendingCodexPaneRestartIds[ptyId]
      return {
        codexRestartNoticeByPtyId: next,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds
      }
    })
  },
  dismissCodexRestartNotices: (ptyIds) => {
    set((s) => {
      // Why: keeping the old account is an answer, not a restart — the record
      // stays so `previousAccountLabel` still names the pane's launch account,
      // but every consumer treats it as answered (prompt hidden, input freed).
      const next = { ...s.codexRestartNoticeByPtyId }
      const nextPendingCodexPaneRestartIds = { ...s.pendingCodexPaneRestartIds }
      let changed = false
      for (const ptyId of ptyIds) {
        const notice = next[ptyId]
        if (!notice || notice.dismissed) {
          continue
        }
        const { restartRequested: _restartRequested, ...kept } = notice
        next[ptyId] = { ...kept, dismissed: true }
        delete nextPendingCodexPaneRestartIds[ptyId]
        changed = true
      }
      if (!changed) {
        return {}
      }
      return {
        codexRestartNoticeByPtyId: next,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds
      }
    })
  },
  setTabPaneExpanded: (tabId, expanded) => {
    set((s) => ({
      expandedPaneByTabId: { ...s.expandedPaneByTabId, [tabId]: expanded }
    }))
  },
  setTabCanExpandPane: (tabId, canExpand) => {
    set((s) => ({
      canExpandPaneByTabId: { ...s.canExpandPaneByTabId, [tabId]: canExpand }
    }))
  },
  setTabLayout: (tabId, layout) => {
    set((s) => {
      const next = { ...s.terminalLayoutsByTabId }
      if (layout) {
        next[tabId] = layout
      } else {
        delete next[tabId]
      }
      return { terminalLayoutsByTabId: next }
    })
  },
  syncPaneDetachPtyOwnership: ({
    detachedLeafId,
    detachedPtyId,
    sourceLayout,
    sourceTabId,
    targetTabId
  }) => {
    const sourcePaneKey = makePaneKey(sourceTabId, detachedLeafId)
    const targetPaneKey = makePaneKey(targetTabId, detachedLeafId)
    set((s) => {
      const layoutSourcePtyIds = uniquePtyIds(Object.values(sourceLayout.ptyIdsByLeafId ?? {}))
      const existingSourcePtyIds = (s.ptyIdsByTabId[sourceTabId] ?? []).filter(
        (ptyId) => ptyId !== detachedPtyId
      )
      const sourcePtyIds = layoutSourcePtyIds.length > 0 ? layoutSourcePtyIds : existingSourcePtyIds
      const sourcePrimaryPtyId = resolvePrimaryLayoutPtyId(sourceLayout) ?? sourcePtyIds[0] ?? null
      const nextPtyIdsByTabId = {
        ...s.ptyIdsByTabId,
        [sourceTabId]: sourcePtyIds
      }
      if (detachedPtyId) {
        nextPtyIdsByTabId[targetTabId] = uniquePtyIds([
          ...(nextPtyIdsByTabId[targetTabId] ?? []),
          detachedPtyId
        ])
      }

      const nextLastKnownRelayPtyIdByTabId = { ...s.lastKnownRelayPtyIdByTabId }
      if (sourcePrimaryPtyId) {
        nextLastKnownRelayPtyIdByTabId[sourceTabId] = sourcePrimaryPtyId
      } else {
        delete nextLastKnownRelayPtyIdByTabId[sourceTabId]
      }
      if (detachedPtyId) {
        nextLastKnownRelayPtyIdByTabId[targetTabId] = detachedPtyId
      }

      // Why: pane-to-tab detach moves a live PTY without spawning or exiting, so transfer identity without activity bumps.
      const sourceTabsByWorktree = withTerminalTabPtyId(
        s.tabsByWorktree,
        sourceTabId,
        sourcePrimaryPtyId
      )
      const nextTabsByWorktree = detachedPtyId
        ? withTerminalTabPtyId(sourceTabsByWorktree, targetTabId, detachedPtyId)
        : sourceTabsByWorktree
      const directSshLedger = transferDirectSshPaneDetachLedger(s, {
        detachedPtyId,
        sourcePtyId: sourcePrimaryPtyId,
        sourceTabId,
        targetTabId,
        isAuthorityCurrent: (authority) => isCurrentDirectSshAuthority(s, authority)
      })

      return {
        ptyIdsByTabId: nextPtyIdsByTabId,
        lastKnownRelayPtyIdByTabId: nextLastKnownRelayPtyIdByTabId,
        ...directSshLedger,
        ...(nextTabsByWorktree !== s.tabsByWorktree ? { tabsByWorktree: nextTabsByWorktree } : {})
      }
    })
    // Why: detach keeps the process and its pane key alive, so move resume/status authority to the new surface before the source closes.
    get().transferAgentPaneAuthority({
      fromPaneKey: sourcePaneKey,
      toPaneKey: targetPaneKey,
      ptyId: detachedPtyId
    })
  },
  queueTabStartupCommand: (tabId, startup) => {
    // Why: launchToken is only meaningful for tracked launch-config reuse; plain startup commands must not mint a synthetic token.
    const launchToken = startup.launchConfig
      ? (startup.launchToken ?? createBrowserUuid())
      : undefined
    set((s) => ({
      pendingStartupByTabId: {
        ...s.pendingStartupByTabId,
        [tabId]: {
          ...startup,
          ...(launchToken ? { launchToken } : {})
        }
      }
    }))
  },
  queueTabInitialCwd: (tabId, cwd) => {
    set((s) => ({
      pendingInitialCwdByTabId: {
        ...s.pendingInitialCwdByTabId,
        [tabId]: cwd
      }
    }))
  },
  consumeTabInitialCwd: (tabId) => {
    const pending = get().pendingInitialCwdByTabId[tabId]
    if (!pending) {
      return null
    }
    set((s) => {
      const next = { ...s.pendingInitialCwdByTabId }
      delete next[tabId]
      return { pendingInitialCwdByTabId: next }
    })
    return pending
  },
  consumeTabStartupCommand: (tabId) => {
    const pending = get().pendingStartupByTabId[tabId]
    if (!pending) {
      return null
    }

    set((s) => {
      const next = { ...s.pendingStartupByTabId }
      delete next[tabId]
      return { pendingStartupByTabId: next }
    })

    return pending
  },
  }
}
