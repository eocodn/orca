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
import { OrchestrationDatabaseRelay } from './db-relay'

export class OrchestrationDatabaseDispatchContext extends OrchestrationDatabaseRelay {
  createDispatchContext(
    taskId: string,
    assigneeHandle: string,
    // Why: pane key is the remint-stable identity behind the handle — lets worker_done ownership survive handle reissue.
    assigneePaneKey?: string,
    launchTokenHash?: string
  ): DispatchContextRow {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }
    if (task.status !== 'ready') {
      throw new Error(`Task ${taskId} is ${task.status}; only ready tasks can be dispatched`)
    }

    // Why: lock on pane identity too, so a reminted handle can't open a second concurrent dispatch on the same pane.
    const existing = this.findActiveDispatchForAssignee(assigneeHandle, assigneePaneKey)

    if (existing) {
      throw new Error(
        `Terminal ${assigneeHandle} already has an active dispatch (${existing.id} for task ${existing.task_id})`
      )
    }

    // Carry forward failure_count so the circuit breaker accumulates across retries for the same task.
    const prior = this.db
      .prepare('SELECT MAX(failure_count) as max_failures FROM dispatch_contexts WHERE task_id = ?')
      .get(taskId) as { max_failures: number | null } | undefined
    const priorFailures = prior?.max_failures ?? 0

    const id = generateId('ctx')
    this.db
      .prepare(
        `INSERT INTO dispatch_contexts (
           id, run_id, task_id, contract_version, launch_token_hash,
           assignee_handle, assignee_pane_key, status, failure_count, dispatched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dispatched', ?, datetime('now'))`
      )
      .run(
        id,
        task.run_id,
        taskId,
        CURRENT_CONTRACT_VERSION,
        launchTokenHash ?? null,
        assigneeHandle,
        assigneePaneKey ?? null,
        priorFailures
      )
    this.hasAnyDispatchContextsCache = true

    this.db.prepare("UPDATE tasks SET status = 'dispatched' WHERE id = ?").run(taskId)

    return this.db
      .prepare('SELECT * FROM dispatch_contexts WHERE id = ?')
      .get(id) as DispatchContextRow
  }

  getDispatchContext(taskId: string): DispatchContextRow | undefined {
    return this.db
      .prepare('SELECT * FROM dispatch_contexts WHERE task_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(taskId) as DispatchContextRow | undefined
  }

  getDispatchContextById(dispatchId: string): DispatchContextRow | undefined {
    return this.db.prepare('SELECT * FROM dispatch_contexts WHERE id = ?').get(dispatchId) as
      | DispatchContextRow
      | undefined
  }

  commitDispatchLaunchTokenHash(dispatchId: string, launchTokenHash: string): DispatchContextRow {
    const dispatch = this.getDispatchContextById(dispatchId)
    if (!dispatch) {
      throw new OrchestrationError('dispatch_not_found', `Dispatch ${dispatchId} was not found.`)
    }
    if (dispatch.contract_version !== CURRENT_CONTRACT_VERSION) {
      throw new OrchestrationError(
        'request_mismatch',
        `Dispatch ${dispatchId} does not use the current contract.`
      )
    }
    if (dispatch.launch_token_hash && dispatch.launch_token_hash !== launchTokenHash) {
      throw new OrchestrationError(
        'request_mismatch',
        `Dispatch ${dispatchId} already has a different launch-token commitment.`
      )
    }
    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET launch_token_hash = COALESCE(launch_token_hash, ?)
         WHERE id = ?`
      )
      .run(launchTokenHash, dispatchId)
    return this.getDispatchContextById(dispatchId) as DispatchContextRow
  }

  mintDispatchCapability(params: {
    dispatchId: string
    paneKey: string
    processIncarnation: string
  }): string {
    const dispatch = this.getDispatchContextById(params.dispatchId)
    if (!dispatch || (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Dispatch ${params.dispatchId} is not active.`
      )
    }
    const capability = `dcap_${randomBytes(32).toString('base64url')}`
    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET capability_hash = ?, assignee_pane_key = ?, process_incarnation = ?,
             capability_revoked_at = NULL
         WHERE id = ?`
      )
      .run(
        hashDispatchCapability(capability),
        params.paneKey,
        params.processIncarnation,
        params.dispatchId
      )
    return capability
  }

  verifyDispatchCapability(params: {
    dispatchId: string
    capability: string | undefined
    paneKey: string | undefined
    processIncarnation: string | undefined
  }): { valid: true } | { valid: false; reason: string } {
    const dispatch = this.getDispatchContextById(params.dispatchId)
    if (!dispatch) {
      return { valid: false, reason: `Dispatch ${params.dispatchId} was not found.` }
    }
    if (!dispatch.capability_hash) {
      return { valid: false, reason: `Dispatch ${params.dispatchId} has no lifecycle capability.` }
    }
    if (dispatch.capability_revoked_at) {
      return { valid: false, reason: `Dispatch ${params.dispatchId} capability is revoked.` }
    }
    if (!params.capability) {
      return { valid: false, reason: 'The Dispatch capability is missing.' }
    }
    const expected = Buffer.from(dispatch.capability_hash, 'hex')
    const observed = Buffer.from(hashDispatchCapability(params.capability), 'hex')
    if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) {
      return { valid: false, reason: 'The Dispatch capability is invalid.' }
    }
    if (
      !dispatch.assignee_pane_key ||
      !params.paneKey ||
      !isEquivalentPaneKey(dispatch.assignee_pane_key, params.paneKey)
    ) {
      return { valid: false, reason: 'The caller is not the Dispatch pane.' }
    }
    if (
      !dispatch.process_incarnation ||
      !params.processIncarnation ||
      dispatch.process_incarnation !== params.processIncarnation
    ) {
      return { valid: false, reason: 'The Dispatch process incarnation changed.' }
    }
    return { valid: true }
  }

  revokeDispatchCapability(dispatchId: string): void {
    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
         WHERE id = ?`
      )
      .run(dispatchId)
  }

  getActiveDispatchForTerminal(handle: string): DispatchContextRow | undefined {
    return this.findActiveDispatchForAssignee(handle)
  }

  /**
   * Cheap "are there any dispatch rows at all" probe. When false, no terminal
   * can have an active or recent-completed dispatch, so orchestration-context
   * builders can skip their per-terminal query fan-out entirely. Cached after
   * the first probe; createDispatchContext marks it true, resets clear it.
   */
  hasAnyDispatchContexts(): boolean {
    if (this.hasAnyDispatchContextsCache === undefined) {
      const row = this.db.prepare('SELECT 1 FROM dispatch_contexts LIMIT 1').get()
      this.hasAnyDispatchContextsCache = row !== undefined
    }
    return this.hasAnyDispatchContextsCache
  }

  getActiveDispatchForIdentity(handle: string, paneKey?: string): DispatchContextRow | undefined {
    return this.findActiveDispatchForAssignee(handle, paneKey)
  }

  protected findActiveDispatchForAssignee(
    assigneeHandle: string,
    assigneePaneKey?: string
  ): DispatchContextRow | undefined {
    const byHandle = this.db
      .prepare(
        "SELECT * FROM dispatch_contexts WHERE assignee_handle = ? AND status IN ('pending', 'dispatched') LIMIT 1"
      )
      .get(assigneeHandle) as DispatchContextRow | undefined
    if (byHandle) {
      return byHandle
    }

    if (!assigneePaneKey) {
      return undefined
    }

    const actives = this.db
      .prepare(
        "SELECT * FROM dispatch_contexts WHERE assignee_pane_key IS NOT NULL AND status IN ('pending', 'dispatched')"
      )
      .all() as DispatchContextRow[]

    for (const row of actives) {
      if (row.assignee_pane_key && isEquivalentPaneKey(row.assignee_pane_key, assigneePaneKey)) {
        return row
      }
    }
    return undefined
  }

  getLatestDispatchForTerminal(handle: string): DispatchContextRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM dispatch_contexts WHERE assignee_handle = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get(handle) as DispatchContextRow | undefined
  }

  completeDispatch(ctxId: string): void {
    this.db
      .prepare(
        "UPDATE dispatch_contexts SET status = 'completed', completed_at = datetime('now'), capability_revoked_at = COALESCE(capability_revoked_at, datetime('now')) WHERE id = ?"
      )
      .run(ctxId)
  }

  completeActiveDispatchForTask(taskId: string): void {
    const active = this.db
      .prepare(
        "SELECT * FROM dispatch_contexts WHERE task_id = ? AND status IN ('pending', 'dispatched') ORDER BY rowid DESC LIMIT 1"
      )
      .get(taskId) as DispatchContextRow | undefined
    if (active) {
      this.completeDispatch(active.id)
    }
  }

  settleWorkerReport(params: {
    taskId: string
    dispatchId: string
    outcome: WorkerReportOutcome
    result: string
  }): WorkerReportSettlement {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const settlement = this.settleWorkerReportInTransaction(params)
      this.db.exec('COMMIT')
      return settlement
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  protected settleWorkerReportInTransaction(params: {
    taskId: string
    dispatchId: string
    outcome: WorkerReportOutcome
    result: string
  }): WorkerReportSettlement {
    const task = this.getTask(params.taskId)
    if (!task) {
      return { action: 'rejected', code: 'unknown_task', reason: `Unknown task ${params.taskId}.` }
    }
    const dispatch = this.getDispatchContextById(params.dispatchId)
    if (!dispatch) {
      return {
        action: 'rejected',
        code: 'unknown_dispatch',
        reason: `Unknown dispatch ${params.dispatchId}.`
      }
    }
    if (dispatch.task_id !== params.taskId) {
      return {
        action: 'rejected',
        code: 'task_dispatch_mismatch',
        reason: `Dispatch ${params.dispatchId} belongs to task ${dispatch.task_id}, not ${params.taskId}.`
      }
    }

    const expectedDispatchStatus = params.outcome === 'succeeded' ? 'completed' : 'failed'
    const expectedTaskStatus = params.outcome === 'succeeded' ? 'completed' : 'failed'
    if (dispatch.status === expectedDispatchStatus && task.status === expectedTaskStatus) {
      return { action: 'settled', outcome: params.outcome, duplicate: true }
    }
    if (dispatch.status !== 'dispatched' || task.status !== 'dispatched') {
      return {
        action: 'rejected',
        code: 'inactive_dispatch',
        reason: `inactive dispatch ${params.dispatchId}: it or task ${params.taskId} is already settled.`
      }
    }
    const latest = this.getDispatchContext(params.taskId)
    if (latest?.id !== params.dispatchId) {
      return {
        action: 'rejected',
        code: 'stale_dispatch',
        reason: `Dispatch ${params.dispatchId} is not the current dispatch for task ${params.taskId}.`
      }
    }

    this.db.exec('SAVEPOINT settle_worker_report')
    const dispatchUpdate = this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET status = ?, completed_at = datetime('now'),
             last_failure = CASE WHEN ? = 'failed' THEN ? ELSE last_failure END,
             capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
         WHERE id = ? AND status = 'dispatched'`
      )
      .run(expectedDispatchStatus, expectedDispatchStatus, params.result, params.dispatchId)
    const taskUpdate = this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, result = ?, completed_at = datetime('now')
         WHERE id = ? AND status = 'dispatched'`
      )
      .run(expectedTaskStatus, params.result, params.taskId)
    if (dispatchUpdate.changes !== 1 || taskUpdate.changes !== 1) {
      this.db.exec('ROLLBACK TO settle_worker_report')
      this.db.exec('RELEASE settle_worker_report')
      return {
        action: 'rejected',
        code: 'inactive_dispatch',
        reason: `Dispatch ${params.dispatchId} changed while its worker report was settling.`
      }
    }
    this.db
      .prepare(
        `UPDATE worker_dispatches
         SET state = ?, stage = 'settled', updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'ready'`
      )
      .run(params.outcome === 'succeeded' ? 'succeeded' : 'failed', params.dispatchId)
    this.closeQuestionsForDispatch(params.dispatchId)
    if (params.outcome === 'succeeded') {
      this.promoteReadyTasks(params.taskId)
    }
    this.db.exec('RELEASE settle_worker_report')
    return { action: 'settled', outcome: params.outcome, duplicate: false }
  }

  failActiveDispatchForTask(taskId: string, error: string): DispatchContextRow | undefined {
    const active = this.db
      .prepare(
        "SELECT * FROM dispatch_contexts WHERE task_id = ? AND status IN ('pending', 'dispatched') ORDER BY rowid DESC LIMIT 1"
      )
      .get(taskId) as DispatchContextRow | undefined
    return active ? this.failDispatch(active.id, error) : undefined
  }

  // Why: only bump status='dispatched' — a zombie heartbeat from a finished dispatch would mask a hung retry from the stale detector (§5.3.4).
  recordHeartbeat(dispatchId: string, at: string): void {
    this.db
      .prepare(
        "UPDATE dispatch_contexts SET last_heartbeat_at = ? WHERE id = ? AND status = 'dispatched'"
      )
      .run(at, dispatchId)
  }

  // Why: dispatched_at grace skips workers still within their first heartbeat interval; julianday() vs raw-TEXT compare avoids misflagging space-format timestamps as stale (#8452).
  getStaleDispatches(thresholdIso: string): DispatchContextRow[] {
    return this.db
      .prepare(
        `SELECT * FROM dispatch_contexts
         WHERE status = 'dispatched'
           AND dispatched_at IS NOT NULL
           AND julianday(dispatched_at) < julianday(?)
           AND (last_heartbeat_at IS NULL OR julianday(last_heartbeat_at) < julianday(?))`
      )
      .all(thresholdIso, thresholdIso) as DispatchContextRow[]
  }

  failDispatch(ctxId: string, error: string): DispatchContextRow | undefined {
    const ctx = this.db.prepare('SELECT * FROM dispatch_contexts WHERE id = ?').get(ctxId) as
      | DispatchContextRow
      | undefined
    if (!ctx) {
      return undefined
    }

    const newFailureCount = ctx.failure_count + 1
    const newStatus: DispatchStatus = newFailureCount >= 3 ? 'circuit_broken' : 'failed'

    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET status = ?, failure_count = ?, last_failure = ?,
             capability_revoked_at = COALESCE(capability_revoked_at, datetime('now'))
         WHERE id = ?`
      )
      .run(newStatus, newFailureCount, error, ctxId)

    // Why: back to 'ready' not 'pending' — 'pending' would strand it since promoteReadyTasks only runs when a dep completes.
    const taskStatus: TaskStatus = newStatus === 'circuit_broken' ? 'failed' : 'ready'
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(taskStatus, ctx.task_id)

    return this.db.prepare('SELECT * FROM dispatch_contexts WHERE id = ?').get(ctxId) as
      | DispatchContextRow
      | undefined
  }

  // ── Decision Gates ──

}

