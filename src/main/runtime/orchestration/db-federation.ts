import { randomBytes, timingSafeEqual } from 'node:crypto'

import Database from '../../sqlite/sync-database'
import type {
  WorkerDispatchState,
  FederatedDispatchRow,
  RemoteDispatchAttachmentRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  hashDispatchCapability,
  isEquivalentPaneKey} from './db-contract-helpers'







import { OrchestrationDatabaseFederationRemoteLifecycle } from './db-federation-remote-lifecycle'
export class OrchestrationDatabaseFederation extends OrchestrationDatabaseFederationRemoteLifecycle {
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


}
