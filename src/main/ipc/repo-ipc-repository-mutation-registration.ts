import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRepoBadgeColor } from '../../shared/repo-badge-color'
import { sanitizeRepoIcon } from '../../shared/repo-icon'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import {
  addLocalRepoFromPath,
  addRemoteRepoFromPath,
  createRemoteRepo,
  emitRepoAdded,
  notifyReposChanged
} from './repo-ipc-handlers'

export function registerRepositoryMutationHandlers(
  mainWindow: BrowserWindow,
  store: Store
): void {
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

}
