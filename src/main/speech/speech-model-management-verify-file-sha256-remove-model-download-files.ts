import { createReadStream, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const ModelManagerMethods5 = {
  verifyFileSha256(this: any, filePath: string, expectedSha256: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      let settled = false

      const cleanup = (): void => {
        stream.off('data', onData)
        stream.off('error', onError)
        stream.off('end', onEnd)
      }
      const settleResolve = (): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve()
      }
      const settleReject = (error: Error): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      }
      const onData = (chunk: Buffer): void => {
        hash.update(chunk)
      }
      const onError = (error: Error): void => {
        settleReject(error)
      }
      const onEnd = (): void => {
        const actualSha256 = hash.digest('hex')
        if (actualSha256 !== expectedSha256.toLowerCase()) {
          // Why: model artifacts feed native runtimes, so verify every downloaded file before installation.
          settleReject(new Error('Downloaded model file failed integrity verification'))
          return
        }
        settleResolve()
      }

      stream.on('data', onData)
      stream.on('error', onError)
      stream.on('end', onEnd)
    })
  },
  removeModelDownloadStaging(this: any, stagingDir: string, legacyArchivePath: string): void {
    for (const path of [stagingDir, legacyArchivePath]) {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  },
  removeModelDownloadFiles(this: any,
    modelDir: string,
    stagingDir: string,
    legacyArchivePath: string
  ): void {
    this.removeModelDownloadStaging(stagingDir, legacyArchivePath)
    try {
      rmSync(modelDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}
export type ModelManagerMethods5Surface = typeof ModelManagerMethods5
