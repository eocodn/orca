import type * as NodePty from 'node-pty'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isPathInsideOrEqual } from '../shared/cross-platform-path'
import { mergeGitConfigEnvProtocol } from '../shared/git-credential-prompt-env'
import { stripInheritedBuildModeEnv } from '../main/pty/build-mode-env'
import { splitWorktreeId } from '../shared/worktree-id'
import type { TuiAgent } from '../shared/types'
import type { RelayPtySourcePublication } from './relay-pty-source-publication'
import type {
  PtyEnvAugmenter,
  PtyExitListener,
  RelayPtyWorktreeRemovalCoordinator
} from './pty-session-stage-contracts'
import { PtyHandler } from './pty-session-stage-state'

type LaterStageDelegates = {
  pausePtyOutput(id: string): void
  maybeResumePtyOutput(id: string): void
  scheduleOutputFlush(delayMs: number): void
  publishPendingExit(id: string): void
  shutdown(params: Record<string, unknown>): Promise<void>
}

export class PtyHandlerStage1Capacity extends PtyHandler {
  setConsumerDeliveryPaused(id: string, paused: boolean): void {
    if (paused) {
      this.consumerPausedOutputPtys.add(id)
      this.laterStageDelegates().pausePtyOutput(id)
      return
    }
    this.consumerPausedOutputPtys.delete(id)
    this.laterStageDelegates().maybeResumePtyOutput(id)
  }

  setSourcePublication(publication: RelayPtySourcePublication): void {
    this.sourcePublication = publication
  }

  handleSourceCreditAvailable(id: string): void {
    this.sourcePublication?.onCreditAvailable(id)
  }

  handleSourcePublicationCapacity(id: string): void {
    const delegates = this.laterStageDelegates()
    if (this.pendingOutputByPty.has(id)) {
      delegates.scheduleOutputFlush(0)
    }
    delegates.maybeResumePtyOutput(id)
    delegates.publishPendingExit(id)
  }

  protected async loadPty(): Promise<typeof NodePty | null> {
    if (this.ptyModule) {
      return this.ptyModule
    }
    if (this.ptyModuleLoadPromise) {
      return this.ptyModuleLoadPromise
    }
    this.ptyModuleLoadPromise = this.loadPtyUncached()
    try {
      return await this.ptyModuleLoadPromise
    } finally {
      this.ptyModuleLoadPromise = null
    }
  }

  protected async loadPtyUncached(): Promise<typeof NodePty | null> {
    if (!this.reloadPtyModuleFromDisk) {
      try {
        this.ptyModule = await import('node-pty')
        return this.ptyModule
      } catch {
        this.reloadPtyModuleFromDisk = true
      }
    }
    // Why: tie module resolution to the deployed bundle dir, not cwd.
    const moduleEntry = join(__dirname, 'node_modules', 'node-pty', 'lib', 'index.js')
    if (!existsSync(moduleEntry)) {
      return null
    }
    try {
      this.ptyModule = require(moduleEntry) as typeof NodePty
      return this.ptyModule
    } catch {
      return null
    }
  }

  protected invalidatePtyModuleAfterBindingFailure(): void {
    this.ptyModule = null
    this.reloadPtyModuleFromDisk = true
    const moduleRoot = join(__dirname, 'node_modules', 'node-pty')
    for (const cachedPath of Object.keys(require.cache)) {
      if (isPathInsideOrEqual(moduleRoot, cachedPath)) {
        delete require.cache[cachedPath]
      }
    }
  }

  setGraceTimeMs(graceTimeMs: number): void {
    this.graceTimeMs = Math.max(0, Math.floor(graceTimeMs))
  }

  setWorktreeRemovalCoordinator(coordinator: RelayPtyWorktreeRemovalCoordinator | null): void {
    this.worktreeRemovalCoordinator = coordinator
  }

  async shutdownForWorktreePath(rootPath: string): Promise<void> {
    const matchingIds = [...this.ptys.values()]
      .filter((managed) => {
        const ownedPath = managed.worktreeId
          ? splitWorktreeId(managed.worktreeId)?.worktreePath
          : undefined
        return (
          (ownedPath !== undefined && isPathInsideOrEqual(rootPath, ownedPath)) ||
          isPathInsideOrEqual(rootPath, managed.initialCwd)
        )
      })
      .map((managed) => managed.id)
    await Promise.all(
      matchingIds.map((id) => this.laterStageDelegates().shutdown({ id, immediate: true }))
    )
  }

  get configuredGraceTimeMs(): number {
    return this.graceTimeMs
  }

  /** Subscribe to PTY-exit events (relay-hook server uses this to evict per-paneKey caches). */
  setExitListener(listener: PtyExitListener | null): void {
    this.exitListener = listener
  }

  /** Register an env augmenter merged into every spawn env after process.env and renderer env. */
  addEnvAugmenter(augmenter: PtyEnvAugmenter): () => void {
    this.envAugmenters.push(augmenter)
    return () => {
      const index = this.envAugmenters.indexOf(augmenter)
      if (index !== -1) {
        this.envAugmenters.splice(index, 1)
      }
    }
  }

  /** Build augmented spawn env; augmenter values win over process.env/renderer env. */
  protected buildSpawnEnv(
    rendererEnv: Record<string, string> | undefined,
    ctx: {
      id: string
      paneKey?: string
      shell: string
      command?: string
      launchAgent?: TuiAgent
    },
    envToDelete: readonly string[] = []
  ): Record<string, string> {
    const baseEnv = mergeGitConfigEnvProtocol(
      {
        ...stripInheritedBuildModeEnv(process.env),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'Orca',
        TERM_PROGRAM_VERSION:
          rendererEnv?.ORCA_APP_VERSION || process.env.ORCA_APP_VERSION || '0.0.0-dev',
        FORCE_HYPERLINK: '1'
      },
      rendererEnv
    ) as Record<string, string>
    const augmented: Record<string, string> = {}
    for (const augmenter of this.envAugmenters) {
      try {
        Object.assign(augmented, augmenter({ ...ctx, env: baseEnv }))
      } catch (err) {
        process.stderr.write(
          `[pty-handler] env augmenter threw: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
    const result = mergeGitConfigEnvProtocol(baseEnv, augmented) as Record<string, string>
    // Why: match local/daemon precedence so defaults/augmenters can't resurrect explicitly-removed values.
    for (const key of envToDelete) {
      delete result[key]
    }
    if (
      !envToDelete.includes('TERM') &&
      rendererEnv &&
      Object.prototype.hasOwnProperty.call(rendererEnv, 'TERM')
    ) {
      result.TERM = rendererEnv.TERM
    }
    // Why: node-pty defaults missing/empty TERM per-platform; normalize so POSIX and Windows children agree.
    if (!result.TERM) {
      result.TERM = 'xterm-256color'
    }
    return result
  }

  // Later stages own these operations; the final handler resolves them through its prototype chain.
  private laterStageDelegates(): LaterStageDelegates {
    return this as unknown as LaterStageDelegates
  }
}
