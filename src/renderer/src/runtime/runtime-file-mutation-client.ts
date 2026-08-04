import type { RuntimeFileOperationArgs, RuntimeImportResult } from './runtime-file-context'
import { REMOTE_UPLOAD_BASE64_CHUNK_CHARS } from './runtime-file-context'
import { basename, joinPath, normalizeRelativePath } from '@/lib/path'
import { getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import {
  assertLocalFilesystemFallbackAllowed,
  callRuntimeFileMutation,
  createRuntimeImportSessionGuard,
  getRemoteFileArgs,
  joinRuntimeRelativePath,
  type StagedRuntimeImportSource,
  withSshMutationExpectation
} from './runtime-file-context'
import { captureRuntimeEnvironmentRequestRevision } from './runtime-environment-revision'
import { runtimePathExists } from './runtime-file-search-client'
import { callRuntimeRpc } from './runtime-rpc-client'
import { getClientRuntime } from './client-runtime'
import {
  assertRuntimeFileMutationCapability,
  canReadRelativeRuntimeFile,
  getRelativePathInsideWorktree
} from './runtime-file-context'

export async function writeRuntimeFile(
  context: RuntimeFileOperationArgs,
  filePath: string,
  content: string
): Promise<void> {
  const remoteArgs = getRemoteFileArgs(context, filePath)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    await getClientRuntime().file.writeFile(
      withSshMutationExpectation(context, { filePath, content, connectionId: context.connectionId })
    )
    return
  }
  await callRuntimeFileMutation(
    remoteArgs.target,
    'files.write',
    withSshMutationExpectation(context, {
      worktree: remoteArgs.worktreeSelector,
      relativePath: remoteArgs.relativePath,
      content
    }),
    15_000
  )
}

async function deconflictRuntimeImportName(
  context: RuntimeFileOperationArgs,
  destinationDir: string,
  originalName: string,
  reservedNames: Set<string>,
  expectedEnvironmentPairingRevision?: number
): Promise<string> {
  if (
    !(await runtimePathExists(
      context,
      joinPath(destinationDir, originalName),
      expectedEnvironmentPairingRevision
    )) &&
    !reservedNames.has(originalName)
  ) {
    return originalName
  }

  const dotIndex = originalName.lastIndexOf('.')
  const hasMeaningfulExt = dotIndex > 0
  const stem = hasMeaningfulExt ? originalName.slice(0, dotIndex) : originalName
  const ext = hasMeaningfulExt ? originalName.slice(dotIndex) : ''
  let candidate = `${stem} copy${ext}`
  if (
    !(await runtimePathExists(
      context,
      joinPath(destinationDir, candidate),
      expectedEnvironmentPairingRevision
    )) &&
    !reservedNames.has(candidate)
  ) {
    return candidate
  }

  let counter = 2
  while (counter < 10000) {
    candidate = `${stem} copy ${counter}${ext}`
    if (
      !(await runtimePathExists(
        context,
        joinPath(destinationDir, candidate),
        expectedEnvironmentPairingRevision
      )) &&
      !reservedNames.has(candidate)
    ) {
      return candidate
    }
    counter += 1
  }
  throw new Error(`Could not generate a unique name for '${basename(originalName)}'`)
}

export async function createRuntimePath(
  context: RuntimeFileOperationArgs,
  path: string,
  kind: 'file' | 'directory'
): Promise<void> {
  const remoteArgs = getRemoteFileArgs(context, path)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    await (kind === 'directory'
      ? getClientRuntime().file.createDir(
          withSshMutationExpectation(context, { dirPath: path, connectionId: context.connectionId })
        )
      : getClientRuntime().file.createFile(
          withSshMutationExpectation(context, {
            filePath: path,
            connectionId: context.connectionId
          })
        ))
    return
  }
  await callRuntimeFileMutation(
    remoteArgs.target,
    kind === 'directory' ? 'files.createDir' : 'files.createFile',
    withSshMutationExpectation(context, {
      worktree: remoteArgs.worktreeSelector,
      relativePath: remoteArgs.relativePath
    }),
    15_000
  )
}

export async function renameRuntimePath(
  context: RuntimeFileOperationArgs,
  oldPath: string,
  newPath: string
): Promise<void> {
  const oldRemoteArgs = getRemoteFileArgs(context, oldPath)
  const newRelativePath = getRelativePathInsideWorktree(context.worktreePath, newPath)
  if (!oldRemoteArgs || newRelativePath === null) {
    assertLocalFilesystemFallbackAllowed(context)
    await getClientRuntime().file.rename(
      withSshMutationExpectation(context, { oldPath, newPath, connectionId: context.connectionId })
    )
    return
  }
  await callRuntimeFileMutation(
    oldRemoteArgs.target,
    'files.rename',
    withSshMutationExpectation(context, {
      worktree: oldRemoteArgs.worktreeSelector,
      oldRelativePath: oldRemoteArgs.relativePath,
      newRelativePath
    }),
    15_000
  )
}

export async function copyRuntimePath(
  context: RuntimeFileOperationArgs,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const sourceArgs = getRemoteFileArgs(context, sourcePath)
  const destinationArgs = getRemoteFileArgs(context, destinationPath)
  if (!sourceArgs || !destinationArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    await getClientRuntime().file.copy(
      withSshMutationExpectation(context, {
        sourcePath,
        destinationPath,
        connectionId: context.connectionId
      })
    )
    return
  }
  await callRuntimeFileMutation(
    sourceArgs.target,
    'files.copy',
    withSshMutationExpectation(context, {
      worktree: sourceArgs.worktreeSelector,
      sourceRelativePath: sourceArgs.relativePath,
      destinationRelativePath: destinationArgs.relativePath
    }),
    15_000
  )
}

export async function deleteRuntimePath(
  context: RuntimeFileOperationArgs,
  targetPath: string,
  recursive?: boolean
): Promise<void> {
  const remoteArgs = getRemoteFileArgs(context, targetPath)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    await getClientRuntime().file.deletePath(
      withSshMutationExpectation(context, {
        targetPath,
        connectionId: context.connectionId,
        recursive
      })
    )
    return
  }
  await callRuntimeFileMutation(
    remoteArgs.target,
    'files.delete',
    withSshMutationExpectation(context, {
      worktree: remoteArgs.worktreeSelector,
      relativePath: remoteArgs.relativePath,
      recursive
    }),
    15_000
  )
}

export async function deleteRuntimeRelativePath(
  context: RuntimeFileOperationArgs,
  relativePath: string,
  recursive?: boolean
): Promise<boolean> {
  const target = getActiveRuntimeTarget(context.settings)
  if (
    target.kind !== 'environment' ||
    !context.worktreeId ||
    !canReadRelativeRuntimeFile(relativePath)
  ) {
    return false
  }
  await callRuntimeFileMutation(
    target,
    'files.delete',
    withSshMutationExpectation(context, {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      relativePath: normalizeRelativePath(relativePath),
      recursive
    }),
    15_000
  )
  return true
}

export async function importExternalPathsToRuntime(
  context: RuntimeFileOperationArgs,
  sourcePaths: string[],
  destinationDir: string,
  options?: { ensureDestinationDir?: boolean; assertCurrent?: () => void }
): Promise<{ results: RuntimeImportResult[] }> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId || !context.worktreePath) {
    return getClientRuntime().file.importExternalPaths(
      withSshMutationExpectation(context, {
        sourcePaths,
        destDir: destinationDir,
        connectionId: context.connectionId,
        ensureDir: options?.ensureDestinationDir
      })
    )
  }

  const destinationArgs = getRemoteFileArgs(context, destinationDir)
  if (!destinationArgs) {
    throw new Error('Destination is outside the active runtime worktree')
  }

  const expectedEnvironmentPairingRevision = captureRuntimeEnvironmentRequestRevision(
    target.environmentId
  )
  const assertImportSessionCurrent = createRuntimeImportSessionGuard(
    target.environmentId,
    expectedEnvironmentPairingRevision,
    options?.assertCurrent
  )
  await assertRuntimeFileMutationCapability(target, expectedEnvironmentPairingRevision)
  assertImportSessionCurrent()
  const staged = await getClientRuntime().file.stageExternalPathsForRuntimeUpload({ sourcePaths })
  assertImportSessionCurrent()
  const results: RuntimeImportResult[] = []
  const reservedNames = new Set<string>()

  await ensureRuntimeDirectory(
    context,
    destinationDir,
    assertImportSessionCurrent,
    expectedEnvironmentPairingRevision
  )

  for (const source of staged.sources as StagedRuntimeImportSource[]) {
    if (source.status !== 'staged') {
      results.push(source)
      continue
    }
    let createdDirectoryImportRoot: string | null = null
    try {
      const finalName = await deconflictRuntimeImportName(
        context,
        destinationDir,
        source.name,
        reservedNames,
        expectedEnvironmentPairingRevision
      )
      const destPath = joinPath(destinationDir, finalName)
      const destRelativePath = joinRuntimeRelativePath(destinationArgs.relativePath, finalName)
      for (const entry of source.entries) {
        const entryRelativePath = joinRuntimeRelativePath(destRelativePath, entry.relativePath)
        if (entry.kind === 'directory') {
          assertImportSessionCurrent()
          await callRuntimeFileMutation(
            target,
            'files.createDirNoClobber',
            withSshMutationExpectation(context, {
              worktree: toRuntimeWorktreeSelector(context.worktreeId),
              relativePath: entryRelativePath
            }),
            15_000,
            expectedEnvironmentPairingRevision
          )
          if (source.kind === 'directory' && entry.relativePath === '') {
            createdDirectoryImportRoot = entryRelativePath
          }
          continue
        }
        await uploadRuntimeFileWithoutClobber(
          target,
          context.worktreeId,
          entryRelativePath,
          entry.contentBase64,
          assertImportSessionCurrent,
          context.expectedSshConnectionGeneration,
          context.expectedSshTargetId,
          context.expectedExecutionHostId ??
            (context.expectedSshTargetId
              ? `ssh:${encodeURIComponent(context.expectedSshTargetId)}`
              : 'local'),
          expectedEnvironmentPairingRevision
        )
      }
      reservedNames.add(finalName)
      results.push({
        sourcePath: source.sourcePath,
        status: 'imported',
        destPath,
        kind: source.kind,
        renamed: finalName !== source.name
      })
    } catch (error) {
      if (createdDirectoryImportRoot) {
        // Why: match local directory imports by removing the no-clobber root
        // Orca created when a nested runtime upload fails halfway through.
        assertImportSessionCurrent()
        await callRuntimeFileMutation(
          target,
          'files.delete',
          withSshMutationExpectation(context, {
            worktree: toRuntimeWorktreeSelector(context.worktreeId),
            relativePath: createdDirectoryImportRoot,
            recursive: true
          }),
          15_000,
          expectedEnvironmentPairingRevision
        ).catch(() => {})
      }
      results.push({
        sourcePath: source.sourcePath,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { results }
}

async function uploadRuntimeFileWithoutClobber(
  target: { kind: 'environment'; environmentId: string },
  worktreeId: string,
  relativePath: string,
  contentBase64: string,
  assertCurrent?: () => void,
  expectedSshConnectionGeneration?: number,
  expectedSshTargetId?: string,
  expectedExecutionHostId?: 'local' | `ssh:${string}`,
  expectedEnvironmentPairingRevision?: number
): Promise<void> {
  const tempRelativePath = makeRuntimeUploadTempPath(relativePath)
  try {
    await writeRuntimeBase64File(
      target,
      worktreeId,
      tempRelativePath,
      contentBase64,
      assertCurrent,
      expectedSshConnectionGeneration,
      expectedSshTargetId,
      expectedExecutionHostId,
      expectedEnvironmentPairingRevision
    )
    assertCurrent?.()
    await callRuntimeFileMutation(
      target,
      'files.commitUpload',
      {
        worktree: toRuntimeWorktreeSelector(worktreeId),
        tempRelativePath,
        finalRelativePath: relativePath,
        expectedSshTargetId,
        expectedSshConnectionGeneration,
        expectedExecutionHostId
      },
      30_000,
      expectedEnvironmentPairingRevision
    )
  } finally {
    assertCurrent?.()
    await callRuntimeFileMutation(
      target,
      'files.delete',
      {
        worktree: toRuntimeWorktreeSelector(worktreeId),
        relativePath: tempRelativePath,
        recursive: false,
        expectedSshTargetId,
        expectedSshConnectionGeneration,
        expectedExecutionHostId
      },
      15_000,
      expectedEnvironmentPairingRevision
    ).catch(() => {})
  }
}

async function writeRuntimeBase64File(
  target: { kind: 'environment'; environmentId: string },
  worktreeId: string,
  relativePath: string,
  contentBase64: string,
  assertCurrent?: () => void,
  expectedSshConnectionGeneration?: number,
  expectedSshTargetId?: string,
  expectedExecutionHostId?: 'local' | `ssh:${string}`,
  expectedEnvironmentPairingRevision?: number
): Promise<void> {
  if (contentBase64.length <= REMOTE_UPLOAD_BASE64_CHUNK_CHARS) {
    assertCurrent?.()
    await callRuntimeFileMutation(
      target,
      'files.writeBase64',
      {
        worktree: toRuntimeWorktreeSelector(worktreeId),
        relativePath,
        contentBase64,
        expectedSshTargetId,
        expectedSshConnectionGeneration,
        expectedExecutionHostId
      },
      30_000,
      expectedEnvironmentPairingRevision
    )
    return
  }

  for (let offset = 0; offset < contentBase64.length; offset += REMOTE_UPLOAD_BASE64_CHUNK_CHARS) {
    assertCurrent?.()
    await callRuntimeFileMutation(
      target,
      'files.writeBase64Chunk',
      {
        worktree: toRuntimeWorktreeSelector(worktreeId),
        relativePath,
        contentBase64: contentBase64.slice(offset, offset + REMOTE_UPLOAD_BASE64_CHUNK_CHARS),
        append: offset > 0,
        expectedSshTargetId,
        expectedSshConnectionGeneration,
        expectedExecutionHostId
      },
      30_000,
      expectedEnvironmentPairingRevision
    )
  }
}

function makeRuntimeUploadTempPath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath)
  const slashIndex = normalized.lastIndexOf('/')
  const dir = slashIndex === -1 ? '' : normalized.slice(0, slashIndex + 1)
  const leaf = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1)
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${dir}.${leaf}.orca-upload-${nonce}`
}

async function ensureRuntimeDirectory(
  context: RuntimeFileOperationArgs,
  destinationDir: string,
  assertCurrent: () => void,
  expectedEnvironmentPairingRevision: number | undefined
): Promise<void> {
  const destinationArgs = getRemoteFileArgs(context, destinationDir)
  if (!destinationArgs) {
    return
  }
  const parts = normalizeRelativePath(destinationArgs.relativePath)
    .split('/')
    .filter((part) => part.length > 0)
  let current = ''
  for (const part of parts) {
    current = joinRuntimeRelativePath(current, part)
    const absolutePath = joinPath(context.worktreePath ?? '', current)
    assertCurrent()
    if (await runtimePathExists(context, absolutePath, expectedEnvironmentPairingRevision)) {
      continue
    }
    assertCurrent?.()
    await callRuntimeFileMutation(
      destinationArgs.target,
      'files.createDir',
      withSshMutationExpectation(context, {
        worktree: destinationArgs.worktreeSelector,
        relativePath: current
      }),
      15_000,
      expectedEnvironmentPairingRevision
    )
  }
}
