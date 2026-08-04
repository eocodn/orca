// Why: must exceed agent-browser's internal timeouts (goto 30s, wait 60s) so the bridge never kills a command before its own timeout fires.
import type * as foundation from './agent-browser-command-bridge-foundation'
type EnqueueTargetedCommandOptions = foundation.EnqueueTargetedCommandOptions
type QueuedCommand = foundation.QueuedCommand
type ResolvedBrowserCommandTarget = foundation.ResolvedBrowserCommandTarget

type QueueProcessor = {
  generation: number
  queue: QueuedCommand[]
  promise: Promise<void>
}

// Why: session destruction clears public queue state while the old command may still be awaiting its child.
const sessionGenerations = new WeakMap<object, Map<string, number>>()
const queueProcessors = new WeakMap<object, Map<string, QueueProcessor>>()

function getSessionGeneration(bridge: object, sessionName: string): number {
  let generations = sessionGenerations.get(bridge)
  if (!generations) {
    generations = new Map()
    sessionGenerations.set(bridge, generations)
  }
  return generations.get(sessionName) ?? 0
}

export function advanceSessionGeneration(bridge: object, sessionName: string): void {
  const nextGeneration = getSessionGeneration(bridge, sessionName) + 1
  sessionGenerations.get(bridge)!.set(sessionName, nextGeneration)
}

function getQueueProcessors(bridge: object): Map<string, QueueProcessor> {
  let processors = queueProcessors.get(bridge)
  if (!processors) {
    processors = new Map()
    queueProcessors.set(bridge, processors)
  }
  return processors
}

export const AgentBrowserBridgeMethods21 = {
  async enqueueTargetedCommand<T>(
    this: any,
    worktreeId: string | undefined,
    browserPageId: string | undefined,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions = {}
  ): Promise<T> {
    const target = this.resolveCommandTarget(worktreeId, browserPageId, options.requireScopedTarget)
    const sessionName = `orca-tab-${target.browserPageId}`

    if (options.ensureSession !== false) {
      await this.ensureSession(sessionName, target.browserPageId, target.webContentsId)
    }

    return new Promise<T>((resolve, reject) => {
      let queue = this.commandQueues.get(sessionName)
      if (!queue) {
        queue = []
        this.commandQueues.set(sessionName, queue)
      }
      queue.push({
        execute: (() =>
          this.executeWithVisibleTarget(
            sessionName,
            worktreeId,
            target,
            execute,
            options
          )) as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.processQueue(sessionName)
    })
  },
  async executeWithVisibleTarget<T>(
    this: any,
    sessionName: string,
    worktreeId: string | undefined,
    target: ResolvedBrowserCommandTarget,
    execute: (sessionName: string, target: ResolvedBrowserCommandTarget) => Promise<T>,
    options: EnqueueTargetedCommandOptions
  ): Promise<T> {
    if (options.ensureVisible === false) {
      return execute(sessionName, target)
    }

    // Why: inactive panes are display:none; the automation lease makes only this target paintable without selecting it.
    const restore = await this.browserManager.acquireAutomationVisibility(target.webContentsId)
    try {
      const visibleTarget = await this.refreshTargetAfterAutomationVisibility(
        sessionName,
        worktreeId,
        target,
        options
      )
      return await execute(sessionName, visibleTarget)
    } finally {
      restore()
    }
  },
  async refreshTargetAfterAutomationVisibility(
    this: any,
    sessionName: string,
    worktreeId: string | undefined,
    target: ResolvedBrowserCommandTarget,
    options: EnqueueTargetedCommandOptions
  ): Promise<ResolvedBrowserCommandTarget> {
    const visibleTarget = this.resolveCommandTarget(worktreeId, target.browserPageId)
    if (visibleTarget.webContentsId === target.webContentsId) {
      return visibleTarget
    }

    if (this.activeWebContentsId === target.webContentsId) {
      this.activeWebContentsId = visibleTarget.webContentsId
    }
    if (worktreeId && this.activeWebContentsPerWorktree.get(worktreeId) === target.webContentsId) {
      this.activeWebContentsPerWorktree.set(worktreeId, visibleTarget.webContentsId)
    }

    // Why: making a parked webview paintable can re-register the page with a new guest webContents; tear down the stale session.
    await this.restartSessionForTarget(
      sessionName,
      visibleTarget.browserPageId,
      visibleTarget.webContentsId,
      { recreate: options.ensureSession !== false }
    )

    return visibleTarget
  },
  async processQueue(this: any, sessionName: string): Promise<void> {
    const queue = this.commandQueues.get(sessionName)
    if (!queue) {
      return
    }

    const generation = getSessionGeneration(this, sessionName)
    const processors = getQueueProcessors(this)
    const activeProcessor = processors.get(sessionName)
    if (activeProcessor) {
      if (activeProcessor.queue === queue && activeProcessor.generation === generation) {
        return
      }
      await activeProcessor.promise
      return this.processQueue(sessionName)
    }

    const promise = Promise.resolve().then(async () => {
      while (
        queue.length > 0 &&
        this.commandQueues.get(sessionName) === queue &&
        getSessionGeneration(this, sessionName) === generation
      ) {
        const cmd = queue.shift()!
        try {
          const result = await cmd.execute()
          cmd.resolve(result)
        } catch (error) {
          cmd.reject(error)
        }
      }

      if (queue.length === 0 && this.commandQueues.get(sessionName) === queue) {
        this.commandQueues.delete(sessionName)
      }
    })
    const processor: QueueProcessor = { generation, queue, promise }
    processors.set(sessionName, processor)
    this.processingQueues.add(sessionName)

    try {
      await promise
    } finally {
      if (processors.get(sessionName) === processor) {
        processors.delete(sessionName)
        this.processingQueues.delete(sessionName)
        if (queue.length > 0 && this.commandQueues.get(sessionName) === queue) {
          void this.processQueue(sessionName)
        }
      }
    }
  }
}
export type AgentBrowserBridgeMethods21Surface = typeof AgentBrowserBridgeMethods21
