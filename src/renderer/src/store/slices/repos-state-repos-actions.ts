 import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import type { AppState } from '../types'
import type { SshRepoReadoption } from '../../../../shared/ssh-types'
import type {
  GlobalSettings,
  Project,
  ProjectUpdateArgs,
  Repo,
  ProjectGroup,
  ProjectHostSetup,
  FolderWorkspace,
  ProjectGroupImportResult,
  NestedRepoScanResult,
  ProjectHostSetupCloneArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult
} from '../../../../shared/types'
import {
  getProjectIdentityKey,
  projectHostSetupProjectionFromRepos,
  type ProjectHostSetupProjection
} from '../../../../shared/project-host-setup-projection'
import {
  FOLDER_WORKSPACE_PATH_STATUS_RUNTIME_CAPABILITY,
  PROJECT_HOST_SETUP_RUNTIME_CAPABILITY,
  WORKSPACE_RUN_CONTEXT_RUNTIME_CAPABILITY,
  WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import {
  FOLDER_WORKSPACE_PATH_STATUS_TTL_MS,
  type FolderWorkspacePathStatus,
  type FolderWorkspacePathStatusRequest
} from '../../../../shared/folder-workspace-path-status'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { sanitizeRepoIcon } from '../../../../shared/repo-icon'
import { normalizeRepoBadgeColor } from '../../../../shared/repo-badge-color'
import { applyManualRepoOrder, getManualRepoOrder } from '../../../../shared/manual-repo-order'
import { getProjectGroupSubtreeIds } from '../../../../shared/project-groups'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree-id'
import { selectProjectGroupRemovalTargets } from './project-group-removal-targets'
import { reconcileFetchedRepos } from './repo-identity-reconcile'
import {
  mergeSshRepoReadoptions,
  reconcileReadoptedSshRepoRows,
  type SshRepoReconciliation
} from './superseded-ssh-repo-rows'
import { reconcileReadoptedSshWorktreesByRepo } from './readopted-ssh-worktree-rows'
import { splitRepoReorderByHost } from './repo-reorder-host-split'
import { omitSparsePresetsForRepos } from './sparse-presets'
import {
  findRepoForHost,
  getRepoHostIdentity,
  getRepoHostIdentityForParts,
  repoMatchesHostIdentity
} from './repo-host-identity'
import {
  assertRuntimeEnvironmentCapability,
  callRuntimeRpc,
  getActiveRuntimeTarget,
  settingsForRuntimeOwner
} from '../../runtime/runtime-rpc-client'
import { syncRuntimeGitForkDefaultBranch } from '../../runtime/runtime-git-client'
import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { buildDismissedOnboardingFolderAgentStartup } from '@/lib/onboarding-folder-agent-startup'
import { markOnboardingProjectAdded } from '@/lib/onboarding-project-checklist'
import { filterSetupScriptPromptDismissalsToValidRepos } from '@/lib/setup-script-prompt'
import { notifyInstalledAgentSkillsChanged } from '@/hooks/installed-agent-skill-discovery'
import { translate } from '@/i18n/i18n'
import {
  getRepoExecutionHostId,
  isRuntimeOwnedSshTargetId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { isRemovedRuntimeHostId } from './stale-runtime-host-rows'
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { formatFolderWorkspaceCreateError } from '../../lib/folder-workspace-path-status'
import { getEnvironmentSshStateGeneration } from './runtime-environment-ssh'
import { getRuntimeEnvironmentConnectionGeneration } from './runtime-status'
import {
  findFolderWorkspaceOwner,
  getRuntimeEnvironmentIdForFolderWorkspace
} from '@/lib/folder-workspace-runtime-owner'
import {
  FolderWorkspaceUpdateCoordinator,
  type FolderWorkspaceUpdateTicket
} from './folder-workspace-update-coordinator'
import { ERROR_TOAST_DURATION, SAFE_AUTO_FORK_SYNC_COOLDOWN_MS, safeAutoForkSyncAttempts, runtimeRepoFetchGenerationByEnvironment, folderWorkspaceUpdateCoordinators, getFolderWorkspaceUpdateCoordinator, normalizeNestedRepoScanResult, sanitizeRepoUpdate, updateRepoChainsByStore, getRepoUpdateChains, worktreeBelongsToHost, getKnownRepoWorktreeIds, getRuntimeTargetHostId, getProjectSetupRuntimeTarget, getProjectUpdateRuntimeTarget, getSafeAutoForkSyncKey, formatProjectPresenceProfileNames, scheduleSafeAutoForkSync, repoWithFetchedOwner, projectGroupWithFetchedOwner, setupWithFetchedOwner, projectCompatibilityFromRepos, mergeProjectCompatibilityProject, mergeProjectCompatibilityProjects, mergeUpdatedProjectCompatibilityProject, getCurrentSourceRepoIds, getReposById, getSourceRepoIdsOutsideHost, getMergedSourceRepoIdsForHostRefresh, projectWithCurrentSourceRepoIds, getLocalHostRepoBadgeColor, mergePreviousProjectMetadata, mergeProjectHostSetupCompatibility, getRepoDerivedSetupKey, getProjectHostSetupOwnerKey, mergeProjectHostSetupsByOwner, getProjectHostIds, getExplicitProjectHostIds, mergeFetchedProjectCompatibilityForHost, mergeByIdentity, mergeFetchedReposForHost, applyInheritedProjectGroups, mergeProjectCompatibilityForHostRepoChange, getProjectGroupHostId, getProjectGroupHostIdentity, catalogOwnsHost, mergeFetchedProjectGroupsForHost, getFolderWorkspaceHostId, getFolderWorkspaceHostIdentity, getFolderWorkspaceUpdateIdentity, mergeFetchedFolderWorkspacesForHost, getFolderWorkspaceCatalogReplacementIdentities, mergeFetchedRepoCatalog, reconcileSupersededSshRepos, filterSetupsForPrunedRepoRows, reconcileReadoptedSshWorktreeState, projectCompatibilityForReconciledRepos, filterTrustedOrcaHooksToValidRepos, clearRestoredFolderWorkspaceSessionOwners, mergeFetchedProjectGroupCatalog, folderWorkspaceWithFetchedOwner, mergeFetchedFolderWorkspaceCatalog, settingsForRepoOwner, getFolderWorkspacePathStatusScopeKey, getRuntimeTargetCachePrefix, getFolderWorkspacePathStatusRouteSettings, getAddRepoPathRouteSettings, folderWorkspaceUpdateInvalidatesPathStatus, mergeFolderWorkspaceUpdateResponse, getRuntimeEnvironmentDisplayName, getFolderWorkspaceStatusRequestSnapshot, getFreshFolderWorkspacePathStatusFromCache, getFolderWorkspacePathStatusRequestSnapshotForRead, latestLocalRepoCatalogFetchByStore, latestRepoCatalogGenerationByHostByStore, latestAllHostRepoCatalogGenerationByStore, latestHostCatalogGenerationByStore, claimHostCatalogFence, isHostCatalogFenceCurrent, startLocalRepoCatalogFetch, claimRepoCatalogGeneration, isLatestRepoCatalogGeneration } from './repos-state'
import type { HostCatalogKind, HostCatalogFence, RepoUpdate, ProjectUpdate, FolderWorkspaceUpdates, FolderWorkspaceUpdateField, FolderWorkspaceUpdateCoordinatorInstance, RepoSliceGet, NestedRepoScanControls, NestedRepoScanCancelOptions, FolderWorkspacePathStatusCacheEntry, DeleteProjectGroupWithContainedProjectsOptions, AllHostCatalogFetchOptions, ProjectRemovalFailure, DeleteProjectGroupWithContainedProjectsResult, FetchedRepoCatalog, FetchedProjectGroupCatalog, FetchedFolderWorkspaceCatalog, FolderWorkspacePathStatusRouteOptions, AddRepoPathRouteOptions, RuntimeCatalogFetchOptions, RepoSlice, LocalRepoCatalogFetchOutcome } from './repos-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createRepoSliceReposActions(set: SliceSet, get: SliceGet) {
  return {
  repos: [],
  projects: [],
  projectHostSetups: [],
  projectGroups: [],
  folderWorkspaces: [],
  folderWorkspacePathStatuses: {},
  activeRepoId: null,
  reposFetchGeneration: 0,
  pendingSshRepoReadoptions: [],
  recordSshRepoReadoptions: (readoptions) =>
    set((s) => {
      const pendingSshRepoReadoptions = mergeSshRepoReadoptions(
        s.pendingSshRepoReadoptions,
        readoptions
      )
      const reconciliation = reconcileReadoptedSshRepoRows(s.repos, pendingSshRepoReadoptions)
      const repos = reconciliation.repos
      const worktreeState = reconcileReadoptedSshWorktreeState(s, pendingSshRepoReadoptions)
      const projectHostSetups = filterSetupsForPrunedRepoRows(s.projectHostSetups, s.repos, repos)
      const compatibility = mergeProjectHostSetupCompatibility(
        projectCompatibilityFromRepos(repos),
        {
          projects: s.projects,
          setups: projectHostSetups
        }
      )
      return {
        repos,
        pendingSshRepoReadoptions: reconciliation.pendingReadoptions,
        ...worktreeState,
        ...compatibility
      }
    }),
  fetchRepos: async (options) => {
    const target = getActiveRuntimeTarget(
      settingsForRuntimeOwner(get().settings, options?.runtimeEnvironmentId)
    )
    const settleLocalCatalog: (outcome: LocalRepoCatalogFetchOutcome) => void =
      target.kind === 'local' ? startLocalRepoCatalogFetch(get) : () => undefined
    let localCatalogOutcome: LocalRepoCatalogFetchOutcome = { status: 'fulfilled' }
    // Why: overlapping repos:changed fetches can resolve out of order; a stale one must not overwrite a newer result and resurrect deleted projects (#7020).
    let generation = 0
    set((s) => {
      generation = s.reposFetchGeneration + 1
      return { reposFetchGeneration: generation }
    })
    const targetHostId = getRuntimeTargetHostId(target)
    claimRepoCatalogGeneration(get, targetHostId, generation)
    try {
      const catalog = await fetchRepoCatalogForTarget(target)
      // A newer same-host fetch superseded us while we awaited — drop this stale result.
      if (!isLatestRepoCatalogGeneration(get, targetHostId, generation)) {
        return
      }
      let finalizedHostRepos: Repo[] = []
      set((s) => {
        // Why: an in-flight fetch for a just-removed env would re-add purged repos and stick; skip only when the env was tombstoned, not merely unhydrated (#8881).
        if (isRemovedRuntimeHostId(catalog.hostId, s.removedRuntimeEnvironmentIds)) {
          return s
        }
        // Why: re-adoption leaves a stale row on the old SSH target id (a ghost that fails "SSH target not found"); drop rows a live-host sibling supersedes.
        const result = mergeFetchedRepoCatalog(catalog, s.repos)
        const reconciliation = reconcileSupersededSshRepos(result.repos, s)
        const prunedRepos = applyManualRepoOrder(reconciliation.repos, s.manualRepoOrder)
        const validRepoIds = new Set(prunedRepos.map((repo) => repo.id))
        const validRepoHostIdentities = new Set(prunedRepos.map(getRepoHostIdentity))
        const projectCompatibility = projectCompatibilityForReconciledRepos(
          prunedRepos,
          catalog.projectHostSetupCompatibility
        )
        const mergedProjectCompatibility = mergeFetchedProjectCompatibilityForHost({
          previous: {
            projects: s.projects,
            projectHostSetups: filterSetupsForPrunedRepoRows(
              s.projectHostSetups,
              result.repos,
              prunedRepos
            )
          },
          fetched: projectCompatibility,
          repos: prunedRepos,
          hostId: result.hostId
        })
        finalizedHostRepos = prunedRepos.filter(
          (repo) => getRepoExecutionHostId(repo) === result.hostId
        )
        return {
          repos: prunedRepos,
          pendingSshRepoReadoptions: reconciliation.pendingReadoptions,
          ...reconcileReadoptedSshWorktreeState(s, s.pendingSshRepoReadoptions),
          ...mergedProjectCompatibility,
          folderWorkspacePathStatuses: {},
          activeRepoId: s.activeRepoId && validRepoIds.has(s.activeRepoId) ? s.activeRepoId : null,
          filterRepoIds: s.filterRepoIds.filter((projectId) => validRepoIds.has(projectId)),
          setupScriptPromptDismissedRepoIds: filterSetupScriptPromptDismissalsToValidRepos(
            s.setupScriptPromptDismissedRepoIds,
            validRepoHostIdentities
          )
        }
      })
      scheduleSafeAutoForkSync(get, finalizedHostRepos)
    } catch (err) {
      localCatalogOutcome = { status: 'rejected', reason: err }
      console.error('Failed to fetch repos:', err)
    } finally {
      settleLocalCatalog(localCatalogOutcome)
    }
  },
  fetchRuntimeEnvironmentRepos: async (environmentId) => {
    const requestGeneration = (runtimeRepoFetchGenerationByEnvironment.get(environmentId) ?? 0) + 1
    runtimeRepoFetchGenerationByEnvironment.set(environmentId, requestGeneration)
    const connectionGeneration = getEnvironmentSshStateGeneration(environmentId)
    const runtimeConnectionGeneration = getRuntimeEnvironmentConnectionGeneration(environmentId)
    let catalogGeneration = 0
    set((s) => {
      catalogGeneration = s.reposFetchGeneration + 1
      return { reposFetchGeneration: catalogGeneration }
    })
    const target = { kind: 'environment' as const, environmentId }
    const targetHostId = getRuntimeTargetHostId(target)
    claimRepoCatalogGeneration(get, targetHostId, catalogGeneration)
    try {
      const catalog = await fetchRepoCatalogForTarget(target)
      if (
        runtimeRepoFetchGenerationByEnvironment.get(environmentId) !== requestGeneration ||
        !isLatestRepoCatalogGeneration(get, targetHostId, catalogGeneration) ||
        getEnvironmentSshStateGeneration(environmentId) !== connectionGeneration ||
        getRuntimeEnvironmentConnectionGeneration(environmentId) !== runtimeConnectionGeneration
      ) {
        return []
      }
      let finalizedHostRepos: Repo[] = []
      set((s) => {
        if (
          runtimeRepoFetchGenerationByEnvironment.get(environmentId) !== requestGeneration ||
          !isLatestRepoCatalogGeneration(get, targetHostId, catalogGeneration) ||
          getEnvironmentSshStateGeneration(environmentId) !== connectionGeneration ||
          getRuntimeEnvironmentConnectionGeneration(environmentId) !== runtimeConnectionGeneration
        ) {
          return s
        }
        // Why: skip merging a runtime env removed while this Connect-flow fetch was in flight, so purged repos aren't re-added (#8881).
        if (isRemovedRuntimeHostId(catalog.hostId, s.removedRuntimeEnvironmentIds)) {
          return s
        }
        const result = mergeFetchedRepoCatalog(catalog, s.repos)
        const reconciliation = reconcileSupersededSshRepos(result.repos, s)
        const finalizedRepos = applyManualRepoOrder(reconciliation.repos, s.manualRepoOrder)
        const validRepoIds = new Set(finalizedRepos.map((repo) => repo.id))
        const validRepoHostIdentities = new Set(finalizedRepos.map(getRepoHostIdentity))
        const projectCompatibility = projectCompatibilityForReconciledRepos(
          finalizedRepos,
          catalog.projectHostSetupCompatibility
        )
        const mergedProjectCompatibility = mergeFetchedProjectCompatibilityForHost({
          previous: {
            projects: s.projects,
            projectHostSetups: filterSetupsForPrunedRepoRows(
              s.projectHostSetups,
              result.repos,
              finalizedRepos
            )
          },
          fetched: projectCompatibility,
          repos: finalizedRepos,
          hostId: result.hostId
        })
        finalizedHostRepos = finalizedRepos.filter(
          (repo) => getRepoExecutionHostId(repo) === result.hostId
        )
        return {
          repos: finalizedRepos,
          pendingSshRepoReadoptions: reconciliation.pendingReadoptions,
          ...reconcileReadoptedSshWorktreeState(s, s.pendingSshRepoReadoptions),
          ...mergedProjectCompatibility,
          activeRepoId: s.activeRepoId && validRepoIds.has(s.activeRepoId) ? s.activeRepoId : null,
          filterRepoIds: s.filterRepoIds.filter((projectId) => validRepoIds.has(projectId)),
          setupScriptPromptDismissedRepoIds: filterSetupScriptPromptDismissalsToValidRepos(
            s.setupScriptPromptDismissedRepoIds,
            validRepoHostIdentities
          )
        }
      })
      scheduleSafeAutoForkSync(get, finalizedHostRepos)
      return finalizedHostRepos
    } catch (err) {
      console.error(`Failed to fetch repos for runtime environment ${environmentId}:`, err)
      return []
    }
  },
  }
}
