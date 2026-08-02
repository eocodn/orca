import type { CommandHandler } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import { printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { getTerminalHandle } from '../selectors'
import {
  clampOrchestrationAskTimeoutMs,
  resolveOrchestrationAskClientTimeoutMs
} from '../../shared/orchestration-ask-timeout'
import { abbreviateOrchestrationTasks } from '../../shared/orchestration-task-summary'
import { parsePositiveSafeIntegerText } from '../../shared/timer-delay'
import type {
  OrchestrationWorkerReadResult,
  OrchestrationWorkerReadSource
} from '../../shared/orchestration-worker-output'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import type { RuntimeTerminalRead } from '../../shared/runtime-types'
import { orchestrationMigrationData } from '../../shared/orchestration-rpc-contract'
import { ORCHESTRATION_RUN_PAGE_LIMIT } from '../../shared/orchestration-run-pagination'
import {
  formatMessageReadOnlyTag,
  formatOrchestrationCheckText,
  prepareOrchestrationCheckOutput,
  type LegacyCompatibilityResult,
  type OrchestrationMessageSummary as MessageSummary
} from '../../shared/orchestration-check-output'

// Why: 15 s is well under Claude Code's ~2 min Bash-tool silence budget while keeping log volume low. See design doc §3.4.
import * as orchestrationSupport from './orchestration-handler-support'

export const ORCHESTRATION_HANDLERS_1: Record<string, CommandHandler> = {
  'orchestration run-create': async ({ flags, client, cwd, json }) => {
    const from = await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await orchestrationSupport.callMutation<{
      run: { id: string; objective: string; consumer_generation: number }
    }>(client, flags, 'orchestration.runCreate', {
      objective: getRequiredStringFlag(flags, 'objective'),
      from
    })
    printResult(result, json, (r) => `Run ${r.run.id} created and bound: ${r.run.objective}`)
  },

  'orchestration run-use': async ({ flags, client, cwd, json }) => {
    const from = await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await orchestrationSupport.callMutation<{
      run: { id: string; objective: string; consumer_generation: number }
    }>(client, flags, 'orchestration.runUse', {
      id: getRequiredStringFlag(flags, 'id'),
      from,
      ...(flags.has('takeover-legacy') ? { takeoverLegacy: true } : {})
    })
    printResult(result, json, (r) => `Using Run ${r.run.id}: ${r.run.objective}`)
  },

  'orchestration run-current': async ({ flags, client, cwd, json }) => {
    const from = await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await client.call<{
      run: { id: string; objective: string } | null
    }>('orchestration.runCurrent', { from })
    printResult(result, json, (r) =>
      r.run ? `${r.run.id} ${r.run.objective}` : 'No Run is bound to this terminal.'
    )
  },

  'orchestration run-list': async ({ flags, client, json }) => {
    const result = await client.call<{
      runs: { id: string; objective: string; legacy: number }[]
      nextCursor: string | null
    }>('orchestration.runList', {
      limit: getOptionalPositiveIntegerFlag(flags, 'limit') ?? ORCHESTRATION_RUN_PAGE_LIMIT,
      cursor: getOptionalStringFlag(flags, 'cursor')
    })
    printResult(result, json, (r) => {
      const rows =
        r.runs.length === 0
          ? 'No Runs found.'
          : r.runs
              .map(
                (run) => `${run.id}${run.legacy ? ' [legacy, inspect only]' : ''} ${run.objective}`
              )
              .join('\n')
      return r.nextCursor ? `${rows}\nMore Runs: --cursor ${r.nextCursor}` : rows
    })
  },

  'orchestration run-show': async ({ flags, client, json }) => {
    const result = await client.call<{
      run: {
        id: string
        objective: string
        consumer_generation: number
        legacy: number
        created_at: string
      }
    }>('orchestration.runShow', { id: getRequiredStringFlag(flags, 'id') })
    printResult(
      result,
      json,
      (r) =>
        `${r.run.id}${r.run.legacy ? ' [legacy, inspect only]' : ''} ${r.run.objective}\n` +
        `consumer generation ${r.run.consumer_generation}; created ${r.run.created_at}`
    )
  },


}
