

import type {
  WorkerReportOutcome,
  RemoteDispatchAttachmentRow,
  FederationRelayDirection,
  FederationRelayItemRow
} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  generateId,
  isEquivalentPaneKey} from './db-contract-helpers'





import { OrchestrationDatabaseWorkerDispatch } from './db-worker-dispatch'

export class OrchestrationDatabaseFederationRemoteLifecycle extends OrchestrationDatabaseWorkerDispatch {
  getRemoteDispatchAttachment(dispatchId: string): RemoteDispatchAttachmentRow | undefined {
    return this.db
      .prepare('SELECT * FROM remote_dispatch_attachments WHERE dispatch_id = ?')
      .get(dispatchId) as RemoteDispatchAttachmentRow | undefined
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
