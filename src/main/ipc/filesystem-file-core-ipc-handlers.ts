// Filesystem, search, and source-control IPC handlers.
import { ipcMain,shell } from 'electron'
import { lstat,stat,writeFile } from 'node:fs/promises'
import type { SshMutationExpectation } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { assertSshMutationExpectation } from '../ssh/ssh-connection-generation'
import { tryDeleteWslUncPath } from '../wsl-unc-delete'
import { authorizeExternalPath,isENOENT,resolveAuthorizedPath,resolveRegisteredWorktreePath } from './filesystem-auth'
import { registerFilesystemMutationHandlers } from './filesystem-mutations'
import { registerLocalLogTailHandlers } from './local-log-tail'
import { listMarkdownDocuments,markdownDocumentsFromRelativePaths } from './markdown-documents'

import type { MarkdownDocument } from '../../shared/types'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'

export function registerFilesystemFileCoreHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {
  ipcMain.handle(
      'fs:listMarkdownDocuments',
      async (
        _event,
        args: { rootPath: string; connectionId?: string }
      ): Promise<MarkdownDocument[]> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          const relativePaths = await provider.listFiles(args.rootPath)
          return markdownDocumentsFromRelativePaths(args.rootPath, relativePaths)
        }

        const rootPath = await resolveRegisteredWorktreePath(args.rootPath, store)
        return listMarkdownDocuments(rootPath)
      }
    )

  ipcMain.handle(
      'fs:writeFile',
      async (
        _event,
        args: { filePath: string; content: string; connectionId?: string } & SshMutationExpectation
      ): Promise<void> => {
        assertSshMutationExpectation(
          args.connectionId,
          args.expectedSshTargetId,
          args.expectedSshConnectionGeneration,
          args.expectedExecutionHostId
        )
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.writeFile(args.filePath, args.content)
        }
        const filePath = await resolveAuthorizedPath(args.filePath, store)

        try {
          const fileStats = await lstat(filePath)
          if (fileStats.isDirectory()) {
            throw new Error('Cannot write to a directory')
          }
        } catch (error) {
          if (!isENOENT(error)) {
            throw error
          }
        }

        await writeFile(filePath, args.content, 'utf-8')
      }
    )

  ipcMain.handle(
      'fs:deletePath',
      async (
        _event,
        args: {
          targetPath: string
          connectionId?: string
          recursive?: boolean
        } & SshMutationExpectation
      ): Promise<void> => {
        assertSshMutationExpectation(
          args.connectionId,
          args.expectedSshTargetId,
          args.expectedSshConnectionGeneration,
          args.expectedExecutionHostId
        )
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.deletePath(args.targetPath, args.recursive)
        }
        // Why: preserve the symlink so we delete the link, not its target (realpath would trash the real file, possibly outside all roots).
        const targetPath = await resolveAuthorizedPath(args.targetPath, store, {
          preserveSymlink: true
        })

        // Why: WSL UNC targets have no Recycle Bin (shell.trashItem throws), so hard-delete via `rm` inside the distro (issue #6415).
        if (await tryDeleteWslUncPath(targetPath, { recursive: args.recursive })) {
          return
        }

        // Why: swallow ENOENT so an external delete racing this UI delete stays idempotent (design §7.1).
        try {
          await shell.trashItem(targetPath)
        } catch (error) {
          if (isENOENT(error)) {
            return
          }
          throw error
        }
      }
    )

  registerFilesystemMutationHandlers(store)

  ipcMain.handle('fs:authorizeExternalPath', (_event, args: { targetPath: string }): void => {
      authorizeExternalPath(args.targetPath)
    })

  ipcMain.handle(
      'fs:stat',
      async (
        _event,
        args: { filePath: string; connectionId?: string }
      ): Promise<{ size: number; isDirectory: boolean; mtime: number }> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          const s = await provider.stat(args.filePath)
          return { size: s.size, isDirectory: s.type === 'directory', mtime: s.mtime }
        }
        const filePath = await resolveAuthorizedPath(args.filePath, store)
        const stats = await stat(filePath)
        return {
          size: stats.size,
          isDirectory: stats.isDirectory(),
          mtime: stats.mtimeMs
        }
      }
    )

  ipcMain.handle(
      'fs:pathExists',
      async (_event, args: { filePath: string; connectionId?: string }): Promise<boolean> => {
        try {
          if (args.connectionId) {
            const provider = requireSshFilesystemProvider(args.connectionId)
            await provider.stat(args.filePath)
            return true
          }
          const filePath = await resolveAuthorizedPath(args.filePath, store)
          await stat(filePath)
          return true
        } catch (error) {
          if (isENOENT(error)) {
            return false
          }
          throw error
        }
      }
    )

    // ─── Search ────────────────────────────────────────────

  registerLocalLogTailHandlers(store)
}
