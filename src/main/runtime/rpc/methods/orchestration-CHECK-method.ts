import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, OptionalString, OptionalBoolean, requiredString } from '../schemas'
import {
  LEGACY_CONTRACT_VERSION,
  type MessageType,
  type MessagePriority,
  type TaskStatus
} from '../../orchestration/db'
import { MESSAGE_TYPES } from '../../orchestration/types'
import { buildDispatchPreamble } from '../../orchestration/preamble'
import { formatMessageBanner } from '../../orchestration/formatter'
import { isGroupAddress, resolveGroupAddress } from '../../orchestration/groups'
import { reconcileLifecycleMessage } from '../../orchestration/lifecycle-reconciliation'
import { abbreviateOrchestrationTasks } from '../../../../shared/orchestration-task-summary'
import {
  ORCHESTRATION_LEGACY_RUN_ID,
  orchestrationSkillRecoveryData
} from '../../../../shared/orchestration-rpc-contract'
import { clampOrchestrationAskTimeoutMs } from '../../../../shared/orchestration-ask-timeout'
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'
import { ORCHESTRATION_RUN_METHODS } from './orchestration-runs'
import { ORCHESTRATION_WORKER_METHODS } from './orchestration-worker-methods'
import { ORCHESTRATION_FEDERATION_METHODS } from './orchestration-federation-methods'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RunRow } from '../../orchestration/types'
import { encodeFederatedControlMessage } from '../../orchestration/federation-control-message'
import { ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION } from '../../../../shared/protocol-version'

const TASK_STATUSES: TaskStatus[] = [
  'pending',
  'ready',
  'dispatched',
  'completed',
  'failed',
  'blocked'
]

function getLifecycleGroupRecipientError(type: 'worker_done' | 'heartbeat'): string {
  return `${type} messages belong to one exact Dispatch and cannot target a group address.`
}

function parseRemoteWorkerPayload(payload: string | undefined): Record<string, unknown> {
  if (!payload) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    throw new OrchestrationError('invalid_argument', 'Message payload must be valid JSON.')
  }
}

function isWorkerReportOutcome(value: unknown): value is 'succeeded' | 'failed' {
  return value === 'succeeded' || value === 'failed'
}

const SendParams = z
  .object({
    to: OptionalString,
    subject: requiredString('Missing --subject'),
    from: OptionalString,
    body: OptionalString,
    type: z
      .enum([
        'status',
        'dispatch',
        'worker_done',
        'merge_ready',
        'escalation',
        'handoff',
        'decision_gate',
        'question',
        'heartbeat'
      ])
      .optional(),
    priority: z.enum(['normal', 'high', 'urgent']).optional(),
    threadId: OptionalString,
    payload: OptionalString,
    // Why: pane key is the remint-stable identity used to verify worker_done/heartbeat ownership; the from handle stays routing metadata.
    senderPaneKey: OptionalString,
    run: OptionalString,
    devMode: OptionalBoolean
  })
  .superRefine((params, ctx) => {
    if (
      (params.type !== 'worker_done' && params.type !== 'heartbeat') ||
      !params.to ||
      !isGroupAddress(params.to)
    ) {
      return
    }
    // Why: dispatch lifecycle messages are authority/liveness signals for one coordinator; fanout would create lifecycle mail in unrelated terminals.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: getLifecycleGroupRecipientError(params.type),
      path: ['to']
    })
  })

const CheckParams = z
  .object({
    terminal: OptionalString,
    terminalPaneKey: OptionalString,
    unread: OptionalBoolean,
    peek: OptionalBoolean,
    // Why: `all` surfaces every message and skips mark-read; legacy encoding was the `{unread: false}` trick (design doc §3.2/§3.3).
    all: OptionalBoolean,
    types: OptionalString,
    format: OptionalBoolean,
    // Why: one-release RPC compatibility only; the public CLI uses --format because no terminal input is injected.
    inject: OptionalBoolean,
    ack: OptionalString,
    compatibilityAck: OptionalString,
    compatibilityQuestionAck: OptionalString,
    compatibilityCliCommand: z.enum(['orca', 'orca-ide', 'orca-dev']).optional(),
    run: OptionalString,
    wait: OptionalBoolean,
    timeoutMs: OptionalFiniteNumber
  })
  .superRefine((params, ctx) => {
    // Why: CLI encodes --peek as {peek:true, unread:false} for pre-peek runtimes, so that pair is one mode, not a conflict.
    const modes = [
      params.unread === true,
      params.peek === true,
      params.all === true || (params.unread === false && params.peek !== true)
    ].filter(Boolean)
    if (modes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose at most one message read mode: --unread, --peek, or --all.'
      })
    }
  })

const ReplyParams = z.object({
  id: requiredString('Missing --id'),
  body: requiredString('Missing --body'),
  from: OptionalString,
  run: OptionalString
})

const InboxParams = z.object({
  limit: OptionalFiniteNumber,
  // Why: filters the inbox to a handle so inbox and check --all give agreeing results (design doc §3.3).
  terminal: OptionalString
})

const TaskCreateParams = z.object({
  spec: requiredString('Missing --spec'),
  taskTitle: OptionalString,
  displayName: OptionalString,
  deps: OptionalString,
  parent: OptionalString,
  callerTerminalHandle: OptionalString,
  run: OptionalString
})

const TaskListParams = z.object({
  status: z.enum(['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']).optional(),
  ready: OptionalBoolean,
  // Why: server-side truncation keeps --brief cheap over SSH/relay instead of shipping full specs the CLI throws away.
  brief: OptionalBoolean,
  run: OptionalString,
  callerTerminalHandle: OptionalString
})

const TaskUpdateParams = z.object({
  id: requiredString('Missing --id'),
  status: z
    .unknown()
    .transform((v) => {
      if (typeof v === 'string' && TASK_STATUSES.includes(v as TaskStatus)) {
        return v as TaskStatus
      }
      return ''
    })
    .pipe(
      z.enum(['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked'], {
        message: 'Missing --status'
      })
    ),
  result: OptionalString,
  run: OptionalString,
  callerTerminalHandle: OptionalString
})

const DispatchParams = z.object({
  task: requiredString('Missing --task'),
  // Why: --to is optional so --dry-run can preview without a target; the handler enforces presence before any side-effecting work.
  to: OptionalString,
  from: OptionalString,
  inject: OptionalBoolean,
  dryRun: OptionalBoolean,
  returnPreamble: OptionalBoolean,
  devMode: OptionalBoolean,
  run: OptionalString
})

const DispatchShowParams = z.object({
  task: OptionalString,
  preamble: OptionalBoolean,
  from: OptionalString,
  devMode: OptionalBoolean
})

const AskParams = z
  .object({
    to: OptionalString,
    question: OptionalString,
    resume: OptionalString,
    options: OptionalString,
    timeoutMs: OptionalFiniteNumber,
    from: OptionalString,
    run: OptionalString,
    compatibilityCliCommand: z.enum(['orca', 'orca-ide', 'orca-dev']).optional(),
    compatibilityWindowsCommand: z.enum(['orca', 'orca-ide']).optional()
  })
  .superRefine((params, ctx) => {
    if ((params.question ? 1 : 0) + (params.resume ? 1 : 0) !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one of --question or --resume.'
      })
    }
  })

const ResetParams = z
  .object({
    all: OptionalBoolean,
    tasks: OptionalBoolean,
    messages: OptionalBoolean
  })
  .superRefine((params, ctx) => {
    const selectedScopeCount = [params.all, params.tasks, params.messages].filter(
      (scope) => scope === true
    ).length
    if (selectedScopeCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose exactly one reset scope: --all, --tasks, or --messages.'
      })
    }
  })

function resolveRunScope(
  runtime: OrcaRuntimeService,
  params: {
    runId?: string
    callerTerminalHandle?: string
    callerPaneKey?: string
    requireCurrentConsumer: boolean
    legacyCoordinatorRunId?: string
  }
): RunRow {
  const db = runtime.getOrchestrationDb()
  const explicit = params.runId ? db.getRun(params.runId) : undefined
  if (params.runId && (!explicit || explicit.legacy === 1)) {
    throw new OrchestrationError('run_not_found', `Run ${params.runId} was not found.`)
  }

  if (!params.requireCurrentConsumer && explicit) {
    return explicit
  }
  if (explicit && params.legacyCoordinatorRunId === explicit.id) {
    return explicit
  }
  if (!params.callerTerminalHandle) {
    throw new OrchestrationError(
      'run_required',
      'No Run is bound. Use orchestration run-create or run-use first. No effects were applied.',
      orchestrationSkillRecoveryData()
    )
  }
  const paneKey = params.callerPaneKey ?? runtime.getTerminalPaneKey(params.callerTerminalHandle)
  if (!paneKey) {
    throw new OrchestrationError(
      'stable_pane_required',
      'The coordinator terminal has no stable pane identity.'
    )
  }
  const current = db.getCurrentRunForPane(paneKey)
  if (!current) {
    if (explicit) {
      throw new OrchestrationError(
        'consumer_fenced',
        `This coordinator terminal is no longer bound to Run ${explicit.id}.`
      )
    }
    throw new OrchestrationError(
      'run_required',
      'No Run is bound. Use orchestration run-create or run-use first. No effects were applied.',
      orchestrationSkillRecoveryData()
    )
  }
  if (explicit && current.id !== explicit.id) {
    throw new OrchestrationError(
      'consumer_fenced',
      `This coordinator terminal is bound to ${current.id}, not ${explicit.id}.`
    )
  }
  return current
}

function parseMessageTypes(rawTypes: string | undefined): MessageType[] | undefined {
  const types = rawTypes
    ?.split(',')
    .map((type) => type.trim())
    .filter(Boolean) as MessageType[] | undefined
  const invalidTypes = types?.filter((type) => !MESSAGE_TYPES.includes(type))
  if (invalidTypes && invalidTypes.length > 0) {
    throw new OrchestrationError('invalid_argument', `Invalid --types: ${invalidTypes.join(',')}`)
  }
  return types && types.length > 0 ? types : undefined
}

function resolveMessageRun(
  runtime: OrcaRuntimeService,
  params: {
    from?: string
    senderPaneKey?: string
    to?: string
    runId?: string
    payload?: string
  }
): { run: RunRow | undefined; dispatchId: string | undefined } {
  const db = runtime.getOrchestrationDb()
  let dispatchId: string | undefined
  if (params.payload) {
    try {
      const payload: unknown = JSON.parse(params.payload)
      if (
        payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        typeof (payload as { dispatchId?: unknown }).dispatchId === 'string'
      ) {
        dispatchId = (payload as { dispatchId: string }).dispatchId
      }
    } catch {
      // Lifecycle validation owns malformed payload errors; routing simply cannot derive a Dispatch.
    }
  }
  if (!dispatchId && params.to?.startsWith('dispatch:')) {
    dispatchId = params.to.slice('dispatch:'.length)
  }

  const dispatch = dispatchId
    ? db.getDispatchContextById(dispatchId)
    : params.from
      ? db.getActiveDispatchForIdentity(params.from, params.senderPaneKey)
      : undefined
  if (params.to?.startsWith('dispatch:') && !dispatch) {
    throw new OrchestrationError(
      'dispatch_not_found',
      `Dispatch ${dispatchId ?? ''} was not found.`
    )
  }
  const targetRunId = params.to?.startsWith('run:') ? params.to.slice('run:'.length) : undefined
  const resolvedRunId = params.runId ?? targetRunId ?? dispatch?.run_id
  let run = resolvedRunId ? db.getRun(resolvedRunId) : undefined

  if (!run && params.from) {
    const paneKey = params.senderPaneKey ?? runtime.getTerminalPaneKey(params.from)
    run = paneKey ? db.getCurrentRunForPane(paneKey) : undefined
  }
  if (resolvedRunId && (!run || run.legacy === 1)) {
    throw new OrchestrationError('run_not_found', `Run ${resolvedRunId} was not found.`)
  }
  if (run && targetRunId && targetRunId !== run.id) {
    throw new OrchestrationError('run_not_found', `Run ${targetRunId} was not found.`)
  }
  if (run && dispatch && dispatch.run_id !== run.id) {
    throw new OrchestrationError(
      'dispatch_run_mismatch',
      `Dispatch ${dispatch.id} belongs to Run ${dispatch.run_id}, not ${run.id}.`
    )
  }
  return { run, dispatchId: dispatch?.id ?? dispatchId }
}

function legacyWorkerDeliveryContract(
  runtime: OrcaRuntimeService,
  runId: string | undefined,
  recipient: string
): 'legacy_direct' | undefined {
  if (!runId) {
    return undefined
  }
  if (!recipient.startsWith('dispatch:')) {
    return runtime
      .getOrchestrationDb()
      .resolveLegacyWorkerCandidate({ runId, terminalHandle: recipient })
      ? 'legacy_direct'
      : undefined
  }
  const dispatch = runtime
    .getOrchestrationDb()
    .getDispatchContextById(recipient.slice('dispatch:'.length))
  return dispatch?.run_id === runId &&
    dispatch.contract_version === LEGACY_CONTRACT_VERSION &&
    (dispatch.status === 'pending' || dispatch.status === 'dispatched')
    ? 'legacy_direct'
    : undefined
}

function interruptedAcknowledgedCheck(
  runId: string,
  acknowledged: string,
  reason: 'consumer_fenced' | 'outcome_unknown' | 'waiter_exists'
): Record<string, unknown> {
  return {
    runId,
    deliveryId: null,
    messages: [],
    count: 0,
    acknowledged,
    timedOut: false,
    cancelled: false,
    connectionLost: false,
    waitInterrupted: reason
  }
}

function rejectFederatedExplicitTarget(params: { to?: string; run?: string }): void {
  if (params.to || params.run) {
    throw new OrchestrationError(
      'invalid_argument',
      'Federated Dispatch messages route to their Run home; omit --to and --run.'
    )
  }
}

import {
  TASK_STATUSES,
  SendParams,
  CheckParams,
  ReplyParams,
  InboxParams,
  TaskCreateParams,
  TaskListParams,
  TaskUpdateParams,
  DispatchParams,
  DispatchShowParams,
  AskParams,
  ResetParams,
  getLifecycleGroupRecipientError,
  parseRemoteWorkerPayload,
  isWorkerReportOutcome,
  resolveRunScope,
  parseMessageTypes,
  resolveMessageRun,
  legacyWorkerDeliveryContract,
  interruptedAcknowledgedCheck,
  rejectFederatedExplicitTarget,
  askRemoteRunHome
} from './orchestration-support'

export const ORCHESTRATION_CHECK_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.check',
    params: CheckParams,
    handler: async (
      params,
      {
        runtime,
        signal,
        legacyCoordinatorRunId,
        revalidateLegacyCoordinator,
        recordMutationReceipt
      }
    ) => {
      const db = runtime.getOrchestrationDb()
      const handle = params.terminal ?? 'unknown'
      const typeFilter = parseMessageTypes(params.types)

      // Why: a live runtime handle is authoritative; pane metadata is only the restart fallback.
      const paneKey = runtime.getTerminalPaneKey(handle) ?? params.terminalPaneKey
      const boundRun = paneKey ? db.getCurrentRunForPane(paneKey) : undefined
      if (params.run || boundRun) {
        const run = resolveRunScope(runtime, {
          runId: params.run,
          callerTerminalHandle: handle,
          callerPaneKey: paneKey ?? undefined,
          requireCurrentConsumer: true,
          legacyCoordinatorRunId
        })
        const generation = run.consumer_generation
        const address = `run:${run.id}`
        runtime.ensureOrchestrationFederationRelay(run.id)

        const acknowledged = params.ack
          ? db.acknowledgeRunDelivery({
              runId: run.id,
              consumerGeneration: generation,
              deliveryId: params.ack
            })
          : undefined
        if (acknowledged) {
          recordMutationReceipt?.(
            interruptedAcknowledgedCheck(run.id, acknowledged.delivery.id, 'outcome_unknown')
          )
        }
        if (params.peek || params.all || params.unread === false) {
          const history = db.getRunMailboxHistory(run.id, 100, typeFilter)
          const messages =
            params.all || (params.unread === false && !params.peek)
              ? history
              : history.filter((message) => message.read === 0)
          const result = {
            messages,
            count: messages.length,
            acknowledged: acknowledged?.delivery.id ?? null
          }
          if (params.format || params.inject) {
            return {
              ...result,
              formatted: messages.map(formatMessageBanner).join('\n\n'),
              runId: run.id
            }
          }
          return { ...result, runId: run.id }
        }

        const readDelivery = (wakeTypes?: MessageType[]) =>
          db.getOrCreateRunDelivery({
            runId: run.id,
            consumerGeneration: generation,
            wakeTypes
          })
        let current = readDelivery(params.wait ? typeFilter : undefined)
        if (current) {
          return {
            runId: run.id,
            deliveryId: current.delivery.id,
            messages: current.messages,
            count: current.messages.length,
            replayed: current.replayed,
            acknowledged: acknowledged?.delivery.id ?? null,
            timedOut: false,
            cancelled: false,
            connectionLost: false,
            ...(params.format || params.inject
              ? { formatted: current.messages.map(formatMessageBanner).join('\n\n') }
              : {})
          }
        }
        if (!params.wait) {
          return {
            runId: run.id,
            deliveryId: null,
            messages: [],
            count: 0,
            acknowledged: acknowledged?.delivery.id ?? null,
            timedOut: false,
            cancelled: false,
            connectionLost: false
          }
        }

        const waitResult = await runtime.waitForMessage(address, {
          typeFilter: typeFilter as string[] | undefined,
          timeoutMs: params.timeoutMs ?? undefined,
          signal,
          exclusive: true
        })
        try {
          revalidateLegacyCoordinator?.()
        } catch (error) {
          if (!acknowledged) {
            throw error
          }
          return interruptedAcknowledgedCheck(run.id, acknowledged.delivery.id, 'consumer_fenced')
        }
        const latestRun = db.getRun(run.id)
        if (!latestRun || latestRun.consumer_generation !== generation) {
          if (acknowledged) {
            return interruptedAcknowledgedCheck(run.id, acknowledged.delivery.id, 'consumer_fenced')
          }
          throw new OrchestrationError(
            'consumer_fenced',
            'This mailbox consumer was replaced while waiting.'
          )
        }
        if (waitResult === 'waiter_exists') {
          if (acknowledged) {
            return interruptedAcknowledgedCheck(run.id, acknowledged.delivery.id, 'waiter_exists')
          }
          throw new OrchestrationError(
            'waiter_exists',
            `Run ${run.id} already has an active actionable waiter.`
          )
        }
        if (waitResult === 'timed_out') {
          return {
            runId: run.id,
            deliveryId: null,
            messages: [],
            count: 0,
            acknowledged: acknowledged?.delivery.id ?? null,
            timedOut: true,
            cancelled: false,
            connectionLost: false
          }
        }
        if (waitResult === 'cancelled') {
          return {
            runId: run.id,
            deliveryId: null,
            messages: [],
            count: 0,
            acknowledged: acknowledged?.delivery.id ?? null,
            timedOut: false,
            cancelled: true,
            connectionLost: signal?.aborted === true
          }
        }

        current = readDelivery(typeFilter)
        return {
          runId: run.id,
          deliveryId: current?.delivery.id ?? null,
          messages: current?.messages ?? [],
          count: current?.messages.length ?? 0,
          replayed: current?.replayed ?? false,
          acknowledged: acknowledged?.delivery.id ?? null,
          timedOut: false,
          cancelled: false,
          connectionLost: false,
          ...(params.format && current
            ? { formatted: current.messages.map(formatMessageBanner).join('\n\n') }
            : {})
        }
      }

      const activeDispatch = db.getActiveDispatchForIdentity(handle, paneKey ?? undefined)
      const remoteAttachment =
        !activeDispatch && paneKey ? db.findActiveRemoteAttachmentForPane(paneKey) : undefined
      if (
        remoteAttachment &&
        !db.isRemoteAttachmentProcessCurrent({
          dispatchId: remoteAttachment.dispatch_id,
          paneKey: paneKey ?? null,
          processIncarnation: runtime.getTerminalProcessIncarnation(handle)
        })
      ) {
        throw new OrchestrationError(
          'dispatch_inactive',
          `Dispatch ${remoteAttachment.dispatch_id} is no longer attached to this worker process.`
        )
      }
      const workerMailbox = activeDispatch
        ? { dispatchId: activeDispatch.id, runId: activeDispatch.run_id }
        : remoteAttachment
          ? { dispatchId: remoteAttachment.dispatch_id, runId: undefined }
          : undefined
      if (workerMailbox) {
        const address = `dispatch:${workerMailbox.dispatchId}`
        const showAll = params.all === true || (params.unread === false && params.peek !== true)
        const messages = showAll
          ? db.getAllMessagesForHandle(address, 100, typeFilter)
          : db.getUnreadMessages(address, typeFilter)
        if (!showAll && params.peek !== true && messages.length > 0) {
          db.markAsRead(messages.map((message) => message.id))
        }
        if (messages.length > 0 || !params.wait) {
          return {
            ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
            dispatchId: workerMailbox.dispatchId,
            messages,
            count: messages.length,
            ...(params.format || params.inject
              ? { formatted: messages.map(formatMessageBanner).join('\n\n') }
              : {})
          }
        }
        const waitResult = await runtime.waitForMessage(address, {
          typeFilter: typeFilter as string[] | undefined,
          timeoutMs: params.timeoutMs ?? undefined,
          signal
        })
        if (waitResult === 'timed_out' || waitResult === 'cancelled') {
          return {
            ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
            dispatchId: workerMailbox.dispatchId,
            messages: [],
            count: 0,
            timedOut: waitResult === 'timed_out',
            cancelled: waitResult === 'cancelled',
            connectionLost: waitResult === 'cancelled' && signal?.aborted === true
          }
        }
        const arrived = db.getUnreadMessages(address, typeFilter)
        db.markAsRead(arrived.map((message) => message.id))
        return {
          ...(workerMailbox.runId ? { runId: workerMailbox.runId } : {}),
          dispatchId: workerMailbox.dispatchId,
          messages: arrived,
          count: arrived.length,
          ...(params.format || params.inject
            ? { formatted: arrived.map(formatMessageBanner).join('\n\n') }
            : {})
        }
      }

      // Why: unread:false is honored for one release as a compat shim so in-flight callers don't break (design doc §5).
      const showAll = params.all === true || (params.unread === false && params.peek !== true)
      const consumeUnread = !showAll && params.peek !== true

      const readAndReturn = () => {
        const messages = showAll
          ? db.getAllMessagesForHandle(handle, undefined, typeFilter)
          : db.getUnreadMessages(handle, typeFilter)

        if (
          consumeUnread &&
          messages.some((message) => message.run_id === ORCHESTRATION_LEGACY_RUN_ID)
        ) {
          throw new OrchestrationError(
            'legacy_read_only',
            'Legacy orchestration messages are inspect-only; use --peek or --all. No acknowledgment was applied.',
            { effectsApplied: false }
          )
        }

        let visibleMessages = messages
        if (consumeUnread && messages.length > 0) {
          // Why: unread check is an authoritative read path for worker_done/heartbeat, so reconcile lifecycle messages here too.
          visibleMessages = messages.map((message) => {
            const reconciled = reconcileLifecycleMessage(db, message)
            return reconciled.action === 'rejected'
              ? (db.getMessageById(message.id) ?? message)
              : message
          })
          db.markAsRead(messages.map((m) => m.id))
        }

        if (params.format || params.inject) {
          const formatted = visibleMessages.map(formatMessageBanner).join('\n\n')
          return { messages: visibleMessages, formatted, count: visibleMessages.length }
        }

        return { messages: visibleMessages, count: visibleMessages.length }
      }

      if (signal?.aborted) {
        return { messages: [], count: 0 }
      }
      const result = readAndReturn()
      if (result.count > 0 || !params.wait) {
        return result
      }

      // Why: signal aborts this waiter when the client socket closes, freeing the long-poll slot immediately rather than after timeoutMs (design doc §3.1).
      await runtime.waitForMessage(handle, {
        typeFilter: typeFilter as string[] | undefined,
        timeoutMs: params.timeoutMs ?? undefined,
        signal
      })
      if (signal?.aborted) {
        return { messages: [], count: 0 }
      }
      return readAndReturn()
    }
  }),

]

