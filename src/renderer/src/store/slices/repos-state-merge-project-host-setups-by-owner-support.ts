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
import { ERROR_TOAST_DURATION, SAFE_AUTO_FORK_SYNC_COOLDOWN_MS, safeAutoForkSyncAttempts, runtimeRepoFetchGenerationByEnvironment, folderWorkspaceUpdateCoordinators, getFolderWorkspaceUpdateCoordinator, normalizeNestedRepoScanResult, sanitizeRepoUpdate, updateRepoChainsByStore, getRepoUpdateChains, worktreeBelongsToHost, getKnownRepoWorktreeIds, getRuntimeTargetHostId, getProjectSetupRuntimeTarget, getProjectUpdateRuntimeTarget, getSafeAutoForkSyncKey, formatProjectPresenceProfileNames, scheduleSafeAutoForkSync, repoWithFetchedOwner, projectGroupWithFetchedOwner, setupWithFetchedOwner, projectCompatibilityFromRepos, mergeProjectCompatibilityProject, mergeProjectCompatibilityProjects, mergeUpdatedProjectCompatibilityProject, getCurrentSourceRepoIds, getReposById, getSourceRepoIdsOutsideHost, getMergedSourceRepoIdsForHostRefresh, projectWithCurrentSourceRepoIds, getLocalHostRepoBadgeColor, mergePreviousProjectMetadata, mergeProjectHostSetupCompatibility, getRepoDerivedSetupKey, getProjectHostSetupOwnerKey, getFolderWorkspaceCatalogReplacementIdentities, mergeFetchedRepoCatalog, reconcileSupersededSshRepos, filterSetupsForPrunedRepoRows, reconcileReadoptedSshWorktreeState, projectCompatibilityForReconciledRepos, filterTrustedOrcaHooksToValidRepos, clearRestoredFolderWorkspaceSessionOwners, mergeFetchedProjectGroupCatalog, folderWorkspaceWithFetchedOwner, mergeFetchedFolderWorkspaceCatalog, settingsForRepoOwner, getFolderWorkspacePathStatusScopeKey, getRuntimeTargetCachePrefix, getFolderWorkspacePathStatusRouteSettings, getAddRepoPathRouteSettings, folderWorkspaceUpdateInvalidatesPathStatus, mergeFolderWorkspaceUpdateResponse, getRuntimeEnvironmentDisplayName, getFolderWorkspaceStatusRequestSnapshot, getFreshFolderWorkspacePathStatusFromCache, getFolderWorkspacePathStatusRequestSnapshotForRead, latestLocalRepoCatalogFetchByStore, latestRepoCatalogGenerationByHostByStore, latestAllHostRepoCatalogGenerationByStore, latestHostCatalogGenerationByStore, claimHostCatalogFence, isHostCatalogFenceCurrent, startLocalRepoCatalogFetch, claimRepoCatalogGeneration, isLatestRepoCatalogGeneration } from './repos-state'
import type { HostCatalogKind, HostCatalogFence, RepoUpdate, ProjectUpdate, FolderWorkspaceUpdates, FolderWorkspaceUpdateField, FolderWorkspaceUpdateCoordinatorInstance, RepoSliceGet, NestedRepoScanControls, NestedRepoScanCancelOptions, FolderWorkspacePathStatusCacheEntry, DeleteProjectGroupWithContainedProjectsOptions, AllHostCatalogFetchOptions, ProjectRemovalFailure, DeleteProjectGroupWithContainedProjectsResult, FetchedProjectGroupCatalog, FetchedFolderWorkspaceCatalog, FolderWorkspacePathStatusRouteOptions, AddRepoPathRouteOptions, RuntimeCatalogFetchOptions, RepoSlice, LocalRepoCatalogFetchOutcome } from './repos-state'
export function mergeProjectHostSetupsByOwner(
  base: readonly ProjectHostSetup[],
  overlay: readonly ProjectHostSetup[]
): ProjectHostSetup[] {
  const merged = [...base]
  const indexByOwner = new Map(
    merged.map((entry, index) => [getProjectHostSetupOwnerKey(entry), index])
  )
  for (const entry of overlay) {
    const index = indexByOwner.get(getProjectHostSetupOwnerKey(entry))
    if (index === undefined) {
      indexByOwner.set(getProjectHostSetupOwnerKey(entry), merged.length)
      merged.push(entry)
    } else {
      merged[index] = entry
    }
  }
  return merged
}
export function getProjectHostIds(
  project: Project,
  setups: readonly ProjectHostSetup[],
  repos: readonly Repo[]
): Set<string> {
  const hostIds = getExplicitProjectHostIds(project, setups, repos)
  if (hostIds.size === 0) {
    hostIds.add(LOCAL_EXECUTION_HOST_ID)
  }
  return hostIds
}
export function getExplicitProjectHostIds(
  project: Project,
  setups: readonly ProjectHostSetup[],
  repos: readonly Repo[]
): Set<string> {
  const hostIds = new Set<string>()
  const sourceRepoIds = new Set(project.sourceRepoIds)
  for (const setup of setups) {
    if (setup.projectId === project.id) {
      hostIds.add(setup.hostId)
    }
  }
  for (const repo of repos) {
    if (sourceRepoIds.has(repo.id)) {
      hostIds.add(getRepoExecutionHostId(repo))
    }
  }
  return hostIds
}
export function mergeFetchedProjectCompatibilityForHost({
  previous,
  fetched,
  repos,
  hostId
}: {
  previous: Pick<RepoSlice, 'projects' | 'projectHostSetups'>
  fetched: Pick<RepoSlice, 'projects' | 'projectHostSetups'>
  repos: readonly Repo[]
  hostId: string
}): Pick<RepoSlice, 'projects' | 'projectHostSetups'> {
  const setupBelongsToFetchedCatalog = (setup: ProjectHostSetup): boolean => {
    if (hostId !== LOCAL_EXECUTION_HOST_ID) {
      return setup.hostId === hostId
    }
    const owner = parseExecutionHostId(setup.hostId)
    // Why: desktop persistence owns local and direct-SSH setups; runtime setups stay authoritative on their remote Orca server.
    return setup.hostId === LOCAL_EXECUTION_HOST_ID || owner?.kind === 'ssh'
  }
  const fetchedSetupsForHost = fetched.projectHostSetups.filter(setupBelongsToFetchedCatalog)
  const preservedSetups = previous.projectHostSetups.filter(
    (setup) => !setupBelongsToFetchedCatalog(setup)
  )
  const projectHostSetups = mergeProjectHostSetupsByOwner(preservedSetups, fetchedSetupsForHost)
  const previousProjectById = new Map(previous.projects.map((project) => [project.id, project]))
  const reposById = getReposById(repos)
  const currentRepoIds = new Set(repos.map((repo) => repo.id))
  const projectHasHost = (project: Project, setups: readonly ProjectHostSetup[]): boolean =>
    getProjectHostIds(project, setups, repos).has(hostId)
  const projectHasCurrentOwnerOutsideHost = (project: Project): boolean =>
    [...getExplicitProjectHostIds(project, projectHostSetups, repos)].some(
      (ownerHostId) => ownerHostId !== hostId
    )
  const fetchedProjects = fetched.projects
    .filter((project) => {
      const previousProject = previousProjectById.get(project.id)
      // Why: repo-derived compatibility projects include every host; a one-host refresh should only reconcile or prune that host's ownership.
      return (
        projectHasHost(project, fetched.projectHostSetups) ||
        (previousProject ? projectHasHost(previousProject, previous.projectHostSetups) : false)
      )
    })
    .map((project) => {
      const previousProject = previousProjectById.get(project.id)
      return previousProject
        ? mergePreviousProjectMetadata(previousProject, project, reposById, hostId)
        : projectWithCurrentSourceRepoIds(project, currentRepoIds)
    })
  const fetchedProjectIds = new Set(fetchedProjects.map((project) => project.id))
  const preservedProjects = previous.projects.filter(
    (project) =>
      !fetchedProjectIds.has(project.id) &&
      (!getProjectHostIds(project, previous.projectHostSetups, repos).has(hostId) ||
        projectHasCurrentOwnerOutsideHost(project))
  )
  return {
    projects: mergeProjectCompatibilityProjects(
      preservedProjects.map((project) => {
        const sourceRepoIds = getSourceRepoIdsOutsideHost(project, reposById, hostId)
        return sourceRepoIds.length === project.sourceRepoIds.length
          ? project
          : { ...project, sourceRepoIds }
      }),
      fetchedProjects
    ),
    projectHostSetups
  }
}
export function mergeByIdentity<T>(
  base: readonly T[],
  overlay: readonly T[],
  getIdentity: (entry: T) => string
): T[] {
  const merged = [...base]
  const indexById = new Map(merged.map((entry, index) => [getIdentity(entry), index]))
  for (const entry of overlay) {
    const identity = getIdentity(entry)
    const index = indexById.get(identity)
    if (index === undefined) {
      indexById.set(identity, merged.length)
      merged.push(entry)
    } else {
      merged[index] = entry
    }
  }
  return merged
}
export function mergeFetchedReposForHost(
  previous: readonly Repo[],
  fetched: Repo[],
  hostId: string
): Repo[] {
  const fetchedWithProjectGroups = applyInheritedProjectGroups(previous, fetched)
  const fetchedIdentities = new Set(fetchedWithProjectGroups.map(getRepoHostIdentity))
  const preserved = previous.filter((repo) => {
    const existingHostId = getRepoExecutionHostId(repo)
    return existingHostId !== hostId || fetchedIdentities.has(getRepoHostIdentity(repo))
  })
  const merged = [...preserved]
  const indexByIdentity = new Map(merged.map((repo, index) => [getRepoHostIdentity(repo), index]))
  for (const repo of fetchedWithProjectGroups) {
    const identity = getRepoHostIdentity(repo)
    const existingIndex = indexByIdentity.get(identity)
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, merged.length)
      merged.push(repo)
      continue
    }
    merged[existingIndex] = repo
  }
  return reconcileFetchedRepos(previous, merged)
}
export function applyInheritedProjectGroups(previous: readonly Repo[], fetched: readonly Repo[]): Repo[] {
  const projectGroupIdByProject = new Map<string, string | null>()
  for (const repo of previous) {
    const projectGroupId =
      repo.projectGroupId === undefined ? undefined : (repo.projectGroupId ?? null)
    if (projectGroupId === undefined) {
      continue
    }
    const projectId = getProjectIdentityKey(repo)
    if (projectId.startsWith('repo:')) {
      continue
    }
    if (!projectGroupIdByProject.has(projectId)) {
      projectGroupIdByProject.set(projectId, projectGroupId)
    }
  }
  if (projectGroupIdByProject.size === 0) {
    return [...fetched]
  }
  return fetched.map((repo) => {
    if (repo.projectGroupId !== undefined) {
      return repo
    }
    const inheritedProjectGroupId = projectGroupIdByProject.get(getProjectIdentityKey(repo))
    if (inheritedProjectGroupId === undefined) {
      return repo
    }
    // Why: project groups are a local affordance; runtime copies of the same canonical project should appear in the user's existing group.
    return { ...repo, projectGroupId: inheritedProjectGroupId }
  })
}
export function mergeProjectCompatibilityForHostRepoChange({
  previous,
  nextRepos,
  hostId
}: {
  previous: Pick<RepoSlice, 'projects' | 'projectHostSetups'>
  nextRepos: readonly Repo[]
  hostId: string
}): Pick<RepoSlice, 'projects' | 'projectHostSetups'> {
  return mergeFetchedProjectCompatibilityForHost({
    previous,
    fetched: projectCompatibilityFromRepos(nextRepos),
    repos: nextRepos,
    hostId
  })
}
export function getProjectGroupHostId(group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>) {
  if (group.executionHostId) {
    return group.executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : LOCAL_EXECUTION_HOST_ID
}
export function getProjectGroupHostIdentity(group: ProjectGroup): string {
  return JSON.stringify([getProjectGroupHostId(group), group.id])
}
export function catalogOwnsHost(catalogHostId: string, rowHostId: string): boolean {
  if (catalogHostId !== LOCAL_EXECUTION_HOST_ID) {
    return catalogHostId === rowHostId
  }
  return parseExecutionHostId(rowHostId)?.kind !== 'runtime'
}
export function mergeFetchedProjectGroupsForHost(
  previous: readonly ProjectGroup[],
  fetched: ProjectGroup[],
  hostId: string
): ProjectGroup[] {
  const fetchedIdentities = new Set(fetched.map(getProjectGroupHostIdentity))
  const preserved = previous.filter((group) => {
    const existingHostId = getProjectGroupHostId(group)
    return (
      !catalogOwnsHost(hostId, existingHostId) ||
      fetchedIdentities.has(getProjectGroupHostIdentity(group))
    )
  })
  return mergeByIdentity(preserved, fetched, getProjectGroupHostIdentity)
}
export function getFolderWorkspaceHostId(
  workspace: FolderWorkspace,
  projectGroups: readonly ProjectGroup[]
): ExecutionHostId {
  const explicitHostId = parseExecutionHostId(workspace.executionHostId)?.id
  if (explicitHostId) {
    return explicitHostId
  }
  if (workspace.connectionId) {
    return toSshExecutionHostId(workspace.connectionId)
  }
  const matchingHosts = new Set(
    projectGroups
      .filter((group) => group.id === workspace.projectGroupId)
      .map(getProjectGroupHostId)
  )
  return matchingHosts.size === 1
    ? ([...matchingHosts][0] as ExecutionHostId)
    : LOCAL_EXECUTION_HOST_ID
}
export function getFolderWorkspaceHostIdentity(
  workspace: FolderWorkspace,
  projectGroups: readonly ProjectGroup[]
): string {
  return JSON.stringify([getFolderWorkspaceHostId(workspace, projectGroups), workspace.id])
}
export function getFolderWorkspaceUpdateIdentity(
  hostId: ExecutionHostId,
  folderWorkspaceId: string
): string {
  return `${hostId}\0${folderWorkspaceId}`
}
export function mergeFetchedFolderWorkspacesForHost({
  previous,
  fetched,
  projectGroups,
  hostId
}: {
  previous: readonly FolderWorkspace[]
  fetched: FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  hostId: string
}): FolderWorkspace[] {
  const fetchedIdentities = new Set(
    fetched.map((workspace) => getFolderWorkspaceHostIdentity(workspace, projectGroups))
  )
  const preserved = previous.filter((workspace) => {
    const existingHostId = getFolderWorkspaceHostId(workspace, projectGroups)
    return (
      !catalogOwnsHost(hostId, existingHostId) ||
      fetchedIdentities.has(getFolderWorkspaceHostIdentity(workspace, projectGroups))
    )
  })
  return mergeByIdentity(preserved, fetched, (workspace) =>
    getFolderWorkspaceHostIdentity(workspace, projectGroups)
  )
}
export type FetchedRepoCatalog = {
  repos: Repo[]
  projectHostSetupCompatibility: ProjectHostSetupProjection
  hostId: ReturnType<typeof getRuntimeTargetHostId>
}
