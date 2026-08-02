import { ipcMain } from 'electron'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  writeFile
} from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Store } from '../persistence'
import { resolveAuthorizedPath, isENOENT } from './filesystem-auth'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { resolveLocalDroppedPathsForAgent } from './dropped-path-resolution'
import { importExternalPathsSsh } from './filesystem-import-ssh'
import {
  importOneSource,
  stageOneSourceForRuntimeUpload,
  type ImportItemResult,
  type ImportSkipReason,
  type ResolveDroppedPathsResult,
  type StagedExternalImportSource
} from './filesystem-external-import'
import type { SshMutationExpectation } from '../../shared/ssh-types'
import { assertSshMutationExpectation } from '../ssh/ssh-connection-generation'
import { renameLocalPathSerializedByDestination } from '../destination-serialized-local-rename'

/**
 * Re-throw filesystem errors with user-friendly messages.
 * The `wx` flag on writeFile throws a raw EEXIST with no helpful message,
 * so we catch it here and provide context the renderer can display directly.
 */
function rethrowWithUserMessage(error: unknown, targetPath: string): never {
  const name = basename(targetPath)
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') {
      throw new Error(`A file or folder named '${name}' already exists in this location`)
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`Permission denied: unable to create '${name}'`)
    }
  }
  throw error
}

/**
 * Ensure `targetPath` does not already exist. Throws if it does.
 *
 * Note: this is a non-atomic check — a concurrent operation could create the
 * path between `lstat` and the caller's next action. Acceptable for a desktop
 * app with low concurrency; `createFile` uses the `wx` flag for an atomic
 * alternative where possible.
 */
async function assertNotExists(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath)
    throw new Error(
      `A file or folder named '${basename(targetPath)}' already exists in this location`
    )
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
  }
}

/**
 * IPC handlers for file/folder creation and renaming.
 * Deletion is handled separately via `fs:deletePath` (shell.trashItem).
 */
export function registerFilesystemMutationHandlers(store: Store): void {
  ipcMain.handle(
    'fs:createFile',
    async (
      _event,
      args: { filePath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        const provider = requireSshFilesystemProvider(args.connectionId)
        return provider.createFile(args.filePath)
      }
      const filePath = await resolveAuthorizedPath(args.filePath, store)
      await mkdir(dirname(filePath), { recursive: true })
      try {
        // Use the 'wx' flag for atomic create-if-not-exists, avoiding TOCTOU races
        await writeFile(filePath, '', { encoding: 'utf-8', flag: 'wx' })
      } catch (error) {
        rethrowWithUserMessage(error, filePath)
      }
    }
  )

  ipcMain.handle(
    'fs:createDir',
    async (
      _event,
      args: { dirPath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        const provider = requireSshFilesystemProvider(args.connectionId)
        return provider.createDir(args.dirPath)
      }
      const dirPath = await resolveAuthorizedPath(args.dirPath, store)
      await assertNotExists(dirPath)
      await mkdir(dirPath, { recursive: true })
    }
  )

  // Note: fs.rename throws EXDEV if old and new paths are on different
  // filesystems/volumes. This is unlikely since both paths are under the same
  // workspace root, but a cross-drive rename would surface as an IPC error.
  ipcMain.handle(
    'fs:rename',
    async (
      _event,
      args: { oldPath: string; newPath: string; connectionId?: string } & SshMutationExpectation
    ): Promise<void> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        const provider = requireSshFilesystemProvider(args.connectionId)
        return provider.renameNoClobber(args.oldPath, args.newPath)
      }
      // Why: rename() operates on directory entries, not file contents. If
      // oldPath is a symlink, we must rename the link itself rather than
      // resolving it to its target — following the link would rename the
      // target file (potentially elsewhere in the worktree) and leave the
      // symlink dangling. newPath must also preserve its leaf so we don't
      // accidentally write into a symlinked destination name.
      const oldPath = await resolveAuthorizedPath(args.oldPath, store, { preserveSymlink: true })
      const newPath = await resolveAuthorizedPath(args.newPath, store, { preserveSymlink: true })
      await renameLocalPathSerializedByDestination(oldPath, newPath)
    }
  )

  ipcMain.handle(
    'fs:copy',
    async (
      _event,
      args: {
        sourcePath: string
        destinationPath: string
        connectionId?: string
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
        return provider.copy(args.sourcePath, args.destinationPath)
      }
      const sourcePath = await resolveAuthorizedPath(args.sourcePath, store, {
        preserveSymlink: true
      })
      const destinationPath = await resolveAuthorizedPath(args.destinationPath, store, {
        preserveSymlink: true
      })
      await mkdir(dirname(destinationPath), { recursive: true })
      // Why: duplicate/copy callers deconflict before copying. COPYFILE_EXCL
      // keeps a late race from silently overwriting an existing file.
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    }
  )

  ipcMain.handle(
    'fs:importExternalPaths',
    async (
      _event,
      args: {
        sourcePaths: string[]
        destDir: string
        connectionId?: string
        ensureDir?: boolean
      } & SshMutationExpectation
    ): Promise<{ results: ImportItemResult[] }> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      if (args.connectionId) {
        return importExternalPathsSsh(args.sourcePaths, args.destDir, args.connectionId, {
          ensureDir: args.ensureDir,
          assertCurrent: () =>
            assertSshMutationExpectation(
              args.connectionId,
              args.expectedSshTargetId,
              args.expectedSshConnectionGeneration,
              args.expectedExecutionHostId
            )
        })
      }

      // Why: destDir must be authorized before any copy work begins. If the
      // destination is outside allowed roots, the entire import fails.
      // This only applies to local imports — remote paths are authorized by
      // the SSH connection boundary (see importExternalPathsSsh).
      const resolvedDest = await resolveAuthorizedPath(args.destDir, store)

      const results: ImportItemResult[] = []
      const reservedNames = new Set<string>()

      for (const sourcePath of args.sourcePaths) {
        const result = await importOneSource(sourcePath, resolvedDest, reservedNames)
        results.push(result)
        if (result.status === 'imported') {
          reservedNames.add(basename(result.destPath))
        }
      }

      return { results }
    }
  )

  ipcMain.handle(
    'fs:stageExternalPathsForRuntimeUpload',
    async (
      _event,
      args: { sourcePaths: string[] }
    ): Promise<{ sources: StagedExternalImportSource[] }> => {
      const sources: StagedExternalImportSource[] = []
      for (const sourcePath of args.sourcePaths) {
        sources.push(await stageOneSourceForRuntimeUpload(sourcePath))
      }
      return { sources }
    }
  )

  // Why: terminal drag-and-drop resolver. Local worktrees pass paths through
  // unchanged (reference-in-place; preserves zero-latency drop). SSH worktrees
  // upload each path into `${worktreePath}/.orca/drops/` and return remote
  // paths the remote agent can read. Kept as a separate IPC from
  // fs:importExternalPaths because terminal semantics differ from the
  // explorer's "copy into user-picked destDir". See docs/terminal-drop-ssh.md.
  ipcMain.handle(
    'fs:resolveDroppedPathsForAgent',
    async (
      _event,
      args: {
        paths: string[]
        worktreePath: string
        connectionId?: string
      } & SshMutationExpectation
    ): Promise<ResolveDroppedPathsResult> => {
      assertSshMutationExpectation(
        args.connectionId,
        args.expectedSshTargetId,
        args.expectedSshConnectionGeneration,
        args.expectedExecutionHostId
      )
      // Why: `== null` (not `!args.connectionId`) so an empty string is
      // treated as a renderer error, not silently routed to the local branch.
      if (args.connectionId == null) {
        return {
          resolvedPaths: resolveLocalDroppedPathsForAgent(args.paths, args.worktreePath),
          skipped: [],
          failed: []
        }
      }
      const worktreePath = args.worktreePath.replace(/\/+$/, '')
      const destDir = `${worktreePath}/.orca/drops`
      const { results } = await importExternalPathsSsh(args.paths, destDir, args.connectionId, {
        ensureDir: true,
        assertCurrent: () =>
          assertSshMutationExpectation(
            args.connectionId,
            args.expectedSshTargetId,
            args.expectedSshConnectionGeneration,
            args.expectedExecutionHostId
          )
      })
      const resolvedPaths: string[] = []
      const skipped: { sourcePath: string; reason: ImportSkipReason }[] = []
      const failed: { sourcePath: string; reason: string }[] = []
      // Iterate in input order so injected paths align with the user's drop order.
      for (const r of results) {
        if (r.status === 'imported') {
          resolvedPaths.push(r.destPath)
        } else if (r.status === 'skipped') {
          skipped.push({ sourcePath: r.sourcePath, reason: r.reason })
        } else {
          failed.push({ sourcePath: r.sourcePath, reason: r.reason })
        }
      }
      return { resolvedPaths, skipped, failed }
    }
  )
}
