import { PtyHandlerStage2Output } from './pty-session-stage-2-output'
import {
  finishPtyCreationOperations,
  MAX_RELAY_PTY_SESSIONS,
  PTY_OUTPUT_PRODUCER_LOW_BYTES
} from './pty-session-stage-contracts'
import { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
import type { RelayPtySourceOutput } from './relay-pty-source-output'
export abstract class PtyHandlerStage2 extends PtyHandlerStage2Output {
  protected clearPtyFlowState(id: string): void {
    this.pendingOutputByPty.delete(id)
    this.pendingExitByPty.delete(id)
    this.pausedOutputPtys.delete(id)
    this.consumerPausedOutputPtys.delete(id)
    this.clearPtyInputState(id)
    this.clearOutputFlushTimerIfIdle()
  }

  protected clearPtyInputState(id: string): void {
    this.lastInputAtByPty.delete(id)
    this.interactiveOutputCharsByPty.delete(id)
  }

  protected publishPtyOutput(
    id: string,
    output: RelayPtySourceOutput,
    interactive: boolean
  ): boolean {
    if (this.sourcePublication?.accepts(id)) {
      return this.sourcePublication.publish(id, output, interactive)
    }
    if (this.dispatcher.tryNotifyPtyData) {
      return this.dispatcher.tryNotifyPtyData(
        {
          id,
          data: output.data,
          ...(output.seq === undefined ? {} : { seq: output.seq }),
          ...(output.rawLength === undefined ? {} : { rawLength: output.rawLength }),
          ...(output.transformed ? { transformed: true } : {})
        },
        { interactive }
      )
    }
    this.dispatcher.notify('pty.data', {
      id,
      data: output.data,
      ...(output.seq === undefined ? {} : { seq: output.seq }),
      ...(output.rawLength === undefined ? {} : { rawLength: output.rawLength }),
      ...(output.transformed ? { transformed: true } : {})
    })
    return true
  }

  protected publishPendingExit(id: string): void {
    if (this.pendingOutputByPty.has(id)) {
      return
    }
    const exit = this.pendingExitByPty.get(id)
    if (!exit) {
      return
    }
    if (this.sourcePublication?.accepts(id)) {
      try {
        // Why: after the exit settlement, re-entering sealAndPublishExit would pump a closed
        // ledger delivery; the settled state alone decides completion.
        if (this.sourcePublication.exitPublicationSettled(id)) {
          this.pendingExitByPty.delete(id)
          return
        }
        if (!this.sourcePublication.sealAndPublishExit(exit)) {
          return
        }
        if (
          this.sourcePublication.accepts(id) &&
          !this.sourcePublication.exitPublicationSettled(id)
        ) {
          return
        }
        this.pendingExitByPty.delete(id)
        return
      } catch (err) {
        // Why: a source-publication fault must never escape onExit — it reaches
        // uncaughtException and kills the whole relay daemon. Fall back to the legacy exit.
        process.stderr.write(
          `[pty-handler] pty source exit publication failed for ${id}: ${
            err instanceof Error ? (err.stack ?? err.message) : String(err)
          }\n`
        )
      }
    }
    // Why: a retired record can already have projected this exit to the legacy subscribers, and
    // the broadcast below would hand them a second copy.
    let retiredExitPublished: boolean | null | undefined
    try {
      retiredExitPublished = this.sourcePublication?.publishExitAfterRetire?.(exit)
    } catch (err) {
      process.stderr.write(
        `[pty-handler] retired pty exit publication failed for ${id}: ${
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        }\n`
      )
    }
    const published =
      retiredExitPublished ??
      (this.dispatcher.tryNotifyPtyExit
        ? this.dispatcher.tryNotifyPtyExit(exit)
        : (this.dispatcher.notify('pty.exit', exit), true))
    if (!published) {
      return
    }
    this.pendingExitByPty.delete(id)
  }

  protected pendingProducerBytes(id: string): number {
    return (this.pendingOutputByPty.get(id) ?? []).reduce(
      (total, pending) =>
        total + Math.max(Buffer.byteLength(pending.data, 'utf8'), 2 * pending.data.length) + 128,
      0
    )
  }

  protected pausePtyOutput(id: string): void {
    if (this.pausedOutputPtys.has(id)) {
      return
    }
    const managed = this.ptys.get(id)
    if (!managed || managed.disposed) {
      return
    }
    this.pausedOutputPtys.add(id)
    managed.pty.pause()
  }

  protected maybeResumePtyOutput(id: string): void {
    if (
      !this.pausedOutputPtys.has(id) ||
      this.consumerPausedOutputPtys.has(id) ||
      this.pendingProducerBytes(id) > PTY_OUTPUT_PRODUCER_LOW_BYTES ||
      this.dispatcher.legacyRetentionBelowLowWater === false
    ) {
      return
    }
    const managed = this.ptys.get(id)
    this.pausedOutputPtys.delete(id)
    if (managed && !managed.disposed) {
      managed.pty.resume()
    }
  }

  protected handleLegacyCapacity(): void {
    if (this.pendingOutputByPty.size > 0) {
      this.scheduleOutputFlush(0)
    }
    for (const id of Array.from(this.pendingExitByPty.keys())) {
      this.publishPendingExit(id)
    }
    for (const id of Array.from(this.pausedOutputPtys)) {
      this.maybeResumePtyOutput(id)
    }
  }

  protected beginPtyCreation(operationPaths: readonly (string | undefined)[]): () => void {
    if (this.creationFenced) {
      throw new Error('PTY handler is shutting down')
    }
    const distinctPaths = new Map<string, string>()
    for (const operationPath of operationPaths) {
      if (operationPath) {
        distinctPaths.set(normalizeRuntimePathForComparison(operationPath), operationPath)
      }
    }
    const finishRemovalOperations: (() => void)[] = []
    try {
      if (this.worktreeRemovalCoordinator) {
        for (const operationPath of distinctPaths.values()) {
          finishRemovalOperations.push(
            this.worktreeRemovalCoordinator.beginWorktreePtySpawn(operationPath)
          )
        }
      }
      if (this.ptys.size + this.pendingSpawnCount >= MAX_RELAY_PTY_SESSIONS) {
        throw new Error('Maximum number of PTY sessions reached (50)')
      }
    } catch (error) {
      // Why: a later rejection must release every earlier admission before propagating.
      finishPtyCreationOperations(finishRemovalOperations)
      throw error
    }
    this.pendingSpawnCount++
    let finished = false
    return () => {
      if (finished) {
        return
      }
      finished = true
      this.pendingSpawnCount--
      if (this.pendingSpawnCount === 0) {
        for (const resolve of this.pendingCreationDrainResolvers) {
          resolve()
        }
        this.pendingCreationDrainResolvers.clear()
      }
      finishPtyCreationOperations(finishRemovalOperations)
    }
  }

  protected waitForPendingPtyCreations(): Promise<void> {
    if (this.pendingSpawnCount === 0) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.pendingCreationDrainResolvers.add(resolve)
    })
  }
}
