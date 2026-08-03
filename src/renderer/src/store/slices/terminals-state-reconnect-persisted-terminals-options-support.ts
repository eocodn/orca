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
import { getNextTerminalOrdinal, isRemoteRuntimePtyId, isCurrentDirectSshAuthority, resolveDirectSshTerminalKeys, getPendingActivationSpawnCount, consumePendingActivationSpawn, getFallbackTabTitle, getPathDisplayName, buildRuntimeSessionPlaceholders, getTerminalTabOwnerWorktreeId, updateUnifiedTerminalLabel, updateUnifiedTerminalGeneratedLabel, getTabIdFromPaneKey, isWindowsRendererRuntime, isAllowedRemoteWindowsTerminalShell, resolveCreatedTabShellOverride, worktreeUsesWslPath, worktreeUsesRemoteConnection, getRemoteConnectionIdForWorktree, resolveTerminalStopRuntimeEnvironmentId, sortedUniquePtyIds, equalStringSets, uniquePtyIds, resolvePrimaryLayoutPtyId, withTerminalTabPtyId } from './terminals-state'
import type { AutomaticAgentResumeClaim, CodexRestartNotice, TerminalSlice, HydrateWorkspaceSessionOptions } from './terminals-state'
export type ReconnectPersistedTerminalsOptions = {
  directSshAuthority: DirectSshAuthority
  workspaceKeys: readonly string[]
}
export type WorkspaceHydrationPatch = Pick<
  AppState,
  | 'activeRepoId'
  | 'activeWorktreeId'
  | 'activeWorkspaceKey'
  | 'activeWorkspaceExecutionHostId'
  | 'activeTabId'
  | 'activeTabIdByWorktree'
  | 'restoredRuntimeHostIdByWorkspaceSessionKey'
  | 'repos'
  | 'tabsByWorktree'
  | 'worktreesByRepo'
  | 'lastVisitedAtByWorktreeId'
  | 'defaultTerminalTabsAppliedByWorktreeId'
  | 'automaticAgentResumeClaimsByTabId'
  | 'sleepingAgentSessionsByPaneKey'
  | 'pendingReconnectWorktreeIds'
  | 'pendingReconnectTabByWorktree'
  | 'pendingReconnectPtyIdByTabId'
  | 'everActivatedWorktreeIds'
  | 'worktreeNavHistory'
  | 'worktreeNavHistoryIndex'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
>
export function replaceHydratedRecordKeys<T>(
  current: Record<string, T>,
  hydrated: Record<string, T>,
  replaceKeys: ReadonlySet<string>
): Record<string, T> {
  return {
    ...Object.fromEntries(Object.entries(current).filter(([key]) => !replaceKeys.has(key))),
    ...Object.fromEntries(Object.entries(hydrated).filter(([key]) => replaceKeys.has(key)))
  }
}
export function targetScopedWorkspaceHydrationPatch(
  state: AppState,
  hydrated: WorkspaceHydrationPatch,
  session: WorkspaceSessionState,
  options: HydrateWorkspaceSessionOptions
): Partial<AppState> {
  const workspaceKeys = new Set(options.replaceWorkspaceKeys)
  const targetTabIds = new Set(
    [...workspaceKeys].flatMap((workspaceKey) => [
      ...(state.tabsByWorktree[workspaceKey] ?? []).map((tab) => tab.id),
      ...(session.tabsByWorktree[workspaceKey] ?? []).map((tab) => tab.id)
    ])
  )
  const retainedTargetTabIds = new Set(
    [...workspaceKeys].flatMap((workspaceKey) =>
      (hydrated.tabsByWorktree[workspaceKey] ?? []).map((tab) => tab.id)
    )
  )
  const deletedTargetTabIds = new Set(
    [...workspaceKeys]
      .flatMap((workspaceKey) => (state.tabsByWorktree[workspaceKey] ?? []).map((tab) => tab.id))
      .filter((tabId) => !retainedTargetTabIds.has(tabId))
  )
  const pendingReconnectPtyIdByTabId = replaceHydratedRecordKeys(
    state.pendingReconnectPtyIdByTabId,
    {},
    targetTabIds
  )
  const authority = options.directSshAuthority
  if (authority) {
    for (const workspaceKey of hydrated.pendingReconnectWorktreeIds) {
      if (!workspaceKeys.has(workspaceKey)) {
        continue
      }
      for (const tab of session.tabsByWorktree[workspaceKey] ?? []) {
        const ptyId = session.remoteSessionIdsByTabId?.[tab.id] ?? tab.ptyId
        if (ptyId && parseAppSshPtyId(ptyId)?.connectionId === authority.targetId) {
          pendingReconnectPtyIdByTabId[tab.id] = ptyId
        }
      }
    }
  }
  const activeOutsideScope =
    state.activeWorktreeId != null && !workspaceKeys.has(state.activeWorktreeId)
  const sleepingAgentSessionsByPaneKey = Object.fromEntries([
    ...Object.entries(state.sleepingAgentSessionsByPaneKey).filter(
      ([, record]) => !workspaceKeys.has(record.worktreeId)
    ),
    ...Object.entries(hydrated.sleepingAgentSessionsByPaneKey).filter(([, record]) =>
      workspaceKeys.has(record.worktreeId)
    )
  ])
  const everActivatedWorktreeIds = new Set(state.everActivatedWorktreeIds)
  for (const workspaceKey of hydrated.everActivatedWorktreeIds) {
    if (workspaceKeys.has(workspaceKey)) {
      everActivatedWorktreeIds.add(workspaceKey)
    }
  }
  return {
    activeRepoId: activeOutsideScope ? state.activeRepoId : hydrated.activeRepoId,
    activeWorktreeId: activeOutsideScope ? state.activeWorktreeId : hydrated.activeWorktreeId,
    activeWorkspaceKey: activeOutsideScope ? state.activeWorkspaceKey : hydrated.activeWorkspaceKey,
    activeWorkspaceExecutionHostId: activeOutsideScope
      ? state.activeWorkspaceExecutionHostId
      : hydrated.activeWorkspaceExecutionHostId,
    activeTabId: activeOutsideScope ? state.activeTabId : hydrated.activeTabId,
    activeTabIdByWorktree: replaceHydratedRecordKeys(
      state.activeTabIdByWorktree,
      hydrated.activeTabIdByWorktree,
      workspaceKeys
    ),
    tabsByWorktree: replaceHydratedRecordKeys(
      state.tabsByWorktree,
      hydrated.tabsByWorktree,
      workspaceKeys
    ),
    lastVisitedAtByWorktreeId: replaceHydratedRecordKeys(
      state.lastVisitedAtByWorktreeId,
      hydrated.lastVisitedAtByWorktreeId,
      workspaceKeys
    ),
    defaultTerminalTabsAppliedByWorktreeId: replaceHydratedRecordKeys(
      state.defaultTerminalTabsAppliedByWorktreeId,
      hydrated.defaultTerminalTabsAppliedByWorktreeId,
      workspaceKeys
    ),
    automaticAgentResumeClaimsByTabId: replaceHydratedRecordKeys(
      state.automaticAgentResumeClaimsByTabId,
      hydrated.automaticAgentResumeClaimsByTabId,
      targetTabIds
    ),
    sleepingAgentSessionsByPaneKey,
    pendingReconnectWorktreeIds: [
      ...state.pendingReconnectWorktreeIds.filter((key) => !workspaceKeys.has(key)),
      ...hydrated.pendingReconnectWorktreeIds.filter((key) => workspaceKeys.has(key))
    ],
    pendingReconnectTabByWorktree: replaceHydratedRecordKeys(
      state.pendingReconnectTabByWorktree,
      hydrated.pendingReconnectTabByWorktree,
      workspaceKeys
    ),
    pendingReconnectPtyIdByTabId,
    everActivatedWorktreeIds,
    directSshPaneRetryByTabId: replaceHydratedRecordKeys(
      state.directSshPaneRetryByTabId,
      {},
      deletedTargetTabIds
    ),
    directSshLivePtyBindingByTabId: replaceHydratedRecordKeys(
      state.directSshLivePtyBindingByTabId,
      {},
      deletedTargetTabIds
    ),
    directSshPaneRetryHistoryByTabId: replaceHydratedRecordKeys(
      state.directSshPaneRetryHistoryByTabId,
      {},
      deletedTargetTabIds
    ),
    ptyIdsByTabId: replaceHydratedRecordKeys(
      state.ptyIdsByTabId,
      hydrated.ptyIdsByTabId,
      targetTabIds
    ),
    terminalLayoutsByTabId: replaceHydratedRecordKeys(
      state.terminalLayoutsByTabId,
      hydrated.terminalLayoutsByTabId,
      targetTabIds
    )
  }
}
