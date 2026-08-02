import { randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationUpdateInput
} from '../shared/automations-types'
import { nextAutomationOccurrenceAfter } from '../shared/automation-schedules'
import { normalizeAutomationPrecheck } from '../shared/automation-precheck'
import {
  getAutomationContextsForRepo,
  getAutomationSchedulerOwner,
  normalizeAutomationPrecheckResult,
  normalizeAutomationSessionReuse,
  normalizeAutomationSetupDecisionForWorkspaceMode
} from './persistence-state-migrations'
import { StorePhase5 } from './persistence-store-session-state'

export class StorePhase6AutomationCrud extends StorePhase5 {
  listAutomations(): Automation[] {
    return (this.state.automations ?? [])
      .map((automation) => normalizeAutomationSessionReuse(automation))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  listAutomationRuns(automationId?: string): AutomationRun[] {
    const runs = this.state.automationRuns ?? []
    return [...(automationId ? runs.filter((run) => run.automationId === automationId) : runs)]
      .map((run) => ({
        ...run,
        precheckResult: normalizeAutomationPrecheckResult(run.precheckResult)
      }))
      .sort((left, right) => right.createdAt - left.createdAt)
  }

  createAutomation(input: AutomationCreateInput): Automation {
    const repo = this.state.repos.find((entry) => entry.id === input.projectId)
    const now = Date.now()
    const executionTargetType = repo?.connectionId ? 'ssh' : 'local'
    const schedulerOwner = getAutomationSchedulerOwner(repo)
    const contexts = getAutomationContextsForRepo(repo, this.state.projectHostSetups ?? [])
    const automation: Automation = {
      id: randomUUID(),
      name: input.name.trim() || 'Untitled automation',
      prompt: input.prompt,
      precheck: normalizeAutomationPrecheck(input.precheck),
      agentId: input.agentId,
      runContext: input.runContext ?? contexts.runContext,
      sourceContext: input.sourceContext ?? contexts.sourceContext,
      projectId: input.projectId,
      executionTargetType,
      executionTargetId: executionTargetType === 'ssh' ? (repo?.connectionId ?? '') : 'local',
      schedulerOwner,
      workspaceMode: input.workspaceMode,
      workspaceId: input.workspaceMode === 'existing' ? (input.workspaceId ?? null) : null,
      baseBranch: input.workspaceMode === 'new_per_run' ? (input.baseBranch ?? null) : null,
      setupDecision: normalizeAutomationSetupDecisionForWorkspaceMode(
        input.workspaceMode,
        input.setupDecision
      ),
      reuseSession: input.workspaceMode === 'existing' ? (input.reuseSession ?? false) : false,
      timezone: input.timezone,
      rrule: input.rrule,
      dtstart: input.dtstart,
      enabled: input.enabled ?? true,
      nextRunAt: nextAutomationOccurrenceAfter(input.rrule, input.dtstart, now),
      missedRunPolicy: 'run_once_within_grace',
      missedRunGraceMinutes: input.missedRunGraceMinutes ?? 720,
      createdAt: now,
      updatedAt: now
    }
    this.state.automations = [...(this.state.automations ?? []), automation]
    this.recordFeatureInteraction('automation-created')
    this.flush()
    return automation
  }

  updateAutomation(id: string, updates: AutomationUpdateInput): Automation {
    const index = (this.state.automations ?? []).findIndex((entry) => entry.id === id)
    if (index === -1) {
      throw new Error('Automation not found.')
    }
    const current = this.state.automations[index]
    const repoId = updates.projectId ?? current.projectId
    const repo = this.state.repos.find((entry) => entry.id === repoId)
    const executionTargetType = repo?.connectionId ? 'ssh' : 'local'
    const schedulerOwner = getAutomationSchedulerOwner(repo)
    const contexts = getAutomationContextsForRepo(repo, this.state.projectHostSetups ?? [])
    const rrule = updates.rrule ?? current.rrule
    const dtstart = updates.dtstart ?? current.dtstart
    const scheduleChanged = updates.rrule !== undefined || updates.dtstart !== undefined
    const workspaceMode = updates.workspaceMode ?? current.workspaceMode
    const updated: Automation = {
      ...current,
      ...updates,
      name:
        updates.name !== undefined ? updates.name.trim() || 'Untitled automation' : current.name,
      precheck: Object.hasOwn(updates, 'precheck')
        ? normalizeAutomationPrecheck(updates.precheck)
        : normalizeAutomationPrecheck(current.precheck),
      projectId: repoId,
      runContext: Object.hasOwn(updates, 'runContext')
        ? (updates.runContext ?? null)
        : updates.projectId !== undefined
          ? contexts.runContext
          : (current.runContext ?? contexts.runContext),
      sourceContext: Object.hasOwn(updates, 'sourceContext')
        ? (updates.sourceContext ?? null)
        : updates.projectId !== undefined
          ? contexts.sourceContext
          : (current.sourceContext ?? contexts.sourceContext),
      executionTargetType,
      executionTargetId: executionTargetType === 'ssh' ? (repo?.connectionId ?? '') : 'local',
      schedulerOwner,
      workspaceMode,
      workspaceId:
        workspaceMode === 'existing'
          ? Object.hasOwn(updates, 'workspaceId')
            ? (updates.workspaceId ?? null)
            : current.workspaceId
          : null,
      baseBranch:
        workspaceMode === 'new_per_run'
          ? Object.hasOwn(updates, 'baseBranch')
            ? (updates.baseBranch ?? null)
            : (current.baseBranch ?? null)
          : null,
      setupDecision:
        workspaceMode === 'new_per_run'
          ? Object.hasOwn(updates, 'setupDecision')
            ? normalizeAutomationSetupDecisionForWorkspaceMode(workspaceMode, updates.setupDecision)
            : normalizeAutomationSetupDecisionForWorkspaceMode(workspaceMode, current.setupDecision)
          : undefined,
      reuseSession:
        workspaceMode === 'existing'
          ? (updates.reuseSession ?? current.reuseSession ?? false)
          : false,
      rrule,
      dtstart,
      nextRunAt: scheduleChanged
        ? nextAutomationOccurrenceAfter(rrule, dtstart, Date.now())
        : current.nextRunAt,
      updatedAt: Date.now()
    }
    this.state.automations[index] = updated
    this.flush()
    return updated
  }
}
