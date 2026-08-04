// Hosted source-control IPC handlers.
import { ipcMain } from 'electron'
import { getRepoSlug,getRepoUpstream } from '../github/client'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import { assertRegisteredRepo,localGitOptionArgs,repoConnectionId } from './github-ipc-foundation'

export function registerGitHubRepositoryHandlers(store: Store, stats: StatsCollector): void {
  ipcMain.handle('gh:repoSlug', (_event, args: { repoPath: string }) => {
      const repo = assertRegisteredRepo(args, store)
      const localGitOptions = localGitOptionArgs(store, repo)[0]
      return localGitOptions
        ? getRepoSlug(repo.path, repoConnectionId(repo), { localGitExecOptions: localGitOptions })
        : getRepoSlug(repo.path, repoConnectionId(repo))
    })

  ipcMain.handle('gh:repoUpstream', (_event, args: { repoPath: string }) => {
      const repo = assertRegisteredRepo(args, store)
      const localGitOptions = localGitOptionArgs(store, repo)[0]
      return localGitOptions
        ? getRepoUpstream(repo.path, repoConnectionId(repo), { localGitExecOptions: localGitOptions })
        : getRepoUpstream(repo.path, repoConnectionId(repo))
    })
}
