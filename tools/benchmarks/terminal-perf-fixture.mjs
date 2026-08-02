import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runWithTimeout, setupTimeoutMs } from '../../config/scripts/windows-apphang-repro/repro-timing.mjs'

function git(cwd, ...cmd) {
  execFileSync('git', cmd, { cwd, stdio: 'pipe' })
}

// Native worktrees keep this fixture representative of the default local path.
export function createLocalRepoFixture() {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'orca-termperf-'))
  const repoPath = path.join(baseDir, 'repo')
  mkdirSync(repoPath, { recursive: true })
  git(repoPath, 'init', '--initial-branch=main')
  git(repoPath, 'config', 'user.email', 'bench@orca.local')
  git(repoPath, 'config', 'user.name', 'Orca Bench')
  writeFileSync(path.join(repoPath, 'README.md'), '# terminal perf fixture\n')
  git(repoPath, 'add', '.')
  git(repoPath, 'commit', '-m', 'init', '--no-gpg-sign')
  const worktreePaths = []
  for (const name of ['wt-one', 'wt-two']) {
    const worktreePath = path.join(baseDir, name)
    git(repoPath, 'worktree', 'add', worktreePath, '-b', name)
    worktreePaths.push(worktreePath)
  }
  return { baseDir, repoPath, worktreePaths }
}

export async function setupWorkspaces(page, fixture) {
  return await runWithTimeout(
    'fixture registration in Orca',
    () =>
      page.evaluate(
        async ({ repoPath, importedWorktreePaths }) => {
          const store = window.__store
          if (!store) {
            throw new Error('window.__store is unavailable.')
          }
          await store.getState().fetchSettings?.()
          const addResult = await window.api.repos.add({ path: repoPath, kind: 'git' })
          if ('error' in addResult) {
            throw new Error(addResult.error)
          }
          await store.getState().fetchRepos()
          const state = store.getState()
          const repo = state.repos.find((candidate) => candidate.path === repoPath) ?? addResult.repo
          await state.updateRepo(repo.id, {
            externalWorktreeVisibility: 'show',
            externalWorktreeVisibilityPromptDismissedAt: Date.now(),
            importedExternalWorktreePaths: importedWorktreePaths,
            externalWorktreeInboxBaselinePaths: importedWorktreePaths
          })
          await store.getState().fetchWorktrees(repo.id, { requireAuthoritative: true })
          const nextState = store.getState()
          nextState.setSidebarOpen(true)
          nextState.setGroupBy('none')
          nextState.setSortBy('recent')
          nextState.setShowActiveOnly(false)
          nextState.setActiveView('terminal')
          const worktrees = nextState.worktreesByRepo[repo.id] ?? []
          return {
            repoId: repo.id,
            worktrees: worktrees.map((worktree) => ({
              id: worktree.id,
              path: worktree.path,
              displayName: worktree.displayName,
              isMainWorktree: worktree.isMainWorktree
            }))
          }
        },
        { repoPath: fixture.repoPath, importedWorktreePaths: fixture.worktreePaths }
      ),
    setupTimeoutMs
  )
}
