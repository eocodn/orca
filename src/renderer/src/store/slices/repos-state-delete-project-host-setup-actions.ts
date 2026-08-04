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
export function createRepoSliceDeleteProjectHostSetupActions6(set: SliceSet, get: SliceGet) {
  return {
  deleteProjectHostSetup: async (args) => {
    try {
      const currentSetup = get().projectHostSetups.find((setup) => setup.id === args.setupId)
      const target = currentSetup
        ? getProjectSetupRuntimeTarget(currentSetup.hostId)
        : { kind: 'local' as const }
      await assertProjectHostSetupMutationRuntimeCapabilities(target)
      const result =
        target.kind === 'local'
          ? await getClientRuntime().workspace.projects.deleteHostSetup(args)
          : (
              await callRuntimeRpc<{ result: ProjectHostSetupDeleteResult }>(
                target,
                'projectHostSetup.delete',
                args,
                { timeoutMs: 15_000 }
              )
            ).result
      const repo = result.repo ? repoWithFetchedOwner(result.repo, target) : undefined
      const repoHostId = repo ? getRepoExecutionHostId(repo) : null
      set((s) => {
        const projectHostSetups = s.projectHostSetups.filter(
          (setup) => setup.id !== result.setup.id
        )
        const repos =
          repo && repoHostId
            ? s.repos.filter((entry) => !repoMatchesHostIdentity(entry, repo.id, repoHostId))
            : s.repos
        const projects =
          repo && !projectHostSetups.some((setup) => setup.projectId === result.project.id)
            ? s.projects.filter((project) => project.id !== result.project.id)
            : s.projects
        const survivingRepoIds = new Set(repos.map((r) => r.id))
        const removedRepoIds = s.repos.filter((r) => !survivingRepoIds.has(r.id)).map((r) => r.id)
        return {
          repos,
          projects,
          projectHostSetups,
          ...omitSparsePresetsForRepos(s, removedRepoIds)
        }
      })
      return { ...result, repo }
    } catch (err) {
      console.error('Failed to delete project host setup:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  setupProjectClone: async (args) => {
    try {
      const parsedHost = parseExecutionHostId(args.hostId)
      const target = getProjectSetupRuntimeTarget(args.hostId)
      if (parsedHost?.kind !== 'ssh') {
        await assertProjectHostSetupMutationRuntimeCapabilities(target)
      }
      const repo =
        parsedHost?.kind === 'ssh'
          ? await getClientRuntime().workspace.repos.cloneRemote({
              connectionId: parsedHost.targetId,
              url: args.url,
              destination: args.destination
            })
          : target.kind === 'local'
            ? await getClientRuntime().workspace.repos.clone({
                url: args.url,
                destination: args.destination
              })
            : (
                await callRuntimeRpc<{ repo: Repo }>(
                  target,
                  'repo.clone',
                  {
                    url: args.url,
                    destination: args.destination
                  },
                  { timeoutMs: 10 * 60_000 }
                )
              ).repo
      return await get().setupProjectExistingFolder({
        projectId: args.projectId,
        hostId: args.hostId,
        path: repo.path,
        kind: 'git',
        displayName: args.displayName,
        setupMethod: 'cloned'
      })
    } catch (err) {
      console.error('Failed to clone project on host:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.c6e022ddfc', 'Failed to add project'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  addRepo: async () => {
    const target = getActiveRuntimeTarget(get().settings)
    if (target.kind !== 'local') {
      // Why: OS folder pickers return client-local paths; remote environments need an explicit host path (Add Project dialog).
      toast.error(
        translate(
          'auto.store.slices.repos.e649269645',
          'Use Add Project to enter a path on the selected host.'
        )
      )
      return null
    }
    const path = await getClientRuntime().workspace.repos.pickFolder()
    if (!path) {
      return null
    }
    return get().addRepoPath(path)
  },
  addNonGitFolder: async (path, options) => {
    try {
      const hadProjectBeforeAdd = get().repos.length > 0
      const repo = await get().addRepoPath(path, 'folder', options)
      if (!repo) {
        return null
      }
      await markOnboardingProjectAdded('addedFolder')
      // Why: focus the new folder so the add is visible; lazy-import worktree-activation to avoid a circular module load (it imports the store root).
      const executionHostId =
        options?.runtimeEnvironmentId === undefined
          ? undefined
          : options.runtimeEnvironmentId
            ? toRuntimeExecutionHostId(options.runtimeEnvironmentId)
            : LOCAL_EXECUTION_HOST_ID
      await get().fetchWorktrees(repo.id, executionHostId ? { executionHostId } : undefined)
      const folderWorktree = get().worktreesByRepo[repo.id]?.find(
        (worktree) => executionHostId === undefined || worktree.hostId === executionHostId
      )
      if (folderWorktree) {
        const { activateAndRevealWorktree } = await import('../../lib/worktree-activation')
        const onboarding = await window.api.onboarding.get().catch(() => null)
        // Why: adding the first folder from Landing skips onboarding's completeRepo hook; carry the default agent into the first terminal here.
        const startup = buildDismissedOnboardingFolderAgentStartup(
          get().settings,
          onboarding,
          hadProjectBeforeAdd
        )
        activateAndRevealWorktree(folderWorktree.id, {
          sidebarRevealBehavior: 'auto',
          ...(executionHostId ? { executionHostId } : {}),
          ...(startup ? { startup } : {})
        })
      }
      return repo
    } catch (err) {
      console.error('Failed to add folder:', err)
      const message = err instanceof Error ? err.message : String(err)
      toast.error(translate('auto.store.slices.repos.b7e14472ae', 'Failed to add folder'), {
        description: message,
        duration: ERROR_TOAST_DURATION
      })
      return null
    }
  },
  }
}
