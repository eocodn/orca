/* import type { StateCreator } from 'zustand'
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
import { cleanupEphemeralVmRuntimesForDeleted } from '@/lib/ephemeral-vm-runtime-cleanup'
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
export function createRepoSliceUpdateRepoActions8(set: SliceSet, get: SliceGet) {
  return {
  updateRepo: async (projectId, updates, options) => {
    const updateRepoChains = getRepoUpdateChains(get)
    // Why: pass options.hostId so a duplicate repo id across hosts resolves to the intended row, not the settings-focused fallback.
    const ownerRepo = findRepoForHost(get().repos, projectId, {
      settings: get().settings,
      hostId: options?.hostId
    })
    if (!ownerRepo) {
      return false
    }
    // Why: an explicit hostId is authoritative; route to that host's target rather than the currently-focused runtime.
    const ownerHasExplicitHost = Boolean(
      options?.hostId || ownerRepo.executionHostId?.trim() || ownerRepo.connectionId?.trim()
    )
    const explicitOwnerHostId = getRepoExecutionHostId(ownerRepo)
    const ownerTarget = ownerHasExplicitHost
      ? getProjectSetupRuntimeTarget(explicitOwnerHostId)
      : getActiveRuntimeTarget(settingsForRepoOwner(get(), projectId))
    const ownerHostId = ownerHasExplicitHost
      ? explicitOwnerHostId
      : getRuntimeTargetHostId(ownerTarget)
    const updateChainKey = getRepoHostIdentityForParts(projectId, ownerHostId)
    const applyRepoUpdate = async () => {
      try {
        const sanitizedUpdates = sanitizeRepoUpdate(updates)
        const target = ownerTarget
        const updatedRepo =
          target.kind === 'local'
            ? await window.api.repos.update({
                repoId: projectId,
                updates: sanitizedUpdates,
                ...(ownerHasExplicitHost ? { hostId: ownerHostId } : {})
              })
            : (
                await callRuntimeRpc<{ repo: Repo }>(
                  target,
                  'repo.update',
                  { repo: projectId, updates: sanitizedUpdates },
                  { timeoutMs: 15_000 }
                )
              ).repo
        set((s) => {
          const nextRepos = s.repos.map((r) => {
            const matchesOwner = ownerHasExplicitHost
              ? repoMatchesHostIdentity(r, projectId, ownerHostId)
              : repoMatchesHostIdentity(r, projectId, ownerHostId) || r === ownerRepo
            if (!matchesOwner) {
              return r
            }
            if (updatedRepo) {
              return repoWithFetchedOwner(updatedRepo, target)
            }
            let mergedRepo: Repo = r
            const {
              sourceControlAi,
              externalWorktreeDiscoverySuppressedAt,
              ...updatesWithoutClearSentinels
            } = sanitizedUpdates
            mergedRepo = { ...mergedRepo, ...updatesWithoutClearSentinels }
            if (sourceControlAi === null) {
              const { sourceControlAi: _sourceControlAi, ...repoWithoutSourceControlAi } =
                mergedRepo
              mergedRepo = repoWithoutSourceControlAi
            } else if (sourceControlAi !== undefined) {
              mergedRepo = { ...mergedRepo, sourceControlAi }
            }
            if (externalWorktreeDiscoverySuppressedAt === null) {
              const {
                externalWorktreeDiscoverySuppressedAt: _suppressedAt,
                ...repoWithoutSuppression
              } = mergedRepo
              mergedRepo = repoWithoutSuppression
            } else if (externalWorktreeDiscoverySuppressedAt !== undefined) {
              mergedRepo = { ...mergedRepo, externalWorktreeDiscoverySuppressedAt }
            }
            return mergedRepo
          })
          return {
            repos: nextRepos,
            ...mergeProjectCompatibilityForHostRepoChange({
              previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
              nextRepos,
              hostId: ownerHostId
            }),
            folderWorkspacePathStatuses: {}
          }
        })
        return true
      } catch (err) {
        console.error('Failed to update repo:', err)
        return false
      }
    }
    const previous = updateRepoChains.get(updateChainKey)
    // Why: settings persist as full nested values, so preserve per-repo call order — a slower response mustn't overwrite newer state.
    const next = previous
      ? previous.catch(() => undefined).then(applyRepoUpdate)
      : applyRepoUpdate()
    updateRepoChains.set(updateChainKey, next)
    const cleanup = () => {
      if (updateRepoChains.get(updateChainKey) === next) {
        updateRepoChains.delete(updateChainKey)
      }
    }
    void next.then(cleanup, cleanup)
    return next
  },
  setActiveRepo: (projectId) => set({ activeRepoId: projectId }),
  reorderRepos: async (orderedIds) => {
    // Optimistically apply the new order for instant sidebar update; resync only if main rejects (racing add/remove).
    const previous = get().repos
    const remainingById = new Map<string, { repos: Repo[]; nextIndex: number }>()
    for (const repo of previous) {
      const existing = remainingById.get(repo.id)
      if (existing) {
        existing.repos.push(repo)
      } else {
        remainingById.set(repo.id, { repos: [repo], nextIndex: 0 })
      }
    }
    const next: Repo[] = []
    for (const id of orderedIds) {
      const remaining = remainingById.get(id)
      const repo = remaining?.repos[remaining.nextIndex]
      if (remaining) {
        remaining.nextIndex += 1
      }
      if (repo) {
        next.push(repo)
      }
    }
    if (next.length !== previous.length) {
      // Caller passed a non-permutation — refuse to apply locally.
      return
    }
    const manualRepoOrder = getManualRepoOrder(next)
    set({
      repos: next,
      manualRepoOrder,
      folderWorkspacePathStatuses: {}
    })
    try {
      // Why: each host persists only its own repos and rejects non-permutations; dispatch one per-host permutation per owner.
      const groups = splitRepoReorderByHost(orderedIds, next, get().settings)
      const [results] = await Promise.all([
        Promise.all(
          groups.map(async (group) => {
            const parsed = parseExecutionHostId(group.hostId)
            const target =
              parsed?.kind === 'runtime'
                ? ({ kind: 'environment', environmentId: parsed.environmentId } as const)
                : ({ kind: 'local' } as const)
            return target.kind === 'local'
              ? window.api.repos.reorderForHost({
                  hostId: group.hostId,
                  orderedIds: group.orderedIds
                })
              : callRuntimeRpc<{ status: 'applied' | 'rejected' }>(
                  target,
                  'repo.reorder',
                  { orderedIds: group.orderedIds },
                  { timeoutMs: 15_000 }
                )
          })
        ),
        // Why: servers only persist local permutations; the desktop profile owns cross-host order after a cold load.
        window.api.ui.set({ manualRepoOrder })
      ])
      if (results.some((result) => result.status === 'rejected')) {
        await get().fetchReposForAllHosts()
      }
    } catch (err) {
      console.error('Failed to reorder repos:', err)
      await get().fetchReposForAllHosts()
    }
  }
  }
}