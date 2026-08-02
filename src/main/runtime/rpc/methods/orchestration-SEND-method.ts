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

export const ORCHESTRATION_SEND_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'orchestration.send',
    params: SendParams,
    handler: async (
      params,
      { runtime, orchestrationCapability, legacyCoordinatorRunId, revalidateLegacyCoordinator }
    ) => {
      const db = runtime.getOrchestrationDb()
      const from = params.from ?? 'unknown'
      // Why: caller-supplied pane fields are only compatibility metadata; lifecycle authority uses the runtime-observed pane plus capability.
      const senderPaneKey = runtime.getTerminalPaneKey(from) ?? undefined
      const remoteAttachment = senderPaneKey
        ? db.findActiveRemoteAttachmentForPane(senderPaneKey)
        : undefined
      if (remoteAttachment) {
        rejectFederatedExplicitTarget(params)
        const processIncarnation = runtime.getTerminalProcessIncarnation(from)
        if (
          !db.verifyRemoteAttachmentAuthority({
            dispatchId: remoteAttachment.dispatch_id,
            capability: orchestrationCapability,
            paneKey: senderPaneKey ?? null,
            processIncarnation
          })
        ) {
          throw new OrchestrationError(
            'dispatch_capability_invalid',
            'The remote Dispatch capability or exact worker process is invalid.'
          )
        }
        const type = (params.type ?? 'status') as MessageType
        const payload = parseRemoteWorkerPayload(params.payload)
        if (
          typeof payload.dispatchId === 'string' &&
          payload.dispatchId !== remoteAttachment.dispatch_id
        ) {
          throw new OrchestrationError(
            'dispatch_inactive',
            `Dispatch ${payload.dispatchId} is not the active remote Dispatch for this pane.`
          )
        }
        const outcome =
          type === 'worker_done' &&
          (payload.outcome === 'succeeded' || payload.outcome === 'failed')
            ? payload.outcome
            : undefined
        if (type === 'worker_done' && !outcome) {
          throw new OrchestrationError(
            'invalid_argument',
            'Remote worker_done requires outcome=succeeded|failed.'
          )
        }
        const relay = db.enqueueFederationRelay({
          dispatchId: remoteAttachment.dispatch_id,
          direction: 'to_home',
          kind: type,
          payload: JSON.stringify({
            from,
            subject: params.subject,
            body: params.body ?? '',
            type,
            priority: params.priority ?? 'normal',
            threadId: params.threadId ?? null,
            payload: params.payload ?? null
          }),
          settleRemoteOutcome: outcome
        })
        return {
          relay: {
            messageId: relay.message_id,
            sequence: relay.sequence,
            dispatchId: relay.dispatch_id,
            destination: 'run_home',
            accepted: true
          },
          ...(outcome
            ? { lifecycle: { action: outcome === 'succeeded' ? 'completed' : 'failed' } }
            : {})
        }
      }
      const routing = resolveMessageRun(runtime, {
        from,
        senderPaneKey,
        to: params.to,
        runId: params.run,
        payload: params.payload
      })
      if (
        params.type === 'worker_done' &&
        !isWorkerReportOutcome(parseRemoteWorkerPayload(params.payload).outcome)
      ) {
        throw new OrchestrationError(
          'invalid_argument',
          'worker_done requires outcome=succeeded|failed for a current Dispatch.'
        )
      }
      if (params.to?.startsWith('task:')) {
        throw new OrchestrationError(
          'invalid_argument',
          'Task recipients are intentionally unsupported; use run:<id> or dispatch:<id>.'
        )
      }
      let to = params.to
      if (
        routing.run &&
        (!to ||
          ((params.type === 'worker_done' || params.type === 'heartbeat') && routing.dispatchId))
      ) {
        to = `run:${routing.run.id}`
      }
      if (!to) {
        throw new OrchestrationError(
          'run_required',
          'No recipient or active Dispatch Run could be resolved. No effects were applied.',
          orchestrationSkillRecoveryData()
        )
      }

      if (!isGroupAddress(to)) {
        const federatedDispatchId = routing.dispatchId
        const federatedTarget =
          federatedDispatchId && to === `dispatch:${federatedDispatchId}`
            ? db.getFederatedDispatch(federatedDispatchId)
            : undefined
        if (federatedTarget && federatedDispatchId) {
          const dispatchId = federatedDispatchId
          if (
            federatedTarget.protocol_version <
            ORCHESTRATION_FEDERATION_CONTROL_MAIL_PROTOCOL_VERSION
          ) {
            throw new OrchestrationError(
              'capability_unsupported',
              `Federated Dispatch ${dispatchId} does not support coordinator control mail; start a fresh worker after updating its Orca server.`
            )
          }
          if (db.getWorkerDispatch(dispatchId)?.state !== 'ready') {
            throw new OrchestrationError(
              'dispatch_inactive',
              `Federated Dispatch ${dispatchId} is not active.`
            )
          }
          if (params.type === 'worker_done' || params.type === 'heartbeat') {
            throw new OrchestrationError(
              'invalid_argument',
              'Coordinator-to-worker control mail cannot report worker lifecycle.'
            )
          }
          revalidateLegacyCoordinator?.()
          const relay = db.enqueueFederationRelay({
            dispatchId,
            direction: 'to_worker',
            kind: 'control_message',
            payload: encodeFederatedControlMessage({
              from,
              subject: params.subject,
              body: params.body ?? '',
              type: (params.type ?? 'status') as MessageType,
              priority: (params.priority ?? 'normal') as MessagePriority,
              threadId: params.threadId ?? null,
              payload: params.payload ?? null
            })
          })
          runtime.ensureOrchestrationFederationRelay(routing.run?.id)
          return {
            relay: {
              messageId: relay.message_id,
              sequence: relay.sequence,
              dispatchId: relay.dispatch_id,
              destination: 'worker',
              accepted: true
            }
          }
        }
        // Point-to-point — existing single-recipient behavior
        revalidateLegacyCoordinator?.()
        const msg = db.insertMessage({
          from,
          to,
          subject: params.subject,
          body: params.body,
          type: params.type as MessageType,
          priority: params.priority as MessagePriority,
          threadId: params.threadId,
          payload: params.payload,
          senderPaneKey,
          runId: routing.run?.id,
          deliveryContract: legacyWorkerDeliveryContract(
            runtime,
            routing.run?.id ?? legacyCoordinatorRunId,
            to
          )
        })
        const dispatch = routing.dispatchId
          ? db.getDispatchContextById(routing.dispatchId)
          : undefined
        if ((msg.type === 'worker_done' || msg.type === 'heartbeat') && dispatch?.capability_hash) {
          const authority = db.verifyDispatchCapability({
            dispatchId: dispatch.id,
            capability: orchestrationCapability,
            paneKey: senderPaneKey,
            processIncarnation: runtime.getTerminalProcessIncarnation(from) ?? undefined
          })
          if (!authority.valid) {
            const rejection =
              db.convertLifecycleMessageToRejection(
                msg.id,
                'dispatch_capability_invalid',
                authority.reason
              ) ?? msg
            runtime.notifyMessageArrived(to, rejection.type)
            return {
              message: rejection,
              lifecycle: {
                action: 'rejected',
                code: 'dispatch_capability_invalid',
                reason: authority.reason
              }
            }
          }
        }
        // Why: reconcile releases the dispatch lock before waking recipients, else a woken coordinator re-dispatches while the lock is still held.
        if (msg.type === 'worker_done' || msg.type === 'heartbeat') {
          const reconciled = reconcileLifecycleMessage(db, msg)
          // Why: a suppressed message is already read, so skip the notify that would wake a check --wait waiter to an empty result.
          if (reconciled.action === 'suppressed') {
            return { message: msg }
          }
          if (reconciled.action === 'rejected') {
            const rejection = db.getMessageById(msg.id) ?? msg
            runtime.notifyMessageArrived(to, rejection.type)
            return { message: rejection, lifecycle: reconciled }
          }
        }
        runtime.notifyMessageArrived(to, msg.type)
        return { message: msg }
      }

      // Why: fan out one message per recipient (independent read-tracking) but share a thread_id for correlation (Section 4.5).
      const { terminals } = await runtime.listTerminals()
      const handles = resolveGroupAddress(to, from, terminals, (handle: string) =>
        runtime.getAgentStatusForHandle(handle)
      )

      if (handles.length === 0) {
        throw new Error(`No recipients resolved for group address: ${to}`)
      }

      revalidateLegacyCoordinator?.()
      const threadId = params.threadId ?? `thread_${Date.now()}`
      const messages = handles.map((handle) =>
        db.insertMessage({
          from,
          to: handle,
          subject: params.subject,
          body: params.body,
          type: params.type as MessageType,
          priority: params.priority as MessagePriority,
          threadId,
          payload: params.payload,
          senderPaneKey,
          runId: routing.run?.id,
          deliveryContract: legacyWorkerDeliveryContract(
            runtime,
            routing.run?.id ?? legacyCoordinatorRunId,
            handle
          )
        })
      )
      for (const message of messages) {
        runtime.notifyMessageArrived(message.to_handle, message.type)
      }

      return { messages, recipients: handles.length }
    }
  }),

]

