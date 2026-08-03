import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import type {
  OrchestrationWorkerReadResult,
  OrchestrationWorkerReadSource
} from '../../shared/orchestration-worker-output'
import type { LegacyWorkerReadResult } from './orchestration-handler-support'
import * as orchestrationSupport from './orchestration-handler-support'

export const ORCHESTRATION_HANDLERS_4: Record<string, CommandHandler> = {
  'orchestration worker-start': async ({ flags, client, cwd, json }) => {
    const result = await orchestrationSupport.callMutation<{
      runId: string
      taskId: string
      dispatchId: string
      state: string
      failedStage?: string
      lastError?: string
      warning?: string
      effects: unknown[]
      residualResources: unknown[]
    }>(client, flags, 'orchestration.workerStart', {
      task: getRequiredStringFlag(flags, 'task'),
      on: getOptionalStringFlag(flags, 'on'),
      worktree: getOptionalStringFlag(flags, 'worktree'),
      name: getOptionalStringFlag(flags, 'name'),
      repo: getOptionalStringFlag(flags, 'repo'),
      baseBranch: getOptionalStringFlag(flags, 'base-branch'),
      displayName: getOptionalStringFlag(flags, 'display-name'),
      comment: getOptionalStringFlag(flags, 'comment'),
      setup: getOptionalStringFlag(flags, 'setup'),
      agent: getOptionalStringFlag(flags, 'agent'),
      terminal: getOptionalStringFlag(flags, 'terminal'),
      retryOf: getOptionalStringFlag(flags, 'retry-of'),
      timeoutMs: orchestrationSupport.getOptionalPositiveIntegerValueFlag(flags, 'timeout-ms'),
      run: getOptionalStringFlag(flags, 'run'),
      from: await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client),
      devMode: orchestrationSupport.isDevCliInvocation()
    })
    if (result.result.state !== 'ready') {
      process.exitCode = 1
    }
    printResult(result, json, (worker) => {
      const base = `Worker ${worker.dispatchId} [${worker.state}] for ${worker.taskId}`
      if (worker.lastError) {
        return `${base}\n${worker.failedStage ?? 'start'}: ${worker.lastError}`
      }
      return worker.warning ? `${base}\nWarning: ${worker.warning}` : base
    })
  },

  'orchestration worker-show': async ({ flags, client, json }) => {
    const result = await client.call<{
      dispatch: { id: string; task_id: string; status: string }
      worker: { state: string; stage: string; agent_terminal_handle: string | null }
    }>('orchestration.workerShow', {
      dispatch: getRequiredStringFlag(flags, 'dispatch')
    })
    printResult(
      result,
      json,
      (value) =>
        `${value.dispatch.id} task=${value.dispatch.task_id} [${value.worker.state}] stage=${value.worker.stage}`
    )
  },

  'orchestration worker-read': async ({ flags, client, json }) => {
    const cursorFlag = getOptionalStringFlag(flags, 'cursor')
    const cursor =
      cursorFlag !== undefined && /^\d+$/.test(cursorFlag)
        ? Number.parseInt(cursorFlag, 10)
        : cursorFlag
    const source = getOptionalStringFlag(flags, 'source')
    if (source && !['auto', 'transcript', 'terminal'].includes(source)) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--source must be auto, transcript, or terminal'
      )
    }
    const result = await client.call<OrchestrationWorkerReadResult | LegacyWorkerReadResult>(
      'orchestration.workerRead',
      {
        dispatch: getRequiredStringFlag(flags, 'dispatch'),
        cursor,
        limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
        source: source as OrchestrationWorkerReadSource | undefined
      }
    )
    printResult(result, json, orchestrationSupport.formatWorkerRead)
  },

  'orchestration worker-stop': async ({ flags, client, json }) => {
    const result = await orchestrationSupport.callMutation<{
      dispatchId: string
      state: string
      processAction: string
      lastError?: string
    }>(client, flags, 'orchestration.workerStop', {
      dispatch: getRequiredStringFlag(flags, 'dispatch')
    })
    if (result.result.state === 'stop_unknown') {
      process.exitCode = 1
    }
    printResult(
      result,
      json,
      (value) =>
        `Worker ${value.dispatchId} [${value.state}] process=${value.processAction}${value.lastError ? `\n${value.lastError}` : ''}`
    )
  },

  'orchestration worker-abandon': async ({ flags, client, json }) => {
    const result = await orchestrationSupport.callMutation<{
      dispatchId: string
      state: string
      warning: string
    }>(client, flags, 'orchestration.workerAbandon', {
      dispatch: getRequiredStringFlag(flags, 'dispatch')
    })
    printResult(
      result,
      json,
      (value) => `Worker ${value.dispatchId} [${value.state}]\nWarning: ${value.warning}`
    )
  }
}
