

import type {
  LegacyAdoptionRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  generateId,
  hasLifecycleRejectionMarker} from './db-contract-helpers'




import {
  LEGACY_RUN_ID,
  LEGACY_CONTRACT_VERSION,
  CURRENT_CONTRACT_VERSION,
  MUTATION_RECEIPT_MAX_ROWS,
  MUTATION_RECEIPT_MAX_AGE_DAYS} from './db-foundation'


import { OrchestrationDatabaseSchemaMigrations } from './db-migrations-schema'
export class OrchestrationDatabaseMigrations extends OrchestrationDatabaseSchemaMigrations {
  protected migrateLegacyContractStorage(): void {
    if (!this.hasColumn('dispatch_contexts', 'contract_version')) {
      this.db.exec(
        `ALTER TABLE dispatch_contexts
         ADD COLUMN contract_version INTEGER NOT NULL DEFAULT ${CURRENT_CONTRACT_VERSION}`
      )
    }
    if (!this.hasColumn('dispatch_contexts', 'launch_token_hash')) {
      this.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN launch_token_hash TEXT')
    }
    if (!this.hasColumn('messages', 'delivery_contract')) {
      this.db.exec(
        `ALTER TABLE messages
         ADD COLUMN delivery_contract TEXT NOT NULL DEFAULT 'current_delivery'
         CHECK(delivery_contract IN ('legacy_direct', 'current_delivery', 'audit_only'))`
      )
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_delivery_contract
        ON messages(run_id, delivery_contract, to_handle, read, sequence);

      CREATE TABLE IF NOT EXISTS legacy_adoptions (
        source_run_id        TEXT PRIMARY KEY,
        adopted_run_id       TEXT UNIQUE NOT NULL,
        scheduler_state_lost INTEGER NOT NULL,
        adopted_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS legacy_compatibility_principals (
        id                  TEXT PRIMARY KEY,
        run_id              TEXT NOT NULL,
        dispatch_id         TEXT,
        role                TEXT NOT NULL CHECK(role IN ('worker', 'coordinator')),
        host_scope          TEXT NOT NULL,
        terminal_handle     TEXT NOT NULL,
        pane_key            TEXT NOT NULL,
        launch_token_hash   TEXT NOT NULL,
        process_incarnation TEXT,
        status              TEXT NOT NULL
          CHECK(status IN ('committed', 'settled', 'revoked')),
        CHECK(
          (role = 'worker' AND dispatch_id IS NOT NULL) OR
          (role = 'coordinator' AND dispatch_id IS NULL)
        ),
        UNIQUE(role, run_id, dispatch_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_principal_coordinator
        ON legacy_compatibility_principals(run_id)
        WHERE role = 'coordinator';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_principal_dispatch
        ON legacy_compatibility_principals(dispatch_id)
        WHERE role = 'worker';

      CREATE TABLE IF NOT EXISTS legacy_operation_receipts (
        principal_id   TEXT NOT NULL,
        operation_key  TEXT NOT NULL,
        method         TEXT NOT NULL,
        payload_hash   TEXT NOT NULL,
        effect_id      TEXT NOT NULL,
        response_json  TEXT NOT NULL,
        completed_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(principal_id, operation_key)
      );

      CREATE TABLE IF NOT EXISTS legacy_mail_receipts (
        principal_id    TEXT NOT NULL,
        message_id      TEXT NOT NULL,
        acknowledged_at TEXT,
        PRIMARY KEY(principal_id, message_id)
      );
    `)

    this.db
      .prepare(
        `UPDATE dispatch_contexts
         SET contract_version = ?
         WHERE run_id = ? AND capability_hash IS NULL`
      )
      .run(LEGACY_CONTRACT_VERSION, LEGACY_RUN_ID)
    this.classifyLegacyMessageContracts(LEGACY_RUN_ID, false)
    this.ensureLegacySchedulerLossColumn()
    this.adoptLegacyRunIfNeeded()
  }

  protected classifyLegacyMessageContracts(runId: string, adoptedOnly: boolean): void {
    const contractFilter = adoptedOnly
      ? " AND delivery_contract IN ('legacy_direct', 'audit_only')"
      : ''
    this.db
      .prepare(
        `UPDATE messages SET delivery_contract = 'legacy_direct'
         WHERE run_id = ?${contractFilter}`
      )
      .run(runId)
    const rows = this.db
      .prepare(`SELECT id, payload FROM messages WHERE run_id = ?${contractFilter}`)
      .all(runId) as { id: string; payload: string | null }[]
    const markAuditOnly = this.db.prepare(
      "UPDATE messages SET delivery_contract = 'audit_only' WHERE id = ? AND run_id = ?"
    )
    for (const row of rows) {
      if (hasLifecycleRejectionMarker(row.payload)) {
        markAuditOnly.run(row.id, runId)
      }
    }
  }

  protected migrateLegacySchedulerLossProvenance(): void {
    this.ensureLegacySchedulerLossColumn()
    this.adoptLegacyRunIfNeeded()
    const adoption = this.getLegacyAdoption()
    if (adoption) {
      this.classifyLegacyMessageContracts(adoption.adopted_run_id, true)
    }
  }

  protected ensureLegacySchedulerLossColumn(): void {
    if (!this.hasColumn('coordinator_runs', 'scheduler_lost_at')) {
      this.db.exec('ALTER TABLE coordinator_runs ADD COLUMN scheduler_lost_at TEXT')
    }
  }

  protected backfillLegacyQuestionThreads(): void {
    const messages = this.db
      .prepare(
        `SELECT id, run_id, from_handle, to_handle, payload, created_at, sequence
         FROM messages
         WHERE type = 'decision_gate'
           AND delivery_contract IN ('legacy_direct', 'current_delivery')
         ORDER BY sequence`
      )
      .all() as {
      id: string
      run_id: string
      from_handle: string
      to_handle: string
      payload: string | null
      created_at: string
      sequence: number
    }[]
    const getDispatch = this.db.prepare(
      'SELECT id, run_id, task_id FROM dispatch_contexts WHERE id = ? AND contract_version = ?'
    )
    const getDispatchesForLegacyQuestion = this.db.prepare(
      `SELECT id, run_id, task_id
       FROM dispatch_contexts
       WHERE contract_version = ? AND assignee_handle = ?
         AND (? IS NULL OR task_id = ?)
         AND created_at <= ?
         AND (completed_at IS NULL OR completed_at >= ?)
       ORDER BY rowid
       LIMIT 2`
    )
    const getAnswer = this.db.prepare(
      `SELECT id, body, created_at
       FROM messages
       WHERE run_id = ?
         AND thread_id = ?
         AND delivery_contract IN ('legacy_direct', 'current_delivery')
         AND from_handle = ?
         AND to_handle IN (?, ?)
         AND sequence > ?
       ORDER BY sequence
       LIMIT 1`
    )
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO question_threads (
         message_id, run_id, dispatch_id, asker_handle, status,
         answer_message_id, answer_body, created_at, answered_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const message of messages) {
      let payload: { taskId?: unknown; dispatchId?: unknown }
      try {
        payload = JSON.parse(message.payload ?? '{}') as {
          taskId?: unknown
          dispatchId?: unknown
        }
      } catch {
        continue
      }
      const inferredDispatches =
        typeof payload.dispatchId === 'string'
          ? []
          : (getDispatchesForLegacyQuestion.all(
              LEGACY_CONTRACT_VERSION,
              message.from_handle,
              typeof payload.taskId === 'string' ? payload.taskId : null,
              typeof payload.taskId === 'string' ? payload.taskId : null,
              message.created_at,
              message.created_at
            ) as { id: string; run_id: string; task_id: string }[])
      const dispatch =
        typeof payload.dispatchId === 'string'
          ? (getDispatch.get(payload.dispatchId, LEGACY_CONTRACT_VERSION) as
              | { id: string; run_id: string; task_id: string }
              | undefined)
          : inferredDispatches.length === 1
            ? inferredDispatches[0]
            : undefined
      if (
        !dispatch ||
        (typeof payload.taskId === 'string' && payload.taskId !== dispatch.task_id) ||
        (message.run_id !== LEGACY_RUN_ID && message.run_id !== dispatch.run_id)
      ) {
        continue
      }
      const answer = getAnswer.get(
        message.run_id,
        message.id,
        message.to_handle,
        message.from_handle,
        `dispatch:${dispatch.id}`,
        message.sequence
      ) as { id: string; body: string; created_at: string } | undefined
      insert.run(
        message.id,
        dispatch.run_id,
        dispatch.id,
        message.from_handle,
        answer ? 'answered' : 'pending',
        answer?.id ?? null,
        answer?.body ?? null,
        message.created_at,
        answer?.created_at ?? null
      )
    }
    const adoption = this.getLegacyAdoption()
    const coordinator = adoption
      ? this.getLegacyCoordinatorPrincipal(adoption.adopted_run_id)
      : undefined
    if (adoption && coordinator?.status === 'revoked') {
      this.promoteLegacyCoordinatorMailForTakeover(
        adoption.adopted_run_id,
        coordinator.terminal_handle
      )
    }
  }

  protected adoptLegacyRunIfNeeded(): void {
    const existing = this.db
      .prepare('SELECT * FROM legacy_adoptions WHERE source_run_id = ?')
      .get(LEGACY_RUN_ID) as LegacyAdoptionRow | undefined
    const hasGraph = this.db
      .prepare(
        `SELECT 1
         WHERE EXISTS(SELECT 1 FROM tasks WHERE run_id = ?)
            OR EXISTS(SELECT 1 FROM dispatch_contexts WHERE run_id = ?)
            OR EXISTS(SELECT 1 FROM decision_gates WHERE run_id = ?)
            OR EXISTS(SELECT 1 FROM messages WHERE run_id = ?)
            OR EXISTS(SELECT 1 FROM question_threads WHERE run_id = ?)
            OR EXISTS(SELECT 1 FROM deliveries WHERE run_id = ?)`
      )
      .get(LEGACY_RUN_ID, LEGACY_RUN_ID, LEGACY_RUN_ID, LEGACY_RUN_ID, LEGACY_RUN_ID, LEGACY_RUN_ID)
    if (!existing && !hasGraph) {
      return
    }

    const adoptedRunId = existing?.adopted_run_id ?? generateId('run')
    this.db
      .prepare(
        `INSERT OR IGNORE INTO runs (
           id, objective, home_database, consumer_generation, legacy
         ) VALUES (?, ?, 'this_database', 0, 0)`
      )
      .run(adoptedRunId, 'Recovered orchestration work from a contract update')
    this.db
      .prepare(
        `INSERT OR IGNORE INTO legacy_adoptions (
           source_run_id, adopted_run_id, scheduler_state_lost
         ) VALUES (?, ?, 1)`
      )
      .run(LEGACY_RUN_ID, adoptedRunId)
    this.db
      .prepare(
        `UPDATE coordinator_runs
         SET status = 'failed',
             completed_at = COALESCE(
               completed_at,
               (SELECT adopted_at FROM legacy_adoptions WHERE source_run_id = ?)
             ),
             scheduler_lost_at = (
               SELECT adopted_at FROM legacy_adoptions WHERE source_run_id = ?
             )
         WHERE status = 'running'
           AND julianday(created_at) <= julianday((
             SELECT adopted_at FROM legacy_adoptions WHERE source_run_id = ?
           ))`
      )
      .run(LEGACY_RUN_ID, LEGACY_RUN_ID, LEGACY_RUN_ID)

    this.db
      .prepare(
        `UPDATE deliveries SET status = 'fenced'
         WHERE run_id = ? AND status = 'outstanding'`
      )
      .run(LEGACY_RUN_ID)
    for (const table of [
      'tasks',
      'dispatch_contexts',
      'decision_gates',
      'messages',
      'question_threads',
      'deliveries'
    ]) {
      this.db
        .prepare(`UPDATE ${table} SET run_id = ? WHERE run_id = ?`)
        .run(adoptedRunId, LEGACY_RUN_ID)
    }
    this.db
      .prepare(
        `UPDATE runs
         SET objective = 'Legacy orchestration state (adopted; inspect only)',
             coordinator_handle = NULL, coordinator_pane_key = NULL,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(LEGACY_RUN_ID)

    const mismatch = this.db
      .prepare(
        `WITH migration_runs(run_id) AS (VALUES (?), (?))
         SELECT 1
         WHERE EXISTS(
           SELECT 1 FROM dispatch_contexts d
           INNER JOIN tasks t ON t.id = d.task_id
           WHERE d.run_id <> t.run_id
             AND (
               d.run_id IN (SELECT run_id FROM migration_runs)
               OR t.run_id IN (SELECT run_id FROM migration_runs)
             )
         )
            OR EXISTS(
              SELECT 1 FROM decision_gates g
              INNER JOIN tasks t ON t.id = g.task_id
              WHERE g.run_id <> t.run_id
                AND (
                  g.run_id IN (SELECT run_id FROM migration_runs)
                  OR t.run_id IN (SELECT run_id FROM migration_runs)
                )
            )
            OR EXISTS(
              SELECT 1 FROM question_threads q
              INNER JOIN dispatch_contexts d ON d.id = q.dispatch_id
              WHERE q.run_id <> d.run_id
                AND (
                  q.run_id IN (SELECT run_id FROM migration_runs)
                  OR d.run_id IN (SELECT run_id FROM migration_runs)
                )
            )
            OR EXISTS(
              SELECT 1 FROM deliveries d
              INNER JOIN json_each(d.message_ids) ids
              INNER JOIN messages m ON m.id = ids.value
              WHERE d.run_id <> m.run_id
                AND (
                  d.run_id IN (SELECT run_id FROM migration_runs)
                  OR m.run_id IN (SELECT run_id FROM migration_runs)
                )
            )`
      )
      .get(LEGACY_RUN_ID, adoptedRunId)
    if (mismatch) {
      throw new Error('Legacy orchestration adoption produced inconsistent Run ownership.')
    }
  }

  protected hasColumn(table: string, column: string): boolean {
    const rows = this.db.pragma(`table_info(${table})`) as { name: string }[]
    return rows.some((r) => r.name === column)
  }

  protected createUndeliveredInboxIndexIfPossible(): void {
    if (!this.hasColumn('messages', 'delivered_at')) {
      return
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_undelivered_inbox
        ON messages(to_handle, read, delivered_at, sequence)
    `)
  }

  // Why: sqlite_master holds the table's CREATE SQL incl. the CHECK — cheapest reliable probe for whether it already allows 'heartbeat'.
  protected messagesTypeCheckAllowsHeartbeat(): boolean {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .get() as { sql: string } | undefined
    return !!row && row.sql.includes("'heartbeat'")
  }

  protected messagesTypeCheckAllowsQuestion(): boolean {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .get() as { sql: string } | undefined
    return !!row && row.sql.includes("'question'")
  }

  // ── Durable mutation receipts ──

  protected ensureMutationReceiptCapacity(): void {
    this.db
      .prepare(
        `DELETE FROM mutation_receipts
         WHERE state = 'completed'
           AND updated_at < datetime('now', ?)`
      )
      .run(`-${MUTATION_RECEIPT_MAX_AGE_DAYS} days`)

    const row = this.db.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as {
      count: number
    }
    const completedToRemove = row.count - MUTATION_RECEIPT_MAX_ROWS + 1
    if (completedToRemove > 0) {
      this.db
        .prepare(
          `DELETE FROM mutation_receipts
           WHERE rowid IN (
             SELECT rowid FROM mutation_receipts
             WHERE state = 'completed'
             ORDER BY updated_at ASC, rowid ASC
             LIMIT ?
           )`
        )
        .run(completedToRemove)
    }

    const retained = this.db.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as {
      count: number
    }
    if (retained.count >= MUTATION_RECEIPT_MAX_ROWS) {
      throw new OrchestrationError(
        'mutation_ledger_full',
        'The durable mutation ledger is full of unresolved operations. Resolve or inspect them before starting another mutation.'
      )
    }
  }

}
