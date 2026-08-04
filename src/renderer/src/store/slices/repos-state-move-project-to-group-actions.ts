import { getClientRuntime } from '@/runtime/client-runtime'
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
export function createRepoSliceMoveProjectToGroupActions5(set: SliceSet, get: SliceGet) {
  return {
  moveProjectToGroup: async (projectId, groupId, order) => {
    try {
      if (!findRepoForHost(get().repos, projectId, { settings: get().settings })) {
        return false
      }
      const target = getActiveRuntimeTarget(settingsForRepoOwner(get(), projectId))
      const moved =
        target.kind === 'local'
          ? await window.api.projectGroups.moveProject({
              projectId,
              groupId,
              order
            })
          : (
              await callRuntimeRpc<{ repo: Repo | null }>(
                target,
                'projectGroup.moveProject',
                { repo: projectId, groupId, order },
                { timeoutMs: 15_000 }
              )
            ).repo
      if (!moved) {
        return false
      }
      const ownedMoved = repoWithFetchedOwner(moved, target)
      const movedHostId = getRepoExecutionHostId(ownedMoved)
      set((s) => {
        const nextRepos = s.repos.map((repo) =>
          repoMatchesHostIdentity(repo, projectId, movedHostId) ? ownedMoved : repo
        )
        return {
          repos: nextRepos,
          ...mergeProjectCompatibilityForHostRepoChange({
            previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
            nextRepos,
            hostId: movedHostId
          }),
          folderWorkspacePathStatuses: {}
        }
      })
      return true
    } catch (err) {
      console.error('Failed to move repo to group:', err)
      return false
    }
  },
  addRepoPath: async (path, kind = 'git', options) => {
    try {
      const target = getActiveRuntimeTarget(getAddRepoPathRouteSettings(options, get().settings))
      let repo: Repo
      try {
        if (target.kind === 'local') {
          const result = await getClientRuntime().workspace.repos.add({ path, kind })
          if ('error' in result) {
            throw new Error(result.error)
          }
          repo = result.repo
        } else {
          repo = (
            await callRuntimeRpc<{ repo: Repo }>(
              target,
              'repo.add',
              { path, kind },
              { timeoutMs: 15_000 }
            )
          ).repo
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (kind !== 'git' || !message.includes('Not a valid git repository')) {
          throw err
        }
        if (target.kind !== 'local') {
          const status = await fetchRuntimeAddProjectPathStatus({ target, path })
          if (status?.exists !== true) {
            const hostName = getRuntimeEnvironmentDisplayName(get(), target.environmentId)
            toast.error(
              translate(
                'auto.store.slices.repos.3be0f7df04',
                'Cannot open folder on selected runtime'
              ),
              {
                description: translate(
                  'auto.store.slices.repos.15cf5319ec',
                  '{{path}} was checked on {{hostName}}, but that host did not report a usable folder.',
                  { path, hostName }
                ),
                duration: ERROR_TOAST_DURATION
              }
            )
            return null
          }
        }
        // Why: folder mode is a capability downgrade (no worktrees/SCM/PRs/checks), so confirm via dialog rather than silently falling back.
        const { openModal } = get()
        openModal('confirm-non-git-folder', {
          folderPath: path,
          ...(target.kind === 'environment' ? { runtimeEnvironmentId: target.environmentId } : {})
        })
        return null
      }
      repo = repoWithFetchedOwner(repo, target)
      const repoIdentity = getRepoHostIdentity(repo)
      const alreadyAdded = get().repos.some((r) => getRepoHostIdentity(r) === repoIdentity)
      if (alreadyAdded) {
        get().clearOrcaHookTrustForRepo(repo.id)
      }
      set((s) => {
        if (s.repos.some((r) => getRepoHostIdentity(r) === repoIdentity)) {
          return s
        }
        const nextRepos = [...s.repos, repo]
        const hostId = getRepoExecutionHostId(repo)
        return {
          repos: nextRepos,
          ...mergeProjectCompatibilityForHostRepoChange({
            previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
            nextRepos,
            hostId
          }),
          folderWorkspacePathStatuses: {}
        }
      })
      if (alreadyAdded) {
        toast.info(translate('auto.store.slices.repos.a8e4b3af5b', 'Project already added'), {
          description: repo.displayName
        })
      } else {
        toast.success(
          isGitRepoKind(repo)
            ? translate('auto.store.slices.repos.8bb3ad7935', 'Project added')
            : translate('auto.store.slices.repos.90d129b48b', 'Folder added'),
          {
            description: repo.displayName
          }
        )
        // Why: the cross-profile advisory applies to SSH-added projects too; the presence lookup already keys on connection/host.
        await warnIfProjectKnownInAnotherProfile(repo, get().activeOrcaProfileId)
      }
      return repo
    } catch (err) {
      console.error('Failed to add project:', err)
      const message = err instanceof Error ? err.message : String(err)
      const duration = ERROR_TOAST_DURATION
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration
      })
      return null
    }
  },
  setupProjectExistingFolder: async (args) => {
    try {
      const target = getProjectSetupRuntimeTarget(args.hostId)
      await assertProjectHostSetupMutationRuntimeCapabilities(target)
      const projectProviderIdentity =
        args.projectProviderIdentity ??
        get().projects.find((project) => project.id === args.projectId)?.providerIdentity
      // Why: the target host may not have a project record yet; carry the selected source-host identity across the boundary.
      const setupArgs = projectProviderIdentity ? { ...args, projectProviderIdentity } : args
      const result =
        target.kind === 'local'
          ? await window.api.projects.setupExistingFolder(setupArgs)
          : (
              await callRuntimeRpc<{ result: ProjectHostSetupResult }>(
                target,
                'projectHostSetup.setupExistingFolder',
                setupArgs,
                { timeoutMs: 15_000 }
              )
            ).result
      const repo = repoWithFetchedOwner(result.repo, target)
      const repoHostId = getRepoExecutionHostId(repo)
      const setup = setupWithFetchedOwner(result.setup, target)
      set((s) => {
        const nextRepos = s.repos.some((entry) =>
          repoMatchesHostIdentity(entry, repo.id, repoHostId)
        )
          ? s.repos.map((entry) =>
              repoMatchesHostIdentity(entry, repo.id, repoHostId) ? repo : entry
            )
          : [...s.repos, repo]
        const nextProjects = s.projects.some((entry) => entry.id === result.project.id)
          ? s.projects.map((entry) => (entry.id === result.project.id ? result.project : entry))
          : [...s.projects, result.project]
        const nextSetups = s.projectHostSetups.some((entry) => entry.id === setup.id)
          ? s.projectHostSetups.map((entry) => (entry.id === setup.id ? setup : entry))
          : [...s.projectHostSetups, setup]
        return {
          repos: nextRepos,
          projects: nextProjects,
          projectHostSetups: nextSetups
        }
      })
      toast.success(translate('auto.store.slices.repos.8bb3ad7935', 'Project added'), {
        description: repo.displayName
      })
      return { ...result, repo, setup }
    } catch (err) {
      console.error('Failed to set up project on host:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  createProjectHostSetup: async (args) => {
    try {
      const target = getProjectSetupRuntimeTarget(args.hostId)
      await assertProjectHostSetupMutationRuntimeCapabilities(target)
      const result =
        target.kind === 'local'
          ? await window.api.projects.createHostSetup(args)
          : (
              await callRuntimeRpc<{ result: ProjectHostSetupCreateResult }>(
                target,
                'projectHostSetup.create',
                args,
                { timeoutMs: 15_000 }
              )
            ).result
      const setup = setupWithFetchedOwner(result.setup, target)
      set((s) => ({
        projects: s.projects.some((entry) => entry.id === result.project.id)
          ? s.projects.map((entry) => (entry.id === result.project.id ? result.project : entry))
          : [...s.projects, result.project],
        projectHostSetups: s.projectHostSetups.some((entry) => entry.id === setup.id)
          ? s.projectHostSetups.map((entry) => (entry.id === setup.id ? setup : entry))
          : [...s.projectHostSetups, setup]
      }))
      return { project: result.project, setup }
    } catch (err) {
      console.error('Failed to create project host setup:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  updateProjectHostSetup: async (args) => {
    try {
      const currentSetup = get().projectHostSetups.find((setup) => setup.id === args.setupId)
      const target = currentSetup
        ? getProjectSetupRuntimeTarget(currentSetup.hostId)
        : { kind: 'local' as const }
      await assertProjectHostSetupMutationRuntimeCapabilities(target)
      const result =
        target.kind === 'local'
          ? await window.api.projects.updateHostSetup(args)
          : (
              await callRuntimeRpc<{ result: ProjectHostSetupUpdateResult }>(
                target,
                'projectHostSetup.update',
                args,
                { timeoutMs: 15_000 }
              )
            ).result
      const setup = setupWithFetchedOwner(result.setup, target)
      const repo = result.repo ? repoWithFetchedOwner(result.repo, target) : undefined
      const repoHostId = repo ? getRepoExecutionHostId(repo) : null
      set((s) => ({
        repos: repo
          ? s.repos.some((entry) => repoMatchesHostIdentity(entry, repo.id, repoHostId!))
            ? s.repos.map((entry) =>
                repoMatchesHostIdentity(entry, repo.id, repoHostId!) ? repo : entry
              )
            : [...s.repos, repo]
          : s.repos,
        projects: s.projects.some((entry) => entry.id === result.project.id)
          ? s.projects.map((entry) => (entry.id === result.project.id ? result.project : entry))
          : [...s.projects, result.project],
        projectHostSetups: s.projectHostSetups.some((entry) => entry.id === setup.id)
          ? s.projectHostSetups.map((entry) => (entry.id === setup.id ? setup : entry))
          : [...s.projectHostSetups, setup]
      }))
      return { ...result, repo, setup }
    } catch (err) {
      console.error('Failed to update project host setup:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  }
}
