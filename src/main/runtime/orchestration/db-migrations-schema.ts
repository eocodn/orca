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

export abstract class OrchestrationDatabaseSchemaMigrations extends OrchestrationDatabaseFoundation {
  protected abstract hasColumn(table: string, column: string): boolean
  protected abstract migrateLegacyContractStorage(): void
  protected abstract backfillLegacyQuestionThreads(): void
  protected abstract migrateLegacySchedulerLossProvenance(): void
  protected abstract createUndeliveredInboxIndexIfPossible(): void
  protected abstract messagesTypeCheckAllowsHeartbeat(): boolean
  protected abstract messagesTypeCheckAllowsQuestion(): boolean

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


}
