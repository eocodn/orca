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
import { OrchestrationDatabaseFoundation } from './db-foundation'

export class OrchestrationDatabaseMigrations extends OrchestrationDatabaseFoundation {
  protected migrate(): void {
    const storedVersion = this.db.pragma('user_version', { simple: true }) as number
    const current = resolveOrchestrationMigrationStartVersion(
      this.db,
      storedVersion,
      SCHEMA_VERSION
    )
    if (current >= SCHEMA_VERSION) {
      return
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      // v1 → v2: SQLite can't ALTER a CHECK, so rebuild messages to allow 'heartbeat'; fold in v3's delivered_at to skip a second rebuild.
      if (current < 2) {
        if (!this.hasColumn('dispatch_contexts', 'last_heartbeat_at')) {
          this.db.exec(`ALTER TABLE dispatch_contexts ADD COLUMN last_heartbeat_at TEXT`)
        }

        if (!this.messagesTypeCheckAllowsHeartbeat()) {
          // Why: recreate indexes here — DROP TABLE drops them; createTables re-runs only next startup, so skipping full-scans until restart.
          this.db.exec(`
            CREATE TABLE messages_new (
              id            TEXT NOT NULL,
              from_handle   TEXT NOT NULL,
              to_handle     TEXT NOT NULL,
              subject       TEXT NOT NULL,
              body          TEXT NOT NULL DEFAULT '',
              type          TEXT NOT NULL DEFAULT 'status'
                CHECK(type IN (
                  'status', 'dispatch', 'worker_done', 'merge_ready',
                  'escalation', 'handoff', 'decision_gate', 'question', 'heartbeat'
                )),
              priority      TEXT NOT NULL DEFAULT 'normal'
                CHECK(priority IN ('normal', 'high', 'urgent')),
              thread_id     TEXT,
              payload       TEXT,
              read          INTEGER NOT NULL DEFAULT 0,
              sequence      INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at    TEXT NOT NULL DEFAULT (datetime('now')),
              delivered_at  TEXT
            );
            INSERT INTO messages_new (
              id, from_handle, to_handle, subject, body, type, priority,
              thread_id, payload, read, sequence, created_at
            )
            SELECT
              id, from_handle, to_handle, subject, body, type, priority,
              thread_id, payload, read, sequence, created_at
            FROM messages;
            DROP TABLE messages;
            ALTER TABLE messages_new RENAME TO messages;

            CREATE UNIQUE INDEX idx_messages_id ON messages(id);
            CREATE INDEX idx_inbox ON messages(to_handle, read);
            CREATE INDEX idx_messages_undelivered_inbox
              ON messages(to_handle, read, delivered_at, sequence);
            CREATE INDEX idx_thread ON messages(thread_id);
          `)
        }
      }

      // v2 → v3: add messages.delivered_at. hasColumn probe skips DBs that already got it via the v1→v2 rebuild (else a dup-column error aborts the txn).
      if (current < 3) {
        if (!this.hasColumn('messages', 'delivered_at')) {
          this.db.exec(`ALTER TABLE messages ADD COLUMN delivered_at TEXT`)
        }
      }
      if (current < 4) {
        if (!this.hasColumn('tasks', 'created_by_terminal_handle')) {
          this.db.exec(`ALTER TABLE tasks ADD COLUMN created_by_terminal_handle TEXT`)
        }
      }
      if (current < 5) {
        if (!this.hasColumn('tasks', 'task_title')) {
          this.db.exec(`ALTER TABLE tasks ADD COLUMN task_title TEXT`)
        }
        if (!this.hasColumn('tasks', 'display_name')) {
          this.db.exec(`ALTER TABLE tasks ADD COLUMN display_name TEXT`)
        }
      }
      if (current < 6) {
        if (!this.hasColumn('dispatch_contexts', 'assignee_pane_key')) {
          this.db.exec(`ALTER TABLE dispatch_contexts ADD COLUMN assignee_pane_key TEXT`)
        }
        if (!this.hasColumn('messages', 'sender_pane_key')) {
          this.db.exec(`ALTER TABLE messages ADD COLUMN sender_pane_key TEXT`)
        }
      }
      if (current < 7) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO runs (
               id, objective, home_database, consumer_generation, legacy
             ) VALUES (?, ?, 'this_database', 0, 1)`
          )
          .run(LEGACY_RUN_ID, 'Legacy orchestration state (inspect only)')
        for (const table of ['messages', 'tasks', 'dispatch_contexts', 'decision_gates']) {
          if (!this.hasColumn(table, 'run_id')) {
            this.db.exec(
              `ALTER TABLE ${table} ADD COLUMN run_id TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}'`
            )
          }
        }
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_messages_run_sequence ON messages(run_id, sequence);
          CREATE INDEX IF NOT EXISTS idx_tasks_run_status ON tasks(run_id, status);
          CREATE INDEX IF NOT EXISTS idx_dispatch_run_status ON dispatch_contexts(run_id, status);
          CREATE INDEX IF NOT EXISTS idx_gates_run_status ON decision_gates(run_id, status);
          CREATE INDEX IF NOT EXISTS idx_runs_coordinator_pane ON runs(coordinator_pane_key);
        `)
      }
      if (current < 8) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS deliveries (
            id                    TEXT PRIMARY KEY,
            run_id                TEXT NOT NULL,
            consumer_generation   INTEGER NOT NULL,
            message_ids           TEXT NOT NULL,
            status                TEXT NOT NULL DEFAULT 'outstanding'
              CHECK(status IN ('outstanding', 'acknowledged', 'fenced')),
            created_at            TEXT NOT NULL DEFAULT (datetime('now')),
            acknowledged_at       TEXT
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_one_outstanding
            ON deliveries(run_id) WHERE status = 'outstanding';
      CREATE INDEX IF NOT EXISTS idx_deliveries_run_created
        ON deliveries(run_id, created_at);

      CREATE TABLE IF NOT EXISTS question_threads (
        message_id                TEXT PRIMARY KEY,
        run_id                    TEXT NOT NULL,
        dispatch_id               TEXT NOT NULL,
        asker_handle              TEXT NOT NULL,
        status                    TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'answered', 'closed')),
        answer_message_id         TEXT,
        answer_body               TEXT,
        answered_by_generation    INTEGER,
        created_at                TEXT NOT NULL DEFAULT (datetime('now')),
        answered_at               TEXT,
        closed_at                 TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_questions_dispatch_status
        ON question_threads(dispatch_id, status);
        `)
      }
      if (current < 9 && !this.messagesTypeCheckAllowsQuestion()) {
        this.db.exec(`
          CREATE TABLE messages_new (
            id              TEXT NOT NULL,
            run_id          TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}',
            from_handle     TEXT NOT NULL,
            to_handle       TEXT NOT NULL,
            subject         TEXT NOT NULL,
            body            TEXT NOT NULL DEFAULT '',
            type            TEXT NOT NULL DEFAULT 'status'
              CHECK(type IN (
                'status', 'dispatch', 'worker_done', 'merge_ready',
                'escalation', 'handoff', 'decision_gate', 'question', 'heartbeat'
              )),
            priority        TEXT NOT NULL DEFAULT 'normal'
              CHECK(priority IN ('normal', 'high', 'urgent')),
            thread_id       TEXT,
            payload         TEXT,
            read            INTEGER NOT NULL DEFAULT 0,
            sequence        INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            delivered_at    TEXT,
            sender_pane_key TEXT
          );
          INSERT INTO messages_new (
            id, run_id, from_handle, to_handle, subject, body, type, priority,
            thread_id, payload, read, sequence, created_at, delivered_at, sender_pane_key
          )
          SELECT
            id, run_id, from_handle, to_handle, subject, body, type, priority,
            thread_id, payload, read, sequence, created_at, delivered_at, sender_pane_key
          FROM messages;
          DROP TABLE messages;
          ALTER TABLE messages_new RENAME TO messages;

          CREATE UNIQUE INDEX idx_messages_id ON messages(id);
          CREATE INDEX idx_inbox ON messages(to_handle, read);
          CREATE INDEX idx_thread ON messages(thread_id);
          CREATE INDEX idx_messages_run_sequence ON messages(run_id, sequence);
          CREATE INDEX idx_messages_undelivered_inbox
            ON messages(to_handle, read, delivered_at, sequence);
        `)
      }
      if (current < 10) {
        if (!this.hasColumn('dispatch_contexts', 'capability_hash')) {
          this.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN capability_hash TEXT')
        }
        if (!this.hasColumn('dispatch_contexts', 'process_incarnation')) {
          this.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN process_incarnation TEXT')
        }
        if (!this.hasColumn('dispatch_contexts', 'capability_revoked_at')) {
          this.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN capability_revoked_at TEXT')
        }
      }
      if (current < 11) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS mutation_receipts (
            caller_fingerprint  TEXT NOT NULL,
            request_id          TEXT NOT NULL,
            method              TEXT NOT NULL,
            payload_hash        TEXT NOT NULL,
            state               TEXT NOT NULL DEFAULT 'pending'
              CHECK(state IN ('pending', 'completed')),
            receipt             TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (caller_fingerprint, request_id)
          );
        `)
      }
      if (current < 12) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS worker_dispatches (
            dispatch_id            TEXT PRIMARY KEY,
            runtime_epoch          TEXT,
            state                  TEXT NOT NULL DEFAULT 'starting'
              CHECK(state IN (
                'starting', 'ready', 'start_unknown', 'failed', 'succeeded',
                'stopping', 'stop_unknown', 'stopped', 'abandoned'
              )),
            stage                  TEXT NOT NULL DEFAULT 'accepted',
            worktree_id            TEXT,
            agent_terminal_handle  TEXT,
            setup_state            TEXT NOT NULL DEFAULT 'not_applicable',
            effects                TEXT NOT NULL DEFAULT '[]',
            residual_resources     TEXT NOT NULL DEFAULT '[]',
            start_options          TEXT NOT NULL DEFAULT '{}',
            last_error             TEXT,
            created_at             TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      }
      if (current < 13 && !this.hasColumn('worker_dispatches', 'runtime_epoch')) {
        this.db.exec('ALTER TABLE worker_dispatches ADD COLUMN runtime_epoch TEXT')
      }
      if (current < 14) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS federated_dispatches (
            dispatch_id             TEXT PRIMARY KEY,
            environment_id          TEXT NOT NULL,
            environment_name        TEXT NOT NULL,
            peer_fingerprint        TEXT NOT NULL,
            remote_runtime_epoch    TEXT,
            protocol_version        INTEGER NOT NULL DEFAULT 1,
            remote_worktree_id      TEXT,
            remote_terminal_handle  TEXT,
            to_home_imported_sequence INTEGER NOT NULL DEFAULT 0,
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
          );
          CREATE TABLE IF NOT EXISTS remote_dispatch_attachments (
            dispatch_id             TEXT PRIMARY KEY,
            task_id                 TEXT NOT NULL,
            home_peer_fingerprint   TEXT NOT NULL,
            protocol_version        INTEGER NOT NULL DEFAULT 1,
            runtime_epoch           TEXT NOT NULL,
            capability_hash         TEXT,
            pane_key                TEXT,
            process_incarnation     TEXT,
            state                   TEXT NOT NULL DEFAULT 'starting'
              CHECK(state IN (
                'starting', 'ready', 'start_unknown', 'failed', 'succeeded',
                'stopping', 'stop_unknown', 'stopped', 'abandoned'
              )),
            stage                   TEXT NOT NULL DEFAULT 'accepted',
            worktree_id             TEXT,
            terminal_handle         TEXT,
            setup_state             TEXT NOT NULL DEFAULT 'not_applicable',
            effects                 TEXT NOT NULL DEFAULT '[]',
            residual_resources      TEXT NOT NULL DEFAULT '[]',
            to_worker_imported_sequence INTEGER NOT NULL DEFAULT 0,
            last_error              TEXT,
            created_at              TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
      }
      if (current < 15) {
        if (!this.hasColumn('federated_dispatches', 'to_home_imported_sequence')) {
          this.db.exec(
            'ALTER TABLE federated_dispatches ADD COLUMN to_home_imported_sequence INTEGER NOT NULL DEFAULT 0'
          )
        }
        if (!this.hasColumn('remote_dispatch_attachments', 'to_worker_imported_sequence')) {
          this.db.exec(
            'ALTER TABLE remote_dispatch_attachments ADD COLUMN to_worker_imported_sequence INTEGER NOT NULL DEFAULT 0'
          )
        }
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS federation_relay_items (
            dispatch_id   TEXT NOT NULL,
            direction     TEXT NOT NULL CHECK(direction IN ('to_home', 'to_worker')),
            sequence      INTEGER NOT NULL,
            message_id    TEXT NOT NULL,
            kind          TEXT NOT NULL,
            payload       TEXT NOT NULL,
            byte_count    INTEGER NOT NULL,
            acked_at      TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (dispatch_id, direction, sequence),
            UNIQUE (dispatch_id, direction, message_id)
          );
          CREATE INDEX IF NOT EXISTS idx_federation_relay_pending
            ON federation_relay_items(dispatch_id, direction, acked_at, sequence);
        `)
      }
      if (current < 16) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS remote_questions (
            message_id        TEXT PRIMARY KEY,
            dispatch_id       TEXT NOT NULL,
            status            TEXT NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending', 'answered', 'closed')),
            answer_message_id TEXT,
            answer_body       TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            answered_at       TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_remote_questions_dispatch_status
            ON remote_questions(dispatch_id, status);
        `)
      }
      if (current < 17 && !this.hasColumn('remote_dispatch_attachments', 'protocol_version')) {
        this.db.exec(
          'ALTER TABLE remote_dispatch_attachments ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1'
        )
      }
      if (current < 19) {
        this.migrateLegacyContractStorage()
      }
      if (current < 20) {
        this.backfillLegacyQuestionThreads()
      }
      if (current < 21) {
        this.migrateLegacySchedulerLossProvenance()
      }
      if (current < 22) {
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_dispatch_assignee_handle
            ON dispatch_contexts(assignee_handle);
        `)
      }
      this.createUndeliveredInboxIndexIfPossible()

      this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

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

