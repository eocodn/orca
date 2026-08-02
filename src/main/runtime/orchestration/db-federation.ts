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
import { OrchestrationDatabaseWorkerDispatch } from './db-worker-dispatch'

export class OrchestrationDatabaseFederation extends OrchestrationDatabaseWorkerDispatch {
  getFederatedDispatch(dispatchId: string): FederatedDispatchRow | undefined {
    return this.db
      .prepare('SELECT * FROM federated_dispatches WHERE dispatch_id = ?')
      .get(dispatchId) as FederatedDispatchRow | undefined
  }

  listActiveFederatedDispatches(runId?: string): FederatedDispatchRow[] {
    return this.db
      .prepare(
        `SELECT fd.*
         FROM federated_dispatches fd
         INNER JOIN dispatch_contexts dc ON dc.id = fd.dispatch_id
         INNER JOIN worker_dispatches wd ON wd.dispatch_id = fd.dispatch_id
         WHERE wd.state IN ('starting', 'ready', 'stopping', 'start_unknown', 'stop_unknown')
           AND (? IS NULL OR dc.run_id = ?)
         ORDER BY fd.rowid`
      )
      .all(runId ?? null, runId ?? null) as FederatedDispatchRow[]
  }

  updateFederatedDispatchResources(params: {
    dispatchId: string
    remoteRuntimeEpoch: string
    worktreeId: string
    terminalHandle: string
  }): FederatedDispatchRow {
    this.db
      .prepare(
        `UPDATE federated_dispatches
         SET remote_runtime_epoch = ?, remote_worktree_id = ?, remote_terminal_handle = ?,
             updated_at = datetime('now')
         WHERE dispatch_id = ?`
      )
      .run(params.remoteRuntimeEpoch, params.worktreeId, params.terminalHandle, params.dispatchId)
    const row = this.getFederatedDispatch(params.dispatchId)
    if (!row) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Federated Dispatch ${params.dispatchId} was not found.`
      )
    }
    return row
  }

  createRemoteDispatchAttachment(params: {
    dispatchId: string
    taskId: string
    homePeerFingerprint: string
    protocolVersion: number
    runtimeEpoch: string
    mutationReceipt: {
      callerFingerprint: string
      requestId: string
      method: string
      payloadHash: string
    }
  }): RemoteDispatchAttachmentRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (params.homePeerFingerprint !== params.mutationReceipt.callerFingerprint) {
        throw new OrchestrationError(
          'resource_server_mismatch',
          'The authenticated Run-home peer does not match the attachment request.'
        )
      }
      const existingReceipt = this.getMutationReceipt(
        params.mutationReceipt.callerFingerprint,
        params.mutationReceipt.requestId
      )
      if (existingReceipt) {
        throw new OrchestrationError(
          existingReceipt.method === params.mutationReceipt.method &&
            existingReceipt.payload_hash === params.mutationReceipt.payloadHash
            ? 'operation_unknown'
            : 'request_mismatch',
          `Remote attachment request ${params.mutationReceipt.requestId} already exists.`
        )
      }
      this.ensureMutationReceiptCapacity()
      this.db
        .prepare(
          `INSERT INTO mutation_receipts (
             caller_fingerprint, request_id, method, payload_hash, state, receipt
           ) VALUES (?, ?, ?, ?, 'pending', ?)`
        )
        .run(
          params.mutationReceipt.callerFingerprint,
          params.mutationReceipt.requestId,
          params.mutationReceipt.method,
          params.mutationReceipt.payloadHash,
          JSON.stringify({ accepted: { dispatchId: params.dispatchId } })
        )
      this.db
        .prepare(
          `INSERT INTO remote_dispatch_attachments (
             dispatch_id, task_id, home_peer_fingerprint, protocol_version, runtime_epoch
           ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          params.dispatchId,
          params.taskId,
          params.homePeerFingerprint,
          params.protocolVersion,
          params.runtimeEpoch
        )
      this.db.exec('COMMIT')
      return this.getRemoteDispatchAttachment(params.dispatchId) as RemoteDispatchAttachmentRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getRemoteDispatchAttachment(dispatchId: string): RemoteDispatchAttachmentRow | undefined {
    return this.db
      .prepare('SELECT * FROM remote_dispatch_attachments WHERE dispatch_id = ?')
      .get(dispatchId) as RemoteDispatchAttachmentRow | undefined
  }

  recordRemoteAttachmentStage(params: {
    dispatchId: string
    stage: string
    state?: WorkerDispatchState
    worktreeId?: string
    terminalHandle?: string
    setupState?: string
    effects?: unknown[]
    residualResources?: unknown[]
    lastError?: string
  }): RemoteDispatchAttachmentRow {
    const current = this.getRemoteDispatchAttachment(params.dispatchId)
    if (!current) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Remote Dispatch ${params.dispatchId} was not found.`
      )
    }
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET stage = ?, state = ?, worktree_id = ?, terminal_handle = ?, setup_state = ?,
             effects = ?, residual_resources = ?, last_error = ?, updated_at = datetime('now')
         WHERE dispatch_id = ?`
      )
      .run(
        params.stage,
        params.state ?? current.state,
        params.worktreeId ?? current.worktree_id,
        params.terminalHandle ?? current.terminal_handle,
        params.setupState ?? current.setup_state,
        params.effects ? JSON.stringify(params.effects) : current.effects,
        params.residualResources
          ? JSON.stringify(params.residualResources)
          : current.residual_resources,
        params.lastError ?? current.last_error,
        params.dispatchId
      )
    return this.getRemoteDispatchAttachment(params.dispatchId) as RemoteDispatchAttachmentRow
  }

  updateRemoteAttachmentSetupEvidence(params: {
    dispatchId: string
    setupState: string
    effects: unknown[]
  }): { attachment: RemoteDispatchAttachmentRow; changed: boolean } {
    const current = this.getRemoteDispatchAttachment(params.dispatchId)
    if (!current) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Remote Dispatch ${params.dispatchId} was not found.`
      )
    }
    const effects = JSON.stringify(params.effects)
    if (current.setup_state === params.setupState && current.effects === effects) {
      return { attachment: current, changed: false }
    }
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET setup_state = ?, effects = ?, updated_at = datetime('now')
         WHERE dispatch_id = ?`
      )
      .run(params.setupState, effects, params.dispatchId)
    return {
      attachment: this.getRemoteDispatchAttachment(
        params.dispatchId
      ) as RemoteDispatchAttachmentRow,
      changed: true
    }
  }

  prepareRemoteAttachmentAuthority(params: {
    dispatchId: string
    paneKey: string
    processIncarnation: string
    worktreeId: string
    terminalHandle: string
    setupState: string
    effects: unknown[]
  }): string {
    const attachment = this.getRemoteDispatchAttachment(params.dispatchId)
    if (!attachment || attachment.state !== 'starting') {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Remote Dispatch ${params.dispatchId} is not starting.`
      )
    }
    const capability = `dcap_${randomBytes(32).toString('base64url')}`
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET stage = 'authority_attached', capability_hash = ?, pane_key = ?,
             process_incarnation = ?, worktree_id = ?, terminal_handle = ?, setup_state = ?,
             effects = ?, residual_resources = ?, updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'starting'`
      )
      .run(
        hashDispatchCapability(capability),
        params.paneKey,
        params.processIncarnation,
        params.worktreeId,
        params.terminalHandle,
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
    return capability
  }

  markRemoteAttachmentReady(dispatchId: string, effects?: unknown[]): RemoteDispatchAttachmentRow {
    const result = this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = 'ready', stage = 'input_accepted',
             effects = COALESCE(?, effects), updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'starting'`
      )
      .run(effects ? JSON.stringify(effects) : null, dispatchId)
    if (result.changes !== 1) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Remote Dispatch ${dispatchId} is not starting.`
      )
    }
    return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
  }

  failRemoteAttachment(
    dispatchId: string,
    stage: string,
    reason: string,
    unknown: boolean
  ): RemoteDispatchAttachmentRow {
    const state = unknown ? 'start_unknown' : 'failed'
    const result = this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = ?, stage = ?, last_error = ?, capability_hash = NULL,
             updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'starting'`
      )
      .run(state, stage, reason, dispatchId)
    if (result.changes !== 1) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Remote Dispatch ${dispatchId} is not starting.`
      )
    }
    return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
  }

  verifyRemoteAttachmentAuthority(params: {
    dispatchId: string
    capability: string | undefined
    paneKey: string | null
    processIncarnation: string | null
  }): boolean {
    const attachment = this.getRemoteDispatchAttachment(params.dispatchId)
    if (
      !attachment?.capability_hash ||
      !params.capability ||
      !attachment.pane_key ||
      !params.paneKey ||
      !isEquivalentPaneKey(attachment.pane_key, params.paneKey) ||
      !attachment.process_incarnation ||
      attachment.process_incarnation !== params.processIncarnation
    ) {
      return false
    }
    const expected = Buffer.from(attachment.capability_hash, 'hex')
    const observed = Buffer.from(hashDispatchCapability(params.capability), 'hex')
    return expected.length === observed.length && timingSafeEqual(expected, observed)
  }

  isRemoteAttachmentProcessCurrent(params: {
    dispatchId: string
    paneKey: string | null
    processIncarnation: string | null
  }): boolean {
    const attachment = this.getRemoteDispatchAttachment(params.dispatchId)
    return Boolean(
      attachment?.pane_key &&
      params.paneKey &&
      isEquivalentPaneKey(attachment.pane_key, params.paneKey) &&
      attachment.process_incarnation &&
      attachment.process_incarnation === params.processIncarnation
    )
  }

  beginRemoteAttachmentStop(dispatchId: string): RemoteDispatchAttachmentRow {
    const attachment = this.getRemoteDispatchAttachment(dispatchId)
    if (!attachment) {
      throw new OrchestrationError(
        'dispatch_not_found',
        `Remote Dispatch ${dispatchId} was not found.`
      )
    }
    if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(attachment.state)) {
      return attachment
    }
    if (!['ready', 'start_unknown'].includes(attachment.state)) {
      throw new OrchestrationError(
        'dispatch_inactive',
        `Remote Dispatch ${dispatchId} cannot stop from ${attachment.state}.`
      )
    }
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = 'stopping', stage = 'stop_requested', capability_hash = NULL,
             updated_at = datetime('now')
         WHERE dispatch_id = ? AND state IN ('ready', 'start_unknown')`
      )
      .run(dispatchId)
    return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
  }

  settleRemoteAttachmentStop(dispatchId: string): RemoteDispatchAttachmentRow {
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = 'stopped', stage = 'process_stopped', updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'stopping'`
      )
      .run(dispatchId)
    return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
  }

  markRemoteAttachmentStopUnknown(dispatchId: string, reason: string): RemoteDispatchAttachmentRow {
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = 'stop_unknown', stage = 'stop_outcome_unknown', last_error = ?,
             updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'stopping'`
      )
      .run(reason, dispatchId)
    return this.getRemoteDispatchAttachment(dispatchId) as RemoteDispatchAttachmentRow
  }

  findActiveRemoteAttachmentForPane(paneKey: string): RemoteDispatchAttachmentRow | undefined {
    const rows = this.db
      .prepare(
        `SELECT * FROM remote_dispatch_attachments
         WHERE state IN ('starting', 'ready') AND pane_key IS NOT NULL
         ORDER BY rowid DESC`
      )
      .all() as RemoteDispatchAttachmentRow[]
    return rows.find((row) => row.pane_key && isEquivalentPaneKey(row.pane_key, paneKey))
  }

  enqueueFederationRelay(params: {
    dispatchId: string
    direction: FederationRelayDirection
    kind: string
    payload: string
    messageId?: string
    settleRemoteOutcome?: WorkerReportOutcome
    remoteQuestion?: true
  }): FederationRelayItemRow {
    const byteCount = Buffer.byteLength(params.payload, 'utf8')
    const messageId = params.messageId ?? generateId('relay')
    if (byteCount > 64 * 1024) {
      throw new OrchestrationError(
        'relay_quota_exceeded',
        'A federated orchestration message cannot exceed 64 KiB.'
      )
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (params.settleRemoteOutcome) {
        const attachment = this.getRemoteDispatchAttachment(params.dispatchId)
        if (!attachment || attachment.state !== 'ready') {
          throw new OrchestrationError(
            'dispatch_inactive',
            `Remote Dispatch ${params.dispatchId} is not active.`
          )
        }
      }
      if (params.kind === 'heartbeat') {
        const heartbeat = this.db
          .prepare(
            `SELECT * FROM federation_relay_items
             WHERE dispatch_id = ? AND direction = ? AND kind = 'heartbeat'
               AND acked_at IS NULL
             ORDER BY sequence DESC LIMIT 1`
          )
          .get(params.dispatchId, params.direction) as FederationRelayItemRow | undefined
        if (heartbeat) {
          this.db
            .prepare(
              `UPDATE federation_relay_items
               SET payload = ?, byte_count = ?, created_at = datetime('now')
               WHERE dispatch_id = ? AND direction = ? AND sequence = ?`
            )
            .run(params.payload, byteCount, params.dispatchId, params.direction, heartbeat.sequence)
          this.db.exec('COMMIT')
          return this.getFederationRelayItem(
            params.dispatchId,
            params.direction,
            heartbeat.sequence
          ) as FederationRelayItemRow
        }
      }
      const quota = this.db
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(byte_count), 0) AS bytes
           FROM federation_relay_items
           WHERE dispatch_id = ? AND direction = ? AND acked_at IS NULL`
        )
        .get(params.dispatchId, params.direction) as { count: number; bytes: number }
      if (quota.count >= 256 || quota.bytes + byteCount > 1024 * 1024) {
        if (params.kind === 'worker_done') {
          const heartbeat = this.db
            .prepare(
              `SELECT * FROM federation_relay_items
               WHERE dispatch_id = ? AND direction = ? AND kind = 'heartbeat'
                 AND acked_at IS NULL
               ORDER BY sequence LIMIT 1`
            )
            .get(params.dispatchId, params.direction) as FederationRelayItemRow | undefined
          if (heartbeat) {
            this.db
              .prepare(
                `UPDATE federation_relay_items
                 SET message_id = ?, kind = ?, payload = ?, byte_count = ?,
                     created_at = datetime('now')
                 WHERE dispatch_id = ? AND direction = ? AND sequence = ?`
              )
              .run(
                messageId,
                params.kind,
                params.payload,
                byteCount,
                params.dispatchId,
                params.direction,
                heartbeat.sequence
              )
            this.settleRemoteAttachmentInRelayTransaction(
              params.dispatchId,
              params.settleRemoteOutcome
            )
            this.db.exec('COMMIT')
            return this.getFederationRelayItem(
              params.dispatchId,
              params.direction,
              heartbeat.sequence
            ) as FederationRelayItemRow
          }
        }
        throw new OrchestrationError(
          'relay_quota_exceeded',
          `Federated Dispatch ${params.dispatchId} has no relay capacity.`
        )
      }
      const latest = this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) AS sequence
           FROM federation_relay_items WHERE dispatch_id = ? AND direction = ?`
        )
        .get(params.dispatchId, params.direction) as { sequence: number }
      const sequence = latest.sequence + 1
      this.db
        .prepare(
          `INSERT INTO federation_relay_items (
             dispatch_id, direction, sequence, message_id, kind, payload, byte_count
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          params.dispatchId,
          params.direction,
          sequence,
          messageId,
          params.kind,
          params.payload,
          byteCount
        )
      if (params.remoteQuestion) {
        this.db
          .prepare(
            `INSERT INTO remote_questions (message_id, dispatch_id)
             VALUES (?, ?)`
          )
          .run(messageId, params.dispatchId)
      }
      this.settleRemoteAttachmentInRelayTransaction(params.dispatchId, params.settleRemoteOutcome)
      this.db.exec('COMMIT')
      return this.getFederationRelayItem(
        params.dispatchId,
        params.direction,
        sequence
      ) as FederationRelayItemRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

}

