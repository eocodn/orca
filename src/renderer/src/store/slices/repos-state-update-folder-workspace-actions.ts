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
export function createRepoSliceUpdateFolderWorkspaceActions4(set: SliceSet, get: SliceGet) {
  return {
  updateFolderWorkspace: async (folderWorkspaceId, updates, options) => {
    const folderWorkspaceUpdates = getFolderWorkspaceUpdateCoordinator(get)
    const state = get()
    const executionHostId =
      options?.executionHostId ??
      (state.activeWorktreeId === folderWorkspaceKey(folderWorkspaceId)
        ? (state.activeWorkspaceExecutionHostId ?? undefined)
        : undefined)
    if (!findFolderWorkspaceOwner(state, folderWorkspaceId, executionHostId)) {
      return false
    }
    const runtimeEnvironmentId = getRuntimeEnvironmentIdForFolderWorkspace(
      state,
      folderWorkspaceId,
      executionHostId
    )
    // Why: owner-scoped mutations must not follow whichever runtime happens to be focused.
    const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: runtimeEnvironmentId })
    const ownerHostId = executionHostId ?? getRuntimeTargetHostId(target)
    const updateIdentity = getFolderWorkspaceUpdateIdentity(ownerHostId, folderWorkspaceId)
    // Why: same gate as folderWorkspace.create — an older paired runtime would drop the Jira link silently.
    if (
      target.kind === 'environment' &&
      (updates.linkedTask?.provider === 'jira' ||
        updates.linkedTaskSourceContext?.provider === 'jira')
    ) {
      await assertRuntimeEnvironmentCapability(
        target.environmentId,
        WORKTREE_LINKED_WORK_ITEM_CONTEXT_RUNTIME_CAPABILITY,
        'Update the remote runtime to link Jira'
      )
    }
    const updateTicket = folderWorkspaceUpdates.begin(
      updateIdentity,
      Object.keys(updates) as FolderWorkspaceUpdateField[]
    )
    try {
      const updated =
        target.kind === 'local'
          ? await window.api.folderWorkspaces.update({ folderWorkspaceId, updates })
          : (
              await callRuntimeRpc<{ folderWorkspace: FolderWorkspace | null }>(
                target,
                'folderWorkspace.update',
                { folderWorkspaceId, updates },
                { timeoutMs: 15_000 }
              )
            ).folderWorkspace
      if (!updated) {
        await reconcileFailedFolderWorkspaceUpdate({
          target,
          folderWorkspaceId,
          updateIdentity,
          ownerHostId,
          ticket: updateTicket,
          coordinator: folderWorkspaceUpdates,
          set,
          get
        })
        return false
      }
      const latestFields = folderWorkspaceUpdates.latestFields(updateIdentity, updateTicket)
      const catalogChanged = folderWorkspaceUpdates.catalogChanged(updateIdentity, updateTicket)
      if (latestFields.length > 0) {
        set((s) => ({
          folderWorkspaces: s.folderWorkspaces.map((workspace) =>
            workspace.id === folderWorkspaceId &&
            getFolderWorkspaceHostId(workspace, s.projectGroups) === ownerHostId
              ? mergeFolderWorkspaceUpdateResponse(workspace, updated, latestFields, {
                  rejectOlderResponse: catalogChanged
                })
              : workspace
          ),
          ...(folderWorkspaceUpdateInvalidatesPathStatus(latestFields)
            ? { folderWorkspacePathStatuses: {} }
            : {})
        }))
      }
      return true
    } catch (err) {
      console.error('Failed to update folder workspace:', err)
      await reconcileFailedFolderWorkspaceUpdate({
        target,
        folderWorkspaceId,
        updateIdentity,
        ownerHostId,
        ticket: updateTicket,
        coordinator: folderWorkspaceUpdates,
        set,
        get
      })
      return false
    } finally {
      folderWorkspaceUpdates.finish(updateIdentity, updateTicket)
    }
  },
  deleteFolderWorkspace: async (folderWorkspaceId) => {
    const state = get()
    if (!findFolderWorkspaceOwner(state, folderWorkspaceId)) {
      return false
    }
    const runtimeEnvironmentId = getRuntimeEnvironmentIdForFolderWorkspace(state, folderWorkspaceId)
    try {
      // Why: deletion targets the folder's owner; focus may be on a different host.
      const target = getActiveRuntimeTarget({ activeRuntimeEnvironmentId: runtimeEnvironmentId })
      const deleted =
        target.kind === 'local'
          ? await window.api.folderWorkspaces.delete({ folderWorkspaceId })
          : (
              await callRuntimeRpc<{ deleted: boolean }>(
                target,
                'folderWorkspace.delete',
                { folderWorkspaceId },
                { timeoutMs: 15_000 }
              )
            ).deleted
      if (!deleted) {
        return false
      }
      const workspaceKey = folderWorkspaceKey(folderWorkspaceId)
      set((s) => ({
        folderWorkspaces: s.folderWorkspaces.filter(
          (workspace) => workspace.id !== folderWorkspaceId
        ),
        folderWorkspacePathStatuses: {}
      }))
      get().purgeWorktreeTerminalState([workspaceKey])
      return true
    } catch (err) {
      console.error('Failed to delete folder workspace:', err)
      return false
    }
  },
  updateProjectGroup: async (groupId, updates) => {
    try {
      // Why: project groups are focused-host-scoped by design; all CRUD routes by the focused host and the list is replaced, not merged.
      const target = getActiveRuntimeTarget(get().settings)
      const updated =
        target.kind === 'local'
          ? await window.api.projectGroups.update({ groupId, updates })
          : (
              await callRuntimeRpc<{ group: ProjectGroup | null }>(
                target,
                'projectGroup.update',
                { groupId, updates },
                { timeoutMs: 15_000 }
              )
            ).group
      if (!updated) {
        return false
      }
      const ownedGroup = projectGroupWithFetchedOwner(updated, target)
      set((s) => ({
        projectGroups: s.projectGroups.map((group) => (group.id === groupId ? ownedGroup : group)),
        folderWorkspacePathStatuses: {}
      }))
      return true
    } catch (err) {
      console.error('Failed to update project group:', err)
      return false
    }
  },
  deleteProjectGroup: async (groupId) => {
    try {
      // Why: project groups are focused-host-scoped by design (see updateProjectGroup).
      const target = getActiveRuntimeTarget(get().settings)
      const deleted =
        target.kind === 'local'
          ? await window.api.projectGroups.delete({ groupId })
          : (
              await callRuntimeRpc<{ deleted: boolean }>(
                target,
                'projectGroup.delete',
                { groupId },
                { timeoutMs: 15_000 }
              )
            ).deleted
      if (!deleted) {
        return false
      }
      set((s) => {
        const deletedGroupIds = getProjectGroupSubtreeIds(s.projectGroups, groupId)
        return {
          projectGroups: s.projectGroups.filter((group) => !deletedGroupIds.has(group.id)),
          folderWorkspaces: s.folderWorkspaces.filter(
            (workspace) => !deletedGroupIds.has(workspace.projectGroupId)
          ),
          repos: s.repos.map((repo) =>
            repo.projectGroupId && deletedGroupIds.has(repo.projectGroupId)
              ? { ...repo, projectGroupId: null }
              : repo
          ),
          folderWorkspacePathStatuses: {}
        }
      })
      return true
    } catch (err) {
      console.error('Failed to delete project group:', err)
      return false
    }
  },
  deleteProjectGroupWithContainedProjects: async (groupId, options) => {
    const targets = selectProjectGroupRemovalTargets(get().projectGroups, get().repos, groupId)
    const requestedProjectIds = options.removeContainedProjects ? targets.projectIds : []
    if (!targets.groupExists) {
      return {
        status: 'missing-group',
        groupId,
        requestedProjectIds,
        removedProjectIds: [],
        failedProjectRemovals: []
      }
    }

    const deleted = await get().deleteProjectGroup(groupId)
    if (!deleted) {
      return {
        status: 'group-delete-failed',
        groupId,
        requestedProjectIds,
        removedProjectIds: [],
        failedProjectRemovals: []
      }
    }

    if (!options.removeContainedProjects) {
      return {
        status: 'deleted-group',
        groupId,
        requestedProjectIds,
        removedProjectIds: [],
        failedProjectRemovals: []
      }
    }

    const removedProjectIds: string[] = []
    const failedProjectRemovals: ProjectRemovalFailure[] = []
    for (const projectId of targets.projectIds) {
      const existedBeforeRemoval = get().repos.some((repo) => repo.id === projectId)
      try {
        if (existedBeforeRemoval) {
          await get().removeProject(projectId)
        }
      } catch (err) {
        console.error('Failed to remove contained project:', err)
      }
      const stillExists = get().repos.some((repo) => repo.id === projectId)
      if (stillExists) {
        failedProjectRemovals.push({
          projectId,
          reason: 'Project remained in Orca after removeProject completed.'
        })
      } else {
        removedProjectIds.push(projectId)
      }
    }

    return {
      status: 'deleted-group',
      groupId,
      requestedProjectIds,
      removedProjectIds,
      failedProjectRemovals
    }
  },
  }
}
