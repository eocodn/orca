import { randomUUID } from 'node:crypto'
import { copyFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { grantDirAcl, isPermissionError } from './win32-utils'

export function writeFileAtomically(
  targetPath: string,
  contents: string,
  options?: { mode?: number }
): void {
  const tmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmpPath, contents, { encoding: 'utf-8', mode: options?.mode })
    renameFileWithWindowsRetry(tmpPath, targetPath)
  } catch (error) {
    rmSync(tmpPath, { force: true })
    // Chromium can reset the userData DACL after startup; repair the parent once before retrying.
    if (isPermissionError(error) && process.platform === 'win32') {
      try {
        grantDirAcl(dirname(targetPath))
        const retryTmpPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
        try {
          writeFileSync(retryTmpPath, contents, { encoding: 'utf-8', mode: options?.mode })
          renameFileWithWindowsRetry(retryTmpPath, targetPath)
          return
        } catch {
          rmSync(retryTmpPath, { force: true })
        }
      } catch {
        // Preserve the original permission error when ACL repair cannot run.
      }
    }
    throw error
  }
}

// Windows file replacement can race antivirus or CLI processes holding the target open.
export function renameFileWithWindowsRetry(source: string, target: string): void {
  runFileOperationWithWindowsRetry(() => renameSync(source, target))
}

export function copyFileWithWindowsRetry(source: string, target: string): void {
  runFileOperationWithWindowsRetry(() => copyFileSync(source, target))
}

function runFileOperationWithWindowsRetry(operation: () => void): void {
  const maxAttempts = process.platform === 'win32' ? 6 : 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      operation()
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt < maxAttempts && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
        sleepSync(attempt * 50)
        continue
      }
      throw error
    }
  }
}

// These synchronous APIs are used by startup and backup paths, so backoff parks the thread.
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(ms: number): void {
  Atomics.wait(sleepBuffer, 0, 0, ms)
}
