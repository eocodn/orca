import { randomBytes} from 'node:crypto'

import type {
  TaskStatus,
  DispatchStatus,
  WorkerDispatchRow,
  WorkerDispatchState,
  LegacyWorkerTerminalRecoveryRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  hashDispatchCapability} from './db-contract-helpers'





import { OrchestrationDatabaseTasks } from './db-tasks'

export class OrchestrationDatabaseWorkerDispatch extends OrchestrationDatabaseTasks {
  recordWorkerStage(params: {
    dispatchId: string
    stage: string
    worktreeId?: string
    terminalHandle?: string
    setupState?: string
    effects?: unknown[]
    residualResources?: unknown[]
    lastError?: string
    state?: WorkerDispatchState
  }): WorkerDispatchRow {
    const current = this.getWorkerDispatch(params.dispatchId)
    if (!current) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Dispatch ${params.dispatchId} was not found.`
      )
    }
    this.db
      .prepare(
        `UPDATE worker_dispatches
         SET stage = ?, state = ?, worktree_id = ?, agent_terminal_handle = ?,
             setup_state = ?, effects = ?, residual_resources = ?, last_error = ?,
             updated_at = datetime('now')
         WHERE dispatch_id = ?`
      )
      .run(
        params.stage,
        params.state ?? current.state,
        params.worktreeId ?? current.worktree_id,
        params.terminalHandle ?? current.agent_terminal_handle,
        params.setupState ?? current.setup_state,
        params.effects ? JSON.stringify(params.effects) : current.effects,
        params.residualResources
          ? JSON.stringify(params.residualResources)
          : current.residual_resources,
        params.lastError ?? current.last_error,
        params.dispatchId
      )
    return this.getWorkerDispatch(params.dispatchId) as WorkerDispatchRow
  }

  updateWorkerSetupEvidence(params: {
    dispatchId: string
    setupState: string
    effects: unknown[]
  }): { worker: WorkerDispatchRow; changed: boolean } {
    const current = this.getWorkerDispatch(params.dispatchId)
    if (!current) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Dispatch ${params.dispatchId} was not found.`
      )
    }
    const effects = JSON.stringify(params.effects)
    if (current.setup_state === params.setupState && current.effects === effects) {
      return { worker: current, changed: false }
    }
    this.db
      .prepare(
        `UPDATE worker_dispatches
         SET setup_state = ?, effects = ?, updated_at = datetime('now')
         WHERE dispatch_id = ?`
      )
      .run(params.setupState, effects, params.dispatchId)
    return {
      worker: this.getWorkerDispatch(params.dispatchId) as WorkerDispatchRow,
      changed: true
    }
  }

  prepareStartingWorkerAuthority(params: {
    dispatchId: string
    handle: string
    paneKey: string
    processIncarnation: string
    launchTokenHash?: string
    worktreeId: string
    effects: unknown[]
    setupState: string
  }): string {
    const dispatch = this.getDispatchContextById(params.dispatchId)
    const worker = this.getWorkerDispatch(params.dispatchId)
    if (!dispatch || dispatch.status !== 'pending' || worker?.state !== 'starting') {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Dispatch ${params.dispatchId} is not starting.`
      )
    }
    if (
      dispatch.launch_token_hash &&
      params.launchTokenHash &&
      dispatch.launch_token_hash !== params.launchTokenHash
    ) {
      throw new OrchestrationError(
        'request_mismatch',
        `Dispatch ${params.dispatchId} already has a different launch-token commitment.`
      )
    }
    const capability = `dcap_${randomBytes(32).toString('base64url')}`
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET assignee_handle = ?, assignee_pane_key = ?, process_incarnation = ?,
               capability_hash = ?, launch_token_hash = COALESCE(launch_token_hash, ?),
               capability_revoked_at = NULL
           WHERE id = ? AND status = 'pending'`
        )
        .run(
          params.handle,
          params.paneKey,
          params.processIncarnation,
          hashDispatchCapability(capability),
          params.launchTokenHash ?? null,
          params.dispatchId
        )
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET stage = 'authority_attached', worktree_id = ?, agent_terminal_handle = ?,
               setup_state = ?, effects = ?, residual_resources = ?, updated_at = datetime('now')
           WHERE dispatch_id = ? AND state = 'starting'`
        )
        .run(
          params.worktreeId,
          params.handle,
          params.setupState,
          JSON.stringify(params.effects),
          JSON.stringify(
            params.effects.filter((effect) =>
              Boolean(
                effect &&
                typeof effect === 'object' &&
                ((effect as { action?: string }).action?.startsWith('created') ||
                  (effect as { action?: string }).action === 'reused_agent_terminal')
              )
            )
          ),
          params.dispatchId
        )
      this.db.exec('COMMIT')
      return capability
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markWorkerDispatchReady(dispatchId: string, effects?: unknown[]): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(dispatchId)
      const worker = this.getWorkerDispatch(dispatchId)
      if (!dispatch || dispatch.status !== 'pending' || worker?.state !== 'starting') {
        throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not starting.`)
      }
      this.db
        .prepare("UPDATE dispatch_contexts SET status = 'dispatched' WHERE id = ?")
        .run(dispatchId)
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'ready', stage = 'input_accepted',
               effects = COALESCE(?, effects), updated_at = datetime('now')
           WHERE dispatch_id = ?`
        )
        .run(effects ? JSON.stringify(effects) : null, dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  failWorkerStart(dispatchId: string, stage: string, reason: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(dispatchId)
      const worker = this.getWorkerDispatch(dispatchId)
      if (!dispatch || !worker || worker.state !== 'starting') {
        throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not starting.`)
      }
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET status = 'failed', last_failure = ?, completed_at = datetime('now'),
               capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
           WHERE id = ?`
        )
        .run(reason, dispatchId)
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'failed', stage = ?, last_error = ?, updated_at = datetime('now')
           WHERE dispatch_id = ?`
        )
        .run(stage, reason, dispatchId)
      this.db
        .prepare("UPDATE tasks SET status = 'failed', completed_at = datetime('now') WHERE id = ?")
        .run(dispatch.task_id)
      this.closeQuestionsForDispatch(dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markWorkerStartUnknown(dispatchId: string, stage: string, reason: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(dispatchId)
      const worker = this.getWorkerDispatch(dispatchId)
      if (!dispatch || !worker || worker.state !== 'starting') {
        throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not starting.`)
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'start_unknown', stage = ?, last_error = ?, updated_at = datetime('now')
           WHERE dispatch_id = ?`
        )
        .run(stage, reason, dispatchId)
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
           WHERE id = ?`
        )
        .run(dispatchId)
      this.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(dispatch.task_id)
      this.closeQuestionsForDispatch(dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  reconcileFederatedWorkerStart(params: {
    dispatchId: string
    state: 'ready' | 'failed' | 'stopped' | 'start_unknown'
    stage: string
    lastError?: string | null
    worktreeId?: string | null
    terminalHandle?: string | null
    setupState?: string
    effects?: unknown[]
    residualResources?: unknown[]
  }): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(params.dispatchId)
      const worker = this.getWorkerDispatch(params.dispatchId)
      if (!dispatch || !worker) {
        throw new OrchestrationError(
          'dispatch_not_found',
          `Federated Dispatch ${params.dispatchId} was not found.`
        )
      }
      if (!['starting', 'start_unknown'].includes(worker.state)) {
        this.db.exec('COMMIT')
        return worker
      }

      if (params.state === 'ready') {
        this.db
          .prepare(
            `UPDATE worker_dispatches
             SET state = 'ready', stage = ?, worktree_id = COALESCE(?, worktree_id),
                 agent_terminal_handle = COALESCE(?, agent_terminal_handle), setup_state = ?,
                 effects = ?, residual_resources = ?, last_error = NULL,
                 updated_at = datetime('now')
             WHERE dispatch_id = ? AND state IN ('starting', 'start_unknown')`
          )
          .run(
            params.stage,
            params.worktreeId ?? null,
            params.terminalHandle ?? null,
            params.setupState ?? worker.setup_state,
            JSON.stringify(params.effects ?? JSON.parse(worker.effects)),
            JSON.stringify(params.residualResources ?? JSON.parse(worker.residual_resources)),
            params.dispatchId
          )
        this.db
          .prepare(
            "UPDATE dispatch_contexts SET status = 'dispatched' WHERE id = ? AND status = 'pending'"
          )
          .run(params.dispatchId)
        this.db
          .prepare(
            "UPDATE tasks SET status = 'dispatched', completed_at = NULL WHERE id = ? AND status = 'blocked'"
          )
          .run(dispatch.task_id)
      } else if (params.state === 'start_unknown') {
        this.db
          .prepare(
            `UPDATE worker_dispatches
             SET stage = ?, last_error = ?, updated_at = datetime('now')
             WHERE dispatch_id = ? AND state IN ('starting', 'start_unknown')`
          )
          .run(params.stage, params.lastError ?? worker.last_error, params.dispatchId)
      } else {
        const reason = params.lastError ?? `The worker server reported ${params.state}.`
        this.db
          .prepare(
            `UPDATE worker_dispatches
             SET state = ?, stage = ?, last_error = ?, updated_at = datetime('now')
             WHERE dispatch_id = ? AND state IN ('starting', 'start_unknown')`
          )
          .run(params.state, params.stage, reason, params.dispatchId)
        this.db
          .prepare(
            `UPDATE dispatch_contexts
             SET status = 'failed', last_failure = ?, completed_at = datetime('now'),
                 capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
             WHERE id = ? AND status IN ('pending', 'dispatched')`
          )
          .run(reason, params.dispatchId)
        this.db
          .prepare(
            "UPDATE tasks SET status = 'failed', completed_at = datetime('now') WHERE id = ? AND status IN ('blocked', 'dispatched')"
          )
          .run(dispatch.task_id)
        this.closeQuestionsForDispatch(params.dispatchId)
      }
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(params.dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getWorkerDispatch(dispatchId: string): WorkerDispatchRow | undefined {
    return this.db
      .prepare('SELECT * FROM worker_dispatches WHERE dispatch_id = ?')
      .get(dispatchId) as WorkerDispatchRow | undefined
  }

  listLegacyWorkerTerminalRecoveryRows(): LegacyWorkerTerminalRecoveryRow[] {
    return this.db
      .prepare(
        `SELECT dc.id AS dispatch_id, dc.task_id, dc.status AS dispatch_status,
                dc.contract_version, dc.assignee_handle, dc.assignee_pane_key,
                dc.process_incarnation, wd.state AS worker_state, wd.worktree_id,
                wd.agent_terminal_handle
         FROM dispatch_contexts dc
         INNER JOIN worker_dispatches wd ON wd.dispatch_id = dc.id
         WHERE wd.state IN ('starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown')
         ORDER BY dc.rowid`
      )
      .all() as LegacyWorkerTerminalRecoveryRow[]
  }

  reconcileMissingWorkerTerminal(dispatchId: string, reason: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(dispatchId)
      const worker = this.getWorkerDispatch(dispatchId)
      if (!dispatch || !worker) {
        throw new OrchestrationError('dispatch_not_found', `Dispatch ${dispatchId} was not found.`)
      }
      if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(worker.state)) {
        this.db.exec('COMMIT')
        return worker
      }

      const activeDispatch = dispatch.status === 'pending' || dispatch.status === 'dispatched'
      const stopWasPending = worker.state === 'stopping' || worker.state === 'stop_unknown'
      if (activeDispatch) {
        const failureCount = dispatch.failure_count + 1
        const dispatchStatus: DispatchStatus = failureCount >= 3 ? 'circuit_broken' : 'failed'
        this.db
          .prepare(
            `UPDATE dispatch_contexts
             SET status = ?, failure_count = ?, last_failure = ?,
                 completed_at = datetime('now'),
                 capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
             WHERE id = ? AND status IN ('pending', 'dispatched')`
          )
          .run(dispatchStatus, failureCount, reason, dispatchId)
        if (!stopWasPending) {
          const taskStatus: TaskStatus = dispatchStatus === 'circuit_broken' ? 'failed' : 'ready'
          this.db
            .prepare(
              `UPDATE tasks
               SET status = ?, completed_at = CASE WHEN ? = 'failed' THEN datetime('now') ELSE NULL END
               WHERE id = ? AND status IN ('dispatched', 'blocked')`
            )
            .run(taskStatus, taskStatus, dispatch.task_id)
        }
        this.closeQuestionsForDispatch(dispatchId)
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = ?, stage = 'terminal_missing', last_error = ?, updated_at = datetime('now')
           WHERE dispatch_id = ?`
        )
        .run(stopWasPending ? 'stopped' : 'abandoned', reason, dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

}

