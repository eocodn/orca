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
export function createRepoSliceFetchReposForAllHostsActions2(set: SliceSet, get: SliceGet) {
  return {
  fetchReposForAllHosts: async (options) => {
    const settleLocalCatalog = startLocalRepoCatalogFetch(get)
    let generation = 0
    set((s) => {
      generation = s.reposFetchGeneration + 1
      return { reposFetchGeneration: generation }
    })
    latestAllHostRepoCatalogGenerationByStore.set(get, generation)
    claimRepoCatalogGeneration(get, LOCAL_EXECUTION_HOST_ID, generation)
    // Why: fetching only the active host hides every other host's repos ("my projects vanished"); load local + all runtime envs, each failing soft.
    const applyCatalog = (catalog: FetchedRepoCatalog): void => {
      // Why: a concurrent all-host refresh must not let the older catalog resurrect a migrated SSH owner.
      if (
        latestAllHostRepoCatalogGenerationByStore.get(get) !== generation ||
        !isLatestRepoCatalogGeneration(get, catalog.hostId, generation)
      ) {
        return
      }
      let hostRepos: Repo[] = []
      set((s) => {
        // Why: skip a catalog whose env was tombstoned mid-load (removed), not one merely absent from the not-yet-hydrated saved list (#8881).
        if (isRemovedRuntimeHostId(catalog.hostId, s.removedRuntimeEnvironmentIds)) {
          return s
        }
        const result = mergeFetchedRepoCatalog(catalog, s.repos)
        const reconciliation = reconcileSupersededSshRepos(result.repos, s)
        const finalizedRepos = applyManualRepoOrder(reconciliation.repos, s.manualRepoOrder)
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
        hostRepos = finalizedRepos.filter((repo) => getRepoExecutionHostId(repo) === result.hostId)
        return {
          repos: finalizedRepos,
          pendingSshRepoReadoptions: reconciliation.pendingReadoptions,
          ...reconcileReadoptedSshWorktreeState(s, s.pendingSshRepoReadoptions),
          ...mergedProjectCompatibility,
          folderWorkspacePathStatuses: {},
          activeRepoId: s.activeRepoId,
          filterRepoIds: s.filterRepoIds,
          setupScriptPromptDismissedRepoIds: s.setupScriptPromptDismissedRepoIds
        }
      })
      // Why: keep the safe-auto fork sync (as fetchRepos does) so cold-start, which now routes here, still updates safe-auto forks.
      scheduleSafeAutoForkSync(get, hostRepos)
    }
    const validateRepoScopedUi = (): void => {
      set((s) => {
        const validRepoIds = new Set(s.repos.map((repo) => repo.id))
        const validRepoHostIdentities = new Set(s.repos.map(getRepoHostIdentity))
        return {
          activeRepoId: s.activeRepoId && validRepoIds.has(s.activeRepoId) ? s.activeRepoId : null,
          filterRepoIds: s.filterRepoIds.filter((projectId) => validRepoIds.has(projectId)),
          setupScriptPromptDismissedRepoIds: filterSetupScriptPromptDismissalsToValidRepos(
            s.setupScriptPromptDismissedRepoIds,
            validRepoHostIdentities
          ),
          trustedOrcaHooks: filterTrustedOrcaHooksToValidRepos(s.trustedOrcaHooks, validRepoIds)
        }
      })
    }

    // Local first so local repos are present even if a remote fetch stalls.
    let failed = false
    let localCatalogOutcome: LocalRepoCatalogFetchOutcome = { status: 'fulfilled' }
    try {
      applyCatalog(await fetchRepoCatalogForTarget({ kind: 'local' }))
    } catch (err) {
      failed = true
      localCatalogOutcome = { status: 'rejected', reason: err }
      console.error('Failed to fetch local repos for all-host load:', err)
    }
    // Why: startup hydration needs the newest local catalog, not unreachable remote hosts.
    settleLocalCatalog(localCatalogOutcome)
    if (
      get().reposFetchGeneration !== generation &&
      !isLatestRepoCatalogGeneration(get, LOCAL_EXECUTION_HOST_ID, generation)
    ) {
      return
    }
    if (options?.remoteHosts === 'skip') {
      return
    }

    const environments = await listRuntimeEnvironmentsForAllHostLoad()
    // Why: unreachable remotes can spend the full connect timeout; merge each resolved host via the state updater so parallel loads don't clobber.
    await Promise.all(
      environments.map(async (environment) => {
        const target = {
          kind: 'environment' as const,
          environmentId: environment.id
        }
        claimRepoCatalogGeneration(get, getRuntimeTargetHostId(target), generation)
        try {
          applyCatalog(await fetchRepoCatalogForTarget(target))
        } catch (err) {
          failed = true
          console.warn(`Skipped repos for runtime environment ${environment.id}:`, err)
        }
      })
    )
    // Why: validate repo-scoped UI only after every host answers; first-paint loads only local repos, so an offline runtime would erase its saved filters.
    if (!failed && get().reposFetchGeneration === generation) {
      validateRepoScopedUi()
    }
  },
  awaitLocalRepoCatalogSettlement: () => awaitLatestLocalRepoCatalogFetch(get),
  fetchProjectGroups: async (options) => {
    try {
      const target = getActiveRuntimeTarget(
        settingsForRuntimeOwner(get().settings, options?.runtimeEnvironmentId)
      )
      const fence = claimHostCatalogFence(get, 'project-groups', target)
      const catalog = await fetchProjectGroupCatalogForTarget(target)
      if (!isHostCatalogFenceCurrent(get, fence)) {
        return
      }
      set((current) =>
        isHostCatalogFenceCurrent(get, fence)
          ? {
              projectGroups: mergeFetchedProjectGroupCatalog(catalog, current.projectGroups)
                .projectGroups,
              folderWorkspacePathStatuses: {}
            }
          : current
      )
    } catch (err) {
      console.error('Failed to fetch project groups:', err)
    }
  },
  fetchProjectGroupsForAllHosts: async (options) => {
    // Why: startup renders an all-host sidebar; replacing groups with only the active host leaves other hosts' repos visible but ungrouped.
    const applyCatalog = (catalog: FetchedProjectGroupCatalog, fence: HostCatalogFence): void => {
      if (!isHostCatalogFenceCurrent(get, fence)) {
        return
      }
      set((s) =>
        isHostCatalogFenceCurrent(get, fence)
          ? {
              projectGroups: mergeFetchedProjectGroupCatalog(catalog, s.projectGroups)
                .projectGroups,
              folderWorkspacePathStatuses: {}
            }
          : s
      )
    }

    try {
      const target = { kind: 'local' as const }
      const fence = claimHostCatalogFence(get, 'project-groups', target)
      applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
    } catch (err) {
      console.error('Failed to fetch local project groups for all-host load:', err)
    }
    if (options?.remoteHosts === 'skip') {
      return
    }

    const environments = await listRuntimeEnvironmentsForAllHostLoad()
    await Promise.all(
      environments.map(async (environment) => {
        const target = {
          kind: 'environment' as const,
          environmentId: environment.id
        }
        const fence = claimHostCatalogFence(get, 'project-groups', target)
        try {
          applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
        } catch (err) {
          console.warn(`Skipped project groups for runtime environment ${environment.id}:`, err)
        }
      })
    )
  },
  fetchFolderWorkspaces: async (options) => {
    try {
      const folderWorkspaceUpdates = getFolderWorkspaceUpdateCoordinator(get)
      const target = getActiveRuntimeTarget(
        settingsForRuntimeOwner(get().settings, options?.runtimeEnvironmentId)
      )
      const fence = claimHostCatalogFence(get, 'folder-workspaces', target)
      const catalog = await fetchFolderWorkspaceCatalogForTarget(target, get().projectGroups)
      if (!isHostCatalogFenceCurrent(get, fence)) {
        return
      }
      set((current) => {
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return current
        }
        folderWorkspaceUpdates.recordCatalogReplacement(
          getFolderWorkspaceCatalogReplacementIdentities(
            catalog,
            current.folderWorkspaces,
            current.projectGroups
          )
        )
        const { folderWorkspaces } = mergeFetchedFolderWorkspaceCatalog(
          catalog,
          current.folderWorkspaces,
          current.projectGroups
        )
        return { folderWorkspaces, folderWorkspacePathStatuses: {} }
      })
    } catch (err) {
      console.error('Failed to fetch folder workspaces:', err)
    }
  },
  fetchFolderWorkspacesForAllHosts: async (options) => {
    const folderWorkspaceUpdates = getFolderWorkspaceUpdateCoordinator(get)
    // Why: folder workspaces are owned through their project groups; fetch groups first, then merge each host's folder slice.
    const applyCatalog = (
      catalog: FetchedFolderWorkspaceCatalog,
      fence: HostCatalogFence
    ): void => {
      if (!isHostCatalogFenceCurrent(get, fence)) {
        return
      }
      set((current) => {
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return current
        }
        folderWorkspaceUpdates.recordCatalogReplacement(
          getFolderWorkspaceCatalogReplacementIdentities(
            catalog,
            current.folderWorkspaces,
            current.projectGroups
          )
        )
        return {
          folderWorkspaces: mergeFetchedFolderWorkspaceCatalog(
            catalog,
            current.folderWorkspaces,
            current.projectGroups
          ).folderWorkspaces,
          folderWorkspacePathStatuses: {}
        }
      })
    }

    let failed = false
    try {
      const target = { kind: 'local' as const }
      const fence = claimHostCatalogFence(get, 'folder-workspaces', target)
      applyCatalog(await fetchFolderWorkspaceCatalogForTarget(target, get().projectGroups), fence)
    } catch (err) {
      failed = true
      console.error('Failed to fetch local folder workspaces for all-host load:', err)
    }
    if (options?.remoteHosts === 'skip') {
      return
    }

    const environments = await listRuntimeEnvironmentsForAllHostLoad()
    await Promise.all(
      environments.map(async (environment) => {
        const target = {
          kind: 'environment' as const,
          environmentId: environment.id
        }
        const fence = claimHostCatalogFence(get, 'folder-workspaces', target)
        try {
          applyCatalog(
            await fetchFolderWorkspaceCatalogForTarget(target, get().projectGroups),
            fence
          )
        } catch (err) {
          failed = true
          console.warn(`Skipped folder workspaces for runtime environment ${environment.id}:`, err)
        }
      })
    )
    if (!failed) {
      set((s) => ({
        restoredRuntimeHostIdByWorkspaceSessionKey: clearRestoredFolderWorkspaceSessionOwners(
          s.restoredRuntimeHostIdByWorkspaceSessionKey,
          s
        )
      }))
    }
  },
  getFolderWorkspacePathStatusCacheKey: (request, options) =>
    `${getRuntimeTargetCachePrefix(
      getFolderWorkspacePathStatusRouteSettings(options, get().settings)
    )}:${getFolderWorkspacePathStatusScopeKey(request)}`,
  }
}
