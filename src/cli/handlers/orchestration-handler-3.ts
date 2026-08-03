import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { abbreviateOrchestrationTasks } from '../../shared/orchestration-task-summary'
import * as orchestrationSupport from './orchestration-handler-support'

export const ORCHESTRATION_HANDLERS_3: Record<string, CommandHandler> = {
  'orchestration task-create': async ({ flags, client, cwd, json }) => {
    const callerTerminalHandle = await orchestrationSupport.resolveCoordinatorTerminalHandle(
      flags,
      cwd,
      client
    )
    const result = await orchestrationSupport.callMutation<{
      task: { id: string; status: string }
    }>(client, flags, 'orchestration.taskCreate', {
      spec: getRequiredStringFlag(flags, 'spec'),
      taskTitle: getOptionalStringFlag(flags, 'task-title'),
      displayName: getOptionalStringFlag(flags, 'display-name'),
      deps: getOptionalStringFlag(flags, 'deps'),
      parent: getOptionalStringFlag(flags, 'parent'),
      run: getOptionalStringFlag(flags, 'run'),
      callerTerminalHandle
    })
    printResult(result, json, (r) => `Created ${r.task.id} [${r.task.status}]`)
  },

  'orchestration task-list': async ({ flags, client, cwd, json }) => {
    const brief = flags.has('brief')
    const run = getOptionalStringFlag(flags, 'run')
    const callerTerminalHandle = run
      ? undefined
      : await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await client.call<{
      tasks: {
        id: string
        spec: string
        task_title?: string | null
        display_name?: string | null
        status: string
        assignee_handle?: string | null
        dispatch_id?: string | null
        spec_truncated?: boolean
      }[]
      count: number
      runId?: string
      legacyReadOnly?: boolean
    }>('orchestration.taskList', {
      status: getOptionalStringFlag(flags, 'status'),
      ready: flags.has('ready') ? true : undefined,
      brief: brief ? true : undefined,
      run,
      callerTerminalHandle
    })
    // Why: only older runtimes (no spec_truncated) skip server-side abbreviation and need this client-side fallback.
    const needsClientAbbreviation =
      brief && result.result.tasks.some((task) => task.spec_truncated === undefined)
    const output = needsClientAbbreviation
      ? {
          ...result,
          result: { ...result.result, tasks: abbreviateOrchestrationTasks(result.result.tasks) }
        }
      : result
    printResult(output, json, (r) => {
      if (r.count === 0) {
        return r.legacyReadOnly ? 'No legacy tasks (read-only).' : 'No tasks.'
      }
      const tasks = r.tasks
        .map((t) => {
          const label = t.display_name ?? t.task_title ?? t.spec
          const head = `${t.id} [${t.status}] ${label.slice(0, 60)}`
          if (t.status === 'dispatched' && t.assignee_handle) {
            return `${head} -> ${t.assignee_handle} (${t.dispatch_id ?? '?'})`
          }
          return head
        })
        .join('\n')
      return r.legacyReadOnly ? `Legacy Run ${r.runId} (read-only)\n${tasks}` : tasks
    })
  },

  'orchestration task-update': async ({ flags, client, cwd, json }) => {
    const status = getRequiredStringFlag(flags, 'status')
    if (
      !orchestrationSupport.TASK_STATUS_VALUES.includes(
        status as (typeof orchestrationSupport.TASK_STATUS_VALUES)[number]
      )
    ) {
      throw new RuntimeClientError(
        'invalid_argument',
        `invalid status '${status}', expected one of: ${orchestrationSupport.TASK_STATUS_VALUES.join(', ')}`
      )
    }
    const result = await orchestrationSupport.callMutation<{
      task: { id: string; status: string }
    }>(client, flags, 'orchestration.taskUpdate', {
      id: getRequiredStringFlag(flags, 'id'),
      status,
      result: getOptionalStringFlag(flags, 'result'),
      run: getOptionalStringFlag(flags, 'run'),
      callerTerminalHandle: await orchestrationSupport.resolveCoordinatorTerminalHandle(
        flags,
        cwd,
        client
      )
    })
    printResult(result, json, (r) => `Updated ${r.task.id} -> ${r.task.status}`)
  }
}
