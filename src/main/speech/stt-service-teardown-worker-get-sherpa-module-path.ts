import type { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export const SttServiceMethods4 = {
  async teardownWorker(this: any,
    worker: Worker,
    options: { ignoreTerminateErrors?: boolean } = { ignoreTerminateErrors: true }
  ): Promise<void> {
    this.clearIdleTeardownTimer()
    if (this.stopInFlight?.worker === worker) {
      await this.stopInFlight.promise
    }
    try {
      worker.postMessage({ type: 'teardown' })
    } catch {
      // The worker may already have exited on a forced stop path.
    }
    this.cleanupActiveWorkerLifecycleListeners()
    worker.removeAllListeners()
    try {
      await worker.terminate()
    } catch (error) {
      if (!options.ignoreTerminateErrors) {
        throw error
      }
    }
    if (this.worker === worker) {
      this.worker = null
      this.activeModelId = null
      this.activeHotwordsFilePath = undefined
      this.activeOwner = null
      this.eventSink = null
    }
  },
  cleanupActiveWorkerLifecycleListeners(this: any): void {
    const cleanup = this.cleanupWorkerLifecycleListeners
    this.cleanupWorkerLifecycleListeners = null
    cleanup?.()
  },
  getSherpaModulePath(this: any): string {
    // Why: the main sherpa-onnx npm package uses WASM, which cannot access
    // the host filesystem to load model files. The platform-specific native
    // addon (e.g. sherpa-onnx-darwin-arm64) has direct filesystem access
    // and better performance. We resolve its absolute path here because
    // the worker runs from out/main/ where bare require() can't find it.
    const nativePkg =
      process.platform === 'win32' && process.arch === 'x64'
        ? 'sherpa-onnx-win-x64'
        : `sherpa-onnx-${process.platform}-${process.arch}`

    if (app.isPackaged) {
      const resourcesNodeModule = join(process.resourcesPath, 'node_modules', nativePkg)
      if (existsSync(resourcesNodeModule)) {
        return resourcesNodeModule
      }
      return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', nativePkg)
    }

    const resolved = require.resolve(nativePkg)
    return join(resolved, '..')
  }
}
export type SttServiceMethods4Surface = typeof SttServiceMethods4
