// Repository, project-group, clone, and folder-workspace IPC registration.
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { z } from 'zod'
import type { Store } from '../persistence'
import type {
  BaseRefSearchResult,
  Project,
  Repo,
  ProjectGroup,
  FolderWorkspace,
  ProjectGroupImportResult,
  ProjectUpdateArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  NestedRepoScanResult,
  BaseRefDefaultResult,
  SparsePreset
} from '../../shared/types'
import type { FolderWorkspacePathStatusRequest } from '../../shared/folder-workspace-path-status'
import { isFolderRepo } from '../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRepoBadgeColor } from '../../shared/repo-badge-color'
import { sanitizeRepoIcon } from '../../shared/repo-icon'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import type { ChildProcess } from 'node:child_process'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { gitExecFileAsync, gitSpawn, nonInteractiveGitEnv } from '../git/runner'
import { isAbsolute, join, posix } from 'node:path'
import {
  cleanupClaimedCloneTarget,
  claimCloneTarget,
  deriveCloneRepoNameFromUrl,
  deriveValidatedClonePath,
  getClonePathComparisonKey
} from '../git/repo-clone-path'
import type { ClaimedCloneTarget } from '../git/repo-clone-path'
import { scanNestedRepos } from '../project-groups/nested-repo-discovery'
import {
  createNestedProjectGroupResolver,
  resolveNestedRepoSelection
} from '../project-groups/nested-repo-import'
import { createNestedRepoImportTargetResolver } from '../project-groups/nested-repo-import-target'
import {
  isGitRepo,
  getGitRepoRoot,
  getLinkedWorktreeMainRepoRoot,
  getRepoName,
  getBaseRefDefault,
  getRemoteCount,
  normalizeRefSearchQuery,
  parseAndFilterSearchRefDetails,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec,
  buildSearchBaseRefsArgv,
  isForEachRefExcludeUnsupportedError,
  mergeBaseRefSearchResultGroups,
  searchBaseRefDetails
} from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshGitCapabilityCache } from '../git/git-capability-state'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getSshGitUsername, resolveLocalGitUsername } from '../git/git-username'
import { enrichRepoGitUsernames } from '../repo-git-username-enrichment'
import { getActiveMultiplexer } from './ssh'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import { track } from '../telemetry/client'
import { scheduleCurrentWorktreeBaseDirectoryWatcherSync } from './worktree-base-directory-watcher'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import type { RepoMethod } from '../../shared/telemetry-events'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../shared/host-repo-catalog-contract'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { enrichMissingRepoGitRemoteIdentities } from '../repo-git-remote-identity-enrichment'
import {
  getProjectHostSetupForRepo,
  getProjectIdForProviderIdentity
} from '../../shared/project-host-setup-projection'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import {
  assertFolderWorkspacePathUsable,
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath
} from '../project-groups/folder-workspace-path-status'
import { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { runWithGitReadCacheInvalidation } from '../git/status'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import { isCurrentSshProviderAuthority } from '../ssh/ssh-provider-authority'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { scanNestedReposForIpc,
  runNestedRepoScanForIpc } from './repo-ipc-folder-workspaces'
export { scanNestedReposForIpc,
  runNestedRepoScanForIpc } from './repo-ipc-folder-workspaces'

export function registerRepoHandlers(mainWindow: BrowserWindow, store: Store): void {
  // Remove previously registered handlers so we can re-register on macOS app re-activation (new window).
  ipcMain.removeHandler('repos:list')
  ipcMain.removeHandler('repos:listForExecutionHost')
  ipcMain.removeHandler('repos:add')
  ipcMain.removeHandler('repos:remove')
  ipcMain.removeHandler('repos:removeForHost')
  ipcMain.removeHandler('repos:reorder')
  ipcMain.removeHandler('repos:reorderForHost')
  ipcMain.removeHandler('repos:update')
  ipcMain.removeHandler('projects:list')
  ipcMain.removeHandler('projects:update')
  ipcMain.removeHandler('projectHostSetups:list')
  ipcMain.removeHandler('projectHostSetups:create')
  ipcMain.removeHandler('projectHostSetups:setupExistingFolder')
  ipcMain.removeHandler('projectHostSetups:update')
  ipcMain.removeHandler('projectHostSetups:delete')
  ipcMain.removeHandler('projectGroups:list')
  ipcMain.removeHandler('projectGroups:create')
  ipcMain.removeHandler('projectGroups:update')
  ipcMain.removeHandler('projectGroups:delete')
  ipcMain.removeHandler('projectGroups:moveProject')
  ipcMain.removeHandler('projectGroups:scanNested')
  ipcMain.removeHandler('projectGroups:cancelNestedScan')
  ipcMain.removeHandler('projectGroups:importNested')
  ipcMain.removeHandler('folderWorkspaces:list')
  ipcMain.removeHandler('folderWorkspaces:create')
  ipcMain.removeHandler('folderWorkspaces:update')
  ipcMain.removeHandler('folderWorkspaces:delete')
  ipcMain.removeHandler('folderWorkspaces:getPathStatus')
  ipcMain.removeHandler('repos:pickFolder')
  ipcMain.removeHandler('repos:pickFolders')
  ipcMain.removeHandler('repos:pickDirectory')
  ipcMain.removeHandler('repos:clone')
  ipcMain.removeHandler('repos:cloneAbort')
  ipcMain.removeHandler('repos:cloneRemote')
  ipcMain.removeHandler('repos:isGitAvailable')
  ipcMain.removeHandler('repos:getDefaultCreateProjectParent')
  ipcMain.removeHandler('repos:getGitUsername')
  ipcMain.removeHandler('repos:getBaseRefDefault')
  ipcMain.removeHandler('repos:searchBaseRefs')
  ipcMain.removeHandler('repos:searchBaseRefDetails')
  ipcMain.removeHandler('repos:addRemote')
  ipcMain.removeHandler('repos:create')
  ipcMain.removeHandler('repos:createRemote')
  ipcMain.removeHandler('sparsePresets:list')
  ipcMain.removeHandler('sparsePresets:save')
  ipcMain.removeHandler('sparsePresets:remove')

  ipcMain.handle('repos:list', () => {
    enrichMissingRepoGitRemoteIdentities(store, {
      onChanged: () => notifyReposChanged(mainWindow)
    })
    // Why: username resolution spawns git/gh, so keep it off this sync handler (issue #7225); it re-lists when values land.
    enrichRepoGitUsernames(store, {
      onChanged: () => notifyReposChanged(mainWindow)
    })
    return store.getRepos()
  })

  ipcMain.handle(
    'repos:listForExecutionHost',
    (_event, args: ListReposForExecutionHostArgs): Promise<HostRepoCatalogSnapshot> =>
      listReposForExecutionHost(store, args)
  )

  ipcMain.handle('projects:list', () => {
    enrichMissingRepoGitRemoteIdentities(store, {
      onChanged: () => notifyReposChanged(mainWindow)
    })
    return store.getProjects()
  })

  ipcMain.handle('projects:update', (_event, rawArgs: ProjectUpdateArgs): Project | null => {
    const args = parseProjectGroupIpcArgs(
      ProjectUpdateIpcArgs,
      rawArgs,
      'project_update_invalid_args'
    )
    return store.updateProject(args.projectId, args.updates)
  })

  ipcMain.handle('projectHostSetups:list', () => {
    enrichMissingRepoGitRemoteIdentities(store, {
      onChanged: () => notifyReposChanged(mainWindow)
    })
    return store.getProjectHostSetups()
  })

  ipcMain.handle(
    'projectHostSetups:create',
    (_event, rawArgs: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupCreateIpcArgs,
        rawArgs,
        'project_host_setup_create_invalid_args'
      )
      const result = store.createProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project not found: ${args.projectId}`)
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:update',
    (_event, rawArgs: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupUpdateIpcArgs,
        rawArgs,
        'project_host_setup_update_invalid_args'
      )
      const result = store.updateProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      if ('worktreeBasePath' in args.updates && result.repo) {
        void prepareLocalWorktreeRootForRepo(store, result.repo)
        invalidateAuthorizedRootsCache()
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:delete',
    (_event, rawArgs: ProjectHostSetupDeleteArgs): ProjectHostSetupDeleteResult => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupDeleteIpcArgs,
        rawArgs,
        'project_host_setup_delete_invalid_args'
      )
      const result = store.deleteProjectHostSetup(args)
      if (!result) {
        throw new Error(`Project host setup not found: ${args.setupId}`)
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  ipcMain.handle(
    'projectHostSetups:setupExistingFolder',
    async (
      _event,
      rawArgs: ProjectHostSetupExistingFolderArgs
    ): Promise<ProjectHostSetupResult> => {
      const args = parseProjectGroupIpcArgs(
        ProjectHostSetupExistingFolderIpcArgs,
        rawArgs,
        'project_host_setup_invalid_args'
      )
      const parsedHost = parseExecutionHostId(args.hostId)
      if (!parsedHost) {
        throw new Error(`Unsupported host: ${args.hostId}`)
      }
      const result =
        parsedHost.kind === 'local'
          ? await addLocalRepoFromPath(store, args.path, args.kind)
          : parsedHost.kind === 'ssh'
            ? await addRemoteRepoFromPath(store, {
                connectionId: parsedHost.targetId,
                remotePath: args.path,
                displayName: args.displayName,
                kind: args.kind
              })
            : {
                error:
                  'Runtime hosts must be set up through the runtime projectHostSetup.setupExistingFolder RPC.'
              }
      if ('error' in result) {
        throw new Error(result.error)
      }
      let aligned: ProjectHostSetupResult
      try {
        aligned = alignRepoWithRequestedProject(
          store,
          result.repo,
          args.projectId,
          args.setupMethod,
          args.projectProviderIdentity
        )
      } catch (err) {
        // Why: an import that cannot be linked must not leave a new repo registration or authorization root behind.
        if (!result.alreadyExisted) {
          store.removeProject(result.repo.id)
          invalidateAuthorizedRootsCache()
        }
        throw err
      }
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      emitRepoAdded('folder_picker', result.alreadyExisted)
      if (result.alreadyExisted) {
        await prepareLocalWorktreeRootForRepo(store, aligned.repo)
      }
      return aligned
    }
  )

  ipcMain.handle('repos:isGitAvailable', () => isGitAvailable())
  ipcMain.handle('repos:getDefaultCreateProjectParent', () => getDefaultCreateProjectParent())

  ipcMain.handle('projectGroups:list', () => store.getProjectGroups())

  ipcMain.handle('folderWorkspaces:list', (): FolderWorkspace[] => store.getFolderWorkspaces())

  ipcMain.handle('folderWorkspaces:getPathStatus', async (_event, rawArgs: unknown) => {
    const args = parseProjectGroupIpcArgs(
      FolderWorkspacePathStatusArgs,
      rawArgs,
      'invalid_folder_workspace_path_status_args'
    ) as FolderWorkspacePathStatusRequest
    return getFolderWorkspacePathStatus(store, args, { getSshFilesystemProvider })
  })

  ipcMain.handle(
    'folderWorkspaces:create',
    async (_event, rawArgs: unknown): Promise<FolderWorkspace> => {
      const args = parseProjectGroupIpcArgs(
        FolderWorkspaceCreateArgs,
        rawArgs,
        'invalid_folder_workspace_create_args'
      )
      const projectGroups = store.getProjectGroups()
      const group = projectGroups.find((entry) => entry.id === args.projectGroupId)
      const folderPath =
        typeof args.folderPath === 'string' && args.folderPath.trim().length > 0
          ? args.folderPath
          : group?.parentPath
      if (!group || !folderPath) {
        throw new Error('folder_workspace_project_group_not_found')
      }
      const status = await getFolderWorkspacePathStatusForPath(
        {
          folderPath,
          projectGroupId: group.id,
          connectionId: args.connectionId ?? group.connectionId ?? null,
          projectGroups,
          repos: store.getRepos()
        },
        { getSshFilesystemProvider }
      )
      assertFolderWorkspacePathUsable(status)
      const workspace = store.createFolderWorkspace(args)
      notifyReposChanged(mainWindow)
      return workspace
    }
  )

  ipcMain.handle(
    'folderWorkspaces:update',
    async (_event, rawArgs: unknown): Promise<FolderWorkspace | null> => {
      const args = parseProjectGroupIpcArgs(
        FolderWorkspaceUpdateArgs,
        rawArgs,
        'invalid_folder_workspace_update_args'
      )
      if (
        typeof args.updates.folderPath === 'string' &&
        args.updates.folderPath.trim().length > 0
      ) {
        const workspace = store.getFolderWorkspace(args.folderWorkspaceId)
        if (!workspace) {
          return null
        }
        const projectGroups = store.getProjectGroups()
        const status = await getFolderWorkspacePathStatusForPath(
          {
            folderPath: args.updates.folderPath,
            projectGroupId: workspace.projectGroupId,
            connectionId:
              workspace.connectionId ??
              projectGroups.find((entry) => entry.id === workspace.projectGroupId)?.connectionId ??
              null,
            projectGroups,
            repos: store.getRepos()
          },
          { getSshFilesystemProvider }
        )
        assertFolderWorkspacePathUsable(status)
      }
      const updated = store.updateFolderWorkspace(args.folderWorkspaceId, args.updates)
      if (updated) {
        notifyReposChanged(mainWindow)
      }
      return updated
    }
  )

  ipcMain.handle('folderWorkspaces:delete', (_event, rawArgs: unknown): boolean => {
    const args = parseProjectGroupIpcArgs(
      FolderWorkspaceSelectorArgs,
      rawArgs,
      'invalid_folder_workspace_delete_args'
    )
    const deleted = store.removeFolderWorkspace(args.folderWorkspaceId)
    if (deleted) {
      notifyReposChanged(mainWindow)
    }
    return deleted
  })

  ipcMain.handle('projectGroups:create', (_event, rawArgs: unknown): ProjectGroup => {
    const args = parseProjectGroupIpcArgs(
      ProjectGroupCreateArgs,
      rawArgs,
      'invalid_project_group_create_args'
    )
    const group = store.createProjectGroup({
      name: args.name,
      parentPath: args.parentPath ?? null,
      connectionId: args.connectionId ?? null,
      parentGroupId: args.parentGroupId ?? null,
      createdFrom: args.createdFrom ?? 'manual'
    })
    notifyReposChanged(mainWindow)
    return group
  })

  ipcMain.handle('projectGroups:update', (_event, rawArgs: unknown): ProjectGroup | null => {
    const args = parseProjectGroupIpcArgs(
      ProjectGroupUpdateArgs,
      rawArgs,
      'invalid_project_group_update_args'
    )
    const updated = store.updateProjectGroup(args.groupId, args.updates)
    if (updated) {
      notifyReposChanged(mainWindow)
    }
    return updated
  })

  ipcMain.handle('projectGroups:delete', (_event, rawArgs: unknown): boolean => {
    const args = parseProjectGroupIpcArgs(
      ProjectGroupSelectorArgs,
      rawArgs,
      'invalid_project_group_delete_args'
    )
    const deleted = store.deleteProjectGroup(args.groupId)
    if (deleted) {
      notifyReposChanged(mainWindow)
    }
    return deleted
  })

  ipcMain.handle('projectGroups:moveProject', (_event, rawArgs: unknown): Repo | null => {
    const args = parseProjectGroupIpcArgs(
      ProjectGroupMoveProjectArgs,
      rawArgs,
      'invalid_project_group_move_repo_args'
    )
    const moved = store.moveProjectToGroup(args.projectId, args.groupId, args.order)
    if (moved) {
      notifyReposChanged(mainWindow)
    }
    return moved
  })

  ipcMain.handle(
    'projectGroups:scanNested',
    async (event, rawArgs: unknown): Promise<NestedRepoScanResult> => {
      const args = parseProjectGroupIpcArgs(
        ProjectGroupScanNestedArgs,
        rawArgs,
        'invalid_project_group_scan_nested_args'
      )
      return runNestedRepoScanForIpc(event, args)
    }
  )

  ipcMain.handle('projectGroups:cancelNestedScan', (_event, rawArgs: unknown): boolean => {
    const args = parseProjectGroupIpcArgs(
      ProjectGroupCancelNestedScanArgs,
      rawArgs,
      'invalid_project_group_cancel_nested_scan_args'
    )
    const controller = activeNestedRepoScans.get(args.scanId)
    if (!controller) {
      return false
    }
    controller.abort()
    return true
  })

  ipcMain.handle(
    'projectGroups:importNested',
    async (_event, rawArgs: unknown): Promise<ProjectGroupImportResult> => {
      const args = parseProjectGroupIpcArgs(
        ProjectGroupImportNestedArgs,
        rawArgs,
        'invalid_project_group_import_nested_args'
      )
      const requestedPaths = args.projectPaths
      const completedScan = getCompletedNestedRepoScan(args)
      const scan =
        completedScan ??
        (await scanNestedReposForIpc({
          path: args.parentPath,
          connectionId: args.connectionId,
          options: { timeoutMs: 15_000 }
        }))
      const selection = resolveNestedRepoSelection({ scan, projectPaths: requestedPaths })
      const groupResolver = createNestedProjectGroupResolver({
        parentPath: scan.selectedPath,
        groupName: args.groupName ?? '',
        mode: args.mode,
        connectionId: args.connectionId ?? null,
        repoPaths: selection.selectedPaths,
        createGroup: (input) => store.createProjectGroup(input)
      })
      const results: ProjectGroupImportResult['projects'] = selection.rejectedPaths.map(
        (repoPath) => ({
          path: repoPath,
          status: 'failed',
          error: 'Repository was not found in the nested repo scan result'
        })
      )
      const importedProjectIdsByRepoPath = new Map<string, string>()
      const importTargetResolver = createNestedRepoImportTargetResolver()

      for (const [projectGroupOrder, repoPath] of selection.selectedPaths.entries()) {
        try {
          let importRepoPath = repoPath
          if (args.connectionId) {
            const gitProvider = getSshGitProvider(args.connectionId)
            const check = gitProvider ? await gitProvider.isGitRepoAsync(repoPath) : null
            if (!gitProvider || !check?.isRepo) {
              results.push({
                path: repoPath,
                status: 'failed',
                error: 'Not a valid git repository'
              })
              continue
            }
            importRepoPath = await importTargetResolver.resolveSsh(repoPath, gitProvider)
          } else if (!isGitRepo(repoPath)) {
            results.push({ path: repoPath, status: 'failed', error: 'Not a valid git repository' })
            continue
          } else {
            importRepoPath = await importTargetResolver.resolveLocal(repoPath)
          }
          const normalizedImportRepoPath = normalizeRuntimePathForComparison(importRepoPath)
          const alreadyImportedProjectId =
            importedProjectIdsByRepoPath.get(normalizedImportRepoPath)
          if (alreadyImportedProjectId) {
            results.push({
              path: repoPath,
              projectId: alreadyImportedProjectId,
              status: 'already-known'
            })
            continue
          }
          const existing = store
            .getRepos()
            .find(
              (repo) =>
                (repo.connectionId ?? null) === (args.connectionId ?? null) &&
                normalizeRuntimePathForComparison(repo.path) === normalizedImportRepoPath
            )
          const group = groupResolver.getGroupForRepo(repoPath)
          if (existing) {
            if (group) {
              store.moveProjectToGroup(existing.id, group.id, projectGroupOrder)
            }
            importedProjectIdsByRepoPath.set(normalizedImportRepoPath, existing.id)
            results.push({ path: repoPath, projectId: existing.id, status: 'already-known' })
            continue
          }
          const detected = await detectRepoIconAndUpstream({
            repoPath: importRepoPath,
            kind: 'git',
            connectionId: args.connectionId
          })
          const repo: Repo = {
            id: randomUUID(),
            path: importRepoPath,
            displayName: getRepoName(importRepoPath),
            badgeColor: DEFAULT_REPO_BADGE_COLOR,
            ...detected,
            addedAt: Date.now(),
            kind: 'git',
            ...(args.connectionId ? { connectionId: args.connectionId } : {}),
            externalWorktreeVisibility: 'hide',
            externalWorktreeVisibilityLegacy: false,
            projectHostSetupMethod: 'imported-existing-folder',
            ...(group
              ? {
                  projectGroupId: group.id,
                  projectGroupOrder
                }
              : {})
          }
          store.addRepo(repo)
          await prepareLocalWorktreeRootForRepo(store, repo)
          if (args.connectionId) {
            getActiveMultiplexer(args.connectionId)?.notify('session.registerRoot', {
              rootPath: importRepoPath
            })
          }
          importedProjectIdsByRepoPath.set(normalizedImportRepoPath, repo.id)
          results.push({ path: repoPath, projectId: repo.id, status: 'imported' })
          // Why: reaches here only after the isGitRepo guard above confirmed a git repo, so always true.
          emitRepoAdded('folder_picker', false, true)
        } catch (error) {
          results.push({
            path: repoPath,
            status: 'failed',
            error: sanitizeNestedRepoImportError('Failed to import nested repository', error)
          })
        }
      }

      const importedCount = results.filter((entry) => entry.status === 'imported').length
      const alreadyKnownCount = results.filter((entry) => entry.status === 'already-known').length
      const failedCount = results.filter((entry) => entry.status === 'failed').length
      if (importedCount + alreadyKnownCount === 0) {
        for (const group of groupResolver.getCreatedGroups().toReversed()) {
          store.deleteProjectGroup(group.id)
        }
      }
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      const rootGroup = groupResolver.getRootGroup()
      return {
        ...(rootGroup && importedCount + alreadyKnownCount > 0 ? { group: rootGroup } : {}),
        projects: results,
        importedCount,
        alreadyKnownCount,
        failedCount
      }
    }
  )

  ipcMain.handle(
    'repos:add',
    async (
      _event,
      args: { path: string; kind?: 'git' | 'folder' }
    ): Promise<{ repo: Repo } | { error: string }> => {
      const result = await addLocalRepoFromPath(store, args.path, args.kind)
      if ('error' in result) {
        return result
      }
      if (result.alreadyExisted) {
        await prepareLocalWorktreeRootForRepo(store, result.repo)
      }
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      emitRepoAdded('folder_picker', result.alreadyExisted, result.repo.kind === 'git')
      return { repo: result.repo }
    }
  )

  ipcMain.handle(
    'repos:addRemote',
    async (
      _event,
      args: {
        connectionId: string
        remotePath: string
        displayName?: string
        kind?: 'git' | 'folder'
      }
    ): Promise<{ repo: Repo } | { error: string }> => {
      const result = await addRemoteRepoFromPath(store, args)
      if ('error' in result) {
        return result
      }
      notifyReposChanged(mainWindow)
      emitRepoAdded('folder_picker', result.alreadyExisted, result.repo.kind === 'git')
      return { repo: result.repo }
    }
  )

  ipcMain.handle(
    'repos:createRemote',
    async (
      _event,
      args: {
        connectionId: string
        parentPath: string
        name: string
        kind: 'git' | 'folder'
      }
    ): Promise<{ repo: Repo } | { error: string }> => {
      const result = await createRemoteRepo(store, args)
      if ('error' in result) {
        return result
      }
      notifyReposChanged(mainWindow)
      return result
    }
  )

  // Create a repo/folder from scratch (orca#763); git repos need an empty initial commit so HEAD has a branch ref for worktrees.
  ipcMain.handle(
    'repos:create',
    async (
      _event,
      args: { parentPath: string; name: string; kind: 'git' | 'folder' }
    ): Promise<{ repo: Repo } | { error: string }> => {
      const name = args.name?.trim() ?? ''
      const parentPath = args.parentPath?.trim() ?? ''
      // Why: IPC input is untrusted — coerce to the narrow union so a bogus kind can't skip git init yet persist in the store.
      const repoKind: 'git' | 'folder' = args.kind === 'folder' ? 'folder' : 'git'

      if (!name) {
        return { error: 'Name cannot be empty' }
      }
      // Block slashes and ./.. so the name can't escape the chosen parent (guards direct IPC use).
      if (/[\\/]/.test(name) || name === '.' || name === '..') {
        return { error: 'Name cannot contain slashes or be "." / ".."' }
      }
      if (!parentPath) {
        return { error: 'Parent directory is required' }
      }
      // Why: block CWD-relative paths at the IPC boundary — keeps targetPath stable across process cwd changes.
      if (!isAbsolute(parentPath)) {
        return { error: 'Parent directory must be an absolute path' }
      }

      const targetPath = join(parentPath, name)

      // Dedup by path so a double-click on Create doesn't make two entries for one folder (first of three dedup checks).
      const existing = store.getRepos().find((r) => r.path === targetPath)
      if (existing) {
        emitRepoAdded('folder_picker', true, repoKind === 'git')
        return { repo: existing }
      }

      // Empty pre-existing dirs are allowed (e.g. made in Finder first); non-empty ones are rejected so we don't overwrite files.
      let createdDir = false
      let targetExists = false
      try {
        // Why: the default parent (~/orca/projects) may not exist on a fresh install; create only the parent before probing the target.
        await mkdir(parentPath, { recursive: true })
        await access(targetPath)
        targetExists = true
      } catch (err) {
        // Why: only ENOENT means the path is free; other codes are something mkdir can't fix, so surface a precise error.
        // Why: tests/non-Node errors lack a code, so treat an ENOENT-looking message as ENOENT to avoid over-rejecting.
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as NodeJS.ErrnoException).code
            : undefined
        const looksLikeEnoent =
          code === 'ENOENT' ||
          (code === undefined && err instanceof Error && /ENOENT/.test(err.message))
        if (!looksLikeEnoent) {
          const message = err instanceof Error ? err.message : String(err)
          return { error: `Cannot access target path: ${message}` }
        }
      }

      if (targetExists) {
        try {
          const entries = await readdir(targetPath)
          if (entries.length > 0) {
            return {
              error: `"${name}" already exists at this location and is not empty.`
            }
          }
        } catch (err) {
          // Why: access ok but readdir failed — path exists but isn't an inspectable dir (file or perms); return a distinct error.
          const message = err instanceof Error ? err.message : String(err)
          return { error: `Failed to read directory: ${message}` }
        }
      } else {
        try {
          await mkdir(targetPath, { recursive: false })
          createdDir = true
        } catch (err) {
          // Why: EEXIST means a concurrent repos:create won the mkdir race; return its store entry instead of a confusing error.
          const code =
            err && typeof err === 'object' && 'code' in err
              ? (err as NodeJS.ErrnoException).code
              : undefined
          const isEexist = code === 'EEXIST' || (err instanceof Error && /EEXIST/.test(err.message))
          if (isEexist) {
            const raceWinner = store.getRepos().find((r) => r.path === targetPath)
            if (raceWinner) {
              return { repo: raceWinner }
            }
          }
          const message = err instanceof Error ? err.message : String(err)
          return { error: `Failed to create directory: ${message}` }
        }
      }

      if (repoKind === 'git') {
        // Why: track which git step ran so catch can attribute failure; the identity-hint regex only applies during commit.
        let step: 'init' | 'commit' = 'init'
        try {
          await gitExecFileAsync(['init'], { cwd: targetPath })
          step = 'commit'
          await gitExecFileAsync(['commit', '--allow-empty', '-m', 'Initial commit'], {
            cwd: targetPath
          })
        } catch (err) {
          // Only rm the dir if we made it (pre-existing folders must survive retry); otherwise strip just the .git/ that git init created.
          if (createdDir) {
            await rm(targetPath, { recursive: true, force: true }).catch(() => {})
          } else if (step === 'commit') {
            await rm(join(targetPath, '.git'), { recursive: true, force: true }).catch(() => {})
          }
          const message = err instanceof Error ? err.message : String(err)
          if (
            step === 'commit' &&
            /Please tell me who you are|user\.name|user\.email/i.test(message)
          ) {
            return {
              error:
                'Git author identity is not configured. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then try again.'
            }
          }
          const stepLabel =
            step === 'init'
              ? 'Failed to initialize git repository'
              : 'Failed to create initial commit'
          return { error: `${stepLabel}: ${message}` }
        }
      }

      // Why: ipcMain.handle doesn't serialize calls, so re-check dedup here to close the race between the first check and addRepo.
      const raceWinner = store.getRepos().find((r) => r.path === targetPath)
      if (raceWinner) {
        // Why: don't rm even if we made the dir — the race winner owns it; leaking an empty folder beats deleting a dir in use.
        emitRepoAdded('folder_picker', true, repoKind === 'git')
        return { repo: raceWinner }
      }

      const detected = await detectRepoIconAndUpstream({ repoPath: targetPath, kind: repoKind })
      const repo: Repo = {
        id: randomUUID(),
        path: targetPath,
        displayName: name,
        badgeColor: DEFAULT_REPO_BADGE_COLOR,
        ...detected,
        addedAt: Date.now(),
        kind: repoKind,
        ...(repoKind === 'git'
          ? {
              externalWorktreeVisibility: 'hide' as const,
              externalWorktreeVisibilityLegacy: false,
              projectHostSetupMethod: 'imported-existing-folder' as const
            }
          : {})
      }

      store.addRepo(repo)
      await prepareLocalWorktreeRootForRepo(store, repo)
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      // Why: repos:create git-inits when kind is 'git', so repoKind is the true git-vs-folder signal.
      emitRepoAdded('folder_picker', false, repoKind === 'git')
      return { repo }
    }
  )

  ipcMain.handle(
    'repos:reorder',
    (_event, args: { orderedIds: string[] }): { status: 'applied' | 'rejected' } => {
      // Why: a permutation mismatch means the renderer's drag was stale vs a concurrent add/remove; reject so it can resync.
      const ids = Array.isArray(args?.orderedIds) ? args.orderedIds : []
      const applied = store.reorderRepos(ids)
      if (applied) {
        notifyReposChanged(mainWindow)
        return { status: 'applied' }
      }
      return { status: 'rejected' }
    }
  )

  ipcMain.handle(
    'repos:reorderForHost',
    (
      _event,
      args: { orderedIds: string[]; hostId: string }
    ): { status: 'applied' | 'rejected' } => {
      const hostId = normalizeExecutionHostId(args?.hostId)
      if (!hostId) {
        return { status: 'rejected' }
      }
      const ids = Array.isArray(args?.orderedIds) ? args.orderedIds : []
      const applied = store.reorderReposForHost(ids, hostId)
      if (applied) {
        notifyReposChanged(mainWindow)
        return { status: 'applied' }
      }
      return { status: 'rejected' }
    }
  )

  ipcMain.handle('repos:remove', async (_event, args: { repoId: string }) => {
    store.removeProject(args.repoId)
    invalidateAuthorizedRootsCache()
    notifyReposChanged(mainWindow)
  })

  // Why: forget a project on one execution host without disturbing the same repo id on other hosts (SSH-workspace forget flow).
  ipcMain.handle(
    'repos:removeForHost',
    async (_event, args: { repoId: string; hostId: string }) => {
      const hostId = normalizeExecutionHostId(args.hostId)
      if (!hostId) {
        throw new Error(`Invalid host ID: ${args.hostId}`)
      }
      store.removeProjectForHost(args.repoId, hostId)
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
    }
  )

  ipcMain.handle(
    'repos:update',
    (
      _event,
      args: {
        repoId: string
        hostId?: ExecutionHostId
        updates: Partial<
          Pick<
            Repo,
            | 'displayName'
            | 'badgeColor'
            | 'repoIcon'
            | 'upstream'
            | 'hookSettings'
            | 'worktreeBaseRef'
            | 'worktreeBasePath'
            | 'kind'
            | 'symlinkPaths'
            | 'issueSourcePreference'
            | 'forkSyncMode'
            | 'externalWorktreeVisibility'
            | 'externalWorktreeVisibilityPromptDismissedAt'
            | 'externalWorktreeInboxBaselinePaths'
            | 'importedExternalWorktreePaths'
            | 'projectGroupId'
            | 'projectGroupOrder'
          >
        > & {
          sourceControlAi?: Repo['sourceControlAi'] | null
          externalWorktreeDiscoverySuppressedAt?:
            | Repo['externalWorktreeDiscoverySuppressedAt']
            | null
        }
      }
    ) => {
      // Why: TS is erased at runtime, so a garbage preference would silently collapse to 'auto' in resolveIssueSource; strip it, keeping other fields.
      const updates = { ...args.updates }
      if (
        'issueSourcePreference' in updates &&
        updates.issueSourcePreference !== undefined &&
        updates.issueSourcePreference !== 'upstream' &&
        updates.issueSourcePreference !== 'origin' &&
        updates.issueSourcePreference !== 'auto'
      ) {
        delete updates.issueSourcePreference
      }
      if (
        'forkSyncMode' in updates &&
        updates.forkSyncMode !== undefined &&
        updates.forkSyncMode !== 'ask' &&
        updates.forkSyncMode !== 'safe-auto' &&
        updates.forkSyncMode !== 'off'
      ) {
        delete updates.forkSyncMode
      }
      // Why: worktree materialization calls .trim() per entry, so strip non-string[] at the boundary to avoid a silent throw later.
      if ('symlinkPaths' in updates && updates.symlinkPaths !== undefined) {
        const v = updates.symlinkPaths as unknown
        if (!Array.isArray(v) || !v.every((e) => typeof e === 'string')) {
          delete updates.symlinkPaths
        }
      }
      if ('worktreeBasePath' in updates && updates.worktreeBasePath !== undefined) {
        const v = updates.worktreeBasePath as unknown
        if (typeof v !== 'string') {
          delete updates.worktreeBasePath
        } else {
          updates.worktreeBasePath = v.trim() || undefined
        }
      }
      if ('repoIcon' in updates) {
        const repoIcon = sanitizeRepoIcon(updates.repoIcon)
        if (repoIcon === undefined) {
          delete updates.repoIcon
        } else {
          updates.repoIcon = repoIcon
        }
      }
      if ('badgeColor' in updates) {
        const badgeColor = normalizeRepoBadgeColor(updates.badgeColor)
        if (!badgeColor) {
          delete updates.badgeColor
        } else {
          updates.badgeColor = badgeColor
        }
      }
      if (
        'externalWorktreeVisibility' in updates &&
        updates.externalWorktreeVisibility !== undefined &&
        updates.externalWorktreeVisibility !== 'hide' &&
        updates.externalWorktreeVisibility !== 'show'
      ) {
        delete updates.externalWorktreeVisibility
      }
      if (
        'externalWorktreeVisibilityPromptDismissedAt' in updates &&
        updates.externalWorktreeVisibilityPromptDismissedAt !== undefined &&
        (typeof updates.externalWorktreeVisibilityPromptDismissedAt !== 'number' ||
          !Number.isFinite(updates.externalWorktreeVisibilityPromptDismissedAt))
      ) {
        delete updates.externalWorktreeVisibilityPromptDismissedAt
      }
      // Why: null is the transport sentinel for clearing discovery suppression.
      if (
        'externalWorktreeDiscoverySuppressedAt' in updates &&
        updates.externalWorktreeDiscoverySuppressedAt === null
      ) {
        updates.externalWorktreeDiscoverySuppressedAt = undefined
      } else if (
        'externalWorktreeDiscoverySuppressedAt' in updates &&
        updates.externalWorktreeDiscoverySuppressedAt !== undefined &&
        (typeof updates.externalWorktreeDiscoverySuppressedAt !== 'number' ||
          !Number.isFinite(updates.externalWorktreeDiscoverySuppressedAt))
      ) {
        delete updates.externalWorktreeDiscoverySuppressedAt
      }
      if (
        'externalWorktreeInboxBaselinePaths' in updates &&
        updates.externalWorktreeInboxBaselinePaths !== undefined
      ) {
        const value = updates.externalWorktreeInboxBaselinePaths as unknown
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          delete updates.externalWorktreeInboxBaselinePaths
        }
      }
      if (
        'importedExternalWorktreePaths' in updates &&
        updates.importedExternalWorktreePaths !== undefined
      ) {
        const value = updates.importedExternalWorktreePaths as unknown
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          delete updates.importedExternalWorktreePaths
        }
      }
      // Why: null is the transport sentinel for clearing Source Control AI, so flow it through as undefined instead of deleting.
      if ('sourceControlAi' in updates && updates.sourceControlAi === null) {
        updates.sourceControlAi = undefined
      } else if ('sourceControlAi' in updates && updates.sourceControlAi !== undefined) {
        const normalizedSourceControlAi = normalizeRepoSourceControlAiOverrides(
          updates.sourceControlAi
        )
        if (normalizedSourceControlAi === undefined) {
          delete updates.sourceControlAi
        } else {
          updates.sourceControlAi = normalizedSourceControlAi
        }
      }
      const hostId = args.hostId ? normalizeExecutionHostId(args.hostId) : null
      if (args.hostId && !hostId) {
        return null
      }
      const updated = hostId
        ? store.updateRepo(args.repoId, updates, hostId)
        : store.updateRepo(args.repoId, updates)
      if (updated) {
        if ('worktreeBasePath' in updates) {
          void prepareLocalWorktreeRootForRepo(store, updated)
          invalidateAuthorizedRootsCache()
        }
        notifyReposChanged(mainWindow)
      }
      return updated
    }
  )

  // ── Sparse presets ─────────────────────────────────────────────
  // Why: repo-scoped reusable directory lists for the new-workspace composer; broadcast on change so open composers refresh.

  ipcMain.handle('sparsePresets:list', (_event, args: { repoId: string }) => {
    return store.getSparsePresets(args.repoId)
  })

  ipcMain.handle(
    'sparsePresets:save',
    (
      _event,
      args: { repoId: string; id?: string; name: string; directories: string[] }
    ): SparsePreset => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        throw new Error(`Repo "${args.repoId}" not found`)
      }
      const name = normalizeSparsePresetName(args.name)
      const directories = normalizeSparsePresetDirectories(args.directories)
      const now = Date.now()
      const existing = args.id
        ? store.getSparsePresets(args.repoId).find((preset) => preset.id === args.id)
        : undefined
      const preset: SparsePreset = {
        id: existing?.id ?? randomUUID(),
        repoId: args.repoId,
        name,
        directories,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      const saved = store.saveSparsePreset(preset)
      notifySparsePresetsChanged(mainWindow, args.repoId)
      return saved
    }
  )

  ipcMain.handle('sparsePresets:remove', (_event, args: { repoId: string; presetId: string }) => {
    const repo = store.getRepo(args.repoId)
    if (!repo) {
      throw new Error(`Repo "${args.repoId}" not found`)
    }
    store.removeSparsePreset(args.repoId, args.presetId)
    notifySparsePresetsChanged(mainWindow, args.repoId)
  })

  ipcMain.handle('repos:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('repos:pickFolders', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return []
    }
    return result.filePaths
  })

  // Why: generic folder picker, separate from pickFolder's add-project flow; a clone destination may not be a git repo yet.
  ipcMain.handle('repos:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      // Why: macOS materializes typed partial paths with directory creation on; clone/create make the final path on submit.
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('repos:cloneAbort', async () => {
    if (activeClone) {
      const clone = activeClone
      clone.abortRequested = true
      markCloneAbortCleanupPending(clone)
      clone.process.kill()
      activeClone = null
    }
    if (activeRemoteClone) {
      activeRemoteClone.controller.abort()
      activeRemoteClone = null
    }
  })

  ipcMain.handle(
    'repos:clone',
    async (_event, args: { url: string; destination: string }): Promise<Repo> => {
      // Why: derive the repo folder name from the URL's last segment, matching default git clone behavior.
      const clonePath = deriveValidatedClonePath(args)
      const clonePathKey = getClonePathComparisonKey(clonePath)
      return runWithClonePathLock(clonePathKey, async () => {
        await pendingAbortCleanupByPath.get(clonePathKey)
        const existingAfterPendingClone = store
          .getRepos()
          .find((r) => getClonePathComparisonKey(r.path) === clonePathKey)
        if (existingAfterPendingClone && !isFolderRepo(existingAfterPendingClone)) {
          // Why: clone_url always produces a git repo.
          emitRepoAdded('clone_url', true, true)
          return existingAfterPendingClone
        }
        // Why: gitSpawn cwd is args.destination, so it must exist before spawn (fresh installs may lack the defaulted parent).
        await mkdir(args.destination, { recursive: true })
        const claimedTarget = await claimCloneTarget(clonePath)

        // Why: spawn (not execFile) avoids the maxBuffer limit — clone progress on stderr can exceed Node's 1 MB default.
        // Why: --progress forces git to emit progress even when stderr isn't a TTY.
        const cloneMetadataRef: { current: ActiveCloneMetadata | null } = { current: null }
        await new Promise<void>((resolve, reject) => {
          // Why: use the parent destination as cwd so the runner detects a WSL path and routes through wsl.exe.
          // Why: '--' isolates the URL so a malicious URL can't be read as git flags (command injection).
          let proc: ReturnType<typeof gitSpawn>
          try {
            proc = gitSpawn(['clone', '--progress', '--', args.url, clonePath], {
              cwd: args.destination,
              // Why: without this, an auth-needing clone pops Git Credential Manager's OAuth window on Windows, unclosable in a restricted env (issue #7652).
              env: nonInteractiveGitEnv(),
              stdio: ['ignore', 'ignore', 'pipe']
            })
          } catch (err) {
            void cleanupClaimedCloneTarget(clonePath, claimedTarget).finally(() => {
              const message = err instanceof Error ? err.message : String(err)
              reject(new Error(`Clone failed: ${message}`))
            })
            return
          }
          const generation = nextCloneGeneration++
          latestCloneGenerationByPath.set(clonePathKey, generation)
          const metadata: ActiveCloneMetadata = {
            path: clonePath,
            pathKey: clonePathKey,
            claimedTarget,
            process: proc,
            abortRequested: false,
            generation,
            pendingAbortCleanup: null,
            resolvePendingAbortCleanup: null
          }
          cloneMetadataRef.current = metadata
          activeClone = metadata

          let stderrTail = ''
          let settled = false
          proc.stderr!.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stderrTail = (stderrTail + text).slice(-4096)

            // Why: git progress lines use \r to overwrite in-place; parse fragments the same as SSH clone.
            emitCloneProgressFromText(mainWindow, text)
          })

          const finishClone = async (
            code: number | null,
            signal: NodeJS.Signals | null,
            err?: Error
          ) => {
            if (settled) {
              return
            }
            settled = true
            // Why: only null activeClone if it still points to this proc; abort-and-retry may have reassigned it, stranding the new clone.
            if (activeClone?.process === proc) {
              activeClone = null
            }

            const cloneSucceeded = !err && code === 0 && !signal
            if (!cloneSucceeded) {
              // Why: only the process that created this target may remove it, and only after git reports failure.
              await cleanupOwnedCloneTarget(metadata)
            }
            if (metadata.abortRequested && !cloneSucceeded) {
              settleCloneAbortCleanup(metadata)
            }
            if (latestCloneGenerationByPath.get(metadata.pathKey) === metadata.generation) {
              latestCloneGenerationByPath.delete(metadata.pathKey)
            }

            if (err) {
              reject(new Error(`Clone failed: ${err.message}`))
            } else if (signal === 'SIGTERM') {
              reject(new Error('Clone aborted'))
            } else if (code === 0) {
              resolve()
            } else {
              reject(
                new Error(`Clone failed: ${getGitCloneFailureMessage(stderrTail, { clonePath })}`)
              )
            }
          }

          proc.on('error', (err) => {
            void finishClone(null, null, err)
          })

          proc.on('close', (code, signal) => {
            void finishClone(code, signal)
          })
        })

        try {
          // Why: check after clone (path didn't exist before); reuse+upgrade a folder repo clone landed into instead of duplicating.
          const existing = store
            .getRepos()
            .find((r) => getClonePathComparisonKey(r.path) === clonePathKey)
          if (existing) {
            if (isFolderRepo(existing)) {
              const updated = store.updateRepo(existing.id, {
                kind: 'git',
                projectHostSetupMethod: 'cloned'
              })
              if (updated) {
                await prepareLocalWorktreeRootForRepo(store, updated)
                invalidateAuthorizedRootsCache()
                notifyReposChanged(mainWindow)
                // Why: folder→git upgrade is a real new git repo provisioning event.
                emitRepoAdded('clone_url', false, true)
                return updated
              }
            }
            emitRepoAdded('clone_url', true, true)
            return existing
          }

          const detected = await detectRepoIconAndUpstream({ repoPath: clonePath, kind: 'git' })
          const repo: Repo = {
            id: randomUUID(),
            path: clonePath,
            displayName: getRepoName(clonePath),
            badgeColor: DEFAULT_REPO_BADGE_COLOR,
            ...detected,
            addedAt: Date.now(),
            kind: 'git',
            externalWorktreeVisibility: 'hide',
            externalWorktreeVisibilityLegacy: false,
            projectHostSetupMethod: 'cloned'
          }

          store.addRepo(repo)
          await prepareLocalWorktreeRootForRepo(store, repo)
          invalidateAuthorizedRootsCache()
          notifyReposChanged(mainWindow)
          emitRepoAdded('clone_url', false, true)
          return repo
        } finally {
          const metadata = cloneMetadataRef.current
          if (metadata?.abortRequested) {
            settleCloneAbortCleanup(metadata)
          }
        }
      })
    }
  )

  ipcMain.handle(
    'repos:cloneRemote',
    async (
      _event,
      args: { connectionId: string; url: string; destination: string }
    ): Promise<Repo> => {
      const repo = await cloneRemoteRepo(store, mainWindow, args)
      notifyReposChanged(mainWindow)
      return repo
    }
  )

  ipcMain.handle('repos:getGitUsername', async (_event, args: { repoId: string }) => {
    const repo = store.getRepo(args.repoId)
    if (!repo || isFolderRepo(repo)) {
      return ''
    }
    // Why: remote repos keep their git config on the remote host, so resolve the username there.
    if (repo.connectionId) {
      const provider = getSshGitProvider(repo.connectionId)
      if (!provider) {
        return ''
      }
      return getSshGitUsername(provider, repo.path)
    }
    return resolveLocalGitUsername(repo.path)
  })

  ipcMain.handle(
    'repos:getBaseRefDefault',
    async (
      _event,
      args: { repoId: string; hostId?: ExecutionHostId }
    ): Promise<BaseRefDefaultResult> => {
      const repo = getRepoForExecutionHost(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        // Why: folder repos have no git state for a base ref; return null + 0 so the renderer skips a fabricated default.
        return { defaultBaseRef: null, remoteCount: 0 }
      }
      // Why: remote repos need the relay to resolve symbolic-ref where the git data lives.
      if (repo.connectionId) {
        const provider = getSshGitProvider(repo.connectionId)
        if (!provider) {
          return { defaultBaseRef: null, remoteCount: 0 }
        }
        // Why: delegate to shared resolveDefaultBaseRefViaExec; log symbolic-ref failures here to keep the SSH transport diagnostic it otherwise swallows.
        const resolveDefault = async (): Promise<string | null> => {
          return resolveDefaultBaseRefViaExec(async (argv) => {
            try {
              return await provider.exec(argv, repo.path)
            } catch (err) {
              if (argv[0] === 'symbolic-ref') {
                console.warn('[repos:getBaseRefDefault] SSH symbolic-ref failed', {
                  path: repo.path,
                  err
                })
              }
              throw err
            }
          })
        }

        const resolveRemoteCount = async (): Promise<number> => {
          try {
            const remotesResult = await provider.exec(['remote'], repo.path)
            return parseRemoteCount(remotesResult.stdout)
          } catch (err) {
            // Why: 0 = unknown sentinel that suppresses the multi-remote hint.
            console.warn('[repos:getBaseRefDefault] SSH git remote count failed', {
              path: repo.path,
              err
            })
            return 0
          }
        }

        const [defaultBaseRef, remoteCount] = await Promise.all([
          resolveDefault(),
          resolveRemoteCount()
        ])
        return { defaultBaseRef, remoteCount }
      }
      // Why: run in parallel; a remote-count failure must not break default detection.
      const [defaultBaseRef, remoteCount] = await Promise.all([
        getBaseRefDefault(repo.path),
        getRemoteCount(repo.path)
      ])
      return { defaultBaseRef, remoteCount }
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefs',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return (await searchBaseRefDetailsForRepo(store, args)).map((entry) => entry.refName)
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefDetails',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return searchBaseRefDetailsForRepo(store, args)
    }
  )
}
