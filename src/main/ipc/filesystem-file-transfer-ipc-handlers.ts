// Filesystem, search, and source-control IPC handlers.
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readdir, readFile, writeFile, stat, open } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import type { Store } from '../persistence'
import type { DirEntry } from '../../shared/types'
import { resolveAuthorizedPath } from './filesystem-auth'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { buildReadDirErrorBreadcrumb, type ReadDirThrowSite } from './readdir-error-diagnostics'
import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import { registerFilesystemDownloadFolderHandlers } from './filesystem-download-folder'
import {
  MAX_TEXT_FILE_SIZE,
  BINARY_PROBE_BYTES,
  MAX_PREVIEWABLE_BINARY_SIZE,
  PREVIEWABLE_BINARY_MIME_TYPES,
  readLocalLogSnapshot,
  DOWNLOAD_SESSION_TTL_MS,
  validateRequiredString,
  decodeDownloadedFileContent,
  createSiblingTransferPath,
  cleanupLocalTransferPath,
  inspectDownloadDestination,
  promoteDownloadedFile,
  isBinaryBuffer,
  isBinaryFilePrefix,
  isDirectoryEntry,
  type DownloadFileResult,
  type DownloadSession
} from './filesystem-ipc-foundation'
import type { CommitMessageAgentEnvironmentResolvers } from '../text-generation/commit-message-agent-environment'


export function registerFilesystemFileTransferHandlers(store: Store, commitMessageAgentEnv?: CommitMessageAgentEnvironmentResolvers): void {

  const downloadSessions = new Map<string, DownloadSession>()

  async function closeDownloadSession(
      transferId: string,
      cleanupTemp: boolean
    ): Promise<DownloadSession | null> {
      const session = downloadSessions.get(transferId)
      if (!session) {
        return null
      }
      downloadSessions.delete(transferId)
      clearTimeout(session.cleanupTimer)
      await session.handle.close().catch(() => {})
      if (cleanupTemp) {
        await cleanupLocalTransferPath(session.tempPath)
      }
      return session
    }

  function cleanupDownloadSessionsForSender(senderId: number): void {
      for (const [transferId, session] of Array.from(downloadSessions)) {
        if (session.senderId === senderId) {
          void closeDownloadSession(transferId, true)
        }
      }
    }

    // ─── Filesystem ─────────────────────────────────────────

  ipcMain.handle(
      'fs:readDir',
      async (_event, args: { dirPath: string; connectionId?: string }): Promise<DirEntry[]> => {
        // Why: fs:readDir throws surface as opaque IPC errors; record the throw site + redacted path shape to keep them diagnosable.
        let throwSite: ReadDirThrowSite = 'authorize'
        try {
          if (args.connectionId) {
            throwSite = 'ssh-provider'
            const provider = requireSshFilesystemProvider(args.connectionId)
            return await provider.readDir(args.dirPath)
          }
          throwSite = 'authorize'
          const dirPath = await resolveAuthorizedPath(args.dirPath, store)
          throwSite = 'readdir'
          const entries = await readdir(dirPath, { withFileTypes: true })
          const mapped = await Promise.all(
            entries.map(async (entry) => ({
              name: entry.name,
              isDirectory: await isDirectoryEntry(dirPath, entry, (entryPath) =>
                resolveAuthorizedPath(entryPath, store)
              ),
              isSymlink: entry.isSymbolicLink()
            }))
          )
          return mapped.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
              return a.isDirectory ? -1 : 1
            }
            return a.name.localeCompare(b.name)
          })
        } catch (error: unknown) {
          recordCrashBreadcrumb(
            'fs_readdir_error',
            buildReadDirErrorBreadcrumb({
              dirPath: args.dirPath,
              connectionId: args.connectionId,
              throwSite,
              error
            })
          )
          throw error
        }
      }
    )

  ipcMain.handle(
      'fs:readFile',
      async (
        _event,
        args: { filePath: string; connectionId?: string; includeLocalLogMetadata?: boolean }
      ): Promise<{
        content: string
        isBinary: boolean
        isImage?: boolean
        mimeType?: string
        fileIdentity?: string
      }> => {
        if (args.connectionId) {
          const provider = requireSshFilesystemProvider(args.connectionId)
          return provider.readFile(args.filePath)
        }
        const filePath = await resolveAuthorizedPath(args.filePath, store)
        if (args.includeLocalLogMetadata === true) {
          return readLocalLogSnapshot(filePath)
        }
        const stats = await stat(filePath)
        const mimeType = PREVIEWABLE_BINARY_MIME_TYPES[extname(filePath).toLowerCase()]
        const sizeLimit = mimeType ? MAX_PREVIEWABLE_BINARY_SIZE : MAX_TEXT_FILE_SIZE
        if (stats.size > sizeLimit) {
          throw new Error(
            `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds ${sizeLimit / 1024 / 1024}MB limit`
          )
        }

        if (mimeType) {
          const buffer = await readFile(filePath)
          return {
            content: buffer.toString('base64'),
            isBinary: true,
            // Why: the renderer keys previewable-binary rendering off `isImage`, so set it for PDFs too to stay compatible.
            isImage: true,
            mimeType
          }
        }

        // Why: probe large unknown files first so archives aren't fully buffered only to discover they aren't editable text.
        if (stats.size > BINARY_PROBE_BYTES && (await isBinaryFilePrefix(filePath))) {
          return { content: '', isBinary: true }
        }

        const buffer = await readFile(filePath)
        if (isBinaryBuffer(buffer)) {
          return { content: '', isBinary: true }
        }

        return { content: buffer.toString('utf-8'), isBinary: false }
      }
    )

  ipcMain.handle(
      'fs:downloadFile',
      async (
        event,
        args: { filePath?: string; connectionId?: string }
      ): Promise<DownloadFileResult> => {
        const filePath = validateRequiredString(args?.filePath, 'filePath')
        const connectionId = validateRequiredString(args?.connectionId, 'connectionId')
        const provider = requireSshFilesystemProvider(connectionId)
        const remoteStat = await provider.stat(filePath)
        if (remoteStat.type === 'directory') {
          throw new Error('Cannot download a directory')
        }
        if (!provider.downloadFile) {
          throw new Error('Remote file download is unavailable. Reconnect the SSH target and retry.')
        }

        const remoteBasename = getRuntimePathBasename(filePath)
        const defaultPath = sanitizeLocalDownloadFilename(remoteBasename)
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, { defaultPath })
          : await dialog.showSaveDialog({ defaultPath })
        if (dialogResult.canceled || !dialogResult.filePath) {
          return { canceled: true }
        }

        const destinationPath = dialogResult.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        const tempPath = createSiblingTransferPath(destinationPath, 'download')
        let promoted = false
        try {
          await provider.downloadFile(filePath, tempPath)
          await promoteDownloadedFile(tempPath, destinationPath, existed)
          promoted = true
          return { canceled: false, destinationPath }
        } finally {
          if (!promoted) {
            await cleanupLocalTransferPath(tempPath)
          }
        }
      }
    )

  registerFilesystemDownloadFolderHandlers()

  ipcMain.handle(
      'fs:saveDownloadedFile',
      async (
        event,
        args: { suggestedName?: string; content?: string; encoding?: 'utf8' | 'base64' }
      ): Promise<DownloadFileResult> => {
        const suggestedName = sanitizeLocalDownloadFilename(
          validateRequiredString(args?.suggestedName, 'suggestedName')
        )
        if (typeof args?.content !== 'string') {
          throw new Error('content is required')
        }
        const content = args.content
        const encoding = args?.encoding === 'base64' ? 'base64' : 'utf8'
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, { defaultPath: suggestedName })
          : await dialog.showSaveDialog({ defaultPath: suggestedName })
        if (dialogResult.canceled || !dialogResult.filePath) {
          return { canceled: true }
        }

        const destinationPath = dialogResult.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        const tempPath = createSiblingTransferPath(destinationPath, 'download')
        let promoted = false
        try {
          await writeFile(tempPath, decodeDownloadedFileContent(content, encoding))
          await promoteDownloadedFile(tempPath, destinationPath, existed)
          promoted = true
          return { canceled: false, destinationPath }
        } finally {
          if (!promoted) {
            await cleanupLocalTransferPath(tempPath)
          }
        }
      }
    )

  ipcMain.handle(
      'fs:startDownloadedFile',
      async (
        event,
        args: { suggestedName?: string }
      ): Promise<
        | { canceled: true }
        | {
            canceled: false
            transferId: string
            destinationPath: string
          }
      > => {
        const suggestedName = sanitizeLocalDownloadFilename(
          validateRequiredString(args?.suggestedName, 'suggestedName')
        )
        const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const dialogResult = parentWindow
          ? await dialog.showSaveDialog(parentWindow, { defaultPath: suggestedName })
          : await dialog.showSaveDialog({ defaultPath: suggestedName })
        if (dialogResult.canceled || !dialogResult.filePath) {
          return { canceled: true }
        }

        const destinationPath = dialogResult.filePath
        const { existed } = await inspectDownloadDestination(destinationPath)
        const tempPath = createSiblingTransferPath(destinationPath, 'download')
        const transferId = randomUUID()
        try {
          const handle = await open(tempPath, 'wx')
          const senderId = typeof event.sender.id === 'number' ? event.sender.id : Number.NaN
          const cleanupTimer = setTimeout(() => {
            void closeDownloadSession(transferId, true)
          }, DOWNLOAD_SESSION_TTL_MS)
          if (typeof cleanupTimer.unref === 'function') {
            cleanupTimer.unref()
          }
          downloadSessions.set(transferId, {
            destinationPath,
            tempPath,
            destinationExisted: existed,
            handle,
            cleanupTimer,
            senderId
          })
          event.sender.once?.('destroyed', () => cleanupDownloadSessionsForSender(senderId))
          return { canceled: false, transferId, destinationPath }
        } catch (error) {
          await cleanupLocalTransferPath(tempPath)
          throw error
        }
      }
    )

  ipcMain.handle(
      'fs:appendDownloadedFileChunk',
      async (
        _event,
        args: { transferId?: string; contentBase64?: string }
      ): Promise<{ ok: true }> => {
        const transferId = validateRequiredString(args?.transferId, 'transferId')
        const contentBase64 = validateRequiredString(args?.contentBase64, 'contentBase64')
        const session = downloadSessions.get(transferId)
        if (!session) {
          throw new Error('Download session not found')
        }
        await session.handle.writeFile(Buffer.from(contentBase64, 'base64'))
        return { ok: true }
      }
    )

  ipcMain.handle(
      'fs:finishDownloadedFile',
      async (
        _event,
        args: { transferId?: string }
      ): Promise<{ canceled: false; destinationPath: string }> => {
        const transferId = validateRequiredString(args?.transferId, 'transferId')
        const session = await closeDownloadSession(transferId, false)
        if (!session) {
          throw new Error('Download session not found')
        }
        let promoted = false
        try {
          await promoteDownloadedFile(
            session.tempPath,
            session.destinationPath,
            session.destinationExisted
          )
          promoted = true
          return { canceled: false, destinationPath: session.destinationPath }
        } finally {
          if (!promoted) {
            await cleanupLocalTransferPath(session.tempPath)
          }
        }
      }
    )

  ipcMain.handle(
      'fs:cancelDownloadedFile',
      async (_event, args: { transferId?: string }): Promise<{ ok: true }> => {
        const transferId = validateRequiredString(args?.transferId, 'transferId')
        await closeDownloadSession(transferId, true)
        return { ok: true }
      }
    )


}
