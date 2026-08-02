import type { RequestContext } from './dispatcher'
import { PtyHandlerStage3 } from './pty-session-stage-3'
import {
  attachIdentityMismatches,
  disposeManagedPty,
  isProcessAlive,
  parseSourceRecoveryRequest
} from './pty-session-stage-contracts'
import type { PtySourceRecoveryResult } from '../shared/pty-source-recovery-contract'
import type { PtySourceReceivingActivation } from '../shared/pty-source-receiving-activation'

export class PtyHandlerStage4Attach extends PtyHandlerStage3 {
  protected async attach(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<{
    incarnationId: string
    replay?: string
    sourceRecovery?: PtySourceRecoveryResult
    sourceActivation?: PtySourceReceivingActivation
  }> {
    const id = params.id as string
    const managed = this.ptys.get(id)
    // Why: after dispose, pty.kill is a POSIX no-op; treat disposed as not-found so failures aren't silent.
    if (!managed || managed.disposed) {
      throw new Error(`PTY "${id}" not found`)
    }

    // Why: a shell can die without node-pty firing onExit (reaped out-of-band); prove liveness so attach doesn't strand a dead, lingering lease.
    if (managed.pty.pid && !isProcessAlive(managed.pty.pid)) {
      managed.physicalExit?.markExited()
      this.releaseRelayIngress(managed)
      this.flushPtyOutput(id)
      this.notifyExitListener(managed)
      this.agentSessionOwners.release(managed.id)
      disposeManagedPty(managed)
      this.ptys.delete(id)
      this.clearPtyFlowState(id)
      throw new Error(`PTY "${id}" not found`)
    }

    // Why: a relay generation reset can reuse pty-N for a different pane; reject on identity disagreement (absent identity permissive).
    const mismatch = attachIdentityMismatches(
      {
        paneKey: typeof params.expectedPaneKey === 'string' ? params.expectedPaneKey : undefined,
        tabId: typeof params.expectedTabId === 'string' ? params.expectedTabId : undefined
      },
      managed.attachIdentity ?? { paneKey: managed.paneKey, tabId: managed.tabId }
    )
    if (mismatch) {
      throw new Error(`PTY "${id}" not found (identity mismatch)`)
    }

    managed.startupIngress?.snapshotBarrier()
    let sourceRecovery = parseSourceRecoveryRequest(params.sourceRecovery)
    if (
      sourceRecovery?.status === 'checkpoint' &&
      this.sourcePublication &&
      !(await this.sourcePublication.waitForPendingSend(id))
    ) {
      sourceRecovery = Object.freeze({ status: 'checkpointUnavailable' })
    }
    const activation = this.sourcePublication?.activate(
      id,
      managed.incarnationId,
      context,
      sourceRecovery
    )
    const sourceActivation =
      context && this.sourcePublication?.receivingActivation?.(id, context.clientId)
    if (typeof activation === 'object') {
      return {
        incarnationId: managed.incarnationId,
        sourceRecovery: activation,
        ...(sourceActivation ? { sourceActivation } : {})
      }
    }
    if (activation === 'existing' && this.sourcePublication?.accepts(id)) {
      return {
        incarnationId: managed.incarnationId,
        ...(sourceActivation ? { sourceActivation } : {})
      }
    }

    // Why: renderer hasn't registered replay handlers yet during spawn, so return to the caller instead of notifying too early.
    // Why: buffer intentionally NOT cleared after replay (client clears xterm first) so later restarts still replay full history.
    const replay = managed.buffered.read()
    if (replay) {
      // Why: drop pending batched bytes already in the replay buffer so attach doesn't render them twice.
      this.pendingOutputByPty.delete(id)
      this.clearOutputFlushTimerIfIdle()
      this.maybeResumePtyOutput(id)
      if (params.suppressReplayNotification) {
        return {
          incarnationId: managed.incarnationId,
          replay,
          ...(sourceActivation ? { sourceActivation } : {})
        }
      }
      this.dispatcher.notify('pty.replay', { id, data: replay })
    }
    return {
      incarnationId: managed.incarnationId,
      ...(sourceActivation ? { sourceActivation } : {})
    }
  }
}

