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
export function createRepoSliceRemoveProjectActions7(set: SliceSet, get: SliceGet) {
  return {
  removeProject: async (projectId, options) => {
    try {
      // Why: pass an explicit hostId so a duplicate id across hosts resolves to the intended row, not the focused-host fallback.
      const ownerRepo = findRepoForHost(get().repos, projectId, {
        settings: get().settings,
        hostId: options?.hostId
      })
      if (!ownerRepo) {
        return
      }
      const ownerHostId = getRepoExecutionHostId(ownerRepo)
      // Why: an SSH per-workspace-env's workspace is the repo's main worktree, so removal routes here; tear down its ephemeral runtime first so it doesn't leak.
      if (isRuntimeOwnedSshTargetId(ownerRepo.connectionId)) {
        await cleanupEphemeralVmRuntimesForDeleted({
          workspaceIds: getKnownRepoWorktreeIds(get(), projectId, ownerHostId),
          runtimeOwnedSshTargetIds: [ownerRepo.connectionId as string]
        })
      }
      // Why: derive the target from the owner's settings (via options.hostId) so an SSH host removal never routes repo.rm to the focused runtime.
      const target = getActiveRuntimeTarget(settingsForRepoOwner(get(), projectId, options?.hostId))
      // Why: repos:remove is id-only and would delete every host's row; scope local removal to the owning host so cross-host duplicates keep other rows.
      const idExistsOnOtherHost = get().repos.some(
        (repo) => repo.id === projectId && getRepoExecutionHostId(repo) !== ownerHostId
      )
      await (target.kind === 'local'
        ? idExistsOnOtherHost
          ? getClientRuntime().workspace.repos.removeForHost({ repoId: projectId, hostId: ownerHostId })
          : getClientRuntime().workspace.repos.remove({ repoId: projectId })
        : callRuntimeRpc(target, 'repo.rm', { repo: projectId }, { timeoutMs: 15_000 }))

      get().clearOrcaHookTrustForRepo(projectId)
      const repoPath = get().repos.find((repo) =>
        repoMatchesHostIdentity(repo, projectId, ownerHostId)
      )?.path
      get().evictGitHubRepoCaches(projectId, repoPath)
      const { clearRepoSlugCacheEntry } = await import('../../lib/repo-slug-index')
      clearRepoSlugCacheEntry(projectId)

      // Kill PTYs for all worktrees belonging to this repo
      const worktreeIds = getKnownRepoWorktreeIds(get(), projectId, ownerHostId)
      const killedTabIds = new Set<string>()
      if (target.kind === 'environment') {
        await Promise.allSettled(
          worktreeIds.map((worktreeId) =>
            callRuntimeRpc(
              target,
              'terminal.stop',
              { worktree: toRuntimeWorktreeSelector(worktreeId) },
              { timeoutMs: 15_000 }
            )
          )
        )
      }
      for (const wId of worktreeIds) {
        const tabs = get().tabsByWorktree[wId] ?? []
        for (const tab of tabs) {
          killedTabIds.add(tab.id)
          for (const ptyId of get().ptyIdsByTabId[tab.id] ?? []) {
            if (!ptyId.startsWith('remote:')) {
              getClientRuntime().terminal.kill(ptyId)
            }
          }
        }
      }

      // Why: use the canonical per-worktree purge to evict all worktree-scoped maps (hand-deletion leaked most); runs before the set() below so it still sees tabsByWorktree.
      get().purgeWorktreeTerminalState(worktreeIds)

      set((s) => {
        const nextWorktrees = { ...s.worktreesByRepo }
        const remainingWorktrees = (nextWorktrees[projectId] ?? []).filter(
          (worktree) => !worktreeBelongsToHost(worktree, ownerHostId)
        )
        if (remainingWorktrees.length > 0) {
          nextWorktrees[projectId] = remainingWorktrees
        } else {
          delete nextWorktrees[projectId]
        }
        const nextDetectedWorktrees = { ...s.detectedWorktreesByRepo }
        const detected = nextDetectedWorktrees[projectId]
        if (detected) {
          const remainingDetected = detected.worktrees.filter(
            (worktree) => !worktreeBelongsToHost(worktree, ownerHostId)
          )
          if (remainingDetected.length > 0) {
            nextDetectedWorktrees[projectId] = { ...detected, worktrees: remainingDetected }
          } else {
            delete nextDetectedWorktrees[projectId]
          }
        }
        const nextTabs = { ...s.tabsByWorktree }
        const nextLayouts = { ...s.terminalLayoutsByTabId }
        const nextPtyIdsByTabId = { ...s.ptyIdsByTabId }
        const nextRuntimePaneTitlesByTabId = { ...s.runtimePaneTitlesByTabId }
        for (const wId of worktreeIds) {
          delete nextTabs[wId]
        }
        for (const tabId of killedTabIds) {
          delete nextLayouts[tabId]
          delete nextPtyIdsByTabId[tabId]
          delete nextRuntimePaneTitlesByTabId[tabId]
        }
        // Why: editor state is worktree-scoped; clear the repo's open files + active-file tracking so orphans don't linger in the session save.
        const worktreeIdSet = new Set(worktreeIds)
        const nextOpenFiles = s.openFiles.filter((f) => !worktreeIdSet.has(f.worktreeId))
        const nextActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
        const nextActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
        for (const wId of worktreeIds) {
          delete nextActiveFileIdByWorktree[wId]
          delete nextActiveTabTypeByWorktree[wId]
        }
        const activeFileCleared = s.activeFileId
          ? s.openFiles.some((f) => f.id === s.activeFileId && worktreeIdSet.has(f.worktreeId))
          : false
        const nextRepos = s.repos.filter((r) => !repoMatchesHostIdentity(r, projectId, ownerHostId))
        // Why: when no sibling host owns this id, drop every worktree timestamp (unhydrated SSH ones would otherwise never prune); else stay host-scoped.
        const repoIdFullyRemoved = !nextRepos.some((r) => r.id === projectId)
        let nextLastVisitedAtByWorktreeId = s.lastVisitedAtByWorktreeId
        for (const id of Object.keys(s.lastVisitedAtByWorktreeId)) {
          if (
            worktreeIdSet.has(id) ||
            (repoIdFullyRemoved && getRepoIdFromWorktreeId(id) === projectId)
          ) {
            if (nextLastVisitedAtByWorktreeId === s.lastVisitedAtByWorktreeId) {
              nextLastVisitedAtByWorktreeId = { ...s.lastVisitedAtByWorktreeId }
            }
            delete nextLastVisitedAtByWorktreeId[id]
          }
        }
        const survivingRepoIds = new Set(nextRepos.map((r) => r.id))
        const removedRepoIds = s.repos.filter((r) => !survivingRepoIds.has(r.id)).map((r) => r.id)
        return {
          repos: nextRepos,
          // Why: drop removed repos' sparse-preset maps so they don't outlive the repo for the whole session.
          ...omitSparsePresetsForRepos(s, removedRepoIds),
          ...mergeProjectCompatibilityForHostRepoChange({
            previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
            nextRepos,
            hostId: ownerHostId
          }),
          activeRepoId: s.activeRepoId === projectId ? null : s.activeRepoId,
          filterRepoIds: s.filterRepoIds.filter((id) => id !== projectId),
          worktreesByRepo: nextWorktrees,
          detectedWorktreesByRepo: nextDetectedWorktrees,
          tabsByWorktree: nextTabs,
          ptyIdsByTabId: nextPtyIdsByTabId,
          runtimePaneTitlesByTabId: nextRuntimePaneTitlesByTabId,
          terminalLayoutsByTabId: nextLayouts,
          activeTabId: s.activeTabId && killedTabIds.has(s.activeTabId) ? null : s.activeTabId,
          openFiles: nextOpenFiles,
          activeFileIdByWorktree: nextActiveFileIdByWorktree,
          activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
          activeFileId: activeFileCleared ? null : s.activeFileId,
          activeTabType: activeFileCleared ? 'terminal' : s.activeTabType,
          lastVisitedAtByWorktreeId: nextLastVisitedAtByWorktreeId,
          folderWorkspacePathStatuses: {},
          sortEpoch: s.sortEpoch + 1,
          // Why: removing the last repo must reset activeView + clear activeWorktreeId so App renders Landing, not an empty settings/terminal pane.
          ...(nextRepos.length === 0
            ? {
                activeView: 'terminal' as const,
                activeWorktreeId: null,
                activeWorkspaceKey: null,
                activeWorkspaceExecutionHostId: null,
                activeRepoId: null
              }
            : {})
        }
      })
    } catch (err) {
      console.error('Failed to remove repo:', err)
    }
  },
  updateProject: async (projectId, updates) => {
    try {
      const target = getProjectUpdateRuntimeTarget(get(), projectId)
      const updatedProject =
        target.kind === 'local'
          ? await window.api.projects.update({ projectId, updates })
          : (
              await callRuntimeRpc<{ project: Project }>(
                target,
                'project.update',
                { projectId, updates },
                { timeoutMs: 15_000 }
              )
            ).project
      if (!updatedProject) {
        return false
      }
      const runtimePreferenceChanged = 'localWindowsRuntimePreference' in updates
      set((state) => ({
        projects: state.projects.map((project) =>
          project.id === projectId
            ? mergeUpdatedProjectCompatibilityProject(project, updatedProject, updates)
            : project
        ),
        folderWorkspacePathStatuses: {}
      }))
      if (runtimePreferenceChanged) {
        get().clearLocalDetectedAgents()
        notifyInstalledAgentSkillsChanged()
      }
      return true
    } catch (err) {
      console.error('Failed to update project:', err)
      return false
    }
  },
  }
}
