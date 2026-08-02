import type { IFilesystemProvider } from '../providers/types'
import { isENOENT } from '../ipc/filesystem-auth'
import { joinWorktreeRelativePath } from './runtime-relative-paths'

export async function ensureRemoteOrcaDirectoryIgnored(
  fsProvider: IFilesystemProvider,
  repoPath: string,
  options: { required?: boolean } = {}
): Promise<void> {
  const gitignorePath = joinWorktreeRelativePath(repoPath, '.gitignore')
  let result: Awaited<ReturnType<IFilesystemProvider['readFile']>>
  try {
    result = await fsProvider.readFile(gitignorePath)
  } catch (error) {
    if (!isENOENT(error)) {
      if (options.required) {
        throw error
      }
      console.warn('[runtime] Could not inspect remote .gitignore for .orca', error)
      return
    }
    try {
      await fsProvider.writeFile(gitignorePath, '.orca\n')
    } catch (writeError) {
      if (options.required) {
        throw writeError
      }
      console.warn('[runtime] Could not update remote .gitignore to exclude .orca', writeError)
    }
    return
  }
  if (result.isBinary) {
    if (options.required) {
      throw new Error('Remote .gitignore is binary; cannot verify .orca is ignored')
    }
    return
  }
  if (/^\.orca\/?$/m.test(result.content)) {
    return
  }
  const separator = result.content.endsWith('\n') ? '' : '\n'
  try {
    await fsProvider.writeFile(gitignorePath, `${result.content}${separator}.orca\n`)
  } catch (writeError) {
    if (options.required) {
      throw writeError
    }
    console.warn('[runtime] Could not update remote .gitignore to exclude .orca', writeError)
  }
}
