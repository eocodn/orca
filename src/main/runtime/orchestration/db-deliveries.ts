

import Database from '../../sqlite/sync-database'
import type {
  MessageType,
  MessagePriority,
  MessageDeliveryContract,
  MessageRow,
  WorkerReportOutcome,
  WorkerReportSettlement,
  DeliveryRow,
  LegacyOperationReceiptRow,
  QuestionRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  exposeDeliveryTimestamps,
  exposeMessageListTimestamps,
  exposeMessageTimestamps,
  generateId,
  legacyMessageMatchesQuestion
} from './db-contract-helpers'




import {
  LEGACY_RUN_ID,
  LEGACY_CONTRACT_VERSION} from './db-foundation'
import { OrchestrationDatabaseRuns } from './db-runs'

export class OrchestrationDatabaseDeliveries extends OrchestrationDatabaseRuns {
  protected getDeliveryRaw(id: string): DeliveryRow | undefined {
    return this.db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id) as
      | DeliveryRow
      | undefined
  }

  protected getDeliveryMessages(delivery: DeliveryRow): MessageRow[] {
    const ids = JSON.parse(delivery.message_ids) as string[]
    if (ids.length === 0) {
      return []
    }
    const rows = this.db
      .prepare(`SELECT * FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as MessageRow[]
    const byId = new Map(rows.map((row) => [row.id, row]))
    return exposeMessageListTimestamps(
      ids.map((id) => byId.get(id)).filter((row): row is MessageRow => row !== undefined)
    )
  }

  getOrCreateRunDelivery(params: {
    runId: string
    consumerGeneration: number
    limit?: number
    wakeTypes?: MessageType[]
  }): { delivery: DeliveryRow; messages: MessageRow[]; replayed: boolean } | undefined {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 50)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.requireCurrentConsumer(params.runId, params.consumerGeneration)
      const existing = this.db
        .prepare("SELECT * FROM deliveries WHERE run_id = ? AND status = 'outstanding'")
        .get(params.runId) as DeliveryRow | undefined
      if (existing) {
        if (existing.consumer_generation !== params.consumerGeneration) {
          throw new OrchestrationError(
            'consumer_fenced',
            'This mailbox Delivery belongs to a fenced consumer generation.'
          )
        }
        const messages = this.getDeliveryMessages(existing)
        this.db.exec('COMMIT')
        return { delivery: exposeDeliveryTimestamps(existing), messages, replayed: true }
      }

      const address = `run:${params.runId}`
      if (params.wakeTypes && params.wakeTypes.length > 0) {
        const placeholders = params.wakeTypes.map(() => '?').join(',')
        const matching = this.db
          .prepare(
            `SELECT 1 FROM messages
             WHERE run_id = ? AND to_handle = ? AND read = 0
               AND delivery_contract = 'current_delivery'
               AND type IN (${placeholders}) LIMIT 1`
          )
          .get(params.runId, address, ...params.wakeTypes)
        if (!matching) {
          this.db.exec('COMMIT')
          return undefined
        }
      }

      const messages = exposeMessageListTimestamps(
        this.db
          .prepare(
            `SELECT * FROM messages
             WHERE run_id = ? AND to_handle = ? AND read = 0
               AND delivery_contract = 'current_delivery'
             ORDER BY sequence ASC LIMIT ?`
          )
          .all(params.runId, address, limit) as MessageRow[]
      )
      if (messages.length === 0) {
        this.db.exec('COMMIT')
        return undefined
      }

      const deliveryId = generateId('delivery')
      this.db
        .prepare(
          `INSERT INTO deliveries (id, run_id, consumer_generation, message_ids)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          deliveryId,
          params.runId,
          params.consumerGeneration,
          JSON.stringify(messages.map((message) => message.id))
        )
      const delivery = this.getDeliveryRaw(deliveryId) as DeliveryRow
      this.db.exec('COMMIT')
      return { delivery: exposeDeliveryTimestamps(delivery), messages, replayed: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  acknowledgeRunDelivery(params: {
    runId: string
    consumerGeneration: number
    deliveryId: string
  }): { delivery: DeliveryRow; duplicate: boolean } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.requireCurrentConsumer(params.runId, params.consumerGeneration)
      const delivery = this.getDeliveryRaw(params.deliveryId)
      if (!delivery || delivery.run_id !== params.runId) {
        throw new OrchestrationError(
          'stale_delivery',
          `Delivery ${params.deliveryId} does not belong to this Run.`
        )
      }
      if (
        delivery.consumer_generation !== params.consumerGeneration ||
        delivery.status === 'fenced'
      ) {
        throw new OrchestrationError(
          'consumer_fenced',
          'This mailbox Delivery belongs to a fenced consumer generation.'
        )
      }
      if (delivery.status === 'acknowledged') {
        this.db.exec('COMMIT')
        return { delivery: exposeDeliveryTimestamps(delivery), duplicate: true }
      }

      const messageIds = JSON.parse(delivery.message_ids) as string[]
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',')
        this.db
          .prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`)
          .run(...messageIds)
      }
      this.db
        .prepare(
          "UPDATE deliveries SET status = 'acknowledged', acknowledged_at = datetime('now') WHERE id = ?"
        )
        .run(delivery.id)
      const acknowledged = this.getDeliveryRaw(delivery.id) as DeliveryRow
      this.db.exec('COMMIT')
      return { delivery: exposeDeliveryTimestamps(acknowledged), duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getRunMailboxHistory(runId: string, limit = 100, types?: MessageType[]): MessageRow[] {
    const address = `run:${runId}`
    if (types && types.length > 0) {
      const placeholders = types.map(() => '?').join(',')
      return exposeMessageListTimestamps(
        this.db
          .prepare(
            `SELECT * FROM messages WHERE run_id = ? AND to_handle = ?
             AND type IN (${placeholders}) ORDER BY sequence DESC LIMIT ?`
          )
          .all(runId, address, ...types, limit) as MessageRow[]
      )
    }
    return exposeMessageListTimestamps(
      this.db
        .prepare(
          `SELECT * FROM messages WHERE run_id = ? AND to_handle = ?
           ORDER BY sequence DESC LIMIT ?`
        )
        .all(runId, address, limit) as MessageRow[]
    )
  }

  // ── Messages ──

  insertMessage(msg: {
    id?: string
    from: string
    to: string
    subject: string
    body?: string
    type?: MessageType
    priority?: MessagePriority
    threadId?: string
    payload?: string
    senderPaneKey?: string
    runId?: string
    deliveryContract?: MessageDeliveryContract
  }): MessageRow {
    const runId = msg.runId ?? LEGACY_RUN_ID
    const deliveryContract = msg.deliveryContract ?? 'current_delivery'
    this.requireRun(runId)
    const id = msg.id ?? generateId('msg')
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, run_id, delivery_contract, from_handle, to_handle, subject, body,
        type, priority, thread_id, payload, sender_pane_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      runId,
      deliveryContract,
      msg.from,
      msg.to,
      msg.subject,
      msg.body ?? '',
      msg.type ?? 'status',
      msg.priority ?? 'normal',
      msg.threadId ?? null,
      msg.payload ?? null,
      msg.senderPaneKey ?? null
    )
    return exposeMessageTimestamps(
      this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow
    )
  }

  commitLegacyLifecycleOperation(params: {
    principalId: string
    operationKey: string
    method: string
    payloadHash: string
    message: {
      existingId?: string
      to: string
      subject: string
      body?: string
      type: MessageType
      priority?: MessagePriority
      payload?: string
    }
    lifecycle:
      | { kind: 'message_only' }
      | { kind: 'heartbeat'; at: string }
      | {
          kind: 'worker_report'
          taskId: string
          outcome: WorkerReportOutcome
          result: string
        }
  }): {
    receipt: LegacyOperationReceiptRow
    message: MessageRow
    settlement?: WorkerReportSettlement
    duplicate: boolean
  } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const principal = this.getLegacyCompatibilityPrincipal(params.principalId)
      if (
        !principal ||
        principal.role !== 'worker' ||
        !['committed', 'settled'].includes(principal.status)
      ) {
        throw new OrchestrationError(
          'request_mismatch',
          `Legacy compatibility principal ${params.principalId} cannot send lifecycle work.`
        )
      }
      const dispatchId = principal.dispatch_id as string
      const existingReceipt = this.requireMatchingLegacyOperationReceipt(params)
      if (existingReceipt) {
        const response = JSON.parse(existingReceipt.response_json) as {
          messageId: string
          settlement?: WorkerReportSettlement
        }
        const message = this.getMessageById(response.messageId)
        if (!message) {
          throw new OrchestrationError(
            'operation_unknown',
            `Legacy operation ${params.operationKey} lost its recorded message.`
          )
        }
        this.db.exec('COMMIT')
        return {
          receipt: existingReceipt,
          message,
          settlement: response.settlement,
          duplicate: true
        }
      }

      const dispatch = this.getDispatchContextById(dispatchId)
      if (
        !dispatch ||
        dispatch.run_id !== principal.run_id ||
        dispatch.contract_version !== LEGACY_CONTRACT_VERSION
      ) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${dispatchId} is not this principal's legacy attempt.`
        )
      }
      if (
        (principal.status === 'settled' || !['pending', 'dispatched'].includes(dispatch.status)) &&
        (!params.message.existingId || params.lifecycle.kind !== 'worker_report')
      ) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${dispatchId} is settled and only matching completion reconstruction is allowed.`
        )
      }
      let message = params.message.existingId
        ? this.getMessageById(params.message.existingId)
        : undefined
      const delivery = this.resolveLegacyWorkerCoordinatorDelivery(
        principal.run_id,
        params.message.to
      )
      if (params.message.existingId) {
        const matchesOriginalLegacyRoute =
          message?.delivery_contract === 'legacy_direct' && message.to_handle === params.message.to
        const matchesCurrentRoute =
          message?.delivery_contract === delivery.contract && message.to_handle === delivery.to
        if (
          !message ||
          message.run_id !== principal.run_id ||
          message.from_handle !== principal.terminal_handle ||
          (!matchesOriginalLegacyRoute && !matchesCurrentRoute)
        ) {
          throw new OrchestrationError(
            'request_mismatch',
            `Existing legacy message ${params.message.existingId} does not match this principal.`
          )
        }
      } else {
        message = this.insertMessage({
          from: principal.terminal_handle,
          to: delivery.to,
          subject: params.message.subject,
          body: params.message.body,
          type: params.message.type,
          priority: params.message.priority,
          payload: params.message.payload,
          senderPaneKey: principal.pane_key,
          runId: principal.run_id,
          deliveryContract: delivery.contract
        })
      }

      let settlement: WorkerReportSettlement | undefined
      if (params.lifecycle.kind === 'heartbeat') {
        this.recordHeartbeat(dispatchId, params.lifecycle.at)
      } else if (params.lifecycle.kind === 'worker_report') {
        const persistedOutcome =
          params.message.existingId &&
          dispatch.task_id === params.lifecycle.taskId &&
          dispatch.status === 'completed'
            ? 'succeeded'
            : params.message.existingId &&
                dispatch.task_id === params.lifecycle.taskId &&
                dispatch.status === 'failed'
              ? 'failed'
              : undefined
        const reportSettlement = persistedOutcome
          ? { action: 'settled', outcome: persistedOutcome, duplicate: true }
          : this.settleWorkerReportInTransaction({
              taskId: params.lifecycle.taskId,
              dispatchId,
              outcome: params.lifecycle.outcome,
              result: params.lifecycle.result
            })
        settlement = reportSettlement
        if (reportSettlement.action === 'rejected') {
          throw new OrchestrationError(reportSettlement.code, reportSettlement.reason)
        }
        this.db
          .prepare(
            `UPDATE legacy_compatibility_principals
             SET status = 'settled' WHERE id = ? AND status = 'committed'`
          )
          .run(principal.id)
      }
      const responseJson = JSON.stringify({ messageId: message.id, settlement })
      const receipt = this.insertLegacyOperationReceipt({
        principalId: principal.id,
        operationKey: params.operationKey,
        method: params.method,
        payloadHash: params.payloadHash,
        effectId: message.id,
        responseJson
      })
      this.db.exec('COMMIT')
      return { receipt, message, settlement, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  commitLegacyAskOperation(params: {
    principalId: string
    operationKey: string
    method: string
    payloadHash: string
    question: string
    options?: string[]
    recipientHandle: string
    existingQuestionId?: string
  }): {
    receipt: LegacyOperationReceiptRow
    question: QuestionRow
    message: MessageRow
    duplicate: boolean
  } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const principal = this.requireCommittedLegacyPrincipal(params.principalId, 'worker')
      const receipt = this.requireMatchingLegacyOperationReceipt(params)
      if (receipt) {
        const response = JSON.parse(receipt.response_json) as { questionId: string }
        const question = this.getQuestion(response.questionId)
        const message = this.getMessageById(response.questionId)
        if (!question || !message) {
          throw new OrchestrationError(
            'operation_unknown',
            `Legacy ask ${params.operationKey} lost its durable question.`
          )
        }
        this.db.exec('COMMIT')
        return { receipt, question, message, duplicate: true }
      }

      const dispatchId = principal.dispatch_id as string
      const dispatch = this.getDispatchContextById(dispatchId)
      if (
        !dispatch ||
        dispatch.run_id !== principal.run_id ||
        dispatch.contract_version !== LEGACY_CONTRACT_VERSION ||
        !['pending', 'dispatched'].includes(dispatch.status)
      ) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${dispatchId} is not an active legacy attempt.`
        )
      }

      const existingQuestionId =
        params.existingQuestionId &&
        !this.db
          .prepare(
            `SELECT 1 FROM legacy_operation_receipts
             WHERE principal_id = ? AND method = 'orchestration.ask' AND effect_id = ?
             LIMIT 1`
          )
          .get(principal.id, params.existingQuestionId)
          ? params.existingQuestionId
          : undefined
      let question: QuestionRow
      let message: MessageRow
      const delivery = this.resolveLegacyWorkerCoordinatorDelivery(
        principal.run_id,
        params.recipientHandle
      )
      if (existingQuestionId) {
        const existingQuestion = this.getQuestion(existingQuestionId)
        const existingMessage = this.getMessageById(existingQuestionId)
        if (
          !existingQuestion ||
          !existingMessage ||
          existingQuestion.run_id !== principal.run_id ||
          existingQuestion.dispatch_id !== dispatchId ||
          existingQuestion.status !== 'pending' ||
          existingMessage.delivery_contract !== delivery.contract ||
          !legacyMessageMatchesQuestion(existingMessage, params.question, params.options ?? [], [
            delivery.to
          ])
        ) {
          throw new OrchestrationError(
            'request_mismatch',
            `Question ${params.existingQuestionId} is not a pending ask for this principal.`
          )
        }
        question = existingQuestion
        message = existingMessage
      } else {
        message = this.insertMessage({
          from: principal.terminal_handle,
          to: delivery.to,
          subject: 'Question',
          body: params.question,
          type: delivery.contract === 'legacy_direct' ? 'decision_gate' : 'question',
          payload: JSON.stringify({
            taskId: dispatch.task_id,
            dispatchId,
            question: params.question,
            options: params.options ?? []
          }),
          senderPaneKey: principal.pane_key,
          runId: principal.run_id,
          deliveryContract: delivery.contract
        })
        this.db
          .prepare('UPDATE messages SET thread_id = ? WHERE id = ?')
          .run(message.id, message.id)
        this.db
          .prepare(
            `INSERT INTO question_threads (
               message_id, run_id, dispatch_id, asker_handle
             ) VALUES (?, ?, ?, ?)`
          )
          .run(message.id, principal.run_id, dispatchId, principal.terminal_handle)
        question = this.getQuestion(message.id) as QuestionRow
        message = this.getMessageById(message.id) as MessageRow
      }

      const committedReceipt = this.insertLegacyOperationReceipt({
        principalId: principal.id,
        operationKey: params.operationKey,
        method: params.method,
        payloadHash: params.payloadHash,
        effectId: question.message_id,
        responseJson: JSON.stringify({ questionId: question.message_id })
      })
      this.db.exec('COMMIT')
      return { receipt: committedReceipt, question, message, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

}
