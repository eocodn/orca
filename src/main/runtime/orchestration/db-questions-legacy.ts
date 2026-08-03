

import type {
  MessageDeliveryContract,
  MessageRow,
  LegacyOperationReceiptRow,
  QuestionRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  exposeQuestionTimestamps,
  legacyMessageMatchesQuestion
} from './db-contract-helpers'




import {
  LEGACY_CONTRACT_VERSION} from './db-foundation'
import { OrchestrationDatabaseDeliveries } from './db-deliveries'

export abstract class OrchestrationDatabaseLegacyQuestions extends OrchestrationDatabaseDeliveries {
  abstract getMessageById(id: string): MessageRow | undefined
  abstract getQuestion(messageId: string): QuestionRow | undefined
  protected abstract getQuestionRaw(messageId: string): QuestionRow | undefined

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


}
