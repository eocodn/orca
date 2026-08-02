import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationUpdateInput,
  AutomationWorkspaceMode
} from '../../shared/automations-types'
import type { Repo, Worktree } from '../../shared/types'

export type RuntimeAutomationCreateInput = Omit<
  AutomationCreateInput,
  'projectId' | 'workspaceId' | 'workspaceMode' | 'timezone'
> & {
  repo?: string
  workspace?: string
  workspaceMode?: AutomationWorkspaceMode
  timezone?: string
}

export type RuntimeAutomationUpdateInput = Omit<
  AutomationUpdateInput,
  'projectId' | 'workspaceId'
> & {
  repo?: string
  workspace?: string
}

type RuntimeAutomationStore = {
  listAutomations?: () => Automation[]
  listAutomationRuns?: (automationId?: string) => AutomationRun[]
  createAutomation?: (input: AutomationCreateInput) => Automation | Promise<Automation>
  updateAutomation?: (
    id: string,
    updates: AutomationUpdateInput
  ) => Automation | Promise<Automation>
  deleteAutomation?: (id: string) => void
}

type RuntimeAutomationTargetHost = {
  showRepo: (selector: string) => Promise<Pick<Repo, 'id'>>
  showManagedWorktree: (selector: string) => Promise<Pick<Worktree, 'id' | 'repoId'>>
}

type AutomationTarget = {
  projectId: string
  workspaceMode: AutomationWorkspaceMode
  workspaceId?: string | null
}

export class RuntimeAutomationCommands {
  constructor(
    private readonly store: RuntimeAutomationStore | null,
    private readonly targetHost: RuntimeAutomationTargetHost,
    private readonly runNow: ((id: string) => Promise<AutomationRun>) | null = null
  ) {}

  listAutomations(): Automation[] {
    if (!this.store?.listAutomations) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomations()
  }

  listAutomationRuns(automationId?: string): AutomationRun[] {
    if (!this.store?.listAutomationRuns) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAutomationRuns(automationId)
  }

  showAutomation(id: string): Automation {
    const automation = this.listAutomations().find((entry) => entry.id === id)
    if (!automation) {
      throw new Error('Automation not found.')
    }
    return automation
  }

  async createAutomation(input: RuntimeAutomationCreateInput): Promise<Automation> {
    if (!this.store?.createAutomation) {
      throw new Error('runtime_unavailable')
    }
    const target = await this.resolveAutomationTarget(input)
    if (input.reuseSession && target.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    return await this.store.createAutomation({
      name: input.name,
      prompt: input.prompt,
      precheck: input.precheck,
      agentId: input.agentId,
      runContext: input.runContext,
      sourceContext: input.sourceContext,
      projectId: target.projectId,
      workspaceMode: target.workspaceMode,
      workspaceId: target.workspaceId,
      baseBranch: input.baseBranch,
      setupDecision: input.setupDecision,
      reuseSession: input.reuseSession,
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      rrule: input.rrule,
      dtstart: input.dtstart,
      enabled: input.enabled,
      missedRunGraceMinutes: input.missedRunGraceMinutes
    })
  }

  async updateAutomation(id: string, updates: RuntimeAutomationUpdateInput): Promise<Automation> {
    if (!this.store?.updateAutomation) {
      throw new Error('runtime_unavailable')
    }
    const current = this.showAutomation(id)
    const patch: AutomationUpdateInput = {}
    for (const key of [
      'name',
      'prompt',
      'precheck',
      'agentId',
      'runContext',
      'sourceContext',
      'baseBranch',
      'setupDecision',
      'reuseSession',
      'timezone',
      'rrule',
      'dtstart',
      'enabled',
      'missedRunGraceMinutes'
    ] as const) {
      if (hasRuntimeAutomationUpdateValue(updates, key)) {
        patch[key] = updates[key] as never
      }
    }
    const targetChanged =
      hasRuntimeAutomationUpdateValue(updates, 'repo') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspace') ||
      hasRuntimeAutomationUpdateValue(updates, 'workspaceMode')
    if (targetChanged) {
      const target = await this.resolveAutomationTarget(updates, current)
      if (patch.reuseSession === true && target.workspaceMode !== 'existing') {
        throw new Error('Session reuse requires an existing workspace target.')
      }
      patch.projectId = target.projectId
      patch.workspaceMode = target.workspaceMode
      patch.workspaceId = target.workspaceId
      if (target.workspaceMode !== 'existing') {
        patch.reuseSession = false
      }
    }
    if (!targetChanged && patch.reuseSession && current.workspaceMode !== 'existing') {
      throw new Error('Session reuse requires an existing workspace target.')
    }
    return await this.store.updateAutomation(id, patch)
  }

  deleteAutomation(id: string): { removed: boolean; id: string } {
    if (!this.store?.deleteAutomation) {
      throw new Error('runtime_unavailable')
    }
    this.showAutomation(id)
    this.store.deleteAutomation(id)
    return { removed: true, id }
  }

  async runAutomationNow(id: string): Promise<AutomationRun> {
    if (!this.runNow) {
      throw new Error('runtime_unavailable')
    }
    return this.runNow(id)
  }

  private async resolveAutomationTarget(
    input: {
      repo?: string
      workspace?: string
      workspaceMode?: AutomationWorkspaceMode
    },
    current?: Automation
  ): Promise<AutomationTarget> {
    const hasRepo = input.repo !== undefined
    const hasWorkspace = input.workspace !== undefined
    if (
      current?.workspaceMode === 'existing' &&
      hasRepo &&
      !hasWorkspace &&
      input.workspaceMode !== 'new_per_run'
    ) {
      throw new Error(
        'Repo updates for existing-workspace automation require workspaceMode new_per_run.'
      )
    }
    const workspace = input.workspace
      ? await this.targetHost.showManagedWorktree(input.workspace)
      : null
    const repo = input.repo ? await this.targetHost.showRepo(input.repo) : null
    const workspaceMode =
      input.workspaceMode ??
      (workspace
        ? 'existing'
        : input.repo && !current
          ? 'new_per_run'
          : (current?.workspaceMode ?? 'new_per_run'))
    if (workspaceMode === 'existing') {
      const workspaceId = workspace?.id ?? current?.workspaceId
      const projectId = workspace?.repoId ?? current?.projectId
      if (repo && repo.id !== projectId) {
        throw new Error('Selected workspace belongs to a different repo.')
      }
      if (!workspaceId || !projectId) {
        throw new Error('Existing-workspace automation requires --workspace.')
      }
      return { projectId, workspaceMode, workspaceId }
    }
    const projectId = repo?.id ?? workspace?.repoId ?? current?.projectId
    if (!projectId) {
      throw new Error('Automation requires --repo or --workspace.')
    }
    return { projectId, workspaceMode: 'new_per_run', workspaceId: null }
  }
}

function hasRuntimeAutomationUpdateValue<K extends keyof RuntimeAutomationUpdateInput>(
  updates: RuntimeAutomationUpdateInput,
  key: K
): boolean {
  return Object.hasOwn(updates, key) && updates[key] !== undefined
}
