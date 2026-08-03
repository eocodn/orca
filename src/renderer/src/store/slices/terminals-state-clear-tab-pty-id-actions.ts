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
export function createTerminalSliceClearTabPtyIdActions7(set: SliceSet, get: SliceGet) {
  return {
  clearTabPtyId: (tabId, ptyId) => {
    if (ptyId && get().pendingPtyShutdownIds[ptyId]) {
      // Why: an owner exit can arrive before its post-stop inventory; keep the renderer binding retryable until verification commits.
      return
    }
    let worktreeId: string | null = null
    let wasActivationSpawn = false
    let preservesDirectSshContinuationGap = false
    let isRemoteRuntimeMirror = isRemoteRuntimePtyId(ptyId)
    set((s) => {
      const existingPtyIds = s.ptyIdsByTabId[tabId] ?? []
      const remainingPtyIds = ptyId ? existingPtyIds.filter((id) => id !== ptyId) : []
      const liveBinding = s.directSshLivePtyBindingByTabId[tabId]
      let nextTabsByWorktree = s.tabsByWorktree
      for (const [wId, tabs] of Object.entries(s.tabsByWorktree)) {
        const index = tabs.findIndex((t) => t.id === tabId)
        if (index === -1) {
          continue
        }
        worktreeId = wId
        const tab = tabs[index]
        if (getPendingActivationSpawnCount(tab.pendingActivationSpawn) > 0) {
          wasActivationSpawn = true
        }
        if (!ptyId) {
          isRemoteRuntimeMirror =
            existingPtyIds.length > 0 && existingPtyIds.every((id) => isRemoteRuntimePtyId(id))
        }
        // Why: consume pendingActivationSpawn on real activation clears, but keep it when clearing a stale wake-hint id — its fallback spawn still needs the suppression.
        const { pendingActivationSpawn: _unused, ...rest } = tab
        void _unused
        const nextTabPtyId = remainingPtyIds.at(-1) ?? null
        preservesDirectSshContinuationGap = Boolean(
          ptyId &&
          remainingPtyIds.length === 0 &&
          liveBinding?.ptyId === ptyId &&
          getPendingActivationSpawnCount(tab.pendingActivationSpawn) > 0 &&
          isCurrentDirectSshAuthority(s, liveBinding.authority)
        )
        const shouldRetainActivationSpawn =
          preservesDirectSshContinuationGap ||
          (wasActivationSpawn && ptyId != null && !existingPtyIds.includes(ptyId))
        const nextPendingActivationSpawn = shouldRetainActivationSpawn
          ? tab.pendingActivationSpawn
          : consumePendingActivationSpawn(tab.pendingActivationSpawn)
        if (tab.pendingActivationSpawn || tab.ptyId !== nextTabPtyId) {
          const nextTabs = [...tabs]
          nextTabs[index] = {
            ...rest,
            ...(nextPendingActivationSpawn
              ? { pendingActivationSpawn: nextPendingActivationSpawn }
              : {}),
            ptyId: nextTabPtyId
          }
          nextTabsByWorktree = { ...s.tabsByWorktree, [wId]: nextTabs }
        }
        break
      }
      const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
      if (worktreeId) {
        nextPtyIdsByTabId[tabId] = remainingPtyIds
      } else {
        // Why: repo purge can retire the owning tab before its async exit arrives; don't resurrect an orphan PTY index.
        delete nextPtyIdsByTabId[tabId]
      }
      const nextPendingCodexPaneRestartIds = { ...s.pendingCodexPaneRestartIds }
      const nextCodexRestartNoticeByPtyId = { ...s.codexRestartNoticeByPtyId }
      if (ptyId) {
        delete nextPendingCodexPaneRestartIds[ptyId]
        delete nextCodexRestartNoticeByPtyId[ptyId]
      } else {
        for (const currentPtyId of s.ptyIdsByTabId[tabId] ?? []) {
          delete nextPendingCodexPaneRestartIds[currentPtyId]
          delete nextCodexRestartNoticeByPtyId[currentPtyId]
        }
      }
      // Why: a passed ptyId means the PTY actually exited — drop its lastKnown so restart won't reattach a dead relay; bulk clear (connection_lost) keeps it during relay grace.
      const nextLastKnownRelay = { ...s.lastKnownRelayPtyIdByTabId }
      if (ptyId && nextLastKnownRelay[tabId] === ptyId) {
        // Why: the relay slot holds ONE id per tab (the last pane to bind). If
        // that pane exits, promote a surviving pane instead of clearing — else the
        // survivor is left visible only in the layout leaf map, and a later
        // relay-drop bulk-clear lets the orphan sweep delete the still-live tab
        // (the orphan predicate reads this map but not layout leaves) (#9911).
        const survivingPtyId = remainingPtyIds.at(-1)
        if (survivingPtyId) {
          nextLastKnownRelay[tabId] = survivingPtyId
        } else {
          delete nextLastKnownRelay[tabId]
        }
      }
      let nextDirectSshPaneRetryByTabId = s.directSshPaneRetryByTabId
      const pendingRetry = s.directSshPaneRetryByTabId[tabId]
      if (
        pendingRetry &&
        (!ptyId ||
          (existingPtyIds.includes(ptyId) &&
            parseAppSshPtyId(ptyId)?.connectionId === pendingRetry.authority.targetId))
      ) {
        nextDirectSshPaneRetryByTabId = { ...s.directSshPaneRetryByTabId }
        delete nextDirectSshPaneRetryByTabId[tabId]
      }
      let nextDirectSshLivePtyBindingByTabId = s.directSshLivePtyBindingByTabId
      if (liveBinding && (!ptyId || liveBinding.ptyId === ptyId)) {
        nextDirectSshLivePtyBindingByTabId = {
          ...s.directSshLivePtyBindingByTabId
        }
        const promotedPtyId = ptyId ? remainingPtyIds.at(-1) : undefined
        if (
          promotedPtyId &&
          parseAppSshPtyId(promotedPtyId)?.connectionId === liveBinding.authority.targetId &&
          isCurrentDirectSshAuthority(s, liveBinding.authority)
        ) {
          nextDirectSshLivePtyBindingByTabId[tabId] = {
            ...liveBinding,
            ptyId: promotedPtyId
          }
        } else if (!preservesDirectSshContinuationGap) {
          delete nextDirectSshLivePtyBindingByTabId[tabId]
        }
      }

      return {
        ...(nextTabsByWorktree !== s.tabsByWorktree ? { tabsByWorktree: nextTabsByWorktree } : {}),
        ptyIdsByTabId: nextPtyIdsByTabId,
        lastKnownRelayPtyIdByTabId: nextLastKnownRelay,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds,
        codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId,
        directSshPaneRetryByTabId: nextDirectSshPaneRetryByTabId,
        directSshLivePtyBindingByTabId: nextDirectSshLivePtyBindingByTabId
      }
    })

    // Bump activity on PTY exit, but skip intentional shutdowns (suppressed exits) and click-driven pane unmounts (pendingActivationSpawn).
    if (
      worktreeId &&
      !wasActivationSpawn &&
      !isRemoteRuntimeMirror &&
      !hasWorktreeSleepIntent(worktreeId) &&
      !(ptyId && get().suppressedPtyExitIds[ptyId])
    ) {
      get().bumpWorktreeActivity(worktreeId)
    }
  },
  }
}
