

import type {
  GateStatus,
  CoordinatorStatus,
  DecisionGateRow,
  CoordinatorRun} from './types'



import {
  generateId} from './db-contract-helpers'




import {
  LEGACY_RUN_ID} from './db-foundation'
import { OrchestrationDatabaseDispatchContext } from './db-dispatch-context'

export class OrchestrationDatabaseCoordinator extends OrchestrationDatabaseDispatchContext {
  createGate(gate: { taskId: string; question: string; options?: string[] }): DecisionGateRow {
    const id = generateId('gate')
    const optionsJson = JSON.stringify(gate.options ?? [])
    this.db
      .prepare(
        'INSERT INTO decision_gates (id, run_id, task_id, question, options) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        id,
        this.getTask(gate.taskId)?.run_id ?? LEGACY_RUN_ID,
        gate.taskId,
        gate.question,
        optionsJson
      )

    this.completeActiveDispatchForTask(gate.taskId)
    this.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(gate.taskId)

    return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as DecisionGateRow
  }

  resolveGate(gateId: string, resolution: string): DecisionGateRow | undefined {
    const gate = this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
      | DecisionGateRow
      | undefined
    if (!gate) {
      return undefined
    }

    this.db
      .prepare(
        "UPDATE decision_gates SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?"
      )
      .run(resolution, gateId)

    // Why: set to 'ready' (not the previous status) so the coordinator re-dispatches the worker with the resolution context.
    this.db.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(gate.task_id)

    return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
      | DecisionGateRow
      | undefined
  }

  timeoutGate(gateId: string): DecisionGateRow | undefined {
    this.db
      .prepare(
        "UPDATE decision_gates SET status = 'timeout', resolved_at = datetime('now') WHERE id = ?"
      )
      .run(gateId)
    return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(gateId) as
      | DecisionGateRow
      | undefined
  }

  listGates(filter?: { taskId?: string; status?: GateStatus }): DecisionGateRow[] {
    if (filter?.taskId && filter?.status) {
      return this.db
        .prepare(
          'SELECT * FROM decision_gates WHERE task_id = ? AND status = ? ORDER BY created_at'
        )
        .all(filter.taskId, filter.status) as DecisionGateRow[]
    }
    if (filter?.taskId) {
      return this.db
        .prepare('SELECT * FROM decision_gates WHERE task_id = ? ORDER BY created_at')
        .all(filter.taskId) as DecisionGateRow[]
    }
    if (filter?.status) {
      return this.db
        .prepare('SELECT * FROM decision_gates WHERE status = ? ORDER BY created_at')
        .all(filter.status) as DecisionGateRow[]
    }
    return this.db
      .prepare('SELECT * FROM decision_gates ORDER BY created_at')
      .all() as DecisionGateRow[]
  }

  getGate(id: string): DecisionGateRow | undefined {
    return this.db.prepare('SELECT * FROM decision_gates WHERE id = ?').get(id) as
      | DecisionGateRow
      | undefined
  }

  // ── Coordinator Runs ──

  createCoordinatorRun(run: {
    spec: string
    coordinatorHandle: string
    pollIntervalMs?: number
  }): CoordinatorRun {
    const id = generateId('run')
    this.db
      .prepare(
        "INSERT INTO coordinator_runs (id, spec, status, coordinator_handle, poll_interval_ms) VALUES (?, ?, 'running', ?, ?)"
      )
      .run(id, run.spec, run.coordinatorHandle, run.pollIntervalMs ?? 2000)
    return this.db.prepare('SELECT * FROM coordinator_runs WHERE id = ?').get(id) as CoordinatorRun
  }

  getCoordinatorRun(id: string): CoordinatorRun | undefined {
    return this.db.prepare('SELECT * FROM coordinator_runs WHERE id = ?').get(id) as
      | CoordinatorRun
      | undefined
  }

  updateCoordinatorRun(id: string, status: CoordinatorStatus): CoordinatorRun | undefined {
    const completedAt =
      status === 'completed' || status === 'failed' ? new Date().toISOString() : null
    this.db
      .prepare(
        'UPDATE coordinator_runs SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?'
      )
      .run(status, completedAt, id)
    return this.getCoordinatorRun(id)
  }

  getActiveCoordinatorRun(): CoordinatorRun | undefined {
    return this.db
      .prepare(
        "SELECT * FROM coordinator_runs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1"
      )
      .get() as CoordinatorRun | undefined
  }

  // ── Queries for Coordinator ──

  getIdleTerminals(excludeHandles: string[] = []): string[] {
    const active = this.db
      .prepare(
        "SELECT DISTINCT assignee_handle FROM dispatch_contexts WHERE status IN ('pending', 'dispatched')"
      )
      .all() as { assignee_handle: string }[]
    const busyHandles = new Set(active.map((r) => r.assignee_handle))
    for (const h of excludeHandles) {
      busyHandles.add(h)
    }
    // Return handles from message history that aren't busy
    const allHandles = this.db
      .prepare(
        'SELECT DISTINCT to_handle FROM messages UNION SELECT DISTINCT from_handle FROM messages'
      )
      .all() as { to_handle: string }[]
    return [...new Set(allHandles.map((r) => r.to_handle))].filter((h) => !busyHandles.has(h))
  }

  // ── Lifecycle ──

  protected runResetTransaction(statements: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec(statements)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  resetAll(): void {
    // Why: retain mutation receipts so a lost reset response cannot replay as a new mutation.
    this.runResetTransaction(`
      DELETE FROM coordinator_runs;
      DELETE FROM decision_gates;
      DELETE FROM remote_questions;
      DELETE FROM question_threads;
      DELETE FROM deliveries;
      DELETE FROM legacy_mail_receipts;
      DELETE FROM legacy_operation_receipts;
      DELETE FROM legacy_compatibility_principals;
      DELETE FROM legacy_adoptions;
      DELETE FROM federation_relay_items;
      DELETE FROM remote_dispatch_attachments;
      DELETE FROM federated_dispatches;
      DELETE FROM worker_dispatches;
      DELETE FROM dispatch_contexts;
      DELETE FROM tasks;
      DELETE FROM messages;
      DELETE FROM runs;
      INSERT INTO runs (id, objective, home_database, consumer_generation, legacy)
        VALUES ('${LEGACY_RUN_ID}', 'Legacy orchestration state (inspect only)', 'this_database', 0, 1);
    `)
    this.hasAnyDispatchContextsCache = undefined
  }

  resetTasks(): void {
    this.runResetTransaction(`
      DELETE FROM coordinator_runs;
      DELETE FROM decision_gates;
      DELETE FROM remote_questions;
      DELETE FROM question_threads;
      DELETE FROM legacy_mail_receipts;
      DELETE FROM legacy_operation_receipts;
      DELETE FROM legacy_compatibility_principals;
      DELETE FROM legacy_adoptions;
      DELETE FROM federation_relay_items;
      DELETE FROM remote_dispatch_attachments;
      DELETE FROM federated_dispatches;
      DELETE FROM worker_dispatches;
      DELETE FROM dispatch_contexts;
      DELETE FROM tasks;
    `)
    this.hasAnyDispatchContextsCache = undefined
  }

  resetMessages(): void {
    // Why: relay rows carry contiguous cross-server cursors, not just inbox history.
    this.runResetTransaction(`
      DELETE FROM legacy_mail_receipts;
      DELETE FROM question_threads;
      DELETE FROM deliveries;
      DELETE FROM messages;
    `)
  }

  close(): void {
    this.db.close()
  }
}

