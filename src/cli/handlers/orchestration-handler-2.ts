import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import {
  formatMessageReadOnlyTag,
  formatOrchestrationCheckText,
  prepareOrchestrationCheckOutput,
  type LegacyCompatibilityResult,
  type OrchestrationMessageSummary as MessageSummary
} from '../../shared/orchestration-check-output'
import type { OrchestrationSendResult } from './orchestration-handler-support'
import * as orchestrationSupport from './orchestration-handler-support'

export const ORCHESTRATION_HANDLERS_2: Record<string, CommandHandler> = {
  'orchestration send': async ({ flags, client, cwd, json }) => {
    const to = getOptionalStringFlag(flags, 'to')
    const type = getOptionalStringFlag(flags, 'type')
    if (to) {
      orchestrationSupport.rejectLifecycleGroupRecipient(type, to)
    }
    const outcome = getOptionalStringFlag(flags, 'outcome')
    if (type !== 'worker_done' && outcome !== undefined) {
      throw new RuntimeClientError(
        'invalid_argument',
        '--outcome is only valid with --type worker_done.'
      )
    }

    if (
      (type === 'worker_done' || type === 'heartbeat') &&
      !getOptionalStringFlag(flags, 'from') &&
      !process.env.ORCA_TERMINAL_HANDLE
    ) {
      // Why: focus isn't lifecycle authority — an identity-less subprocess must fail closed rather than guess the worker.
      orchestrationSupport.throwNoActiveSenderTerminal()
    }

    // Why: lifecycle senders keep ORCA_TERMINAL_HANDLE verbatim — no liveness probe (worker_done must survive the mid-restart window) and no remint (older runtimes require from === the stale assignee_handle).
    const from = await orchestrationSupport.resolveOrchestrationTerminalHandle(
      flags,
      cwd,
      client,
      'from'
    )
    const sendParams = {
      from,
      to,
      run: getOptionalStringFlag(flags, 'run'),
      subject: getRequiredStringFlag(flags, 'subject'),
      body: getOptionalStringFlag(flags, 'body'),
      type,
      priority: getOptionalStringFlag(flags, 'priority'),
      threadId: getOptionalStringFlag(flags, 'thread-id'),
      payload: orchestrationSupport.getOptionalStructuredMessagePayload(flags),
      // Why: pane key is the remint-stable sender identity the runtime verifies lifecycle ownership against; older runtimes strip it.
      senderPaneKey: process.env.ORCA_PANE_KEY || undefined,
      devMode: orchestrationSupport.isDevCliInvocation()
    }
    const dispatchCapability = getOptionalStringFlag(flags, 'dispatch-capability')
    const result = await orchestrationSupport.callMutation<OrchestrationSendResult>(
      client,
      flags,
      'orchestration.send',
      sendParams,
      dispatchCapability ? { orchestrationCapability: dispatchCapability } : undefined
    )
    if ('message' in result.result && result.result.lifecycle?.action === 'rejected') {
      // Why: a rejected lifecycle signal isn't completion; non-zero exit stops workers from treating it as such.
      process.exitCode = 1
    }
    printResult(result, json, (r) => {
      if ('message' in r) {
        if (r.lifecycle?.action === 'rejected') {
          return `Rejected ${r.message.id}: ${r.lifecycle.reason}`
        }
        return `Sent ${r.message.id}`
      }
      if ('relay' in r) {
        if (r.relay.destination === 'worker') {
          return `Queued ${r.relay.messageId} for worker Dispatch ${r.relay.dispatchId}`
        }
        return `Queued ${r.relay.messageId} for Run home (Dispatch ${r.relay.dispatchId})`
      }
      return `Sent ${r.messages.length} messages to ${r.recipients} recipients`
    })
  },

  'orchestration check': async ({ flags, client, cwd, json }) => {
    const wait = flags.has('wait')
    const peek = flags.has('peek')
    // Why: enforce mode exclusivity client-side — older runtimes strip unknown peek and run --unread --peek as destructive mark-read.
    if ([flags.has('unread'), peek, flags.has('all')].filter(Boolean).length > 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Choose at most one message read mode: --unread, --peek, or --all.'
      )
    }
    const timeoutMs = orchestrationSupport.getOptionalPositiveIntegerValueFlag(flags, 'timeout-ms')
    const explicitTerminal = getOptionalStringFlag(flags, 'terminal')
    const terminal = await orchestrationSupport.resolveOrchestrationTerminalHandle(
      flags,
      cwd,
      client,
      'terminal'
    )

    // Why: Claude Code auto-backgrounds subprocesses silent ~2 min; emit JSON keepalives to stderr (stdout stays one payload). See §3.4.
    const stopKeepalive = wait ? orchestrationSupport.startCheckKeepalive(timeoutMs) : null
    type CheckResult = {
      messages: MessageSummary[]
      count: number
      formatted?: string
      deliveryId?: string | null
      runId?: string
      timedOut?: boolean
      cancelled?: boolean
      connectionLost?: boolean
      legacyCompatibility?: LegacyCompatibilityResult
    }
    let result: Awaited<ReturnType<typeof client.call<CheckResult>>>
    try {
      result = await orchestrationSupport.callMutation<CheckResult>(
        client,
        flags,
        'orchestration.check',
        {
          terminal,
          terminalPaneKey: explicitTerminal ? undefined : process.env.ORCA_PANE_KEY || undefined,
          // Why: peek also sends unread:false so pre-peek runtimes degrade to non-consuming all mode instead of destructive mark-read.
          unread: flags.has('unread') ? true : peek ? false : undefined,
          peek: peek ? true : undefined,
          all: flags.has('all') ? true : undefined,
          types: getOptionalStringFlag(flags, 'types'),
          format: flags.has('format') ? true : undefined,
          inject: flags.has('inject') ? true : undefined,
          compatibilityCliCommand: orchestrationSupport.resolveCompatibilityCliCommand(),
          run: getOptionalStringFlag(flags, 'run'),
          ack: getOptionalStringFlag(flags, 'ack'),
          wait: wait ? true : undefined,
          timeoutMs
        }
      )
    } finally {
      stopKeepalive?.()
    }
    if (peek) {
      const rawRowCount = result.result.messages.length
      const unreadOnly = result.result.messages.filter((m) => m.read !== 1)
      const removedReadRows = unreadOnly.length !== rawRowCount
      // Why: read rows mean a pre-peek runtime ran the all mode and returned instead of blocking; can't honor --wait, so fail loudly.
      if (wait && removedReadRows && unreadOnly.length === 0) {
        throw new RuntimeClientError(
          'peek_wait_unsupported',
          'The connected runtime does not support --peek with --wait; upgrade the runtime or use --wait without --peek.'
        )
      }
      // Why: pre-peek runtimes cap the all mode at 100 rows; a full page may hide older unread — warn on stderr.
      if (removedReadRows && rawRowCount >= 100) {
        console.error(
          'Warning: this runtime returned only its newest 100 messages for --peek; older unread messages may be missing. Upgrade the runtime for exact peek results.'
        )
      }
      result = {
        ...result,
        result: {
          ...result.result,
          // Why: a pre-peek runtime builds `formatted` from all rows; drop it so output matches the filtered peek set.
          ...(removedReadRows ? { formatted: undefined } : {}),
          messages: unreadOnly,
          count: unreadOnly.length
        }
      }
    }
    result = {
      ...result,
      result: prepareOrchestrationCheckOutput(result.result, terminal, flags.has('format'))
    }
    printResult(result, json, (r) => formatOrchestrationCheckText(r, terminal))
    const compatibilityAck = result.result.legacyCompatibility?.ackMessageIds
    if (compatibilityAck && compatibilityAck.length > 0) {
      await orchestrationSupport.flushStdout()
      await client.call('orchestration.check', {
        terminal,
        compatibilityAck: JSON.stringify({
          messageIds: compatibilityAck,
          types: getOptionalStringFlag(flags, 'types')
            ?.split(',')
            .map((type) => type.trim())
            .filter(Boolean)
        })
      })
    }
  },

  'orchestration reply': async ({ flags, client, cwd, json }) => {
    const from = await orchestrationSupport.resolveOrchestrationTerminalHandle(
      flags,
      cwd,
      client,
      'from'
    )
    const result = await orchestrationSupport.callMutation<{ message: { id: string } }>(
      client,
      flags,
      'orchestration.reply',
      {
        id: getRequiredStringFlag(flags, 'id'),
        body: getRequiredStringFlag(flags, 'body'),
        run: getOptionalStringFlag(flags, 'run'),
        from
      }
    )
    printResult(result, json, (r) => `Replied ${r.message.id}`)
  },

  'orchestration inbox': async ({ flags, client, json }) => {
    const full = flags.has('full')
    const result = await client.call<{
      messages: MessageSummary[]
      count: number
    }>('orchestration.inbox', {
      limit: getOptionalPositiveIntegerFlag(flags, 'limit'),
      terminal: getOptionalStringFlag(flags, 'terminal')
    })
    printResult(result, json, (r) => {
      if (r.count === 0) {
        return 'No messages.'
      }
      // Why: default output omits body/payload for at-a-glance sweeps; --full prints them for auditing.
      return r.messages
        .map((m) => {
          const head = `${m.id}${formatMessageReadOnlyTag(m)} ${m.from_handle} -> ${m.to_handle ?? '?'}: "${m.subject}"`
          if (!full) {
            return head
          }
          const parts = [head]
          if (m.body && m.body.length > 0) {
            parts.push(m.body)
          }
          if (m.payload) {
            parts.push(`[payload] ${m.payload}`)
          }
          return parts.join('\n')
        })
        .join(full ? '\n\n' : '\n')
    })
  }
}
