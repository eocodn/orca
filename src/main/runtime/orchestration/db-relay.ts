

import Database from '../../sqlite/sync-database'
import type {
  MessageType,
  MessagePriority,
  MessageRow,
  DispatchContextRow,
  WorkerReportOutcome,
  WorkerDispatchRow,
  FederationRelayDirection,
  FederationRelayItemRow
} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  isEquivalentPaneKey} from './db-contract-helpers'





import { OrchestrationDatabaseFederation } from './db-federation'

export class OrchestrationDatabaseRelay extends OrchestrationDatabaseFederation {
  listFederationRelay(params: {
    dispatchId: string
    direction: FederationRelayDirection
    afterSequence: number
    limit?: number
  }): FederationRelayItemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM federation_relay_items
         WHERE dispatch_id = ? AND direction = ? AND sequence > ?
         ORDER BY sequence LIMIT ?`
      )
      .all(
        params.dispatchId,
        params.direction,
        params.afterSequence,
        Math.min(Math.max(params.limit ?? 50, 1), 50)
      ) as FederationRelayItemRow[]
  }

  listPendingFederationRelay(
    dispatchId: string,
    direction: FederationRelayDirection,
    limit = 50
  ): FederationRelayItemRow[] {
    return this.db
      .prepare(
        `SELECT * FROM federation_relay_items
         WHERE dispatch_id = ? AND direction = ? AND acked_at IS NULL
         ORDER BY sequence LIMIT ?`
      )
      .all(dispatchId, direction, Math.min(Math.max(limit, 1), 50)) as FederationRelayItemRow[]
  }

  acknowledgeFederationRelay(params: {
    dispatchId: string
    direction: FederationRelayDirection
    throughSequence: number
  }): void {
    this.db
      .prepare(
        `UPDATE federation_relay_items SET acked_at = COALESCE(acked_at, datetime('now'))
         WHERE dispatch_id = ? AND direction = ? AND sequence <= ?`
      )
      .run(params.dispatchId, params.direction, params.throughSequence)
  }

  setFederatedHomeImportSequence(dispatchId: string, sequence: number): void {
    this.db
      .prepare(
        `UPDATE federated_dispatches
         SET to_home_imported_sequence = ?, updated_at = datetime('now')
         WHERE dispatch_id = ? AND to_home_imported_sequence < ?`
      )
      .run(sequence, dispatchId, sequence)
  }

  importFederatedRelayItem(params: {
    dispatchId: string
    sequence: number
    message: {
      id: string
      runId: string
      from: string
      to: string
      subject: string
      body: string
      type: MessageType
      priority: MessagePriority
      threadId?: string
      payload?: string
    }
    lifecycle:
      | { kind: 'none' }
      | { kind: 'heartbeat'; at: string }
      | {
          kind: 'worker_report'
          taskId: string
          outcome: WorkerReportOutcome
          result: string
        }
      | { kind: 'rejected'; code: string; reason: string }
  }): { message: MessageRow; duplicate: boolean } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const federated = this.getFederatedDispatch(params.dispatchId)
      if (!federated) {
        throw new OrchestrationError(
          'dispatch_not_found',
          `Federated Dispatch ${params.dispatchId} was not found.`
        )
      }
      if (params.sequence <= federated.to_home_imported_sequence) {
        const existing = this.getMessageById(params.message.id)
        if (!existing) {
          throw new OrchestrationError(
            'operation_unknown',
            `Federated relay sequence ${params.sequence} was committed without its message.`
          )
        }
        this.db.exec('COMMIT')
        return { message: existing, duplicate: true }
      }
      if (params.sequence !== federated.to_home_imported_sequence + 1) {
        throw new OrchestrationError(
          'operation_unknown',
          `Federated relay for ${params.dispatchId} is not contiguous after sequence ${federated.to_home_imported_sequence}.`
        )
      }

      let message = this.getMessageById(params.message.id)
      if (!message) {
        message = this.insertMessage(params.message)
      } else if (
        message.run_id !== params.message.runId ||
        message.to_handle !== params.message.to ||
        message.type !== params.message.type
      ) {
        throw new OrchestrationError(
          'request_mismatch',
          `Federated relay message ${params.message.id} conflicts with an existing message.`
        )
      }
      if (message.type === 'question') {
        this.registerFederatedQuestion({
          messageId: message.id,
          runId: params.message.runId,
          dispatchId: params.dispatchId
        })
      }
      if (params.lifecycle.kind === 'heartbeat') {
        this.recordHeartbeat(params.dispatchId, params.lifecycle.at)
      } else if (params.lifecycle.kind === 'worker_report') {
        const settlement = this.settleWorkerReportInTransaction({
          taskId: params.lifecycle.taskId,
          dispatchId: params.dispatchId,
          outcome: params.lifecycle.outcome,
          result: params.lifecycle.result
        })
        if (settlement.action === 'rejected') {
          message = this.convertLifecycleMessageToRejection(
            message.id,
            settlement.code,
            settlement.reason
          ) as MessageRow
        }
      } else if (params.lifecycle.kind === 'rejected') {
        message = this.convertLifecycleMessageToRejection(
          message.id,
          params.lifecycle.code,
          params.lifecycle.reason
        ) as MessageRow
      }
      this.setFederatedHomeImportSequence(params.dispatchId, params.sequence)
      this.db.exec('COMMIT')
      return { message, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getRemoteQuestion(messageId: string):
    | {
        message_id: string
        dispatch_id: string
        status: 'pending' | 'answered' | 'closed'
        answer_message_id: string | null
        answer_body: string | null
      }
    | undefined {
    return this.db.prepare('SELECT * FROM remote_questions WHERE message_id = ?').get(messageId) as
      | {
          message_id: string
          dispatch_id: string
          status: 'pending' | 'answered' | 'closed'
          answer_message_id: string | null
          answer_body: string | null
        }
      | undefined
  }

  answerRemoteQuestion(params: {
    messageId: string
    dispatchId: string
    answerMessageId: string
    body: string
  }): void {
    const question = this.getRemoteQuestion(params.messageId)
    if (!question || question.dispatch_id !== params.dispatchId) {
      throw new OrchestrationError(
        'question_not_found',
        `Remote Question ${params.messageId} was not found.`
      )
    }
    if (question.status === 'answered') {
      if (
        question.answer_message_id !== params.answerMessageId ||
        question.answer_body !== params.body
      ) {
        throw new OrchestrationError(
          'answer_conflict',
          `Remote Question ${params.messageId} already has a different answer.`
        )
      }
      return
    }
    this.db
      .prepare(
        `UPDATE remote_questions
         SET status = 'answered', answer_message_id = ?, answer_body = ?,
             answered_at = datetime('now')
         WHERE message_id = ? AND status = 'pending'`
      )
      .run(params.answerMessageId, params.body, params.messageId)
  }

  setRemoteWorkerImportSequence(dispatchId: string, sequence: number): void {
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET to_worker_imported_sequence = ?, updated_at = datetime('now')
         WHERE dispatch_id = ? AND to_worker_imported_sequence < ?`
      )
      .run(sequence, dispatchId, sequence)
  }

  registerFederatedQuestion(params: {
    messageId: string
    runId: string
    dispatchId: string
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO question_threads (
           message_id, run_id, dispatch_id, asker_handle
         ) VALUES (?, ?, ?, ?)`
      )
      .run(params.messageId, params.runId, params.dispatchId, `dispatch:${params.dispatchId}`)
  }

  protected getFederationRelayItem(
    dispatchId: string,
    direction: FederationRelayDirection,
    sequence: number
  ): FederationRelayItemRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM federation_relay_items
         WHERE dispatch_id = ? AND direction = ? AND sequence = ?`
      )
      .get(dispatchId, direction, sequence) as FederationRelayItemRow | undefined
  }

  protected settleRemoteAttachmentInRelayTransaction(
    dispatchId: string,
    outcome: WorkerReportOutcome | undefined
  ): void {
    if (!outcome) {
      return
    }
    this.db
      .prepare(
        `UPDATE remote_dispatch_attachments
         SET state = ?, stage = 'worker_report_queued', capability_hash = NULL,
             updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'ready'`
      )
      .run(outcome === 'succeeded' ? 'succeeded' : 'failed', dispatchId)
  }

  isDispatchProcessCurrent(params: {
    dispatchId: string
    paneKey: string | null
    processIncarnation: string | null
  }): boolean {
    const dispatch = this.getDispatchContextById(params.dispatchId)
    return Boolean(
      dispatch?.assignee_pane_key &&
      params.paneKey &&
      isEquivalentPaneKey(dispatch.assignee_pane_key, params.paneKey) &&
      dispatch.process_incarnation &&
      params.processIncarnation === dispatch.process_incarnation
    )
  }

  beginWorkerStop(
    dispatchId: string
  ):
    | { disposition: 'stopping'; worker: WorkerDispatchRow; dispatch: DispatchContextRow }
    | { disposition: 'already_settled'; worker: WorkerDispatchRow; dispatch: DispatchContextRow } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const dispatch = this.getDispatchContextById(dispatchId)
      const worker = this.getWorkerDispatch(dispatchId)
      if (!dispatch || !worker) {
        throw new OrchestrationError('dispatch_not_found', `Dispatch ${dispatchId} was not found.`)
      }
      if (['succeeded', 'failed', 'stopped', 'abandoned'].includes(worker.state)) {
        this.db.exec('COMMIT')
        return { disposition: 'already_settled', worker, dispatch }
      }
      if (!['ready', 'start_unknown'].includes(worker.state)) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${dispatchId} cannot stop from ${worker.state}.`
        )
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'stopping', stage = 'stop_requested', updated_at = datetime('now')
           WHERE dispatch_id = ? AND state IN ('ready', 'start_unknown')`
        )
        .run(dispatchId)
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
      return {
        disposition: 'stopping',
        worker: this.getWorkerDispatch(dispatchId) as WorkerDispatchRow,
        dispatch: this.getDispatchContextById(dispatchId) as DispatchContextRow
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  settleWorkerStop(dispatchId: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const worker = this.getWorkerDispatch(dispatchId)
      const dispatch = this.getDispatchContextById(dispatchId)
      if (!worker || !dispatch || worker.state !== 'stopping') {
        throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not stopping.`)
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'stopped', stage = 'process_stopped', updated_at = datetime('now')
           WHERE dispatch_id = ? AND state = 'stopping'`
        )
        .run(dispatchId)
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET status = 'failed', completed_at = datetime('now'), last_failure = 'stopped'
           WHERE id = ? AND status IN ('pending', 'dispatched')`
        )
        .run(dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  reconcileFederatedWorkerStop(dispatchId: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const worker = this.getWorkerDispatch(dispatchId)
      const dispatch = this.getDispatchContextById(dispatchId)
      if (!worker || !dispatch || !this.getFederatedDispatch(dispatchId)) {
        throw new OrchestrationError(
          'dispatch_not_found',
          `Federated Dispatch ${dispatchId} was not found.`
        )
      }
      if (worker.state === 'stopped') {
        this.db.exec('COMMIT')
        return worker
      }
      if (!['stopping', 'stop_unknown'].includes(worker.state)) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Federated Dispatch ${dispatchId} cannot reconcile stop from ${worker.state}.`
        )
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'stopped', stage = 'process_stopped', last_error = NULL,
               updated_at = datetime('now')
           WHERE dispatch_id = ? AND state IN ('stopping', 'stop_unknown')`
        )
        .run(dispatchId)
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET status = 'failed', completed_at = COALESCE(completed_at, datetime('now')),
               last_failure = 'stopped'
           WHERE id = ? AND status IN ('pending', 'dispatched')`
        )
        .run(dispatchId)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  resumeFederatedWorkerForTerminalRelay(dispatchId: string): WorkerDispatchRow {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const worker = this.getWorkerDispatch(dispatchId)
      const dispatch = this.getDispatchContextById(dispatchId)
      if (!worker || !dispatch || worker.state !== 'stopping') {
        throw new OrchestrationError('dispatch_inactive', `Dispatch ${dispatchId} is not stopping.`)
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'ready', stage = 'remote_report_pending', updated_at = datetime('now')
           WHERE dispatch_id = ? AND state = 'stopping'`
        )
        .run(dispatchId)
      this.db
        .prepare("UPDATE tasks SET status = 'dispatched' WHERE id = ? AND status = 'blocked'")
        .run(dispatch.task_id)
      this.db.exec('COMMIT')
      return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markWorkerStopUnknown(dispatchId: string, reason: string): WorkerDispatchRow {
    this.db
      .prepare(
        `UPDATE worker_dispatches
         SET state = 'stop_unknown', stage = 'stop_outcome_unknown', last_error = ?,
             updated_at = datetime('now')
         WHERE dispatch_id = ? AND state = 'stopping'`
      )
      .run(reason, dispatchId)
    return this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
  }

  abandonWorkerDispatch(dispatchId: string): {
    disposition: 'abandoned' | 'already_abandoned' | 'stale'
    worker: WorkerDispatchRow
  } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const worker = this.getWorkerDispatch(dispatchId)
      const dispatch = this.getDispatchContextById(dispatchId)
      if (!worker || !dispatch) {
        throw new OrchestrationError('dispatch_not_found', `Dispatch ${dispatchId} was not found.`)
      }
      if (worker.state === 'abandoned') {
        this.db.exec('COMMIT')
        return { disposition: 'already_abandoned', worker }
      }
      if (this.getDispatchContext(dispatch.task_id)?.id !== dispatchId) {
        this.db.exec('COMMIT')
        return { disposition: 'stale', worker }
      }
      if (worker.state === 'succeeded') {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${dispatchId} already succeeded and cannot be abandoned.`
        )
      }
      this.db
        .prepare(
          `UPDATE worker_dispatches
           SET state = 'abandoned', stage = 'abandoned', updated_at = datetime('now')
           WHERE dispatch_id = ?`
        )
        .run(dispatchId)
      this.db
        .prepare(
          `UPDATE dispatch_contexts
           SET status = CASE WHEN status IN ('pending', 'dispatched') THEN 'failed' ELSE status END,
               capability_revoked_at = COALESCE(capability_revoked_at, datetime('now')),
               completed_at = COALESCE(completed_at, datetime('now'))
           WHERE id = ?`
        )
        .run(dispatchId)
      this.db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(dispatch.task_id)
      this.closeQuestionsForDispatch(dispatchId)
      this.db.exec('COMMIT')
      return {
        disposition: 'abandoned',
        worker: this.getWorkerDispatch(dispatchId) as WorkerDispatchRow
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

}

