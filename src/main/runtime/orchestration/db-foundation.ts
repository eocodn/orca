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

export type {
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
  WorkerDispatchState
}


export const LEGACY_RUN_ID = ORCHESTRATION_LEGACY_RUN_ID

export const LEGACY_CONTRACT_VERSION = 0
export const CURRENT_CONTRACT_VERSION = ORCHESTRATION_CONTRACT_VERSION

export const MUTATION_RECEIPT_MAX_ROWS = 10_000
export const MUTATION_RECEIPT_MAX_AGE_DAYS = 30

export type RunListPage = {
  runs: RunRow[]
  nextCursor: string | null
}

// Schema versions: v2 'heartbeat'+last_heartbeat_at, v3 delivered_at, v4 task-creator terminal, v5 task_title/display_name, v6 pane identity, v7 lightweight Runs, v8 crash-safe Run deliveries, v9 durable question threads, v10 Dispatch capabilities, v11 durable mutation receipts, v12 composed worker state, v18 post-v6 version-skew repair, v19 adopted legacy Runs and compatibility receipts, v20 legacy question backfill, v21 legacy scheduler-loss provenance, v22 dispatch assignee lookup.
export const SCHEMA_VERSION = 22

function hardenOrchestrationDatabaseFiles(dbPath: string | ':memory:'): void {
  if (dbPath === ':memory:' || process.platform === 'win32') {
    // Why: Windows protects these files through Orca's current-user-only userData DACL; POSIX mode bits are inert there.
    return
  }
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) {
      chmodSync(path, 0o600)
    }
  }
}

export class OrchestrationDatabaseFoundation {
  protected db: Database.Database

  // Why: the orchestration DB is created lazily for ALL users, but only the
  // small minority who dispatch work ever have dispatch_contexts rows. The
  // renderer graph publish rebuilds orchestration context on every 16ms tick
  // (buildAgentOrchestrationByPaneKey), issuing 2 queries per terminal. Cache
  // emptiness so the non-orchestration majority short-circuits the whole
  // per-terminal fan-out. Only createDispatchContext flips this false→true.
  protected hasAnyDispatchContextsCache: boolean | undefined

  constructor(dbPath: string | ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.createTables()
    this.migrate()
    hardenOrchestrationDatabaseFiles(dbPath)
  }

  protected createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id                    TEXT PRIMARY KEY,
        objective             TEXT NOT NULL,
        home_database         TEXT NOT NULL DEFAULT 'this_database',
        coordinator_handle    TEXT,
        coordinator_pane_key  TEXT,
        consumer_generation   INTEGER NOT NULL DEFAULT 0,
        legacy                INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id            TEXT NOT NULL,
        run_id        TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}',
        delivery_contract TEXT NOT NULL DEFAULT 'current_delivery'
          CHECK(delivery_contract IN ('legacy_direct', 'current_delivery', 'audit_only')),
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
        delivered_at  TEXT,
        sender_pane_key TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
      CREATE INDEX IF NOT EXISTS idx_inbox ON messages(to_handle, read);
      CREATE INDEX IF NOT EXISTS idx_thread ON messages(thread_id);

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

      CREATE TABLE IF NOT EXISTS tasks (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}',
        parent_id     TEXT,
        created_by_terminal_handle TEXT,
        task_title    TEXT,
        display_name  TEXT,
        spec          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN (
            'pending', 'ready', 'dispatched',
            'completed', 'failed', 'blocked'
          )),
        deps          TEXT NOT NULL DEFAULT '[]',
        result        TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

      CREATE TABLE IF NOT EXISTS dispatch_contexts (
        id                  TEXT PRIMARY KEY,
        run_id              TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}',
        task_id             TEXT NOT NULL,
        contract_version    INTEGER NOT NULL DEFAULT ${CURRENT_CONTRACT_VERSION},
        launch_token_hash   TEXT,
        assignee_handle     TEXT,
        assignee_pane_key   TEXT,
        capability_hash     TEXT,
        process_incarnation TEXT,
        capability_revoked_at TEXT,
        status              TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'dispatched', 'completed', 'failed', 'circuit_broken')),
        failure_count       INTEGER NOT NULL DEFAULT 0,
        last_failure        TEXT,
        dispatched_at       TEXT,
        completed_at        TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        last_heartbeat_at   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_dispatch_task ON dispatch_contexts(task_id);
      CREATE INDEX IF NOT EXISTS idx_dispatch_status ON dispatch_contexts(status);
      CREATE INDEX IF NOT EXISTS idx_dispatch_assignee_handle ON dispatch_contexts(assignee_handle);

      CREATE TABLE IF NOT EXISTS decision_gates (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL DEFAULT '${LEGACY_RUN_ID}',
        task_id       TEXT NOT NULL,
        question      TEXT NOT NULL,
        options       TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'resolved', 'timeout')),
        resolution    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_gates_task ON decision_gates(task_id);
      CREATE INDEX IF NOT EXISTS idx_gates_status ON decision_gates(status);

      CREATE TABLE IF NOT EXISTS coordinator_runs (
        id                  TEXT PRIMARY KEY,
        spec                TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'idle'
          CHECK(status IN ('idle', 'running', 'completed', 'failed')),
        coordinator_handle  TEXT NOT NULL,
        poll_interval_ms    INTEGER NOT NULL DEFAULT 2000,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at        TEXT,
        scheduler_lost_at   TEXT
      );
    `)
    this.createUndeliveredInboxIndexIfPossible()
  }

  // Why: CREATE TABLE IF NOT EXISTS won't alter existing DBs; migrate in a txn that bumps user_version only on success (atomic all-or-nothing).
  // Constructor hooks dispatch to the final database implementation.
  protected migrate(): void {
    throw new Error('Orchestration database migrations are not installed.')
  }

  protected createUndeliveredInboxIndexIfPossible(): void {
    throw new Error('Orchestration database schema helpers are not installed.')
  }
}
