 import type { StateCreator, StoreApi } from 'zustand'
import type { AppState } from '../types'
import type {
  DetectedWorktreeListResult,
  LocalBaseRefRefreshResult,
  ForceDeleteWorktreeBranchResult,
  FolderWorkspace,
  GitHubPrStartPoint,
  Worktree,
  WorkspaceVisibleTabType,
  GitPushTarget,
  RemoveWorktreeResult,
  WorktreeLineage,
  WorkspaceLineage,
  ProjectHostSetup,
  WorktreeMeta
} from '../../../../shared/types'
import type { RuntimeWorktreeListResult } from '../../../../shared/runtime-types'
import {
  findWorktreeById,
  applyWorktreeUpdates,
  withoutErasedRequiredWorktreeFields,
  getRepoIdFromWorktreeId,
  type DirectSshWorktreeFetchOptions,
  type WorktreeFetchOptions,
  type WorktreeSlice
} from './worktree-helpers'
import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree-id'
import { areWorkspaceLinkedItemsEqual } from '../../../../shared/workspace-linked-item'
import { areTaskSourceContextsEqual } from '../../../../shared/task-source-context'
import {
  remapClosedTerminalTabSnapshotCwds,
  type ClosedTerminalTabSnapshot
} from './recently-closed-tabs'
import { findRepoForHost } from './repo-host-identity'
import {
  dropWorktreeRowsForRemovedRuntimeEnvironments,
  isRemovedRuntimeHostId
} from './stale-runtime-host-rows'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { disposeRemovedWorktreeParkedTerminalWatchers } from '../../components/terminal-pane/terminal-parked-watcher-registry'
import {
  callRuntimeRpc,
  assertRuntimeEnvironmentCapability,
  getActiveRuntimeTarget,
  isRuntimeScopeForbiddenError,
  RuntimeRpcCallError
} from '../../runtime/runtime-rpc-client'
import { WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { getHostedReviewCacheKey, refreshHostedReviewCard } from './hosted-review'
import { routeListingBranchSwitchesThroughGitIdentity } from './worktree-listing-branch-switch'
import { isPositiveHostedReviewNumber } from '../../../../shared/hosted-review'
import { getGitHubPRCacheKey, getLegacyGitHubPRCacheKey } from './github-cache-key'
import { moveFocusToRendererBeforeFocusedWebviewHidden } from './browser-webview-cleanup'
import { toast } from 'sonner'
import { requestVirtualizedScrollAnchorRecord } from '@/hooks/requestVirtualizedScrollAnchorRecord'
import { forgetAgentHibernationTabOutput } from '@/lib/agent-hibernation-output-activity'
import { forgetForegroundTerminalTabs } from '@/lib/foreground-terminal-tabs'
import { forgetAgentStartupDeliveriesForTabs } from '@/lib/agent-startup-delivery-guards'
import { forgetAgentPaneAuthorityAliasesByTabIds } from './agent-pane-authority'
import { branchName } from '@/lib/git-utils'
import { markInputQuietSchedulerInput, scheduleAfterInputQuiet } from '@/lib/input-quiet-scheduler'
import { clearSessionCommitDraftForWorktree } from '@/lib/source-control-commit-draft-session'
import {
  forgetHugeRepoWarningDismissalsForWorktrees,
  migrateHugeRepoWarningDismissal
} from '@/lib/source-control-huge-repo-warning-dismissals'
import { showLocalBaseRefUpdateSuggestionToast } from '@/components/sidebar/local-base-ref-suggestion-toast'
import { showPreservedBranchToast } from '@/components/sidebar/preserved-branch-toast'
import { requestWorktreeBaseFallbackNotice } from '@/components/worktree-base-fallback-notice'
import { translate } from '@/i18n/i18n'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  resolveWorktreeOperationRoute,
  settingsForWorktreeOperationRoute
} from '@/lib/worktree-operation-route'
import { captureWorktreeOperationGenerationGuard } from '@/lib/worktree-operation-generation'
import { getEnvironmentSshStateGeneration } from './runtime-environment-ssh'
import { getRuntimeEnvironmentConnectionGeneration } from './runtime-status'
import {
  folderWorkspaceKey,
  getActiveSidebarWorkspaceId,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import { folderWorkspaceToWorktree } from '../../../../shared/folder-workspace-worktree'
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  isRetryableWorktreeCreateConflict
} from '../../../../shared/new-workspace/worktree-create-retry-policy'
import {
  classifyWorktreeForceDeleteReason,
  getLockedWorktreeRemovalReason,
  isLockedWorktreeRemovalError
} from '../../../../shared/worktree-removal'
import { FolderWorkspaceActivityPersistence } from './folder-workspace-activity-persistence'
import {
  createDetectedWorktreeRefreshLeaseRegistry,
  type DetectedWorktreeRefreshLease
} from './detected-worktree-refresh-leases'
import { getTerminalActivationSpawnSuppression } from './terminal-activation-spawn-suppression'
import type {
  HostQualifiedDetectedWorktreeResult,
  ListDetectedWorktreesArgs,
  ProviderRequestId,
  SshExecutionHostId
} from '../../../../shared/detected-worktree-provider-contract'
import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { findIndexedWorktreeOwnerForHost } from '@/lib/worktree-runtime-owner-index'
export type { WorktreeSlice, WorktreeDeleteState } from './worktree-helpers'

// Why: old runtime servers only have `worktree.list`; preserve the large-list UI hydration parity used before `worktree.detectedList` existed.
import { REMOTE_WORKTREE_LIST_PARITY_LIMIT, WORKTREE_REMOVAL_AMBIGUOUS_ERROR, ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS, ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS, ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS, WORKTREE_REFRESH_CONCURRENCY, pendingActivationTerminalPrepCancels, detachedHeadAutoDerivedDisplayNames, folderWorkspaceWorktreeCache, hostedReviewPushTargetLookupsInFlight, runtimeDetectedWorktreeRefreshesInFlight, folderWorkspaceActivityPersistenceByStore, getFolderWorkspaceActivityPersistence, shouldDeferActivationTerminalPrep, showLocalBaseRefRefreshToast, arraysShallowEqual, areLineageRecordsEqual, areWorktreesEqual, areDetectedWorktreeResultsEqual, toVisibleTabType, toVisibleWorktree, withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeSliceGet, BackgroundRuntimeRefreshOptions, DetectedWorktreeRefreshOptions, AdmittedDetectedWorktreeRefresh, DetectedWorktreeRefreshOutcome, WorktreeWithLineage, WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createWorktreeSliceSetWorktreesPinnedAndRevealActions8(set: SliceSet, get: SliceGet) {
  return {
  setWorktreesPinnedAndReveal: (worktreeIds, isPinned) => {
    // Only follow a toggled row with the viewport when it's the focused worktree, not an unfocused card.
    const activeSidebarWorktreeId = getActiveSidebarWorkspaceId(
      get().activeWorkspaceKey,
      get().activeWorktreeId
    )
    // Skip worktrees already in the target state so a no-op toggle doesn't scroll the viewport away.
    const updates = new Map<string, Partial<WorktreeMeta>>()
    let didChange = false
    let revealWorktreeId: string | null = null
    for (const worktreeId of worktreeIds) {
      const current = get().getKnownWorktreeById(worktreeId)
      if (!current || current.isPinned === isPinned) {
        continue
      }
      didChange = true
      const workspaceScope = parseWorkspaceKey(worktreeId)
      if (workspaceScope?.type === 'folder') {
        void get().updateWorktreeMeta(worktreeId, { isPinned })
      } else {
        updates.set(worktreeId, { isPinned })
      }
      if (revealWorktreeId === null && worktreeId === activeSidebarWorktreeId) {
        revealWorktreeId = worktreeId
      }
    }
    if (!didChange) {
      return
    }
    // updateWorktreesMeta applies the store update synchronously, so the reveal below sees the row already rendered.
    void get().updateWorktreesMeta(updates)
    if (revealWorktreeId !== null) {
      get().revealWorktreeInSidebar(revealWorktreeId, { behavior: 'smooth', highlight: true })
    }
  },
  markWorktreeUnread: (worktreeId) => {
    // Why: attention dot stays until the user engages the worktree; cleared by pane interaction or activation.
    const now = Date.now()
    const workspaceScope = parseWorkspaceKey(worktreeId)
    if (workspaceScope?.type === 'folder') {
      const folderWorkspaceId = workspaceScope.folderWorkspaceId
      let shouldPersist = false
      set((s) => {
        const folderWorkspace = s.folderWorkspaces.find(
          (workspace) => workspace.id === folderWorkspaceId
        )
        if (!folderWorkspace || folderWorkspace.isUnread) {
          return s
        }
        shouldPersist = true
        return {
          folderWorkspaces: s.folderWorkspaces.map((workspace) =>
            workspace.id === folderWorkspaceId
              ? { ...workspace, isUnread: true, lastActivityAt: now }
              : workspace
          ),
          sortEpoch: s.sortEpoch + 1
        }
      })
      if (!shouldPersist) {
        return
      }
      void get().updateFolderWorkspace(folderWorkspaceId, {
        isUnread: true,
        lastActivityAt: now
      })
      return
    }
    let shouldPersist = false
    set((s) => {
      const worktree = findKnownWorktreeById(s, worktreeId)
      if (!worktree || worktree.isUnread) {
        return {}
      }
      shouldPersist = true
      const nextWorktrees = applyWorktreeUpdates(s.worktreesByRepo, worktreeId, {
        isUnread: true,
        lastActivityAt: now
      })
      const nextDetectedWorktrees = applyDetectedWorktreeUpdates(
        s.detectedWorktreesByRepo,
        worktreeId,
        {
          isUnread: true,
          lastActivityAt: now
        }
      )
      return {
        ...(nextWorktrees !== s.worktreesByRepo
          ? { worktreesByRepo: nextWorktrees, sortEpoch: s.sortEpoch + 1 }
          : {}),
        ...(nextDetectedWorktrees !== s.detectedWorktreesByRepo
          ? { detectedWorktreesByRepo: nextDetectedWorktrees }
          : {})
      }
    })

    if (!shouldPersist) {
      return
    }

    persistPassiveWorktreeMetaForOwner(
      get,
      worktreeId,
      { isUnread: true, lastActivityAt: now },
      'persist unread worktree state'
    )
  },
  observeTerminalGitHubPullRequestLink: (worktreeId, link) => {
    const state = get()
    const worktree = findKnownWorktreeById(state, worktreeId)
    if (!worktree || worktree.isBare || worktree.isArchived) {
      return
    }
    const repo = state.repos.find((candidate) => candidate.id === worktree.repoId)
    if (!repo || (repo.kind && repo.kind !== 'git')) {
      return
    }
    if (typeof worktree.linkedPR === 'number' && worktree.linkedPR !== link.number) {
      return
    }

    const branch = branchName(worktree.branch)
    const alreadyLinked = worktree.linkedPR === link.number

    const fetchPRForBranch = get().fetchPRForBranch
    if (typeof fetchPRForBranch === 'function') {
      void fetchPRForBranch(repo.path, branch, {
        force: true,
        repoId: repo.id,
        worktreeId,
        linkedPRNumber: alreadyLinked ? link.number : null,
        fallbackPRNumber: null,
        fallbackPRSource: alreadyLinked ? null : 'explicit'
      }).then((pr) => {
        if (!alreadyLinked && pr?.number === link.number) {
          // Why: terminal output can carry arbitrary PR URLs (docs/agents/logs).
          // Persist only after branch lookup confirms it and the user hasn't picked another PR mid-flight.
          void get().updateWorktreeMeta(
            worktreeId,
            { linkedPR: link.number },
            {
              shouldApply: (currentWorktree) =>
                Boolean(
                  currentWorktree &&
                  !currentWorktree.isBare &&
                  !currentWorktree.isArchived &&
                  (currentWorktree.linkedPR == null || currentWorktree.linkedPR === link.number)
                )
            }
          )
        }
      })
      return
    }

    const fetchHostedReviewForBranch = get().fetchHostedReviewForBranch
    if (typeof fetchHostedReviewForBranch === 'function') {
      // Why: full app stores have fetchPRForBranch (syncs the hosted-review cache); this is only a slice-test fallback.
      void refreshHostedReviewCard(fetchHostedReviewForBranch, {
        repoPath: repo.path,
        repoId: repo.id,
        branch,
        linkedGitHubPR: alreadyLinked ? link.number : null,
        fallbackGitHubPR: null,
        linkedGitLabMR: worktree.linkedGitLabMR ?? null
      })
    }
  },
  clearWorktreeUnread: (worktreeId) => {
    const workspaceScope = parseWorkspaceKey(worktreeId)
    if (workspaceScope?.type === 'folder') {
      const folderWorkspaceId = workspaceScope.folderWorkspaceId
      const folderWorkspace = get().folderWorkspaces.find(
        (workspace) => workspace.id === folderWorkspaceId
      )
      if (!folderWorkspace?.isUnread) {
        return
      }
      // Why: flip locally first — this runs per keystroke, so the guard above must dedupe before the IPC round-trip lands.
      set((s) => ({
        folderWorkspaces: s.folderWorkspaces.map((workspace) =>
          workspace.id === folderWorkspaceId ? { ...workspace, isUnread: false } : workspace
        )
      }))
      void get().updateFolderWorkspace(folderWorkspaceId, { isUnread: false })
      return
    }
    let shouldPersist = false
    set((s) => {
      const worktree = findKnownWorktreeById(s, worktreeId)
      if (!worktree || !worktree.isUnread) {
        // Why: return `s` (not {}) to keep the object reference on this hot-path no-op (every keystroke), avoiding selector churn.
        return s
      }
      shouldPersist = true
      const nextWorktrees = applyWorktreeUpdates(s.worktreesByRepo, worktreeId, {
        isUnread: false
      })
      const nextDetectedWorktrees = applyDetectedWorktreeUpdates(
        s.detectedWorktreesByRepo,
        worktreeId,
        {
          isUnread: false
        }
      )
      return {
        ...(nextWorktrees !== s.worktreesByRepo ? { worktreesByRepo: nextWorktrees } : {}),
        ...(nextDetectedWorktrees !== s.detectedWorktreesByRepo
          ? { detectedWorktreesByRepo: nextDetectedWorktrees }
          : {})
      }
    })

    if (!shouldPersist) {
      return
    }

    persistPassiveWorktreeMetaForOwner(
      get,
      worktreeId,
      { isUnread: false },
      'persist cleared unread worktree state'
    )
  },
  }
}
