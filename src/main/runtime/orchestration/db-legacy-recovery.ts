

import type {
  MessageType,
  MessageRow,
  LegacyCompatibilityPrincipalRow,
  LegacyPrincipalRole,
  LegacyOperationReceiptRow,
  LegacyMailReceiptRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  exposeMessageListTimestamps,
  exposeMessageTimestamps} from './db-contract-helpers'




import {
  LEGACY_CONTRACT_VERSION} from './db-foundation'
import { OrchestrationDatabaseMutationReceipts } from './db-mutation-receipts'

export class OrchestrationDatabaseLegacyRecovery extends OrchestrationDatabaseMutationReceipts {
  isLegacyCoordinatorHandle(runId: string, terminalHandle: string): boolean {
    const principal = this.getLegacyCoordinatorPrincipal(runId)
    if (principal) {
      return principal.terminal_handle === terminalHandle
    }
    return this.getUniqueLegacyCoordinatorHandle(runId) === terminalHandle
  }

  findLegacyWorkerCompletion(params: {
    principalId: string
    taskId: string
    recipientHandle: string
    subject: string
    body: string
    payload: string | null
  }): MessageRow | undefined {
    const principal = this.getLegacyCompatibilityPrincipal(params.principalId)
    if (!principal || principal.role !== 'worker' || !principal.dispatch_id) {
      throw new OrchestrationError('request_mismatch', 'Legacy worker principal was not found.')
    }
    const runAddress = `run:${principal.run_id}`
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE run_id = ?
           AND (
             (delivery_contract = 'legacy_direct' AND to_handle = ?) OR
             (delivery_contract = 'current_delivery' AND to_handle = ?)
           )
           AND from_handle = ? AND type = 'worker_done'
           AND subject = ? AND body = ? AND payload IS ?
         ORDER BY sequence`
      )
      .all(
        principal.run_id,
        params.recipientHandle,
        runAddress,
        principal.terminal_handle,
        params.subject,
        params.body,
        params.payload
      ) as MessageRow[]
    const matches = rows.filter((message) => {
      try {
        const payload = JSON.parse(message.payload ?? '{}') as {
          taskId?: unknown
          dispatchId?: unknown
        }
        return payload.taskId === params.taskId && payload.dispatchId === principal.dispatch_id
      } catch {
        return false
      }
    })
    if (matches.length > 1) {
      throw new OrchestrationError(
        'operation_unknown',
        'Multiple matching legacy worker completions exist.'
      )
    }
    return matches[0] ? exposeMessageTimestamps(matches[0]) : undefined
  }

  hasPendingCurrentDelivery(runId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM messages
           WHERE run_id = ? AND to_handle = ?
             AND delivery_contract = 'current_delivery' AND read = 0
           LIMIT 1`
        )
        .get(runId, `run:${runId}`)
    )
  }

  setLegacyCompatibilityPrincipalStatus(
    id: string,
    status: 'settled' | 'revoked'
  ): LegacyCompatibilityPrincipalRow | undefined {
    this.db
      .prepare(
        `UPDATE legacy_compatibility_principals
         SET status = ?
         WHERE id = ? AND status = 'committed'`
      )
      .run(status, id)
    return this.getLegacyCompatibilityPrincipal(id)
  }

  getLegacyOperationReceipt(
    principalId: string,
    operationKey: string
  ): LegacyOperationReceiptRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM legacy_operation_receipts
         WHERE principal_id = ? AND operation_key = ?`
      )
      .get(principalId, operationKey) as LegacyOperationReceiptRow | undefined
  }

  protected requireCommittedLegacyPrincipal(
    principalId: string,
    role?: LegacyPrincipalRole
  ): LegacyCompatibilityPrincipalRow {
    const principal = this.getLegacyCompatibilityPrincipal(principalId)
    if (!principal || principal.status !== 'committed' || (role && principal.role !== role)) {
      throw new OrchestrationError(
        'request_mismatch',
        `Legacy compatibility principal ${principalId} is not committed for this operation.`
      )
    }
    return principal
  }

  protected requireLegacyMailPrincipal(
    principalId: string,
    role?: LegacyPrincipalRole
  ): LegacyCompatibilityPrincipalRow {
    const principal = this.getLegacyCompatibilityPrincipal(principalId)
    if (
      !principal ||
      !['committed', 'settled'].includes(principal.status) ||
      (role && principal.role !== role)
    ) {
      throw new OrchestrationError(
        'request_mismatch',
        `Legacy compatibility principal ${principalId} cannot access retained mail.`
      )
    }
    return principal
  }

  protected initializeLegacyRecoveryCohort(principal: LegacyCompatibilityPrincipalRow): void {
    if (principal.role === 'worker') {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO legacy_mail_receipts (
             principal_id, message_id, acknowledged_at
           )
           SELECT ?, m.id, NULL
           FROM messages m
           INNER JOIN dispatch_contexts d ON d.id = ?
           WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct' AND m.read = 1
             AND d.status IN ('pending', 'dispatched')
             AND m.created_at >= d.created_at
             AND (m.to_handle = ? OR m.to_handle = ?)`
        )
        .run(
          principal.id,
          principal.dispatch_id,
          principal.run_id,
          principal.terminal_handle,
          `dispatch:${principal.dispatch_id}`
        )
      return
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO legacy_mail_receipts (
           principal_id, message_id, acknowledged_at
         )
         SELECT ?, m.id, NULL
         FROM messages m
         WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct' AND m.read = 1
           AND m.to_handle = ?
           AND EXISTS(
             SELECT 1 FROM dispatch_contexts d
             WHERE d.run_id = m.run_id
               AND d.contract_version = ?
               AND d.status IN ('pending', 'dispatched')
               AND m.created_at >= d.created_at
               AND (m.from_handle = d.assignee_handle OR m.from_handle = 'dispatch:' || d.id)
           )`
      )
      .run(principal.id, principal.run_id, principal.terminal_handle, LEGACY_CONTRACT_VERSION)
  }

  getLegacyMailPage(params: { principalId: string; limit?: number; types?: MessageType[] }): {
    messages: MessageRow[]
    recovery: boolean
  } {
    const principal = this.requireLegacyMailPrincipal(params.principalId)
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 50)
    const addressSql =
      principal.role === 'worker' ? '(m.to_handle = ? OR m.to_handle = ?)' : 'm.to_handle = ?'
    const addressParams =
      principal.role === 'worker'
        ? [principal.terminal_handle, `dispatch:${principal.dispatch_id}`]
        : [principal.terminal_handle]
    const typeSql =
      params.types && params.types.length > 0
        ? `AND m.type IN (${params.types.map(() => '?').join(',')})`
        : ''
    const typeParams = params.types ?? []
    const recovery = this.db
      .prepare(
        `SELECT m.*
         FROM legacy_mail_receipts r
         INNER JOIN messages m ON m.id = r.message_id
         WHERE r.principal_id = ? AND r.acknowledged_at IS NULL
           AND m.run_id = ? AND m.delivery_contract = 'legacy_direct'
           AND ${addressSql}
           ${typeSql}
         ORDER BY m.sequence ASC LIMIT ?`
      )
      .all(
        params.principalId,
        principal.run_id,
        ...addressParams,
        ...typeParams,
        limit
      ) as MessageRow[]
    if (recovery.length > 0) {
      return { messages: exposeMessageListTimestamps(recovery), recovery: true }
    }

    const unread = this.db
      .prepare(
        `SELECT m.*
         FROM messages m
         LEFT JOIN legacy_mail_receipts r
           ON r.principal_id = ? AND r.message_id = m.id
         WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct'
           AND m.read = 0 AND r.message_id IS NULL AND ${addressSql}
           ${typeSql}
         ORDER BY m.sequence ASC LIMIT ?`
      )
      .all(
        params.principalId,
        principal.run_id,
        ...addressParams,
        ...typeParams,
        limit
      ) as MessageRow[]
    return { messages: exposeMessageListTimestamps(unread), recovery: false }
  }

  getLegacyMailHistory(params: { principalId: string; limit?: number; types?: MessageType[] }): {
    messages: MessageRow[]
    recovery: false
  } {
    const principal = this.requireLegacyMailPrincipal(params.principalId)
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 100)
    const addressSql =
      principal.role === 'worker' ? '(to_handle = ? OR to_handle = ?)' : 'to_handle = ?'
    const addressParams =
      principal.role === 'worker'
        ? [principal.terminal_handle, `dispatch:${principal.dispatch_id}`]
        : [principal.terminal_handle]
    const typeSql =
      params.types && params.types.length > 0
        ? `AND type IN (${params.types.map(() => '?').join(',')})`
        : ''
    const messages = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE run_id = ? AND delivery_contract = 'legacy_direct'
           AND ${addressSql} ${typeSql}
         ORDER BY sequence ASC LIMIT ?`
      )
      .all(principal.run_id, ...addressParams, ...(params.types ?? []), limit) as MessageRow[]
    return { messages: exposeMessageListTimestamps(messages), recovery: false }
  }

  acknowledgeLegacyMail(params: {
    principalId: string
    messageIds: string[]
    types?: MessageType[]
  }): {
    receipts: LegacyMailReceiptRow[]
    duplicate: boolean
  } {
    if (params.messageIds.length === 0) {
      return { receipts: [], duplicate: true }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const principal = this.requireLegacyMailPrincipal(params.principalId)
      const uniqueIds = [...new Set(params.messageIds)]
      const placeholders = uniqueIds.map(() => '?').join(',')
      const prior = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM legacy_mail_receipts
           WHERE principal_id = ? AND message_id IN (${placeholders})
             AND acknowledged_at IS NOT NULL`
        )
        .get(params.principalId, ...uniqueIds) as { count: number }
      if (prior.count !== uniqueIds.length) {
        const actionable = this.getLegacyMailPage({
          principalId: params.principalId,
          limit: uniqueIds.length,
          types: params.types
        }).messages
        if (
          actionable.length !== uniqueIds.length ||
          actionable.some((message, index) => message.id !== uniqueIds[index])
        ) {
          throw new OrchestrationError(
            'request_mismatch',
            'Legacy mail acknowledgment does not match the current replay page.'
          )
        }
      }
      const rows = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE id IN (${placeholders}) AND run_id = ?
             AND delivery_contract = 'legacy_direct'`
        )
        .all(...uniqueIds, principal.run_id) as MessageRow[]
      const validIds = new Set(
        rows
          .filter(
            (message) =>
              message.to_handle === principal.terminal_handle ||
              (principal.role === 'worker' &&
                message.to_handle === `dispatch:${principal.dispatch_id}`)
          )
          .map((message) => message.id)
      )
      if (validIds.size !== uniqueIds.length || uniqueIds.some((id) => !validIds.has(id))) {
        throw new OrchestrationError(
          'request_mismatch',
          'Legacy mail acknowledgment contains a message outside this principal inbox.'
        )
      }

      this.db
        .prepare(
          `UPDATE messages
           SET read = 1, delivered_at = COALESCE(delivered_at, datetime('now'))
           WHERE id IN (${placeholders})`
        )
        .run(...uniqueIds)
      const insert = this.db.prepare(
        `INSERT INTO legacy_mail_receipts (
           principal_id, message_id, acknowledged_at
         ) VALUES (?, ?, datetime('now'))
         ON CONFLICT(principal_id, message_id)
         DO UPDATE SET acknowledged_at = COALESCE(
           legacy_mail_receipts.acknowledged_at, excluded.acknowledged_at
         )`
      )
      for (const messageId of uniqueIds) {
        insert.run(params.principalId, messageId)
      }
      const receipts = this.db
        .prepare(
          `SELECT * FROM legacy_mail_receipts
           WHERE principal_id = ? AND message_id IN (${placeholders})
           ORDER BY message_id`
        )
        .all(params.principalId, ...uniqueIds) as LegacyMailReceiptRow[]
      this.db.exec('COMMIT')
      return { receipts, duplicate: prior.count === uniqueIds.length }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  acknowledgeLegacyQuestionAnswer(params: {
    principalId: string
    questionId: string
    answerMessageId: string
  }): { receipt: LegacyMailReceiptRow; duplicate: boolean } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const principal = this.requireLegacyMailPrincipal(params.principalId, 'worker')
      const question = this.getQuestionRaw(params.questionId)
      const source = this.getMessageById(params.questionId)
      const answer = this.getMessageById(params.answerMessageId)
      const dispatch = principal.dispatch_id
        ? this.getDispatchContextById(principal.dispatch_id)
        : undefined
      const exactLegacyAnswer =
        answer?.delivery_contract === 'legacy_direct' &&
        (answer.to_handle === principal.terminal_handle ||
          answer.to_handle === `dispatch:${principal.dispatch_id}`)
      const adoption = this.getLegacyAdoption()
      const exactTakenOverAnswer =
        adoption?.adopted_run_id === principal.run_id &&
        dispatch?.run_id === principal.run_id &&
        dispatch.contract_version === LEGACY_CONTRACT_VERSION &&
        source?.run_id === principal.run_id &&
        source.from_handle === principal.terminal_handle &&
        source.to_handle === `run:${principal.run_id}` &&
        source.delivery_contract === 'current_delivery' &&
        answer?.run_id === principal.run_id &&
        answer?.delivery_contract === 'current_delivery' &&
        answer.from_handle === `run:${principal.run_id}` &&
        answer.to_handle === `dispatch:${principal.dispatch_id}` &&
        answer.thread_id === question?.message_id
      if (
        !question ||
        !answer ||
        question.run_id !== principal.run_id ||
        question.dispatch_id !== principal.dispatch_id ||
        question.answer_message_id !== params.answerMessageId ||
        (!exactLegacyAnswer && !exactTakenOverAnswer)
      ) {
        throw new OrchestrationError(
          'request_mismatch',
          'Legacy answer acknowledgment does not match this principal question.'
        )
      }
      const existing = this.db
        .prepare(
          `SELECT * FROM legacy_mail_receipts
           WHERE principal_id = ? AND message_id = ?`
        )
        .get(params.principalId, params.answerMessageId) as LegacyMailReceiptRow | undefined
      this.db
        .prepare(
          `UPDATE messages
           SET read = 1, delivered_at = COALESCE(delivered_at, datetime('now'))
           WHERE id = ?`
        )
        .run(params.answerMessageId)
      this.db
        .prepare(
          `INSERT INTO legacy_mail_receipts (
             principal_id, message_id, acknowledged_at
           ) VALUES (?, ?, datetime('now'))
           ON CONFLICT(principal_id, message_id)
           DO UPDATE SET acknowledged_at = COALESCE(
             legacy_mail_receipts.acknowledged_at, excluded.acknowledged_at
           )`
        )
        .run(params.principalId, params.answerMessageId)
      const receipt = this.db
        .prepare(
          `SELECT * FROM legacy_mail_receipts
           WHERE principal_id = ? AND message_id = ?`
        )
        .get(params.principalId, params.answerMessageId) as LegacyMailReceiptRow
      this.db.exec('COMMIT')
      return { receipt, duplicate: Boolean(existing?.acknowledged_at) }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // ── Runs ──

}

