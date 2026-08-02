import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/badge'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { formatAutomationDateTimeWithRelative } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'
import type {
  Automation,
  AutomationPrecheck,
  AutomationRun,
  ExternalAutomationJob,
  ExternalAutomationManager,
  ExternalAutomationRun
} from '../../../../shared/automations-types'
import type { AutomationHostTarget } from './automation-host-client'
import { buildAutomationCronSchedule } from '../../../../shared/automation-schedules'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { Worktree } from '../../../../shared/types'
import type { TaskSourceHostAvailability } from '../task-source-context-summary'

export const AGENTS = getAgentCatalog().map((agent) => agent.id)
export const DEFAULT_TIME = '09:00'
export const AUTOMATIONS_CHANGED_EVENT = 'orca:automations-changed'

export type AutomationPaneTab = 'overview' | 'runs'
export type RepoBackedAutomationSourceContext = TaskSourceContext & {
  provider: 'github' | 'gitlab'
}
export type ExternalAutomationListEntry =
  | { kind: 'job'; key: string; manager: ExternalAutomationManager; job: ExternalAutomationJob }
  | { kind: 'source'; key: string; manager: ExternalAutomationManager }
export type SelectedExternalRunPage = {
  manager: ExternalAutomationManager
  job: ExternalAutomationJob
  run: ExternalAutomationRun
}

export function getAutomationHostTargetKey(target: AutomationHostTarget): string {
  return target.kind === 'environment' ? 'environment:' + target.environmentId : 'local'
}

export function getAutomationHostTargetFromKey(key: string | null): AutomationHostTarget | null {
  if (!key) {
    return null
  }
  if (key.startsWith('environment:')) {
    return { kind: 'environment', environmentId: key.slice('environment:'.length) }
  }
  return { kind: 'local' }
}

export function getDefaultWorktree(worktrees: readonly Worktree[]): Worktree | null {
  return worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0] ?? null
}

export function getRepoBackedAutomationSourceContext(
  automation: Automation
): RepoBackedAutomationSourceContext | null {
  const context = automation.sourceContext
  return context?.provider === 'github' || context?.provider === 'gitlab'
    ? (context as RepoBackedAutomationSourceContext)
    : null
}

export function getRuntimeSourceHostAvailability(
  context: TaskSourceContext,
  runtimeStatusByEnvironmentId: ReadonlyMap<
    string,
    { status: RuntimeStatus | null; checkedAt: number }
  >
): TaskSourceHostAvailability | null {
  const parsed = parseExecutionHostId(context.hostId)
  if (parsed?.kind !== 'runtime') {
    return null
  }
  const entry = runtimeStatusByEnvironmentId.get(parsed.environmentId)
  if (!entry) {
    return { hostId: context.hostId, reason: 'checking-task-source-capability' }
  }
  if (!entry.status) {
    return { hostId: context.hostId, health: 'disconnected' }
  }
  if (entry.status.graphStatus !== 'ready') {
    return { hostId: context.hostId, health: 'connecting' }
  }
  const capabilities = entry.status.capabilities
  if (!capabilities) {
    return { hostId: context.hostId, reason: 'checking-task-source-capability' }
  }
  if (!capabilities.includes(TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY)) {
    return { hostId: context.hostId, reason: 'missing-task-source-capability' }
  }
  return null
}

export function formatTimeInput(hour: number, minute: number): string {
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0')
}

export function parseDraftTime(time: string): { hour: number; minute: number } {
  const [rawHour, rawMinute] = time.split(':').map((part) => Number(part))
  return {
    hour: Number.isFinite(rawHour) ? rawHour : 9,
    minute: Number.isFinite(rawMinute) ? rawMinute : 0
  }
}

export function buildDraftPrecheck(draft: AutomationDraft): AutomationPrecheck | null {
  const command = draft.precheckCommand.trim()
  if (!command) {
    return null
  }
  const rawTimeout = Number(draft.precheckTimeoutSeconds)
  return { command, timeoutSeconds: Number.isFinite(rawTimeout) ? rawTimeout : 60 }
}

export function buildHermesCronSchedule(draft: AutomationDraft): string {
  if (draft.preset === 'custom') {
    return draft.customSchedule.trim()
  }
  const { hour, minute } = parseDraftTime(draft.time)
  return buildAutomationCronSchedule({
    preset: draft.preset,
    hour,
    minute,
    dayOfWeek: Number(draft.dayOfWeek)
  })
}

export function getAgentLabel(agentId: string): string {
  return getAgentCatalog().find((agent) => agent.id === agentId)?.label ?? agentId
}

export function getExternalAutomationKey(
  manager: ExternalAutomationManager,
  job: ExternalAutomationJob
): string {
  return manager.id + ':' + job.id
}

export function getExternalAutomationSourceKey(manager: ExternalAutomationManager): string {
  return manager.id + ':source'
}

export function formatExternalDate(value: string | null, now: number): string {
  if (!value) {
    return 'Never'
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? formatAutomationDateTimeWithRelative(parsed, now) : value
}

export function getExternalProviderLabel(manager: ExternalAutomationManager): string {
  return manager.provider === 'hermes' ? 'Hermes' : 'OpenClaw'
}

export function getExternalTargetKindLabel(manager: ExternalAutomationManager): string {
  return manager.target.type === 'ssh' ? 'SSH host' : 'Local'
}

export function getExternalRunStatusLabel(run: ExternalAutomationRun): string {
  switch (run.status) {
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'unknown':
      return 'Unknown'
  }
}

export function getExternalRunStatusVariant(
  run: ExternalAutomationRun
): ComponentProps<typeof Badge>['variant'] {
  switch (run.status) {
    case 'completed':
      return 'secondary'
    case 'failed':
      return 'destructive'
    case 'unknown':
      return 'outline'
  }
}

export function getExternalRunContent(run: ExternalAutomationRun): string {
  return run.outputContent ?? run.error ?? run.outputPreview ?? 'No output content available.'
}

export function getAutomationRunContent(run: AutomationRun): string {
  const savedOutput = run.outputSnapshot?.content.trim()
  if (savedOutput) {
    return run.outputSnapshot?.content ?? savedOutput
  }
  if (run.precheckResult) {
    const output = [run.precheckResult.stderr.trim(), run.precheckResult.stdout.trim()]
      .filter(Boolean)
      .join('\n\n')
    if (output) {
      return output
    }
  }
  return run.error ?? run.usage?.unavailableMessage ?? 'No output content available.'
}

export function isMissingExternalRunsApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /listExternalRuns|automations:listExternalRuns|No handler registered/i.test(message)
}
