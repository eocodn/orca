import type { RequestContext } from './dispatcher'
import { PtyHandlerStage3Admission } from './pty-session-stage-3-admission'
import {
  AGENT_SESSION_CREATE_OPERATION_ID_PATTERN,
  AGENT_SESSION_CREATE_OPERATION_LIMIT,
  AGENT_SESSION_CREATE_OPERATION_RETENTION_MS
} from './pty-session-stage-contracts'
import type { RelayAgentSessionCreateResult } from './pty-session-stage-contracts'
import { isProcessAlive, resolveDefaultCwd } from './pty-shell-utils'
import { splitWorktreeId } from '../shared/worktree-id'
import { agentSessionOwnerBindingsEqual } from '../shared/claimed-agent-pty-owner'
import {
  isAgentSessionExecutionClaim,
  isAgentSessionSurfaceBinding
} from '../shared/agent-session-host-authority'

export abstract class PtyHandlerStage3 extends PtyHandlerStage3Admission {
  protected async spawn(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<RelayAgentSessionCreateResult> {
    const operationId = params.agentSessionCreateOperationId
    if (operationId === undefined) {
      return await this.spawnOnce(params, context)
    }
    if (
      typeof operationId !== 'string' ||
      !AGENT_SESSION_CREATE_OPERATION_ID_PATTERN.test(operationId)
    ) {
      throw new Error('agent_session_operation_invalid')
    }
    const existing = this.agentSessionCreateOperations.get(operationId)
    if (existing) {
      const result = await existing
      this.sourcePublication?.activate(result.id, result.incarnationId, context)
      const sourceActivation =
        context && this.sourcePublication?.receivingActivation?.(result.id, context.clientId)
      const { sourceActivation: _staleActivation, ...stableResult } = result
      return { ...stableResult, ...(sourceActivation ? { sourceActivation } : {}) }
    }
    if (this.agentSessionCreateOperations.size >= AGENT_SESSION_CREATE_OPERATION_LIMIT) {
      throw new Error('agent_session_operation_capacity')
    }
    const operation = this.spawnOnce(params, context)
    this.agentSessionCreateOperations.set(operationId, operation)
    try {
      const result = await operation
      this.expireAgentSessionCreateOperation(operationId, operation)
      return result
    } catch (error) {
      const outcomeUnknown =
        typeof error === 'object' &&
        error !== null &&
        'agentSessionOperationOutcome' in error &&
        error.agentSessionOperationOutcome === 'unknown'
      if (outcomeUnknown) {
        // Why: the native PTY may be live; replay the same failure instead of spawning again.
        this.expireAgentSessionCreateOperation(operationId, operation)
      } else if (this.agentSessionCreateOperations.get(operationId) === operation) {
        this.agentSessionCreateOperations.delete(operationId)
      }
      throw error
    }
  }

  protected expireAgentSessionCreateOperation(
    operationId: string,
    operation: Promise<RelayAgentSessionCreateResult>
  ): void {
    const timer = setTimeout(() => {
      if (this.agentSessionCreateOperations.get(operationId) === operation) {
        this.agentSessionCreateOperations.delete(operationId)
      }
    }, AGENT_SESSION_CREATE_OPERATION_RETENTION_MS)
    timer.unref?.()
  }

  protected async spawnOnce(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<RelayAgentSessionCreateResult> {
    const env = params.env as Record<string, string> | undefined
    const worktreeId = env?.ORCA_WORKTREE_ID
    const worktreePath = worktreeId ? splitWorktreeId(worktreeId)?.worktreePath : undefined
    const cwd = typeof params.cwd === 'string' ? params.cwd : resolveDefaultCwd()
    const finishCreation = this.beginPtyCreation([worktreePath, cwd])
    let physicalSpawnCommitted = false
    const markPhysicalSpawnCommitted = (): void => {
      physicalSpawnCommitted = true
    }
    try {
      const ensure = params.agentSessionEnsure as { claim?: unknown; surface?: unknown } | undefined
      if (!ensure) {
        return await this.spawnAfterAdmission(params, context, markPhysicalSpawnCommitted)
      }
      if (
        !isAgentSessionExecutionClaim(ensure.claim) ||
        !isAgentSessionSurfaceBinding(ensure.surface)
      ) {
        throw new Error('agent_session_identity_required')
      }
      const claim = ensure.claim
      const surface = ensure.surface
      const result = await this.agentSessionOwners.ensure({
        claim,
        surface,
        spawn: async ({ generation }) => {
          const created = await this.spawnAfterAdmission(
            params,
            context,
            markPhysicalSpawnCommitted
          )
          const managed = this.ptys.get(created.id)
          if (managed) {
            managed.agentSessionOwners = [
              {
                claim,
                generation,
                phase: 'live',
                ptyId: created.id,
                surface
              }
            ]
          }
          return { ptyId: created.id }
        },
        isLive: (owner) => {
          const managed = this.ptys.get(owner.ptyId)
          return Boolean(
            managed &&
            !managed.disposed &&
            (!managed.pty.pid || isProcessAlive(managed.pty.pid)) &&
            managed.agentSessionOwners?.some((candidate) =>
              agentSessionOwnerBindingsEqual(candidate, owner)
            )
          )
        }
      })
      const managed = this.ptys.get(result.owner.ptyId)
      if (!managed || managed.disposed) {
        this.agentSessionOwners.release(result.owner.ptyId, result.owner.generation)
        throw new Error('agent_session_exited_during_start')
      }
      managed.agentSessionOwners = this.agentSessionOwners.listForPty(managed.id)
      const adoptedReplay = result.disposition === 'adopted' ? managed.buffered.read() : ''
      this.sourcePublication?.activate(managed.id, managed.incarnationId, context)
      const sourceActivation =
        context && this.sourcePublication?.receivingActivation?.(managed.id, context.clientId)
      return {
        id: managed.id,
        incarnationId: managed.incarnationId,
        agentSessionEnsure: result,
        ...(sourceActivation ? { sourceActivation } : {}),
        ...(adoptedReplay ? { replay: adoptedReplay } : {})
      }
    } catch (error) {
      if (!physicalSpawnCommitted) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw Object.assign(new Error(message), {
        agentSessionOperationOutcome: 'unknown' as const
      })
    } finally {
      finishCreation()
    }
  }
}
