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
export function createTerminalSliceUpdateTabPtyIdActions6(set: SliceSet, get: SliceGet) {
  return {
  updateTabPtyId: (tabId, ptyId, replacedPtyId, directSshRetryAttemptId) => {
    // Why: final guard preventing a late caller from recreating retired tab maps (async spawn owners still do their own provider teardown).
    if (!isTerminalTabPresent(get(), tabId)) {
      return
    }
    let worktreeId: string | null = null
    let wasActivationSpawn = false
    const isRemoteRuntimeMirror = isRemoteRuntimePtyId(ptyId)
    set((s) => {
      if (directSshRetryAttemptId) {
        const pendingRetry = s.directSshPaneRetryByTabId[tabId]
        const liveRetry = s.directSshLivePtyBindingByTabId[tabId]
        const retryLease =
          pendingRetry?.attemptId === directSshRetryAttemptId
            ? pendingRetry
            : liveRetry?.attemptId === directSshRetryAttemptId
              ? liveRetry
              : undefined
        const boundTab = Object.values(s.tabsByWorktree)
          .flat()
          .find((candidate) => candidate.id === tabId)
        if (
          !retryLease ||
          !boundTab ||
          parseAppSshPtyId(ptyId)?.connectionId !== retryLease.authority.targetId ||
          !isCurrentDirectSshAuthority(s, retryLease.authority) ||
          (boundTab.generation ?? 0) !== retryLease.tabGeneration
        ) {
          return s
        }
      }
      const existingPtyIds = s.ptyIdsByTabId[tabId] ?? []
      const remote = parseRemoteRuntimePtyId(ptyId)
      const legacyRemotePtyId = remote?.environmentId ? toRemoteRuntimePtyId(remote.handle) : null
      const hasLegacyPtyBinding = legacyRemotePtyId
        ? existingPtyIds.includes(legacyRemotePtyId)
        : false
      const explicitReplacementPtyId = replacedPtyId !== ptyId ? replacedPtyId : undefined
      const replacementPtyId =
        explicitReplacementPtyId ?? (hasLegacyPtyBinding ? legacyRemotePtyId : null)
      const boundReplacementPtyId =
        replacementPtyId && existingPtyIds.includes(replacementPtyId) ? replacementPtyId : null
      const nextPtyIds = boundReplacementPtyId
        ? [...new Set(existingPtyIds.map((id) => (id === boundReplacementPtyId ? ptyId : id)))]
        : existingPtyIds.includes(ptyId)
          ? existingPtyIds
          : [...existingPtyIds, ptyId]
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
        // Why: consume one pendingActivationSpawn unit — a split remounts several panes per click, each activation callback suppressed without hiding later real activity.
        const { pendingActivationSpawn: _unused, ...rest } = tab
        void _unused
        // Why: tab.ptyId is the single-pane fallback for legacy attach; later split-pane spawns must not steal it or remount/close reattaches the tab to the wrong PTY.
        const currentTabPtyId = tab.ptyId === replacementPtyId ? ptyId : tab.ptyId
        const nextTabPtyId = currentTabPtyId ?? nextPtyIds[0] ?? null
        const nextPendingActivationSpawn = consumePendingActivationSpawn(tab.pendingActivationSpawn)
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
      // Why: a new active-worktree tab's first PTY flips the live-tab signal (+12), so bump sortEpoch — but suppress on activation spawns (click side-effect, not activity).
      const isFirstPty = existingPtyIds.length === 0
      const isActiveWorktree = worktreeId != null && s.activeWorktreeId === worktreeId
      const shouldBumpSortEpoch = isFirstPty && isActiveWorktree && !wasActivationSpawn
      const shouldRetainSuppressedExit = Boolean(
        explicitReplacementPtyId &&
        (s.suppressedPtyExitIds[ptyId] ||
          (replacementPtyId && s.suppressedPtyExitIds[replacementPtyId]))
      )
      const nextSuppressedPtyExitIds = { ...s.suppressedPtyExitIds }
      delete nextSuppressedPtyExitIds[ptyId]
      if (replacementPtyId) {
        delete nextSuppressedPtyExitIds[replacementPtyId]
      }
      if (shouldRetainSuppressedExit) {
        // Why: handle rotation keeps the same terminal lifecycle; an intentional exit racing the rotation must stay suppressed once.
        nextSuppressedPtyExitIds[ptyId] = true
      }
      const hasReplacementPendingRestart = replacementPtyId
        ? replacementPtyId in s.pendingCodexPaneRestartIds
        : false
      const hasReplacementRestartNotice = replacementPtyId
        ? replacementPtyId in s.codexRestartNoticeByPtyId
        : false
      const hasReplacementMigrationUnsupported = replacementPtyId
        ? replacementPtyId in s.migrationUnsupportedByPtyId
        : false
      const nextPendingCodexPaneRestartIds = hasReplacementPendingRestart
        ? { ...s.pendingCodexPaneRestartIds }
        : s.pendingCodexPaneRestartIds
      const nextCodexRestartNoticeByPtyId = hasReplacementRestartNotice
        ? { ...s.codexRestartNoticeByPtyId }
        : s.codexRestartNoticeByPtyId
      const nextMigrationUnsupportedByPtyId = hasReplacementMigrationUnsupported
        ? { ...s.migrationUnsupportedByPtyId }
        : s.migrationUnsupportedByPtyId
      if (replacementPtyId) {
        if (hasReplacementPendingRestart) {
          nextPendingCodexPaneRestartIds[ptyId] = true
          delete nextPendingCodexPaneRestartIds[replacementPtyId]
        }
        if (hasReplacementRestartNotice) {
          const replacedNotice = nextCodexRestartNoticeByPtyId[replacementPtyId]
          nextCodexRestartNoticeByPtyId[ptyId] ??= replacedNotice
          delete nextCodexRestartNoticeByPtyId[replacementPtyId]
        }
        if (hasReplacementMigrationUnsupported) {
          const replacedMigrationUnsupported = nextMigrationUnsupportedByPtyId[replacementPtyId]
          nextMigrationUnsupportedByPtyId[ptyId] ??= {
            ...replacedMigrationUnsupported,
            ptyId
          }
          delete nextMigrationUnsupportedByPtyId[replacementPtyId]
        }
      }
      const pendingRetry = s.directSshPaneRetryByTabId[tabId]
      const liveRetry = s.directSshLivePtyBindingByTabId[tabId]
      const retryLease =
        pendingRetry?.attemptId === directSshRetryAttemptId
          ? pendingRetry
          : liveRetry?.attemptId === directSshRetryAttemptId
            ? liveRetry
            : undefined
      const boundTab = worktreeId
        ? nextTabsByWorktree[worktreeId]?.find((candidate) => candidate.id === tabId)
        : undefined
      const parsedSshPty = parseAppSshPtyId(ptyId)
      const acknowledgesDirectSshRetry = Boolean(
        retryLease &&
        boundTab &&
        parsedSshPty?.connectionId === retryLease.authority.targetId &&
        isCurrentDirectSshAuthority(s, retryLease.authority) &&
        (boundTab.generation ?? 0) === retryLease.tabGeneration &&
        nextPtyIds.includes(ptyId)
      )
      let nextDirectSshPaneRetryByTabId = s.directSshPaneRetryByTabId
      let nextDirectSshLivePtyBindingByTabId = s.directSshLivePtyBindingByTabId
      if (acknowledgesDirectSshRetry && retryLease && boundTab?.ptyId) {
        if (pendingRetry?.attemptId === directSshRetryAttemptId) {
          nextDirectSshPaneRetryByTabId = { ...s.directSshPaneRetryByTabId }
          delete nextDirectSshPaneRetryByTabId[tabId]
        }
        if (!liveRetry || liveRetry.attemptId !== directSshRetryAttemptId) {
          nextDirectSshLivePtyBindingByTabId = {
            ...s.directSshLivePtyBindingByTabId,
            [tabId]: {
              attemptId: retryLease.attemptId,
              authority: retryLease.authority,
              tabGeneration: retryLease.tabGeneration,
              ptyId: boundTab.ptyId
            }
          }
        } else if (
          (replacementPtyId === liveRetry.ptyId && boundTab.ptyId === ptyId) ||
          !nextPtyIds.includes(liveRetry.ptyId)
        ) {
          nextDirectSshLivePtyBindingByTabId = {
            ...s.directSshLivePtyBindingByTabId,
            [tabId]: { ...liveRetry, ptyId: boundTab.ptyId }
          }
        }
      } else {
        const liveBinding = s.directSshLivePtyBindingByTabId[tabId]
        if (liveBinding) {
          if (
            replacementPtyId === liveBinding.ptyId &&
            boundTab?.ptyId === ptyId &&
            isCurrentDirectSshAuthority(s, liveBinding.authority)
          ) {
            nextDirectSshLivePtyBindingByTabId = {
              ...s.directSshLivePtyBindingByTabId,
              [tabId]: { ...liveBinding, ptyId }
            }
          }
        }
      }
      return {
        ...(nextTabsByWorktree !== s.tabsByWorktree ? { tabsByWorktree: nextTabsByWorktree } : {}),
        ptyIdsByTabId: {
          ...s.ptyIdsByTabId,
          [tabId]: nextPtyIds
        },
        lastKnownRelayPtyIdByTabId: {
          ...s.lastKnownRelayPtyIdByTabId,
          [tabId]: ptyId
        },
        suppressedPtyExitIds: nextSuppressedPtyExitIds,
        pendingCodexPaneRestartIds: nextPendingCodexPaneRestartIds,
        codexRestartNoticeByPtyId: nextCodexRestartNoticeByPtyId,
        migrationUnsupportedByPtyId: nextMigrationUnsupportedByPtyId,
        directSshPaneRetryByTabId: nextDirectSshPaneRetryByTabId,
        directSshLivePtyBindingByTabId: nextDirectSshLivePtyBindingByTabId,
        ...(shouldBumpSortEpoch ? { sortEpoch: s.sortEpoch + 1 } : {})
      }
    })

    // Why: activation spawns come from clicking a worktree, not work in it — skip the lastActivityAt stamp and sortEpoch bump; other spawn reasons still bump.
    if (worktreeId && !wasActivationSpawn && !isRemoteRuntimeMirror) {
      get().bumpWorktreeActivity(worktreeId)
    }
  },
  }
}
