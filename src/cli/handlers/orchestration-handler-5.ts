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

export const ORCHESTRATION_HANDLERS_5: Record<string, CommandHandler> = {
  'orchestration dispatch': async ({ flags, client, cwd, json }) => {
    const from = await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
    const dryRun = flags.has('dry-run') ? true : undefined
    const returnPreamble = flags.has('return-preamble') ? true : undefined
    // Why: --to is only required for non-dry-run; the RPC handler re-enforces.
    const to = dryRun ? getOptionalStringFlag(flags, 'to') : getRequiredStringFlag(flags, 'to')
    const result = await orchestrationSupport.callMutation<{
      dispatch: { id: string; task_id: string; status: string } | null
      injected?: boolean
      dryRun?: boolean
      preamble?: string
    }>(client, flags, 'orchestration.dispatch', {
      task: getRequiredStringFlag(flags, 'task'),
      run: getOptionalStringFlag(flags, 'run'),
      to,
      from,
      inject: flags.has('inject') ? true : undefined,
      dryRun,
      returnPreamble,
      devMode: orchestrationSupport.isDevCliInvocation()
    })
    printResult(result, json, (r) => {
      if (r.dryRun) {
        return r.preamble ?? ''
      }
      const base = `Dispatched ${r.dispatch?.task_id} -> ${r.dispatch?.id} [${r.dispatch?.status}]`
      return r.preamble ? `${base}\n\n--- Preamble ---\n${r.preamble}` : base
    })
  },

  'orchestration ask': async ({ flags, client, cwd, json }) => {
    const parsedTimeoutMs = orchestrationSupport.getOptionalPositiveIntegerValueFlag(flags, 'timeout-ms')
    const timeoutMs = clampOrchestrationAskTimeoutMs(parsedTimeoutMs)
    const from = await orchestrationSupport.resolveOrchestrationTerminalHandle(flags, cwd, client, 'from')
    const question = getOptionalStringFlag(flags, 'question')
    const resume = getOptionalStringFlag(flags, 'resume')
    if ((question ? 1 : 0) + (resume ? 1 : 0) !== 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Choose exactly one of --question or --resume.'
      )
    }
    if (resume && flags.has('options')) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--options is only valid when creating a new question.'
      )
    }
    const result = await orchestrationSupport.callMutation<{
      answer: string | null
      messageId: string | null
      threadId: string
      timedOut: boolean
      timeoutMs?: number
      cancelled?: boolean
      connectionLost?: boolean
      answerMessageId?: string | null
      legacyCompatibility?: LegacyCompatibilityResult
    }>(
      client,
      flags,
      'orchestration.ask',
      {
        to: getOptionalStringFlag(flags, 'to'),
        run: getOptionalStringFlag(flags, 'run'),
        question,
        resume,
        options: getOptionalStringFlag(flags, 'options'),
        timeoutMs: parsedTimeoutMs === undefined ? undefined : timeoutMs,
        from,
        compatibilityCliCommand: orchestrationSupport.resolveCompatibilityCliCommand(),
        compatibilityWindowsCommand: orchestrationSupport.resolvePackagedWindowsCompatibilityCommand()
      },
      // Why: extend past timeoutMs so the RPC transport's 60s default doesn't abort before the runtime's own timeout resolves.
      {
        timeoutMs: resolveOrchestrationAskClientTimeoutMs(parsedTimeoutMs),
        orchestrationCapability: getOptionalStringFlag(flags, 'dispatch-capability')
      }
    )
    // Why: bypass printResult so --json emits a bare JSON object (no envelope) pipeable via `jq -r .answer`, unlike other verbs.
    if (json) {
      console.log(JSON.stringify(result.result))
    } else if (result.result.legacyCompatibility?.resumeRequired) {
      console.log(`Question ${result.result.messageId} committed.`)
      console.log(`Resume with: ${result.result.legacyCompatibility.resumeCommand}`)
    } else if (result.result.answer !== null) {
      console.log(result.result.answer)
    }
    if (result.result.legacyCompatibility?.resumeRequired) {
      await orchestrationSupport.flushStdout()
      process.exitCode = 75
      return
    }
    const answerAck = result.result.legacyCompatibility?.answerAcknowledgement
    if (answerAck && result.result.answer !== null) {
      await orchestrationSupport.flushStdout()
      await client.call('orchestration.check', {
        terminal: from,
        compatibilityQuestionAck: JSON.stringify(answerAck)
      })
    }
    if (result.result.timedOut) {
      if (!json) {
        // Why: report the server's effective budget — it clamps large values, so the requested one would overstate the wait.
        const waitedMs = result.result.timeoutMs ?? timeoutMs
        console.error(`ask timeout after ${waitedMs}ms (thread ${result.result.threadId})`)
      }
      process.exitCode = 1
    }
    if (result.result.cancelled) {
      if (!json) {
        console.error(
          result.result.connectionLost
            ? `ask connection closed (question ${result.result.messageId})`
            : `ask cancelled (question ${result.result.messageId})`
        )
      }
      process.exitCode = 1
    }
  },

  'orchestration dispatch-show': async ({ flags, client, cwd, json }) => {
    const showPreamble = flags.has('preamble') ? true : undefined
    // Why: resolve --from so the previewed preamble embeds a real coordinator handle like an actual dispatch.
    const from = showPreamble
      ? await orchestrationSupport.resolveCoordinatorTerminalHandle(flags, cwd, client)
      : undefined
    const result = await client.call<{
      dispatch: { id: string; task_id: string; status: string } | null
      preamble?: string
    }>('orchestration.dispatchShow', {
      task: getRequiredStringFlag(flags, 'task'),
      preamble: showPreamble,
      from,
      devMode: orchestrationSupport.isDevCliInvocation()
    })
    printResult(result, json, (r) => {
      if (r.preamble && showPreamble) {
        return r.preamble
      }
      if (!r.dispatch) {
        return 'No dispatch context found.'
      }
      return `${r.dispatch.id} task=${r.dispatch.task_id} [${r.dispatch.status}]`
    })
  },


}
