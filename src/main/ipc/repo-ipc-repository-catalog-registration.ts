import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type {
  Project,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  ProjectUpdateArgs
} from '../../shared/types'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../shared/host-repo-catalog-contract'
import { parseExecutionHostId } from '../../shared/execution-host'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import { enrichMissingRepoGitRemoteIdentities } from '../repo-git-remote-identity-enrichment'
import { enrichRepoGitUsernames } from '../repo-git-username-enrichment'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import {
  addLocalRepoFromPath,
  addRemoteRepoFromPath,
  alignRepoWithRequestedProject,
  getDefaultCreateProjectParent,
  isGitAvailable,
  listReposForExecutionHost,
  notifyReposChanged,
  parseProjectGroupIpcArgs,
  ProjectHostSetupCreateIpcArgs,
  ProjectHostSetupDeleteIpcArgs,
  ProjectHostSetupExistingFolderIpcArgs,
  ProjectHostSetupUpdateIpcArgs,
  ProjectUpdateIpcArgs
} from './repo-ipc-handlers'

export function registerRepositoryCatalogHandlers(mainWindow: BrowserWindow, store: Store): void {
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
      if (result.alreadyExisted) {
        await prepareLocalWorktreeRootForRepo(store, aligned.repo)
      }
      return aligned
    }
  )

  ipcMain.handle('repos:isGitAvailable', () => isGitAvailable())
  ipcMain.handle('repos:getDefaultCreateProjectParent', () => getDefaultCreateProjectParent())
}
