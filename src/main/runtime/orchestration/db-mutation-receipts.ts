

import Database from '../../sqlite/sync-database'
import type {
  DispatchContextRow,
  LegacyAdoptionRow,
  LegacyCompatibilityPrincipalRow,
  LegacyPrincipalRole,
  MutationReceiptRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  generateId,
  isEquivalentPaneKey} from './db-contract-helpers'




import {
  LEGACY_RUN_ID,
  LEGACY_CONTRACT_VERSION} from './db-foundation'
import { OrchestrationDatabaseMigrations } from './db-migrations'

export class OrchestrationDatabaseMutationReceipts extends OrchestrationDatabaseMigrations {
  beginMutationReceipt(params: {
    callerFingerprint: string
    requestId: string
    method: string
    payloadHash: string
  }):
    | { disposition: 'started'; row: MutationReceiptRow }
    | { disposition: 'pending'; row: MutationReceiptRow }
    | { disposition: 'completed'; row: MutationReceiptRow } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.getMutationReceipt(params.callerFingerprint, params.requestId)
      if (existing) {
        if (existing.method !== params.method || existing.payload_hash !== params.payloadHash) {
          throw new OrchestrationError(
            'request_mismatch',
            `Mutation request ${params.requestId} was already used with different input.`
          )
        }
        this.db.exec('COMMIT')
        return { disposition: existing.state, row: existing }
      }
      this.ensureMutationReceiptCapacity()
      this.db
        .prepare(
          `INSERT INTO mutation_receipts (
             caller_fingerprint, request_id, method, payload_hash, state
           ) VALUES (?, ?, ?, ?, 'pending')`
        )
        .run(params.callerFingerprint, params.requestId, params.method, params.payloadHash)
      const row = this.getMutationReceipt(params.callerFingerprint, params.requestId)
      this.db.exec('COMMIT')
      return { disposition: 'started', row: row as MutationReceiptRow }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  completeMutationReceipt(params: {
    callerFingerprint: string
    requestId: string
    method: string
    payloadHash: string
    receipt: string
  }): MutationReceiptRow {
    const result = this.db
      .prepare(
        `UPDATE mutation_receipts
         SET state = 'completed', receipt = ?, updated_at = datetime('now')
         WHERE caller_fingerprint = ? AND request_id = ? AND method = ?
           AND payload_hash = ?`
      )
      .run(
        params.receipt,
        params.callerFingerprint,
        params.requestId,
        params.method,
        params.payloadHash
      )
    const row = this.getMutationReceipt(params.callerFingerprint, params.requestId)
    if (result.changes !== 1 || !row) {
      throw new OrchestrationError(
        'request_mismatch',
        `Mutation request ${params.requestId} no longer matches its pending operation.`
      )
    }
    return row
  }

  discardPendingMutationReceipt(callerFingerprint: string, requestId: string): void {
    this.db
      .prepare(
        `DELETE FROM mutation_receipts
         WHERE caller_fingerprint = ? AND request_id = ? AND state = 'pending'`
      )
      .run(callerFingerprint, requestId)
  }

  getMutationReceipt(callerFingerprint: string, requestId: string): MutationReceiptRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM mutation_receipts
         WHERE caller_fingerprint = ? AND request_id = ?`
      )
      .get(callerFingerprint, requestId) as MutationReceiptRow | undefined
  }

  // ── Legacy adoption and compatibility principals ──

  getLegacyAdoption(): LegacyAdoptionRow | undefined {
    return this.db
      .prepare('SELECT * FROM legacy_adoptions WHERE source_run_id = ?')
      .get(LEGACY_RUN_ID) as LegacyAdoptionRow | undefined
  }

  commitLegacyCompatibilityPrincipal(params: {
    runId: string
    dispatchId?: string
    role: LegacyPrincipalRole
    hostScope: string
    terminalHandle: string
    paneKey: string
    launchTokenHash: string
    processIncarnation?: string
  }): { principal: LegacyCompatibilityPrincipalRow; duplicate: boolean } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const adoption = this.getLegacyAdoption()
      if (!adoption || adoption.adopted_run_id !== params.runId) {
        throw new OrchestrationError(
          'request_mismatch',
          `Run ${params.runId} is not the adopted legacy Run.`
        )
      }
      const dispatchId = params.role === 'worker' ? (params.dispatchId ?? null) : null
      let initialStatus: 'committed' | 'settled' = 'committed'
      if (params.role === 'worker') {
        const dispatch = dispatchId ? this.getDispatchContextById(dispatchId) : undefined
        if (
          !dispatch ||
          dispatch.run_id !== params.runId ||
          dispatch.contract_version !== LEGACY_CONTRACT_VERSION
        ) {
          throw new OrchestrationError(
            'request_mismatch',
            `Dispatch ${dispatchId ?? '(missing)'} is not a legacy attempt in this Run.`
          )
        }
        initialStatus = ['pending', 'dispatched'].includes(dispatch.status)
          ? 'committed'
          : 'settled'
      } else if (params.dispatchId) {
        throw new OrchestrationError(
          'request_mismatch',
          'A coordinator compatibility principal cannot name a Dispatch.'
        )
      }

      const existing = this.db
        .prepare(
          `SELECT * FROM legacy_compatibility_principals
           WHERE role = ? AND run_id = ? AND dispatch_id IS ?`
        )
        .get(params.role, params.runId, dispatchId) as LegacyCompatibilityPrincipalRow | undefined
      if (existing) {
        const same =
          existing.host_scope === params.hostScope &&
          existing.terminal_handle === params.terminalHandle &&
          existing.pane_key === params.paneKey &&
          existing.launch_token_hash === params.launchTokenHash &&
          existing.process_incarnation === (params.processIncarnation ?? null)
        if (!same) {
          throw new OrchestrationError(
            'request_mismatch',
            `The ${params.role} compatibility principal is already committed to different proof.`
          )
        }
        if (existing.status === 'revoked') {
          throw new OrchestrationError(
            'legacy_read_only',
            `The ${params.role} compatibility principal has been revoked. No effects were applied.`,
            { effectsApplied: false }
          )
        }
        this.db.exec('COMMIT')
        return { principal: existing, duplicate: true }
      }
      if (
        params.role === 'coordinator' &&
        !this.resolveLegacyCoordinatorCandidate({
          runId: params.runId,
          terminalHandle: params.terminalHandle,
          paneKey: params.paneKey
        })
      ) {
        throw new OrchestrationError(
          'legacy_read_only',
          'This retained legacy coordinator no longer has lifecycle authority. No effects were applied.',
          { effectsApplied: false }
        )
      }

      const id = generateId('legacy_principal')
      this.db
        .prepare(
          `INSERT INTO legacy_compatibility_principals (
             id, run_id, dispatch_id, role, host_scope, terminal_handle,
             pane_key, launch_token_hash, process_incarnation, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          params.runId,
          dispatchId,
          params.role,
          params.hostScope,
          params.terminalHandle,
          params.paneKey,
          params.launchTokenHash,
          params.processIncarnation ?? null,
          initialStatus
        )
      const principal = this.getLegacyCompatibilityPrincipal(id) as LegacyCompatibilityPrincipalRow
      if (principal.status === 'committed') {
        this.initializeLegacyRecoveryCohort(principal)
      }
      this.db.exec('COMMIT')
      return { principal, duplicate: false }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getLegacyCompatibilityPrincipal(id: string): LegacyCompatibilityPrincipalRow | undefined {
    return this.db.prepare('SELECT * FROM legacy_compatibility_principals WHERE id = ?').get(id) as
      | LegacyCompatibilityPrincipalRow
      | undefined
  }

  listLegacyCompatibilityPrincipals(runId: string): LegacyCompatibilityPrincipalRow[] {
    return this.db
      .prepare(
        `SELECT * FROM legacy_compatibility_principals
         WHERE run_id = ? ORDER BY rowid`
      )
      .all(runId) as LegacyCompatibilityPrincipalRow[]
  }

  getLegacyCoordinatorPrincipal(runId: string): LegacyCompatibilityPrincipalRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM legacy_compatibility_principals
         WHERE run_id = ? AND role = 'coordinator'`
      )
      .get(runId) as LegacyCompatibilityPrincipalRow | undefined
  }

  resolveLegacyCompatibilityPrincipalByIdentity(params: {
    runId: string
    role: LegacyPrincipalRole
    terminalHandle?: string
    paneKey?: string
  }): LegacyCompatibilityPrincipalRow | undefined {
    if (!params.terminalHandle && !params.paneKey) {
      return undefined
    }
    const rows = (
      this.db
        .prepare(
          `SELECT * FROM legacy_compatibility_principals
           WHERE run_id = ? AND role = ? AND status IN ('committed', 'settled')
           ORDER BY rowid`
        )
        .all(params.runId, params.role) as LegacyCompatibilityPrincipalRow[]
    ).filter((principal) =>
      params.paneKey
        ? isEquivalentPaneKey(principal.pane_key, params.paneKey)
        : principal.terminal_handle === params.terminalHandle
    )
    if (rows.length > 1) {
      throw new OrchestrationError(
        'operation_unknown',
        'Multiple legacy principals match this process identity.'
      )
    }
    return rows[0]
  }

  resolveLegacyWorkerCandidate(params: {
    runId?: string
    terminalHandle?: string
    paneKey?: string
    dispatchId?: string
    taskId?: string
  }): { dispatch: DispatchContextRow } | undefined {
    if (!params.runId || (!params.terminalHandle && !params.paneKey)) {
      return undefined
    }
    const rows = (
      params.dispatchId
        ? [this.getDispatchContextById(params.dispatchId)].filter(
            (row): row is DispatchContextRow => row !== undefined
          )
        : (this.db
            .prepare(
              `SELECT * FROM dispatch_contexts
               WHERE run_id = ? AND contract_version = ?
                 AND status IN ('pending', 'dispatched')
               ORDER BY rowid`
            )
            .all(params.runId, LEGACY_CONTRACT_VERSION) as DispatchContextRow[])
    ).filter(
      (dispatch) =>
        dispatch.run_id === params.runId &&
        dispatch.contract_version === LEGACY_CONTRACT_VERSION &&
        (!params.taskId || dispatch.task_id === params.taskId) &&
        (params.paneKey
          ? Boolean(
              dispatch.assignee_pane_key &&
              isEquivalentPaneKey(dispatch.assignee_pane_key, params.paneKey)
            )
          : dispatch.assignee_handle === params.terminalHandle)
    )
    if (rows.length > 1) {
      throw new OrchestrationError(
        'operation_unknown',
        'Multiple active legacy Dispatches match this process identity.'
      )
    }
    if (params.dispatchId && rows.length === 0) {
      const target = this.getDispatchContextById(params.dispatchId)
      if (target?.contract_version === LEGACY_CONTRACT_VERSION) {
        throw new OrchestrationError(
          'legacy_read_only',
          `Dispatch ${params.dispatchId} is retained but this process cannot prove ownership.`
        )
      }
    }
    return rows[0] ? { dispatch: rows[0] } : undefined
  }

  resolveLegacyCoordinatorCandidate(params: {
    runId: string
    terminalHandle?: string
    paneKey?: string
  }): { terminalHandle: string; paneKey: string } | undefined {
    if (!params.terminalHandle || !params.paneKey) {
      return undefined
    }
    const run = this.getRunRaw(params.runId)
    const principal = this.getLegacyCoordinatorPrincipal(params.runId)
    if (principal) {
      if (
        principal.status !== 'committed' ||
        principal.terminal_handle !== params.terminalHandle ||
        !isEquivalentPaneKey(principal.pane_key, params.paneKey) ||
        (run?.coordinator_pane_key !== null &&
          (run?.coordinator_handle !== principal.terminal_handle ||
            !isEquivalentPaneKey(run.coordinator_pane_key, principal.pane_key)))
      ) {
        return undefined
      }
      return { terminalHandle: params.terminalHandle, paneKey: params.paneKey }
    }
    // Why: the first current binding durably fences uncommitted legacy processes.
    if (
      !run ||
      run.coordinator_pane_key !== null ||
      this.getUniqueLegacyCoordinatorHandle(params.runId) !== params.terminalHandle
    ) {
      return undefined
    }
    return { terminalHandle: params.terminalHandle, paneKey: params.paneKey }
  }

}

