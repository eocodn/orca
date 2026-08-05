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
import { withRepoHostOwnership, repoHostId, repoHasExactlyOneExecutionHostOwner, toVisibleWorktrees, getProjectHostSetupForRepoHost, getHydratedSessionWorktreeIdsForRepo, repoHostSummariesByRepos, getRepoHostSummaries, unhostedWorktreesMatchRefreshHost, worktreeHostMatchOptions, worktreeMatchesHost, mergeWorktreesForHost, mergeDetectedWorktreesForHost, getKnownWorktreeIdsForPurge, getRemovedWorktreeIdsAfterAuthoritativeScan, toLegacyDetectedWorktreeResult, isRuntimeMethodNotFoundError, missingWorktreeTeardownsInFlight, RUNTIME_SCOPE_FORBIDDEN_TOAST_ID, notifyRuntimeScopeForbiddenIfNeeded, applyDetectedWorktreeUpdates, folderWorkspaceMatchesHost, findKnownWorktreeById, getFolderWorkspaceMetaUpdates, isRuntimeSelectorNotFoundError, replaceWorktreeInRepoLists, settingsForRepoOwner, settingsForKnownRepoOwner, trySettingsForWorktreeOwner, settingsForWorktreeOwner, ambiguousOwnerWarnedWorktreeIds, warnAmbiguousOwnerOnce, persistPassiveWorktreeMetaForOwner, detectedWorktreeRefreshKey, isDetectedWorktreeListResult, rejectedDetectedWorktreeProviderResult, detectedWorktreeRefreshLeaseRegistry, acquireDetectedWorktreeRefreshLeaseForRepo, qualifiedProviderResultIsAdmitted, normalizeNotAdmittedProviderResult, projectWorktreeLineageToWorkspaceLineage, projectLocalWorktreeLineageUpdate, applyWorktreeLineageUpdate, getWorktreeHostId, mergeLineageForHost, mergeWorkspaceLineageForHost, getHostedReviewPushTargetLookup, HOSTED_REVIEW_LINK_KEYS, CLEARED_HOSTED_REVIEW_LINK_UPDATES, hostedReviewLinkMutationGenerationByWorktreeId, hostedReviewLinkClearTombstonesByWorktreeId, hostedReviewLinkWorktreeIdAliases, hasHostedReviewLinks, hasBranchScopedHostedReviewContext, hasHostedReviewLinkUpdates, getHostedReviewLinkMutationGeneration, bumpHostedReviewLinkMutationGeneration, pruneHostedReviewLinkMutationGenerations, resolveHostedReviewLinkWorktreeId, pruneHostedReviewLinkWorktreeAliasesForId, migrateHostedReviewLinkMutationGeneration, getHostedReviewLinkMutationGenerationForTests, getHostedReviewLinkWorktreeAliasCountForTests, resetHostedReviewLinkMutationGenerationForTests, setDetachedHeadAutoDerivedDisplayNameForTests, getDetachedHeadAutoDerivedDisplayNameForTests, hostedReviewLinksAreCleared, getHostedReviewLinkUpdates, canonicalHostedReviewBranchIdentity, rememberHostedReviewLinkClear, sanitizeHostedReviewLinksForBranchClear, sanitizeHostedReviewLinksForBranchClears, applyHostedReviewLinkClear, getPositiveHostedReviewLinkUpdateKey, clearOlderHostedReviewLinksForReplacement, getHostedReviewLinkForMetaRefresh, hasExplicitPushTargetClear, encodePushTargetClearForRuntimeRpc, WORKTREE_ID_KEYED_MAP_KEYS, buildWorktreeRenameState, buildWorktreePurgeState, directSshAuthorityIsComplete, getCurrentDirectSshAuthority, directSshAuthoritiesEqual, isCurrentDetectedWorktreeRefresh, staleDetectedWorktreeProviderResult, mergeFetchedWorktrees, acquireDirectSshDetectedWorktreeRefresh } from './worktrees-state'
import type { WorktreeHostMatchOptions, RepoHostSummary, WorktreeLineageUpdateResult, HostedReviewLinkKey, RuntimeWorktreeMetaUpdates, FencedWorktreeMergeArgs, DirectSshDetectedWorktreeRefresh } from './worktrees-state'
export const REMOTE_WORKTREE_LIST_PARITY_LIMIT = 10_000
export const WORKTREE_REMOVAL_AMBIGUOUS_ERROR =
  'Workspace identity is ambiguous across hosts. Refresh projects and try again.'
export const ACTIVE_WORKTREE_TERMINAL_PREP_DELAY_MS = 300
export const ACTIVE_WORKTREE_TERMINAL_PREP_INPUT_QUIET_MS = 450
export const ACTIVE_WORKTREE_TERMINAL_PREP_IDLE_TIMEOUT_MS = 180
export const FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS = 1_000
// Why: each repo's `git worktree list` is an independent main-process child; a higher ceiling cuts startup scan batches (#7225) while staying bounded against launching every git probe at once.
export const WORKTREE_REFRESH_CONCURRENCY = 8
export const pendingActivationTerminalPrepCancels = new Map<string, () => void>()
export const detachedHeadAutoDerivedDisplayNames = new Map<string, string>()
export const folderWorkspaceWorktreeCache = new WeakMap<FolderWorkspace, Worktree>()
export const hostedReviewPushTargetLookupsInFlight = new Set<string>()
export const runtimeDetectedWorktreeRefreshesInFlight = new Map<
  string,
  Promise<DetectedWorktreeListResult>
>()
export type WorktreeSliceGet = Parameters<StateCreator<AppState>>[1]
export const folderWorkspaceActivityPersistenceByStore = new WeakMap<
  WorktreeSliceGet,
  FolderWorkspaceActivityPersistence
>()
export function getFolderWorkspaceActivityPersistence(
  get: WorktreeSliceGet
): FolderWorkspaceActivityPersistence {
  const existing = folderWorkspaceActivityPersistenceByStore.get(get)
  if (existing) {
    return existing
  }
  const created = new FolderWorkspaceActivityPersistence((folderWorkspaceId, activityAt) => {
    if (get().folderWorkspaces.some((workspace) => workspace.id === folderWorkspaceId)) {
      void get().updateFolderWorkspace(folderWorkspaceId, { lastActivityAt: activityAt })
    }
  }, FOLDER_WORKSPACE_ACTIVITY_PERSIST_INTERVAL_MS)
  folderWorkspaceActivityPersistenceByStore.set(get, created)
  return created
}
export type BackgroundRuntimeRefreshOptions = {
  reuseRecentCompatibilityFailure?: boolean
}
export type DetectedWorktreeRefreshOptions = BackgroundRuntimeRefreshOptions & {
  executionHostId: ExecutionHostId
  requireAuthoritative?: boolean
  directSshAuthority?: DirectSshAuthority
  // Why (#10562): the caller's own view of what it is about to purge. Teardown is
  // requested per caller, so this must never be shared with a coalesced scan.
  connectionId?: string | null
  knownWorktreeIds?: readonly string[]
}
export type AdmittedDetectedWorktreeRefresh = {
  status: 'admitted'
  result: DetectedWorktreeListResult
  providerResult?: HostQualifiedDetectedWorktreeResult
  executionHostId: ExecutionHostId
  directSshAuthority?: DirectSshAuthority
  runtimeAuthority?: {
    environmentId: string
    connectionGeneration: number
    runtimeConnectionGeneration: number
  }
}
export type DetectedWorktreeRefreshOutcome =
  | AdmittedDetectedWorktreeRefresh
  | {
      status: 'not-admitted'
      providerResult: HostQualifiedDetectedWorktreeResult
      executionHostId: ExecutionHostId
      directSshAuthority?: DirectSshAuthority
    }

async function mapReposForWorktreeRefresh<TRepo extends { id: string }, TResult>(
  repos: readonly TRepo[],
  mapper: (repo: TRepo) => Promise<TResult>
): Promise<TResult[]> {
  const results = Array<TResult>(repos.length)
  let nextIndex = 0
  const workerCount = Math.min(WORKTREE_REFRESH_CONCURRENCY, repos.length)

  // Why: refresh can fire during activation/startup; bound repo scans so one UI moment can't launch every git probe at once.
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < repos.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(repos[index])
      }
    })
  )

  return results
}
export function shouldDeferActivationTerminalPrep(): boolean {
  return typeof window !== 'undefined' && import.meta.env.MODE !== 'test'
}
export function showLocalBaseRefRefreshToast(result: LocalBaseRefRefreshResult | undefined): void {
  if (!result || result.status === 'updated') {
    return
  }

  let reason: string
  switch (result.status) {
    case 'skipped_dirty_worktree':
      reason =
        'the worktree where it is checked out has uncommitted changes. Commit, stash, or discard those changes, then try again.'
      break
    case 'skipped_not_fast_forward':
      reason =
        'the local branch does not exist or cannot be fast-forwarded cleanly from the remote base. Check for local-only commits before updating it manually.'
      break
    case 'skipped_error':
      reason =
        'Git returned an error while updating the local ref. Check the repo for locked refs or unusual worktree state, then try again.'
      break
  }

  toast.warning(
    translate('auto.store.slices.worktrees.14bc053a47', 'Local {{value0}} was not refreshed', {
      value0: result.localBranch
    }),
    {
      description: translate(
        'auto.store.slices.worktrees.903b51c2ed',
        'Workspace created from {{value0}}, but Orca could not fast-forward local {{value1}} because {{value2}}',
        { value0: result.baseRef, value1: result.localBranch, value2: reason }
      )
    }
  )
}
export function arraysShallowEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b || a.length !== b.length) {
    return !a?.length && !b?.length
  }
  return a.every((v, i) => v === b[i])
}
export function areLineageRecordsEqual(
  a: WorktreeLineage | null | undefined,
  b: WorktreeLineage | null | undefined
): boolean {
  if (!a || !b) {
    return !a && !b
  }
  return (
    a.worktreeId === b.worktreeId &&
    a.worktreeInstanceId === b.worktreeInstanceId &&
    a.parentWorktreeId === b.parentWorktreeId &&
    a.parentWorktreeInstanceId === b.parentWorktreeInstanceId &&
    a.origin === b.origin &&
    a.capture.source === b.capture.source &&
    a.capture.confidence === b.capture.confidence &&
    a.orchestrationRunId === b.orchestrationRunId &&
    a.taskId === b.taskId &&
    a.coordinatorHandle === b.coordinatorHandle &&
    a.createdByTerminalHandle === b.createdByTerminalHandle &&
    a.createdAt === b.createdAt
  )
}
export function areWorktreesEqual(current: Worktree[] | undefined, next: Worktree[]): boolean {
  if (!current || current.length !== next.length) {
    return false
  }

  return current.every((worktree, index) => {
    const candidate = next[index]
    return (
      worktree.id === candidate.id &&
      worktree.instanceId === candidate.instanceId &&
      worktree.repoId === candidate.repoId &&
      worktree.projectId === candidate.projectId &&
      worktree.hostId === candidate.hostId &&
      worktree.projectHostSetupId === candidate.projectHostSetupId &&
      worktree.path === candidate.path &&
      worktree.head === candidate.head &&
      worktree.branch === candidate.branch &&
      worktree.isBare === candidate.isBare &&
      worktree.isMainWorktree === candidate.isMainWorktree &&
      worktree.isSparse === candidate.isSparse &&
      worktree.displayName === candidate.displayName &&
      worktree.comment === candidate.comment &&
      worktree.linkedIssue === candidate.linkedIssue &&
      worktree.linkedPR === candidate.linkedPR &&
      worktree.linkedLinearIssue === candidate.linkedLinearIssue &&
      (worktree.linkedLinearIssueWorkspaceId ?? null) ===
        (candidate.linkedLinearIssueWorkspaceId ?? null) &&
      (worktree.linkedLinearIssueOrganizationUrlKey ?? null) ===
        (candidate.linkedLinearIssueOrganizationUrlKey ?? null) &&
      worktree.linkedGitLabMR === candidate.linkedGitLabMR &&
      worktree.linkedGitLabIssue === candidate.linkedGitLabIssue &&
      worktree.linkedBitbucketPR === candidate.linkedBitbucketPR &&
      worktree.linkedAzureDevOpsPR === candidate.linkedAzureDevOpsPR &&
      worktree.linkedGiteaPR === candidate.linkedGiteaPR &&
      areWorkspaceLinkedItemsEqual(worktree.linkedWorkItem, candidate.linkedWorkItem) &&
      areTaskSourceContextsEqual(
        worktree.linkedTaskSourceContext,
        candidate.linkedTaskSourceContext
      ) &&
      worktree.isArchived === candidate.isArchived &&
      worktree.isUnread === candidate.isUnread &&
      worktree.isPinned === candidate.isPinned &&
      worktree.sortOrder === candidate.sortOrder &&
      worktree.manualOrder === candidate.manualOrder &&
      worktree.lastActivityAt === candidate.lastActivityAt &&
      worktree.workspaceStatus === candidate.workspaceStatus &&
      worktree.createdWithAgent === candidate.createdWithAgent &&
      worktree.pendingFirstAgentMessageRename === candidate.pendingFirstAgentMessageRename &&
      worktree.firstAgentMessageRenameError === candidate.firstAgentMessageRenameError &&
      worktree.baseRef === candidate.baseRef &&
      worktree.pushTarget?.remoteName === candidate.pushTarget?.remoteName &&
      worktree.pushTarget?.branchName === candidate.pushTarget?.branchName &&
      worktree.pushTarget?.remoteUrl === candidate.pushTarget?.remoteUrl &&
      worktree.sparseBaseRef === candidate.sparseBaseRef &&
      arraysShallowEqual(worktree.sparseDirectories, candidate.sparseDirectories) &&
      arraysShallowEqual(worktree.priorWorktreeIds, candidate.priorWorktreeIds) &&
      (worktree as WorktreeWithLineage).parentWorktreeId ===
        (candidate as WorktreeWithLineage).parentWorktreeId &&
      arraysShallowEqual(
        (worktree as WorktreeWithLineage).childWorktreeIds,
        (candidate as WorktreeWithLineage).childWorktreeIds
      ) &&
      areLineageRecordsEqual(
        (worktree as WorktreeWithLineage).lineage,
        (candidate as WorktreeWithLineage).lineage
      )
    )
  })
}
export function areDetectedWorktreeResultsEqual(
  current: DetectedWorktreeListResult | undefined,
  next: DetectedWorktreeListResult
): boolean {
  return Boolean(
    current &&
    current.repoId === next.repoId &&
    current.authoritative === next.authoritative &&
    current.source === next.source &&
    areWorktreesEqual(current.worktrees, next.worktrees) &&
    current.worktrees.every((worktree, index) => {
      const candidate = next.worktrees[index]
      return (
        worktree.ownership === candidate.ownership &&
        worktree.selectedCheckout === candidate.selectedCheckout &&
        worktree.visible === candidate.visible
      )
    })
  )
}
export function toVisibleTabType(contentType: string): WorkspaceVisibleTabType {
  if (contentType === 'browser' || contentType === 'terminal') {
    return contentType
  }
  return 'editor'
}
export type WorktreeWithLineage = Worktree & {
  parentWorktreeId?: string | null
  childWorktreeIds?: string[]
  lineage?: WorktreeLineage | null
}
export function toVisibleWorktree(worktree: DetectedWorktreeListResult['worktrees'][number]): Worktree {
  const {
    ownership: _ownership,
    selectedCheckout: _selectedCheckout,
    visible: _visible,
    ...base
  } = worktree
  return base
}

// Why: runtime payloads describe execution from the HUB's perspective; project that location without losing the paired transport owner.
