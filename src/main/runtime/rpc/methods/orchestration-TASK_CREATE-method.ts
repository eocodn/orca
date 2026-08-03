import { defineMethod, type RpcMethod } from '../core'
import { TaskCreateParams, resolveRunScope } from './orchestration-support'

export const ORCHESTRATION_TASK_CREATE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.taskCreate',
    params: TaskCreateParams,
    handler: (params, { runtime, legacyCoordinatorRunId }) => {
      const db = runtime.getOrchestrationDb()
      let deps: string[] | undefined
      if (params.deps) {
        try {
          const parsed = JSON.parse(params.deps)
          if (!Array.isArray(parsed) || !parsed.every((d) => typeof d === 'string')) {
            throw new Error('not an array of strings')
          }
          deps = parsed
        } catch {
          throw new Error('Invalid --deps: must be a JSON array of task IDs')
        }
      }
      const task = db.createTask({
        spec: params.spec,
        taskTitle: params.taskTitle,
        displayName: params.displayName,
        deps,
        parentId: params.parent,
        createdByTerminalHandle: params.callerTerminalHandle,
        runId: resolveRunScope(runtime, {
          runId: params.run,
          callerTerminalHandle: params.callerTerminalHandle,
          requireCurrentConsumer: true,
          legacyCoordinatorRunId
        }).id
      })
      return { task }
    }
  }),

]
