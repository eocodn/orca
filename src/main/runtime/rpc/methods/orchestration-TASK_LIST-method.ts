import { defineMethod, type RpcMethod } from '../core'
import { abbreviateOrchestrationTasks } from '../../../../shared/orchestration-task-summary'
import type { TaskStatus } from '../../orchestration/db'
import { TaskListParams, resolveRunScope } from './orchestration-support'

export const ORCHESTRATION_TASK_LIST_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.taskList',
    params: TaskListParams,
    handler: (params, { runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      const explicitRun = params.run ? db.getRun(params.run) : undefined
      const run =
        explicitRun?.legacy === 1
          ? explicitRun
          : resolveRunScope(runtime, {
              runId: params.run,
              callerTerminalHandle: params.callerTerminalHandle,
              requireCurrentConsumer: params.run === undefined,
              legacyCoordinatorRunId
            })
      // Why: listTasksWithDispatch adds assignee_handle + dispatch_id (NULL for non-dispatched), so legacy-shape consumers are unaffected.
      const joined = db.listTasksWithDispatch({
        status: params.status as TaskStatus,
        ready: params.ready,
        runId: run.id
      })
      const tasks = joined.map((row) => {
        const { assignee_handle, dispatch_id, ...base } = row
        if (base.status === 'dispatched') {
          return { ...base, assignee_handle, dispatch_id }
        }
        return base
      })
      return {
        runId: run.id,
        legacyReadOnly: run.legacy === 1,
        tasks: params.brief ? abbreviateOrchestrationTasks(tasks) : tasks,
        count: tasks.length
      }
    }
  }),

]
