import { ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { isFolderRepo } from '../../shared/repo-kind'
import { readBranchRenameFailureOutputForDisplay } from '../agent-hooks/branch-rename-failure-output'
import { inspectSetupScriptImportCandidates } from '../../shared/setup-script-imports'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { isENOENT } from './filesystem-auth'
import { parseWorktreeId } from './worktree-logic'
import { notifyWorktreesChanged } from './worktree-remote'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import { readIssueCommand, writeIssueCommand, createIssueCommandRunnerScript, hasHooksFile, loadHooks, parseOrcaYaml, hasUnrecognizedOrcaYamlKeys } from '../hooks'
import { getRepoForWorktreeRemoval, normalizeLinkedWorkItemFields } from './worktree-ipc-foundation'
import { listDesktopLineageForHost } from './worktree-ipc-events'
import { stripOrcaProvenanceMetaUpdates } from '../worktree-removal-safety'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { HostLineageSnapshot, ListDesktopLineageForHostArgs } from '../../shared/host-lineage-contract'
import type { WorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'
import type { WorktreeMeta } from '../../shared/types'

export function registerWorktreeMetadataHandlers({
  mainWindow,
  store,
  runtime
}: Pick<WorktreeIpcRegistrationContext, 'mainWindow' | 'store' | 'runtime'>): void {
  ipcMain.handle(
    'worktrees:updateMeta',
    (_event, args: { worktreeId: string; updates: Partial<WorktreeMeta> }) => {
      const validatedUpdates = normalizeLinkedWorkItemFields(args.updates)
      const updates =
        validatedUpdates.displayName !== undefined
          ? {
              ...validatedUpdates,
              pendingFirstAgentMessageRename: false,
              firstAgentMessageRenameError: null
            }
          : validatedUpdates
      const meta = store.setWorktreeMeta(args.worktreeId, stripOrcaProvenanceMetaUpdates(updates))
      // Do NOT notify here: renderer already applied this optimistically; a notification would re-sort the sidebar (bug PR #209).
      if (args.updates.displayName !== undefined) {
        // Why: remote clients have no optimistic rename and stopped polling titles, so push a remote-only invalidation; gate on displayName so per-click isUnread updates stay event-free.
        runtime.notifyWorktreesChangedForRemoteClients(getRepoIdFromWorktreeId(args.worktreeId))
      }
      return meta
    }
  )

  ipcMain.handle('worktrees:listLineage', async () => {
    await runtime.hydrateInferredWorktreeLineage()
    return {
      lineage: store.getAllWorktreeLineage(),
      workspaceLineage: store.getAllWorkspaceLineage()
    }
  })

  ipcMain.handle(
    'worktrees:listLineageForHost',
    (_event, args: ListDesktopLineageForHostArgs): Promise<HostLineageSnapshot> =>
      listDesktopLineageForHost(store, runtime, args)
  )

  ipcMain.handle(
    'worktrees:updateLineage',
    async (_event, args: { worktreeId: string; parentWorktreeId?: string; noParent?: boolean }) => {
      await runtime.updateManagedWorktreeMeta(args.worktreeId, {
        lineage:
          args.noParent === true
            ? { noParent: true }
            : args.parentWorktreeId
              ? { parentWorktree: `id:${args.parentWorktreeId}` }
              : undefined
      })
      notifyWorktreesChanged(mainWindow, parseWorktreeId(args.worktreeId).repoId)
      return store.getWorktreeLineage(args.worktreeId) ?? null
    }
  )

  // Why: snapshot sidebar order for cold-start restore (ephemeral signals gone); one batch call avoids N updateMeta IPCs.
  ipcMain.handle('worktrees:persistSortOrder', (_event, args: { orderedIds: string[] }) => {
    if (!Array.isArray(args?.orderedIds) || args.orderedIds.length === 0) {
      return
    }
    const now = Date.now()
    for (let i = 0; i < args.orderedIds.length; i++) {
      // Why: a sidebar-order snapshot must only reorder worktrees that already
      // exist — it must never create one. Without this guard a stale id the
      // renderer still lists (e.g. a removed repo's `${repoId}::${path}`) gets a
      // fresh worktreeMeta entry minted here, resurrecting an orphan/duplicate
      // workspace on the next launch. setWorktreeMeta has no repo-existence check.
      if (!store.getWorktreeMeta(args.orderedIds[i])) {
        continue
      }
      // Descending timestamps: first item gets highest sortOrder so b - a sorts first-wins on cold start.
      store.setWorktreeMeta(args.orderedIds[i], { sortOrder: now - i * 1000 })
    }
  })

  // Why: full failure output lives only in main memory (not worktree metadata), so the dialog pulls it on demand.
  ipcMain.handle(
    'worktrees:getBranchRenameFailureOutput',
    (_event, args: { worktreeId: string }) => {
      if (typeof args?.worktreeId !== 'string' || args.worktreeId.length === 0) {
        return null
      }
      return readBranchRenameFailureOutputForDisplay(args.worktreeId)
    }
  )

  ipcMain.handle(
    'hooks:check',
    async (_event, args: { repoId: string; hostId?: ExecutionHostId }) => {
      const repo = getRepoForWorktreeRemoval(store, args.repoId, args.hostId)
      if (!repo) {
        const repoIdExists = store.getRepos().some((candidate) => candidate.id === args.repoId)
        // Why: callers treat inspection errors as "skip", so a requested/ambiguous host must report error (fail closed), not hook-free.
        return {
          status: args.hostId || repoIdExists ? 'error' : 'ok',
          hasHooks: false,
          hooks: null,
          mayNeedUpdate: false
        }
      }
      if (isFolderRepo(repo)) {
        return { status: 'ok', hasHooks: false, hooks: null, mayNeedUpdate: false }
      }

      if (repo.connectionId) {
        const fsProvider = getSshFilesystemProvider(repo.connectionId)
        if (!fsProvider) {
          return { status: 'error', hasHooks: false, hooks: null, mayNeedUpdate: false }
        }
        try {
          const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
          return {
            status: 'ok',
            hasHooks: !result.isBinary,
            hooks: result.isBinary ? null : parseOrcaYaml(result.content),
            mayNeedUpdate: false
          }
        } catch (error) {
          return {
            status: isENOENT(error) ? 'ok' : 'error',
            hasHooks: false,
            hooks: null,
            mayNeedUpdate: false
          }
        }
      }

      const has = hasHooksFile(repo.path)
      const hooks = has ? loadHooks(repo.path) : null
      // Why: unrecognised top-level keys mean the file is well-formed but from a newer Orca; suggest updating rather than "could not be parsed".
      const mayNeedUpdate = has && !hooks && hasUnrecognizedOrcaYamlKeys(repo.path)
      return {
        status: 'ok',
        hasHooks: has,
        hooks,
        mayNeedUpdate
      }
    }
  )

  ipcMain.handle(
    'hooks:createIssueCommandRunner',
    (_event, args: { repoId: string; worktreePath: string; command: string }) => {
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        throw new Error(`Repo not found: ${args.repoId}`)
      }

      return createIssueCommandRunnerScript(
        repo,
        args.worktreePath,
        args.command,
        getLocalProjectWorktreeGitOptions(store, repo)
      )
    }
  )

  ipcMain.handle(
    'hooks:inspectSetupScriptImports',
    async (_event, args: { repoId: string; hostId?: ExecutionHostId }) => {
      const repo = getRepoForWorktreeRemoval(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        return []
      }

      return inspectSetupScriptImportCandidates(
        async (relativePath) => {
          const filePath = joinWorktreeRelativePath(repo.path, relativePath)
          if (repo.connectionId) {
            const fsProvider = getSshFilesystemProvider(repo.connectionId)
            if (!fsProvider) {
              return null
            }
            try {
              const result = await fsProvider.readFile(filePath)
              return result.isBinary ? null : result.content
            } catch {
              return null
            }
          }

          try {
            return await readFile(filePath, 'utf-8')
          } catch (error) {
            if (!isENOENT(error)) {
              console.warn('[hooks] Failed to inspect setup script import candidate:', error)
            }
            return null
          }
        },
        {
          fileExists: async (relativePath) => {
            const filePath = joinWorktreeRelativePath(repo.path, relativePath)
            if (repo.connectionId) {
              const fsProvider = getSshFilesystemProvider(repo.connectionId)
              if (!fsProvider) {
                return false
              }
              try {
                const fileStat = await fsProvider.stat(filePath)
                return fileStat.type !== 'directory'
              } catch {
                return false
              }
            }

            try {
              const fileStat = await stat(filePath)
              return !fileStat.isDirectory()
            } catch (error) {
              if (!isENOENT(error)) {
                console.warn('[hooks] Failed to stat setup script import candidate:', error)
              }
              return false
            }
          }
        }
      )
    }
  )

  ipcMain.handle(
    'hooks:readIssueCommand',
    async (_event, args: { repoId: string; hostId?: ExecutionHostId }) => {
      const repo = getRepoForWorktreeRemoval(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        return {
          status: 'ok',
          localContent: null,
          sharedContent: null,
          effectiveContent: null,
          localFilePath: '',
          source: 'none' as const
        }
      }
      if (repo.connectionId) {
        const issueCommandPath = joinWorktreeRelativePath(repo.path, '.orca/issue-command')
        const fsProvider = getSshFilesystemProvider(repo.connectionId)
        if (!fsProvider) {
          return {
            status: 'error',
            localContent: null,
            sharedContent: null,
            effectiveContent: null,
            localFilePath: issueCommandPath,
            source: 'none' as const
          }
        }

        let status: 'ok' | 'error' = 'ok'
        let localContent: string | null = null
        let sharedContent: string | null = null
        try {
          const result = await fsProvider.readFile(issueCommandPath)
          localContent = result.isBinary ? null : result.content.trim() || null
        } catch (error) {
          if (!isENOENT(error)) {
            status = 'error'
          }
        }
        try {
          const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
          sharedContent = result.isBinary
            ? null
            : parseOrcaYaml(result.content)?.issueCommand?.trim() || null
        } catch (error) {
          if (!isENOENT(error)) {
            status = 'error'
          }
        }
        const effectiveContent = localContent ?? sharedContent
        return {
          status: localContent ? 'ok' : status,
          localContent,
          sharedContent,
          effectiveContent,
          localFilePath: issueCommandPath,
          source: localContent
            ? ('local' as const)
            : sharedContent
              ? ('shared' as const)
              : ('none' as const)
        }
      }
      return readIssueCommand(repo.path)
    }
  )

  ipcMain.handle(
    'hooks:writeIssueCommand',
    async (_event, args: { repoId: string; content: string; hostId?: ExecutionHostId }) => {
      const repo = getRepoForWorktreeRemoval(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        return
      }
      if (repo.connectionId) {
        const issueCommandPath = joinWorktreeRelativePath(repo.path, '.orca/issue-command')
        const fsProvider = getSshFilesystemProvider(repo.connectionId)
        if (!fsProvider) {
          throw new Error(
            'Remote filesystem unavailable. Reconnect the SSH target before retrying.'
          )
        }
        const trimmed = args.content.trim()
        if (!trimmed) {
          await fsProvider.deletePath(issueCommandPath, false).catch((error: unknown) => {
            if (!isENOENT(error)) {
              throw error
            }
          })
          return
        }
        await fsProvider.createDir(joinWorktreeRelativePath(repo.path, '.orca'))
        const gitignorePath = joinWorktreeRelativePath(repo.path, '.gitignore')
        try {
          const result = await fsProvider.readFile(gitignorePath)
          if (!result.isBinary && !/^\.orca\/?$/m.test(result.content)) {
            const separator = result.content.endsWith('\n') ? '' : '\n'
            await fsProvider.writeFile(gitignorePath, `${result.content}${separator}.orca\n`)
          }
        } catch (error) {
          if (!isENOENT(error)) {
            throw error
          }
          await fsProvider.writeFile(gitignorePath, '.orca\n')
        }
        await fsProvider.writeFile(issueCommandPath, `${trimmed}\n`)
        return
      }
      writeIssueCommand(repo.path, args.content)
    }
  )

}
