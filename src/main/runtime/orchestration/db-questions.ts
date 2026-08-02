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
import { OrchestrationDatabaseDeliveries } from './db-deliveries'

export class OrchestrationDatabaseQuestions extends OrchestrationDatabaseDeliveries {
  findPendingLegacyQuestions(params: {
    principalId: string
    question: string
    options?: string[]
    recipientHandle: string
  }): { question: QuestionRow; message: MessageRow }[] {
    return this.findLegacyQuestionsBySemanticIdentity(params)
      .filter((row) => row.question.status === 'pending')
      .map(({ question, message }) => ({ question, message }))
  }

  findLegacyQuestionsBySemanticIdentity(params: {
    principalId: string
    question: string
    options?: string[]
    recipientHandle: string
  }): {
    question: QuestionRow
    message: MessageRow
    answerAcknowledged: boolean
    claimedByOperation: boolean
  }[] {
    const principal = this.requireCommittedLegacyPrincipal(params.principalId, 'worker')
    const runAddress = `run:${principal.run_id}`
    const rows = this.db
      .prepare(
        `SELECT q.*, m.id AS source_message_id,
                EXISTS(
                  SELECT 1 FROM legacy_operation_receipts lor
                  WHERE lor.principal_id = ? AND lor.method = 'orchestration.ask'
                    AND lor.effect_id = q.message_id
                ) AS claimed_by_operation
         FROM question_threads q
         INNER JOIN messages m ON m.id = q.message_id
         WHERE q.run_id = ? AND q.dispatch_id = ?
           AND (
             (m.delivery_contract = 'legacy_direct' AND m.to_handle = ?) OR
             (m.delivery_contract = 'current_delivery' AND m.to_handle = ?)
           )
         ORDER BY m.sequence
         LIMIT 501`
      )
      .all(
        principal.id,
        principal.run_id,
        principal.dispatch_id,
        params.recipientHandle,
        runAddress
      ) as (QuestionRow & {
      source_message_id: string
      claimed_by_operation: number
    })[]
    if (rows.length > 500) {
      throw new OrchestrationError(
        'operation_unknown',
        'Legacy ask identity is too ambiguous to reconstruct safely.'
      )
    }
    return rows
      .filter((row) => {
        const message = this.getMessageById(row.source_message_id)
        return Boolean(
          message &&
          legacyMessageMatchesQuestion(message, params.question, params.options ?? [], [
            params.recipientHandle,
            runAddress
          ])
        )
      })
      .map((row) => ({
        question: exposeQuestionTimestamps(row),
        message: this.getMessageById(row.message_id) as MessageRow,
        claimedByOperation: row.claimed_by_operation === 1,
        answerAcknowledged: row.answer_message_id
          ? Boolean(
              this.db
                .prepare(
                  `SELECT 1 FROM legacy_mail_receipts
                   WHERE principal_id = ? AND message_id = ?
                     AND acknowledged_at IS NOT NULL`
                )
                .get(principal.id, row.answer_message_id)
            )
          : false
      }))
  }

  protected resolveLegacyWorkerCoordinatorDelivery(
    runId: string,
    retainedCoordinatorHandle: string
  ): { to: string; contract: MessageDeliveryContract } {
    const run = this.getRunRaw(runId)
    const principal = this.getLegacyCoordinatorPrincipal(runId)
    const takenOver = run?.coordinator_handle !== null && principal?.status !== 'committed'
    return takenOver
      ? { to: `run:${runId}`, contract: 'current_delivery' }
      : { to: retainedCoordinatorHandle, contract: 'legacy_direct' }
  }

  commitLegacyReplyOperation(params: {
    principalId: string
    operationKey: string
    method: string
    payloadHash: string
    questionId: string
    body: string
  }): {
    receipt: LegacyOperationReceiptRow
    question: QuestionRow
    message: MessageRow
    duplicate: boolean
  } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const principal = this.requireCommittedLegacyPrincipal(params.principalId, 'coordinator')
      const receipt = this.requireMatchingLegacyOperationReceipt(params)
      if (receipt) {
        const response = JSON.parse(receipt.response_json) as {
          questionId: string
          messageId: string
        }
        const question = this.getQuestion(response.questionId)
        const message = this.getMessageById(response.messageId)
        if (!question || !message) {
          throw new OrchestrationError(
            'operation_unknown',
            `Legacy reply ${params.operationKey} lost its durable effect.`
          )
        }
        this.db.exec('COMMIT')
        return { receipt, question, message, duplicate: true }
      }

      const question = this.getQuestionRaw(params.questionId)
      const sourceMessage = this.getMessageById(params.questionId)
      const dispatch = question ? this.getDispatchContextById(question.dispatch_id) : undefined
      if (
        !question ||
        !sourceMessage ||
        !dispatch ||
        question.run_id !== principal.run_id ||
        sourceMessage.delivery_contract !== 'legacy_direct' ||
        dispatch.run_id !== principal.run_id ||
        dispatch.contract_version !== LEGACY_CONTRACT_VERSION ||
        question.status === 'closed'
      ) {
        throw new OrchestrationError(
          'question_not_found',
          `Question ${params.questionId} is not actionable in the adopted Run.`
        )
      }
      let message: MessageRow
      if (question.status === 'answered') {
        if (question.answer_body !== params.body || !question.answer_message_id) {
          throw new OrchestrationError(
            'answer_conflict',
            `Question ${params.questionId} already has a different answer.`
          )
        }
        message = this.getMessageById(question.answer_message_id) as MessageRow
        if (
          !message ||
          message.run_id !== principal.run_id ||
          message.delivery_contract !== 'legacy_direct'
        ) {
          throw new OrchestrationError(
            'operation_unknown',
            `Question ${params.questionId} lost its recorded answer message.`
          )
        }
      } else {
        message = this.insertMessage({
          from: principal.terminal_handle,
          to: question.asker_handle,
          subject: 'Re: Question',
          body: params.body,
          threadId: question.message_id,
          runId: principal.run_id,
          deliveryContract: 'legacy_direct'
        })
        this.markAsRead([question.message_id])
        this.db
          .prepare(
            `UPDATE question_threads
             SET status = 'answered', answer_message_id = ?, answer_body = ?,
                 answered_at = datetime('now')
             WHERE message_id = ? AND status = 'pending'`
          )
          .run(message.id, params.body, question.message_id)
      }

      const answered = this.getQuestion(params.questionId) as QuestionRow
      const committedReceipt = this.insertLegacyOperationReceipt({
        principalId: principal.id,
        operationKey: params.operationKey,
        method: params.method,
        payloadHash: params.payloadHash,
        effectId: message.id,
        responseJson: JSON.stringify({
          questionId: answered.message_id,
          messageId: message.id
        })
      })
      this.db.exec('COMMIT')
      return {
        receipt: committedReceipt,
        question: answered,
        message,
        duplicate: question.status === 'answered'
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  protected requireMatchingLegacyOperationReceipt(params: {
    principalId: string
    operationKey: string
    method: string
    payloadHash: string
  }): LegacyOperationReceiptRow | undefined {
    const receipt = this.getLegacyOperationReceipt(params.principalId, params.operationKey)
    if (
      receipt &&
      (receipt.method !== params.method || receipt.payload_hash !== params.payloadHash)
    ) {
      throw new OrchestrationError(
        'request_mismatch',
        `Legacy operation ${params.operationKey} was already used with different input.`
      )
    }
    return receipt
  }

  protected insertLegacyOperationReceipt(params: {
    principalId: string
    operationKey: string
    method: string
    payloadHash: string
    effectId: string
    responseJson: string
  }): LegacyOperationReceiptRow {
    this.db
      .prepare(
        `INSERT INTO legacy_operation_receipts (
           principal_id, operation_key, method, payload_hash, effect_id, response_json
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.principalId,
        params.operationKey,
        params.method,
        params.payloadHash,
        params.effectId,
        params.responseJson
      )
    return this.getLegacyOperationReceipt(
      params.principalId,
      params.operationKey
    ) as LegacyOperationReceiptRow
  }

  getUnreadMessages(toHandle: string, types?: MessageType[]): MessageRow[] {
    if (types && types.length > 0) {
      const placeholders = types.map(() => '?').join(',')
      return exposeMessageListTimestamps(
        this.db
          .prepare(
            `SELECT * FROM messages
             WHERE to_handle = ? AND read = 0 AND delivery_contract = 'current_delivery'
               AND type IN (${placeholders}) ORDER BY sequence`
          )
          .all(toHandle, ...types) as MessageRow[]
      )
    }
    return exposeMessageListTimestamps(
      this.db
        .prepare(
          `SELECT * FROM messages
           WHERE to_handle = ? AND read = 0 AND delivery_contract = 'current_delivery'
           ORDER BY sequence`
        )
        .all(toHandle) as MessageRow[]
    )
  }

  convertLifecycleMessageToRejection(
    messageId: string,
    code: string,
    reason: string
  ): MessageRow | undefined {
    const message = this.getMessageById(messageId)
    if (!message || (message.type !== 'worker_done' && message.type !== 'heartbeat')) {
      return message
    }

    const originalBody = message.body ? `\n\nOriginal body:\n${message.body}` : ''
    const body = `Orca rejected this ${message.type}: ${reason}${originalBody}`
    const payload = addLifecycleRejectionMarker(message.payload, code, reason)
    // Why: rejected lifecycle signals stay auditable but must not reach read paths as actionable completion/liveness events.
    this.db
      .prepare(
        `UPDATE messages
         SET priority = 'high', subject = ?, body = ?, payload = ?
         WHERE id = ?`
      )
      .run(`Rejected ${message.type}: ${message.subject}`, body, payload, messageId)
    return this.getMessageById(messageId)
  }

  // Why: delivered_at IS NULL filter — push-on-idle delivers each row at most once; read (set only by check) wouldn't prevent replay.
  getUndeliveredUnreadMessages(toHandle: string, types?: MessageType[]): MessageRow[] {
    if (types && types.length > 0) {
      const placeholders = types.map(() => '?').join(',')
      return exposeMessageListTimestamps(
        this.db
          .prepare(
            `SELECT * FROM messages
             WHERE to_handle = ? AND read = 0 AND delivered_at IS NULL
               AND delivery_contract = 'current_delivery'
               AND type IN (${placeholders}) ORDER BY sequence`
          )
          .all(toHandle, ...types) as MessageRow[]
      )
    }
    return exposeMessageListTimestamps(
      this.db
        .prepare(
          `SELECT * FROM messages
           WHERE to_handle = ? AND read = 0 AND delivered_at IS NULL
             AND delivery_contract = 'current_delivery'
           ORDER BY sequence`
        )
        .all(toHandle) as MessageRow[]
    )
  }

  getAllMessages(toHandle: string, limit = 20): MessageRow[] {
    return exposeMessageListTimestamps(
      this.db
        .prepare('SELECT * FROM messages WHERE to_handle = ? ORDER BY sequence DESC LIMIT ?')
        .all(toHandle, limit) as MessageRow[]
    )
  }

  getMessageById(id: string): MessageRow | undefined {
    const message = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      | MessageRow
      | undefined
    return message ? exposeMessageTimestamps(message) : undefined
  }

  markAsRead(ids: string[]): void {
    if (ids.length === 0) {
      return
    }
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...ids)
  }

  // Why: use datetime('now') so delivered_at matches the space-format UTC shape of the table's other timestamps for correct ordering (§3.2).
  markAsDelivered(ids: string[]): void {
    if (ids.length === 0) {
      return
    }
    const placeholders = ids.map(() => '?').join(',')
    this.db
      .prepare(`UPDATE messages SET delivered_at = datetime('now') WHERE id IN (${placeholders})`)
      .run(...ids)
  }

  markAsReadAndDelivered(ids: string[]): void {
    if (ids.length === 0) {
      return
    }
    const placeholders = ids.map(() => '?').join(',')
    // Why: superseded lifecycle messages stay in history but must not be consumed or injected after their dispatch finished.
    this.db
      .prepare(
        `UPDATE messages SET read = 1, delivered_at = COALESCE(delivered_at, datetime('now')) WHERE id IN (${placeholders})`
      )
      .run(...ids)
  }

  getInbox(limit = 20): MessageRow[] {
    return exposeMessageListTimestamps(
      this.db
        .prepare('SELECT * FROM messages ORDER BY sequence DESC LIMIT ?')
        .all(limit) as MessageRow[]
    )
  }

  // Why: read-only history for a handle — returns every message regardless of read/delivered state, never flips the read bit (§3.3).
  getAllMessagesForHandle(toHandle: string, limit = 100, types?: MessageType[]): MessageRow[] {
    if (types && types.length > 0) {
      const placeholders = types.map(() => '?').join(',')
      return exposeMessageListTimestamps(
        this.db
          .prepare(
            `SELECT * FROM messages WHERE to_handle = ? AND type IN (${placeholders}) ORDER BY sequence DESC LIMIT ?`
          )
          .all(toHandle, ...types, limit) as MessageRow[]
      )
    }
    return exposeMessageListTimestamps(
      this.db
        .prepare('SELECT * FROM messages WHERE to_handle = ? ORDER BY sequence DESC LIMIT ?')
        .all(toHandle, limit) as MessageRow[]
    )
  }

  // Why: ask wait-loop read — to_handle filter shows only replies to the worker; afterSequence resumes past its own outbound ask.
  getThreadMessagesFor(threadId: string, toHandle: string, afterSequence?: number): MessageRow[] {
    if (afterSequence !== undefined) {
      return exposeMessageListTimestamps(
        this.db
          .prepare(
            'SELECT * FROM messages WHERE thread_id = ? AND to_handle = ? AND sequence > ? ORDER BY sequence ASC'
          )
          .all(threadId, toHandle, afterSequence) as MessageRow[]
      )
    }
    return exposeMessageListTimestamps(
      this.db
        .prepare(
          'SELECT * FROM messages WHERE thread_id = ? AND to_handle = ? ORDER BY sequence ASC'
        )
        .all(threadId, toHandle) as MessageRow[]
    )
  }

  createQuestion(params: {
    runId: string
    dispatchId: string
    askerHandle: string
    question: string
    options?: string[]
  }): { question: QuestionRow; message: MessageRow } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.requireRun(params.runId)
      const dispatch = this.getDispatchContextById(params.dispatchId)
      if (
        !dispatch ||
        dispatch.run_id !== params.runId ||
        (dispatch.status !== 'pending' && dispatch.status !== 'dispatched')
      ) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${params.dispatchId} is not active in Run ${params.runId}.`
        )
      }
      const message = this.insertMessage({
        from: `dispatch:${params.dispatchId}`,
        to: `run:${params.runId}`,
        subject: 'Question',
        body: params.question,
        type: 'question',
        payload: JSON.stringify({
          taskId: dispatch.task_id,
          dispatchId: dispatch.id,
          question: params.question,
          options: params.options ?? []
        }),
        runId: params.runId
      })
      this.db.prepare('UPDATE messages SET thread_id = ? WHERE id = ?').run(message.id, message.id)
      this.db
        .prepare(
          `INSERT INTO question_threads (
             message_id, run_id, dispatch_id, asker_handle
           ) VALUES (?, ?, ?, ?)`
        )
        .run(message.id, params.runId, params.dispatchId, params.askerHandle)
      const question = this.getQuestionRaw(message.id) as QuestionRow
      const storedMessage = this.getMessageById(message.id) as MessageRow
      this.db.exec('COMMIT')
      return { question: exposeQuestionTimestamps(question), message: storedMessage }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getQuestion(messageId: string): QuestionRow | undefined {
    const question = this.getQuestionRaw(messageId)
    return question ? exposeQuestionTimestamps(question) : undefined
  }

  protected getQuestionRaw(messageId: string): QuestionRow | undefined {
    return this.db.prepare('SELECT * FROM question_threads WHERE message_id = ?').get(messageId) as
      | QuestionRow
      | undefined
  }

  answerQuestion(params: {
    messageId: string
    runId: string
    consumerGeneration: number
    body: string
  }): { question: QuestionRow; message: MessageRow; duplicate: boolean } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.requireCurrentConsumer(params.runId, params.consumerGeneration)
      const question = this.getQuestionRaw(params.messageId)
      if (!question || question.run_id !== params.runId) {
        throw new OrchestrationError(
          'question_not_found',
          `Question ${params.messageId} was not found in Run ${params.runId}.`
        )
      }
      if (question.status === 'closed') {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Question ${params.messageId} is closed because its Dispatch is inactive.`
        )
      }
      if (question.status === 'answered') {
        if (question.answer_body !== params.body || !question.answer_message_id) {
          throw new OrchestrationError(
            'answer_conflict',
            `Question ${params.messageId} already has a different answer.`
          )
        }
        const message = this.getMessageById(question.answer_message_id)
        if (!message) {
          throw new Error(`Recorded answer message ${question.answer_message_id} was not found.`)
        }
        this.db.exec('COMMIT')
        return { question: exposeQuestionTimestamps(question), message, duplicate: true }
      }

      const message = this.insertMessage({
        from: `run:${params.runId}`,
        to: `dispatch:${question.dispatch_id}`,
        subject: 'Re: Question',
        body: params.body,
        threadId: question.message_id,
        runId: params.runId
      })
      // Why: ask returns thread state directly; leaving its answer unread would deliver it again via check.
      this.markAsRead([message.id])
      this.db
        .prepare(
          `UPDATE question_threads
           SET status = 'answered', answer_message_id = ?, answer_body = ?,
               answered_by_generation = ?, answered_at = datetime('now')
           WHERE message_id = ? AND status = 'pending'`
        )
        .run(message.id, params.body, params.consumerGeneration, question.message_id)
      const answered = this.getQuestionRaw(question.message_id) as QuestionRow
      const storedMessage = this.getMessageById(message.id) as MessageRow
      this.db.exec('COMMIT')
      return {
        question: exposeQuestionTimestamps(answered),
        message: storedMessage,
        duplicate: false
      }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  closeQuestionsForDispatch(dispatchId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT message_id FROM question_threads WHERE dispatch_id = ? AND status = 'pending'"
      )
      .all(dispatchId) as { message_id: string }[]
    if (rows.length === 0) {
      return []
    }
    this.db
      .prepare(
        "UPDATE question_threads SET status = 'closed', closed_at = datetime('now') WHERE dispatch_id = ? AND status = 'pending'"
      )
      .run(dispatchId)
    return rows.map((row) => row.message_id)
  }

  // ── Tasks ──

}

