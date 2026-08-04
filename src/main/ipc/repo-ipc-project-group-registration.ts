import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { FolderWorkspace, NestedRepoScanResult, ProjectGroup, ProjectGroupImportResult, Repo } from '../../shared/types'
import type { FolderWorkspacePathStatusRequest } from '../../shared/folder-workspace-path-status'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { isGitRepo, getRepoName } from '../git/repo'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { getActiveMultiplexer } from './ssh'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { createNestedProjectGroupResolver, resolveNestedRepoSelection } from '../project-groups/nested-repo-import'
import { createNestedRepoImportTargetResolver } from '../project-groups/nested-repo-import-target'
import { assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath } from '../project-groups/folder-workspace-path-status'
import { activeNestedRepoScans, emitRepoAdded, getCompletedNestedRepoScan, notifyReposChanged, parseProjectGroupIpcArgs, ProjectGroupCancelNestedScanArgs, ProjectGroupCreateArgs, ProjectGroupImportNestedArgs, ProjectGroupMoveProjectArgs, ProjectGroupScanNestedArgs, ProjectGroupSelectorArgs, ProjectGroupUpdateArgs, sanitizeNestedRepoImportError, scanNestedReposForIpc, runNestedRepoScanForIpc, FolderWorkspaceCreateArgs, FolderWorkspacePathStatusArgs, FolderWorkspaceSelectorArgs, FolderWorkspaceUpdateArgs } from './repo-ipc-handlers'

export function registerProjectGroupHandlers(mainWindow: BrowserWindow, store: Store): void {
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


}
