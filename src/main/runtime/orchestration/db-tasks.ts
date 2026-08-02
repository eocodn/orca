import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import Database from '../../sqlite/sync-database'
import type {
  MessageType,
  MessagePriority,
  MessageDeliveryContract,
  TaskStatus,
  DispatchStatus,
  GateStatus,
  CoordinatorStatus,
  MessageRow,
  TaskRow,
  DispatchContextRow,
  DecisionGateRow,
  CoordinatorRun,
  WorkerReportOutcome,
  WorkerReportSettlement,
  RunRow,
  DeliveryRow,
  DeliveryStatus,
  LegacyAdoptionRow,
  LegacyCompatibilityPrincipalRow,
  LegacyPrincipalRole,
  LegacyOperationReceiptRow,
  LegacyMailReceiptRow,
  QuestionRow,
  QuestionStatus,
  MutationReceiptRow,
  MutationState,
  WorkerDispatchRow,
  WorkerDispatchState,
  LegacyWorkerTerminalRecoveryRow,
  FederatedDispatchRow,
  RemoteDispatchAttachmentRow,
  FederationRelayDirection,
  FederationRelayItemRow
} from './types'
import { buildOrchestrationTaskDisplayMetadata } from '../../../shared/orchestration-task-display'
import { ORCHESTRATION_LEGACY_RUN_ID } from '../../../shared/orchestration-rpc-contract'
import { OrchestrationError } from './orchestration-error'
import {
  addLifecycleRejectionMarker,
  decodeRunListCursor,
  encodeRunListCursor,
  exposeDeliveryTimestamps,
  exposeMessageListTimestamps,
  exposeMessageTimestamps,
  exposeQuestionTimestamps,
  exposeRunTimestamps,
  generateId,
  hashDispatchCapability,
  hasLifecycleRejectionMarker,
  isEquivalentPaneKey,
  legacyMessageMatchesQuestion
} from './db-contract-helpers'
import { resolveOrchestrationMigrationStartVersion } from './orchestration-schema-version-skew'
import { ORCHESTRATION_RUN_PAGE_LIMIT } from '../../../shared/orchestration-run-pagination'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'

import {
  LEGACY_RUN_ID,
  LEGACY_CONTRACT_VERSION,
  CURRENT_CONTRACT_VERSION,
  MUTATION_RECEIPT_MAX_ROWS,
  MUTATION_RECEIPT_MAX_AGE_DAYS,
  SCHEMA_VERSION,
  type RunListPage
} from './db-foundation'
import { OrchestrationDatabaseQuestions } from './db-questions'

export class OrchestrationDatabaseTasks extends OrchestrationDatabaseQuestions {
  createTask(task: {
    spec: string
    taskTitle?: string
    displayName?: string
    deps?: string[]
    parentId?: string
    createdByTerminalHandle?: string
    runId?: string
  }): TaskRow {
    const runId = task.runId ?? LEGACY_RUN_ID
    this.requireRun(runId)
    if (task.parentId) {
      const parent = this.getTask(task.parentId)
      if (!parent || parent.run_id !== runId) {
        throw new Error(`Parent task ${task.parentId} must belong to run ${runId}`)
      }
    }
    for (const depId of task.deps ?? []) {
      const dependency = this.getTask(depId)
      if (!dependency || dependency.run_id !== runId) {
        throw new Error(`Dependency task ${depId} must belong to run ${runId}`)
      }
    }
    const id = generateId('task')
    const depsJson = JSON.stringify(task.deps ?? [])
    const hasDeps = (task.deps ?? []).length > 0
    const status: TaskStatus = hasDeps ? 'pending' : 'ready'
    const display = buildOrchestrationTaskDisplayMetadata({
      spec: task.spec,
      taskTitle: task.taskTitle,
      displayName: task.displayName
    })
    this.db
      .prepare(
        'INSERT INTO tasks (id, run_id, parent_id, created_by_terminal_handle, task_title, display_name, spec, status, deps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        runId,
        task.parentId ?? null,
        task.createdByTerminalHandle ?? null,
        display.taskTitle || null,
        display.displayName || null,
        task.spec,
        status,
        depsJson
      )
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow
  }

  getTask(id: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
  }

  listTasks(filter?: { status?: TaskStatus; ready?: boolean; runId?: string }): TaskRow[] {
    const runWhere = filter?.runId ? 'run_id = ? AND ' : ''
    const runParams: Database.BindValue[] = filter?.runId ? [filter.runId] : []
    if (filter?.ready) {
      return this.db
        .prepare(`SELECT * FROM tasks WHERE ${runWhere}status = 'ready' ORDER BY created_at`)
        .all(...runParams) as TaskRow[]
    }
    if (filter?.status) {
      return this.db
        .prepare(`SELECT * FROM tasks WHERE ${runWhere}status = ? ORDER BY created_at`)
        .all(...runParams, filter.status) as TaskRow[]
    }
    if (filter?.runId) {
      return this.db
        .prepare('SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at')
        .all(filter.runId) as TaskRow[]
    }
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at').all() as TaskRow[]
  }

  // Why: LEFT JOIN keeps non-dispatched tasks (NULL assignee); the MAX(rowid) subquery matches getDispatchContext's most-recent-active-dispatch semantics.
  listTasksWithDispatch(filter?: {
    status?: TaskStatus
    ready?: boolean
    runId?: string
  }): (TaskRow & {
    assignee_handle: string | null
    dispatch_id: string | null
  })[] {
    const whereClauses: string[] = []
    const params: Database.BindValue[] = []
    if (filter?.runId) {
      whereClauses.push('t.run_id = ?')
      params.push(filter.runId)
    }
    if (filter?.ready) {
      whereClauses.push("t.status = 'ready'")
    } else if (filter?.status) {
      whereClauses.push('t.status = ?')
      params.push(filter.status)
    }
    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
    const sql = `
      SELECT
        t.*,
        d.assignee_handle AS assignee_handle,
        d.id              AS dispatch_id
      FROM tasks t
      LEFT JOIN (
        SELECT dc.*
        FROM dispatch_contexts dc
        INNER JOIN (
          SELECT task_id, MAX(rowid) AS max_rowid
          FROM dispatch_contexts
          WHERE status IN ('pending', 'dispatched')
          GROUP BY task_id
        ) latest ON latest.task_id = dc.task_id AND latest.max_rowid = dc.rowid
      ) d ON d.task_id = t.id
      ${where}
      ORDER BY t.created_at
    `
    return this.db.prepare(sql).all(...params) as (TaskRow & {
      assignee_handle: string | null
      dispatch_id: string | null
    })[]
  }

  updateTaskStatus(id: string, status: TaskStatus, result?: string): TaskRow | undefined {
    const completedAt =
      status === 'completed' || status === 'failed' ? new Date().toISOString() : null
    this.db
      .prepare(
        'UPDATE tasks SET status = ?, result = COALESCE(?, result), completed_at = COALESCE(?, completed_at) WHERE id = ?'
      )
      .run(status, result ?? null, completedAt, id)

    if (status === 'completed') {
      this.promoteReadyTasks(id)
      this.completeActiveDispatchForTask(id)
    }

    return this.getTask(id)
  }

  // Why: runs in the status-update transaction, so a completed task never leaves its ready children unpromoted.
  protected promoteReadyTasks(completedTaskId: string): void {
    const candidates = this.db
      .prepare("SELECT * FROM tasks WHERE status = 'pending'")
      .all() as TaskRow[]

    for (const task of candidates) {
      const deps: string[] = JSON.parse(task.deps)
      if (!deps.includes(completedTaskId)) {
        continue
      }

      const allDepsCompleted = deps.every((depId) => {
        const dep = this.getTask(depId)
        return dep?.status === 'completed'
      })
      if (allDepsCompleted) {
        this.db.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(task.id)
      }
    }
  }

  // ── Dispatch Contexts ──

  createStartingWorkerDispatch(params: {
    taskId: string
    startOptions: unknown
    launchTokenHash?: string
    retryOf?: string
    runtimeEpoch?: string
    federation?: {
      environmentId: string
      environmentName: string
      peerFingerprint: string
      protocolVersion: number
    }
    mutationReceipt?: {
      callerFingerprint: string
      requestId: string
      method: string
      payloadHash: string
    }
  }): { dispatch: DispatchContextRow; worker: WorkerDispatchRow } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (params.mutationReceipt) {
        const receipt = params.mutationReceipt
        const existing = this.getMutationReceipt(receipt.callerFingerprint, receipt.requestId)
        if (existing) {
          if (existing.method !== receipt.method || existing.payload_hash !== receipt.payloadHash) {
            throw new OrchestrationError(
              'request_mismatch',
              `Mutation request ${receipt.requestId} was already used with different input.`
            )
          }
          throw new OrchestrationError(
            'operation_unknown',
            `Mutation ${receipt.requestId} already has a durable acceptance record.`
          )
        }
        this.ensureMutationReceiptCapacity()
        this.db
          .prepare(
            `INSERT INTO mutation_receipts (
               caller_fingerprint, request_id, method, payload_hash, state
             ) VALUES (?, ?, ?, ?, 'pending')`
          )
          .run(receipt.callerFingerprint, receipt.requestId, receipt.method, receipt.payloadHash)
      }
      const task = this.getTask(params.taskId)
      if (!task) {
        throw new OrchestrationError('task_not_found', `Task ${params.taskId} was not found.`)
      }
      if (params.retryOf) {
        const prior = this.getDispatchContextById(params.retryOf)
        const priorWorker = this.getWorkerDispatch(params.retryOf)
        const latest = this.getDispatchContext(task.id)
        if (
          !prior ||
          prior.task_id !== task.id ||
          latest?.id !== prior.id ||
          !priorWorker ||
          !['failed', 'stopped', 'abandoned'].includes(priorWorker.state) ||
          !['failed', 'blocked'].includes(task.status)
        ) {
          throw new OrchestrationError(
            'task_not_startable',
            `Task ${task.id} cannot retry from Dispatch ${params.retryOf}.`
          )
        }
      } else if (task.status !== 'ready') {
        throw new OrchestrationError(
          'task_not_startable',
          `Task ${task.id} is ${task.status}; only a ready Task can start.`
        )
      }

      const id = generateId('ctx')
      if (params.mutationReceipt) {
        this.db
          .prepare(
            `UPDATE mutation_receipts
             SET receipt = ?, updated_at = datetime('now')
             WHERE caller_fingerprint = ? AND request_id = ? AND state = 'pending'`
          )
          .run(
            JSON.stringify({ accepted: { dispatchId: id } }),
            params.mutationReceipt.callerFingerprint,
            params.mutationReceipt.requestId
          )
      }
      this.db
        .prepare(
          `INSERT INTO dispatch_contexts (
             id, run_id, task_id, contract_version, launch_token_hash, status, dispatched_at
           ) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`
        )
        .run(id, task.run_id, task.id, CURRENT_CONTRACT_VERSION, params.launchTokenHash ?? null)
      this.db
        .prepare(
          `INSERT INTO worker_dispatches (
             dispatch_id, runtime_epoch, state, stage, start_options
           ) VALUES (?, ?, 'starting', 'accepted', ?)`
        )
        .run(id, params.runtimeEpoch ?? null, JSON.stringify(params.startOptions))
      if (params.federation) {
        this.db
          .prepare(
            `INSERT INTO federated_dispatches (
               dispatch_id, environment_id, environment_name, peer_fingerprint, protocol_version
             ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            id,
            params.federation.environmentId,
            params.federation.environmentName,
            params.federation.peerFingerprint,
            params.federation.protocolVersion
          )
      }
      this.db
        .prepare(
          "UPDATE tasks SET status = 'dispatched', result = NULL, completed_at = NULL WHERE id = ?"
        )
        .run(task.id)
      this.db.exec('COMMIT')
      return {
        dispatch: this.getDispatchContextById(id) as DispatchContextRow,
        worker: this.getWorkerDispatch(id) as WorkerDispatchRow
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

}

