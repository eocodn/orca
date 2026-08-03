

import type {
  RunRow} from './types'


import { OrchestrationError } from './orchestration-error'
import {
  decodeRunListCursor,
  encodeRunListCursor,
  exposeRunTimestamps,
  generateId,
  isEquivalentPaneKey} from './db-contract-helpers'

import { ORCHESTRATION_RUN_PAGE_LIMIT } from '../../../shared/orchestration-run-pagination'


import {
  LEGACY_CONTRACT_VERSION,
  type RunListPage
} from './db-foundation'
import { OrchestrationDatabaseLegacyRecovery } from './db-legacy-recovery'

export class OrchestrationDatabaseRuns extends OrchestrationDatabaseLegacyRecovery {
  createRun(params: {
    objective: string
    coordinatorHandle: string
    coordinatorPaneKey: string
  }): RunRow {
    const id = generateId('run')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.unbindOtherRunsForPane(params.coordinatorPaneKey)
      this.db
        .prepare(
          `INSERT INTO runs (
             id, objective, coordinator_handle, coordinator_pane_key,
             consumer_generation, legacy
           ) VALUES (?, ?, ?, ?, 1, 0)`
        )
        .run(id, params.objective, params.coordinatorHandle, params.coordinatorPaneKey)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getRun(id) as RunRow
  }

  bindRun(params: {
    runId: string
    coordinatorHandle: string
    coordinatorPaneKey: string
    takeoverLegacy?: boolean
    legacyCoordinatorAuthority?: {
      runId: string
      principalId: string | null
      terminalHandle: string
      paneKey: string
      consumerGeneration: number
    }
  }): RunRow | undefined {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const run = this.getRunRaw(params.runId)
      if (!run || run.legacy === 1) {
        this.db.exec('ROLLBACK')
        return undefined
      }
      const sameBinding =
        run.coordinator_pane_key !== null &&
        isEquivalentPaneKey(run.coordinator_pane_key, params.coordinatorPaneKey)
      const adoption = this.getLegacyAdoption()
      const adoptedRun = adoption?.adopted_run_id === params.runId
      const legacyAuthority = params.legacyCoordinatorAuthority
      const legacyPrincipalId = legacyAuthority?.principalId
      const legacyPrincipal = legacyPrincipalId
        ? this.getLegacyCompatibilityPrincipal(legacyPrincipalId)
        : undefined
      const provenLegacyBinding = Boolean(
        adoptedRun &&
        legacyAuthority &&
        legacyAuthority.principalId !== null &&
        legacyAuthority.runId === params.runId &&
        legacyAuthority.consumerGeneration === run.consumer_generation &&
        legacyPrincipal?.run_id === params.runId &&
        legacyPrincipal.role === 'coordinator' &&
        legacyPrincipal.status === 'committed' &&
        legacyPrincipal.terminal_handle === legacyAuthority.terminalHandle &&
        isEquivalentPaneKey(legacyPrincipal.pane_key, legacyAuthority.paneKey) &&
        params.coordinatorHandle === legacyAuthority.terminalHandle &&
        isEquivalentPaneKey(params.coordinatorPaneKey, legacyAuthority.paneKey)
      )
      if (legacyAuthority && !provenLegacyBinding) {
        throw new OrchestrationError(
          'legacy_read_only',
          'This retained legacy coordinator no longer has lifecycle authority. No effects were applied.',
          { effectsApplied: false }
        )
      }
      const activeLegacyAssignment =
        adoptedRun &&
        Boolean(
          this.db
            .prepare(
              `SELECT 1 FROM dispatch_contexts
               WHERE run_id = ? AND contract_version = ?
                 AND status IN ('pending', 'dispatched')
               LIMIT 1`
            )
            .get(params.runId, LEGACY_CONTRACT_VERSION)
        )
      const coordinatorPrincipal = adoptedRun
        ? this.getLegacyCoordinatorPrincipal(params.runId)
        : undefined
      const retainedCoordinatorHandle =
        coordinatorPrincipal?.terminal_handle ??
        run.coordinator_handle ??
        this.getUniqueLegacyCoordinatorHandle(params.runId)
      const takeoverAlreadyApplied = Boolean(
        params.takeoverLegacy &&
        sameBinding &&
        run.coordinator_handle === params.coordinatorHandle &&
        coordinatorPrincipal?.status !== 'committed'
      )
      const replacesLegacyCoordinator = Boolean(
        adoptedRun &&
        !provenLegacyBinding &&
        retainedCoordinatorHandle &&
        (params.takeoverLegacy ||
          retainedCoordinatorHandle !== params.coordinatorHandle ||
          !sameBinding)
      )
      if (params.takeoverLegacy && !adoptedRun) {
        throw new OrchestrationError(
          'invalid_argument',
          'Legacy takeover is only available for the automatically adopted Run.'
        )
      }
      if (
        activeLegacyAssignment &&
        !sameBinding &&
        !provenLegacyBinding &&
        !params.takeoverLegacy
      ) {
        throw new OrchestrationError(
          'consumer_fenced',
          'This adopted Run still has live legacy work. Its attested coordinator may rebind it, or a current coordinator may explicitly use run-use --takeover-legacy.',
          {
            effectsApplied: false,
            recoveryCommand: `orca orchestration run-use --id ${params.runId} --takeover-legacy`
          }
        )
      }
      this.unbindOtherRunsForPane(params.coordinatorPaneKey, params.runId)
      if (
        (params.takeoverLegacy && !takeoverAlreadyApplied) ||
        !sameBinding ||
        run.coordinator_handle !== params.coordinatorHandle
      ) {
        if (adoptedRun && (params.takeoverLegacy || !activeLegacyAssignment)) {
          if (
            coordinatorPrincipal?.status === 'committed' &&
            (params.takeoverLegacy ||
              coordinatorPrincipal.terminal_handle !== params.coordinatorHandle ||
              !isEquivalentPaneKey(coordinatorPrincipal.pane_key, params.coordinatorPaneKey))
          ) {
            this.setLegacyCompatibilityPrincipalStatus(coordinatorPrincipal.id, 'revoked')
          }
        }
        this.db
          .prepare(
            `UPDATE runs
             SET coordinator_handle = ?, coordinator_pane_key = ?,
                 consumer_generation = consumer_generation + 1,
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(params.coordinatorHandle, params.coordinatorPaneKey, params.runId)
        this.fenceOutstandingDelivery(params.runId)
        if (params.takeoverLegacy || replacesLegacyCoordinator) {
          this.promoteLegacyCoordinatorMailForTakeover(params.runId, retainedCoordinatorHandle)
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getRun(params.runId)
  }

  getRun(id: string): RunRow | undefined {
    const run = this.getRunRaw(id)
    return run ? exposeRunTimestamps(run) : undefined
  }

  listRuns(params: { limit?: number; cursor?: string } = {}): RunListPage {
    if (params.limit === undefined && params.cursor === undefined) {
      const rows = this.db
        .prepare('SELECT * FROM runs ORDER BY created_at DESC, id DESC')
        .all() as RunRow[]
      return { runs: rows.map(exposeRunTimestamps), nextCursor: null }
    }
    const limit = Math.min(
      Math.max(1, params.limit ?? ORCHESTRATION_RUN_PAGE_LIMIT),
      ORCHESTRATION_RUN_PAGE_LIMIT
    )
    const cursor = params.cursor ? decodeRunListCursor(params.cursor) : undefined
    const rows = (
      cursor
        ? this.db
            .prepare(
              `SELECT * FROM runs
             WHERE created_at < ? OR (created_at = ? AND id < ?)
             ORDER BY created_at DESC, id DESC
             LIMIT ?`
            )
            .all(cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
        : this.db
            .prepare('SELECT * FROM runs ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(limit + 1)
    ) as RunRow[]
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    return {
      runs: pageRows.map(exposeRunTimestamps),
      nextCursor: hasMore ? encodeRunListCursor(pageRows.at(-1) as RunRow) : null
    }
  }

  getCurrentRunForPane(paneKey: string): RunRow | undefined {
    const runs = this.db
      .prepare('SELECT * FROM runs WHERE coordinator_pane_key IS NOT NULL AND legacy = 0')
      .all() as RunRow[]
    const run = runs.find(
      (candidate) =>
        candidate.coordinator_pane_key !== null &&
        isEquivalentPaneKey(candidate.coordinator_pane_key, paneKey)
    )
    return run ? exposeRunTimestamps(run) : undefined
  }

  protected getRunRaw(id: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
  }

  protected unbindOtherRunsForPane(paneKey: string, exceptRunId?: string): void {
    const bound = this.db
      .prepare('SELECT * FROM runs WHERE coordinator_pane_key IS NOT NULL AND legacy = 0')
      .all() as RunRow[]
    for (const run of bound) {
      if (
        run.id !== exceptRunId &&
        run.coordinator_pane_key &&
        isEquivalentPaneKey(run.coordinator_pane_key, paneKey)
      ) {
        this.db
          .prepare(
            `UPDATE runs
             SET coordinator_handle = NULL, coordinator_pane_key = NULL,
                 consumer_generation = consumer_generation + 1,
                 updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(run.id)
        this.fenceOutstandingDelivery(run.id)
      }
    }
  }

  protected requireRun(runId: string): void {
    if (!this.getRunRaw(runId)) {
      throw new Error(`Run not found: ${runId}`)
    }
  }

  protected fenceOutstandingDelivery(runId: string): void {
    this.db
      .prepare(
        "UPDATE deliveries SET status = 'fenced' WHERE run_id = ? AND status = 'outstanding'"
      )
      .run(runId)
  }

  protected promoteLegacyCoordinatorMailForTakeover(
    runId: string,
    retainedCoordinatorHandle: string | null
  ): void {
    if (!retainedCoordinatorHandle) {
      return
    }
    this.db
      .prepare(
        `UPDATE messages
         SET to_handle = ?, delivery_contract = 'current_delivery',
             read = 0, delivered_at = NULL
         WHERE run_id = ? AND delivery_contract = 'legacy_direct'
           AND to_handle = ?
           AND EXISTS(
             SELECT 1 FROM dispatch_contexts d
             WHERE d.run_id = messages.run_id
               AND d.contract_version = ?
               AND (
                 messages.from_handle = d.assignee_handle OR
                 messages.from_handle = 'dispatch:' || d.id
               )
           )
           AND (
             read = 0 OR EXISTS(
               SELECT 1 FROM question_threads q
               WHERE q.message_id = messages.id AND q.status = 'pending'
             ) OR EXISTS(
               SELECT 1
               FROM legacy_mail_receipts r
               INNER JOIN legacy_compatibility_principals p
                 ON p.id = r.principal_id
               WHERE r.message_id = messages.id
                 AND r.acknowledged_at IS NULL
                 AND p.run_id = messages.run_id
                 AND p.role = 'coordinator'
                 AND p.terminal_handle = ?
             ) OR (
               read = 1
               AND NOT EXISTS(
                 SELECT 1 FROM legacy_compatibility_principals p
                 WHERE p.run_id = messages.run_id AND p.role = 'coordinator'
               )
               AND EXISTS(
                 SELECT 1 FROM dispatch_contexts d
                 WHERE d.run_id = messages.run_id
                   AND d.contract_version = ?
                   AND d.status IN ('pending', 'dispatched')
                   AND messages.created_at >= d.created_at
                   AND (
                     messages.from_handle = d.assignee_handle OR
                     messages.from_handle = 'dispatch:' || d.id
                   )
               )
             )
           )`
      )
      .run(
        `run:${runId}`,
        runId,
        retainedCoordinatorHandle,
        LEGACY_CONTRACT_VERSION,
        retainedCoordinatorHandle,
        LEGACY_CONTRACT_VERSION
      )
  }

  protected getUniqueLegacyCoordinatorHandle(runId: string): string | null {
    const adoption = this.getLegacyAdoption()
    if (!adoption || adoption.adopted_run_id !== runId) {
      return null
    }
    const workerHandles = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT assignee_handle AS handle
             FROM dispatch_contexts
             WHERE run_id = ? AND contract_version = ?
               AND assignee_handle IS NOT NULL
             UNION
             SELECT DISTINCT terminal_handle AS handle
             FROM legacy_compatibility_principals
             WHERE run_id = ? AND role = 'worker'
               AND status IN ('committed', 'settled')`
          )
          .all(runId, LEGACY_CONTRACT_VERSION, runId) as { handle: string }[]
      ).map((row) => row.handle)
    )
    const durableRows = this.db
      .prepare(
        `SELECT coordinator_handle AS handle
         FROM coordinator_runs
         WHERE scheduler_lost_at = ?
         UNION
         SELECT created_by_terminal_handle AS handle
         FROM tasks t
         WHERE t.run_id = ? AND t.created_by_terminal_handle IS NOT NULL
           AND t.created_at <= ?
           AND EXISTS(
             SELECT 1 FROM dispatch_contexts d
             WHERE d.task_id = t.id AND d.run_id = t.run_id
               AND d.contract_version = ?
           )`
      )
      .all(adoption.adopted_at, runId, adoption.adopted_at, LEGACY_CONTRACT_VERSION) as {
      handle: string
    }[]
    if (durableRows.some((row) => workerHandles.has(row.handle))) {
      return null
    }
    const candidates = new Set(durableRows.map((row) => row.handle))
    const mailRows = this.db
      .prepare(
        `SELECT m.to_handle AS handle
         FROM messages m
         INNER JOIN dispatch_contexts d
           ON d.run_id = m.run_id AND d.contract_version = ?
          AND (m.from_handle = d.assignee_handle OR m.from_handle = 'dispatch:' || d.id)
         WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct'
           AND m.created_at <= ?
         UNION
         SELECT m.from_handle AS handle
         FROM messages m
         INNER JOIN dispatch_contexts d
           ON d.run_id = m.run_id AND d.contract_version = ?
          AND (m.to_handle = d.assignee_handle OR m.to_handle = 'dispatch:' || d.id)
         WHERE m.run_id = ? AND m.delivery_contract = 'legacy_direct'
           AND m.created_at <= ?`
      )
      .all(
        LEGACY_CONTRACT_VERSION,
        runId,
        adoption.adopted_at,
        LEGACY_CONTRACT_VERSION,
        runId,
        adoption.adopted_at
      ) as {
      handle: string
    }[]
    for (const row of mailRows) {
      if (
        !workerHandles.has(row.handle) &&
        !row.handle.startsWith('dispatch:') &&
        !row.handle.startsWith('run:')
      ) {
        candidates.add(row.handle)
      }
    }
    return candidates.size === 1 ? ([...candidates][0] ?? null) : null
  }

  protected requireCurrentConsumer(runId: string, consumerGeneration: number): RunRow {
    const run = this.getRunRaw(runId)
    if (!run || run.legacy === 1 || run.consumer_generation !== consumerGeneration) {
      throw new OrchestrationError(
        'consumer_fenced',
        'This mailbox consumer has been replaced. Rebind with orchestration run-use.'
      )
    }
    return run
  }

}

