import { randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationRun,
  AutomationRunTrigger
} from '../shared/automations-types'
import {
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter
} from '../shared/automation-schedules'
import { isFinalAutomationRunStatus } from '../shared/automations-types'
import type {
  WorktreeMeta,
  WorktreeLineage
} from '../shared/types'

import {
  normalizeStoredTaskSourceContext
} from '../shared/task-source-context'
import {
  normalizeWorkspaceLinkedItem
} from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'

import {
  nextAutomationRunNumber,
  pruneAutomationRuns
} from '../shared/automation-run-retention'
import {
  getWorktreePathBasenameFromId
} from '../shared/worktree-id'
import {
  worktreeWorkspaceKey
} from '../shared/workspace-scope'

import {
  removeWorkspaceSessionOwner,
  getDefaultWorktreeMeta
} from './persistence-state-phase-8'
import {
  normalizeAutomationPrecheckResult,
  normalizeAutomationRunOutputSnapshot,
  normalizeAutomationRunTerminalPaneKey,
  normalizeAutomationRunTerminalPtyId,
  normalizeAutomationRunWorkspaceDisplayName
} from './persistence-state-migrations'
import { StorePhase6 } from './persistence-store-pty-state'

export class StorePhase7 extends StorePhase6 {
  deleteAutomation(id: string): void {
    this.state.automations = (this.state.automations ?? []).filter((entry) => entry.id !== id)
    this.state.automationRuns = (this.state.automationRuns ?? []).filter(
      (entry) => entry.automationId !== id
    )
    this.flush()
  }

  createAutomationRun(
    automation: Automation,
    scheduledFor: number,
    trigger: AutomationRunTrigger = 'scheduled'
  ): AutomationRun {
    const existing = (this.state.automationRuns ?? []).find(
      (run) => run.automationId === automation.id && run.scheduledFor === scheduledFor
    )
    if (existing) {
      return existing
    }
    const now = Date.now()
    // Why: retention prunes old runs, so the retained count isn't the ordinal — carry the number forward from the newest survivor.
    const runNumber = nextAutomationRunNumber(
      (this.state.automationRuns ?? []).filter((run) => run.automationId === automation.id)
    )
    const run: AutomationRun = {
      id: randomUUID(),
      automationId: automation.id,
      runNumber,
      runContext: automation.runContext ?? null,
      sourceContext: automation.sourceContext ?? null,
      title: `${automation.name} run ${runNumber}`,
      scheduledFor,
      status: 'pending',
      trigger,
      workspaceId: automation.workspaceId,
      workspaceDisplayName: this.getAutomationRunWorkspaceDisplayName(automation.workspaceId),
      sessionKind: 'terminal',
      chatSessionId: null,
      terminalSessionId: null,
      terminalPaneKey: null,
      terminalPtyId: null,
      outputSnapshot: null,
      precheckResult: null,
      usage: null,
      error: null,
      startedAt: null,
      dispatchedAt: null,
      createdAt: now
    }
    this.state.automationRuns = pruneAutomationRuns([...(this.state.automationRuns ?? []), run])
    if (trigger === 'manual') {
      this.recordFeatureInteraction('automation-run')
    }
    this.flush()
    return run
  }

  updateAutomationRun(result: AutomationDispatchResult): AutomationRun {
    const index = (this.state.automationRuns ?? []).findIndex((entry) => entry.id === result.runId)
    if (index === -1) {
      throw new Error('Automation run not found.')
    }
    const now = Date.now()
    const current = this.state.automationRuns[index]
    if (isFinalAutomationRunStatus(current.status)) {
      if (
        result.status === current.status &&
        Object.hasOwn(result, 'usage') &&
        current.usage === null &&
        result.usage != null
      ) {
        const updated = { ...current, usage: result.usage }
        this.state.automationRuns[index] = updated
        this.flush()
        return updated
      }
      return current
    }
    const workspaceId = result.workspaceId ?? current.workspaceId
    const workspaceDisplayName = Object.hasOwn(result, 'workspaceDisplayName')
      ? normalizeAutomationRunWorkspaceDisplayName(result.workspaceDisplayName ?? null)
      : null
    const updated: AutomationRun = {
      ...current,
      status: result.status,
      workspaceId,
      workspaceDisplayName:
        workspaceDisplayName ??
        normalizeAutomationRunWorkspaceDisplayName(current.workspaceDisplayName ?? null) ??
        this.getAutomationRunWorkspaceDisplayName(workspaceId),
      terminalSessionId: Object.hasOwn(result, 'terminalSessionId')
        ? (result.terminalSessionId ?? null)
        : current.terminalSessionId,
      terminalPaneKey: Object.hasOwn(result, 'terminalPaneKey')
        ? normalizeAutomationRunTerminalPaneKey(result.terminalPaneKey)
        : normalizeAutomationRunTerminalPaneKey(current.terminalPaneKey),
      terminalPtyId: Object.hasOwn(result, 'terminalPtyId')
        ? normalizeAutomationRunTerminalPtyId(result.terminalPtyId)
        : normalizeAutomationRunTerminalPtyId(current.terminalPtyId),
      outputSnapshot: Object.hasOwn(result, 'outputSnapshot')
        ? normalizeAutomationRunOutputSnapshot(result.outputSnapshot)
        : normalizeAutomationRunOutputSnapshot(current.outputSnapshot),
      precheckResult: Object.hasOwn(result, 'precheckResult')
        ? normalizeAutomationPrecheckResult(result.precheckResult)
        : normalizeAutomationPrecheckResult(current.precheckResult),
      usage: Object.hasOwn(result, 'usage') ? (result.usage ?? null) : (current.usage ?? null),
      error: result.error ?? null,
      startedAt: current.startedAt ?? now,
      dispatchedAt: result.status === 'dispatched' ? now : current.dispatchedAt
    }
    this.state.automationRuns[index] = updated
    const automation = this.state.automations.find((entry) => entry.id === updated.automationId)
    if (automation) {
      automation.lastRunAt = now
      automation.updatedAt = now
    }
    this.flush()
    return updated
  }

  snapshotAutomationRunWorkspaceDisplayName(workspaceId: string, displayName: string): number {
    const normalizedDisplayName = normalizeAutomationRunWorkspaceDisplayName(displayName)
    if (!normalizedDisplayName) {
      return 0
    }
    let updatedCount = 0
    this.state.automationRuns = (this.state.automationRuns ?? []).map((run) => {
      if (run.workspaceId !== workspaceId || run.workspaceDisplayName === normalizedDisplayName) {
        return run
      }
      updatedCount += 1
      return { ...run, workspaceDisplayName: normalizedDisplayName }
    })
    if (updatedCount > 0) {
      this.flush()
    }
    return updatedCount
  }

  protected getAutomationRunWorkspaceDisplayName(
    workspaceId: string | null | undefined
  ): string | null {
    if (!workspaceId) {
      return null
    }
    return normalizeAutomationRunWorkspaceDisplayName(
      this.state.worktreeMeta[workspaceId]?.displayName ??
        getWorktreePathBasenameFromId(workspaceId)
    )
  }

  advanceAutomationNextRun(id: string, now = Date.now()): Automation {
    const index = (this.state.automations ?? []).findIndex((entry) => entry.id === id)
    if (index === -1) {
      throw new Error('Automation not found.')
    }
    const current = this.state.automations[index]
    const nextRunAt = nextAutomationOccurrenceAfter(current.rrule, current.dtstart, now)
    const updated = { ...current, nextRunAt, updatedAt: Date.now() }
    this.state.automations[index] = updated
    this.flush()
    return updated
  }

  getLatestAutomationOccurrence(automation: Automation, now = Date.now()): number | null {
    return latestAutomationOccurrenceAtOrBefore(automation.rrule, automation.dtstart, now)
  }

  // ── Worktree Meta ──────────────────────────────────────────────────

  getWorktreeMeta(worktreeId: string): WorktreeMeta | undefined {
    return this.state.worktreeMeta[worktreeId]
  }

  getAllWorktreeMeta(): Record<string, WorktreeMeta> {
    return this.state.worktreeMeta
  }

  setWorktreeMeta(worktreeId: string, meta: Partial<WorktreeMeta>): WorktreeMeta {
    const existing = this.state.worktreeMeta[worktreeId] || getDefaultWorktreeMeta()
    const updated = { ...existing, ...meta }
    updated.linkedWorkItem = normalizeWorkspaceLinkedItem(updated.linkedWorkItem)
    const linkedTaskSourceContext = normalizeStoredTaskSourceContext(
      updated.linkedTaskSourceContext
    )
    updated.linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
      updated.linkedWorkItem,
      linkedTaskSourceContext
    )
      ? linkedTaskSourceContext
      : null
    if (!updated.instanceId) {
      updated.instanceId = randomUUID()
    }
    this.state.worktreeMeta[worktreeId] = updated
    this.scheduleSave()
    return updated
  }

  removeWorktreeMeta(worktreeId: string): void {
    delete this.state.worktreeMeta[worktreeId]
    delete this.state.worktreeLineageById[worktreeId]
    delete this.state.workspaceLineageByChildKey[worktreeWorkspaceKey(worktreeId)]
    this.state.workspaceSession = removeWorkspaceSessionOwner(
      this.state.workspaceSession,
      worktreeId,
      { advanceTerminalTopologyRevision: true }
    )!
    this.scheduleSave()
  }

  getWorktreeLineage(worktreeId: string): WorktreeLineage | undefined {
    return this.state.worktreeLineageById[worktreeId]
  }

  getAllWorktreeLineage(): Record<string, WorktreeLineage> {
    return this.state.worktreeLineageById
  }

  setWorktreeLineage(worktreeId: string, lineage: WorktreeLineage): WorktreeLineage {
    this.state.worktreeLineageById[worktreeId] = lineage
    this.scheduleSave()
    return lineage
  }

  removeWorktreeLineage(worktreeId: string): void {
    delete this.state.worktreeLineageById[worktreeId]
    this.scheduleSave()
  }

  /**
   * Re-key every worktreeId-keyed record from `oldWorktreeId` to `newWorktreeId` after the worktree folder (and its
   * `${repoId}::${path}` id) was renamed on disk, so a refresh re-binds state instead of orphaning it. Records the old id on
   * the new meta's `priorWorktreeIds` so session GC/hydration still recognizes PTY sessions minted under it. No-op when ids match.
   * Renderer counterpart: `buildWorktreeRenameState` in store/slices/worktrees.ts.
   */

}
